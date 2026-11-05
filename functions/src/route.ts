// Real street routes for the room page's "Getting around" map:
// GET /api/route?code=<listing>&lat=<to>&lng=<to>&mode=walk|bike|drive (Hosting rewrite -> routeLine).
// The route always starts at the listing's own saved spot (an active listing's location is public in
// Firestore), never at a point the caller sends, and ends within 6 km (walk, bike) or 25 km (drive) of it
// inside the map's Chicago area, so this is not a free routing API. HERE Routing v8 answers with
// flexible polylines; they are decoded here and thinned to at most 400 points. Answers are kept in
// memory for a day and at Hosting's CDN for a day. Failures answer an empty line, never HERE's own
// error, and the key (Firebase secret HERE_API_KEY) never leaves this file or reaches a log.
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';
import { decodeFlexPolyline } from './flexpolyline.js';

const HERE_API_KEY = defineSecret('HERE_API_KEY');

export type Mode = 'walk' | 'bike' | 'drive';
export type LatLng = [number, number];

export interface Point {
  lat: number;
  lng: number;
}

export interface RouteQuery {
  code: string;
  to: Point;
  mode: Mode;
}

export interface RouteBody {
  points: LatLng[]; // from the room to the place; empty when there is no route
  seconds: number | null;
  meters: number | null;
  mode: Mode;
}

export interface Answer {
  status: number;
  cache: string;
  body: RouteBody | { error: string };
}

export const HERE_ROUTES = 'https://router.hereapi.com/v8/routes';
export const TRANSPORT: Record<Mode, string> = { walk: 'pedestrian', bike: 'bicycle', drive: 'car' };
export const MAX_KM: Record<Mode, number> = { walk: 6, bike: 6, drive: 25 };
// The map's area (src/map.ts SERVICE_BOUNDS, functions/src/tiles.ts SERVICE_AREA).
export const SERVICE_AREA = { south: 41.4, north: 42.5, west: -88.4, east: -87.2 } as const;
export const MAX_POINTS = 400;
const DIGITS = 5; // about a meter

const CODE = /^[1-9][0-9]{7}$/;
const NUMBER = /^-?\d{1,3}(?:\.\d{1,12})?$/;

export const CACHE_OK = 'public, max-age=3600, s-maxage=86400';
const CACHE_NO_ROUTE = 'public, max-age=3600, s-maxage=3600';
const CACHE_BAD_INPUT = 'public, max-age=3600, s-maxage=3600';
const CACHE_NO_LISTING = 'public, max-age=300, s-maxage=300';
const CACHE_FAILED = 'no-store';

export class RouteInputError extends Error {}

const round = (n: number) => Math.round(n * 10 ** DIGITS) / 10 ** DIGITS;

function coordinate(v: unknown, min: number, max: number): number {
  if (typeof v !== 'string' || !NUMBER.test(v)) throw new RouteInputError('Expected coordinates.');
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new RouteInputError('Expected coordinates.');
  return n;
}

// Query strings arrive as text (or arrays when a key repeats, which is refused).
export function parseRouteQuery(q: Record<string, unknown>): RouteQuery {
  const code = q.code;
  if (typeof code !== 'string' || !CODE.test(code)) throw new RouteInputError('Unknown listing.');
  const mode = q.mode;
  if (typeof mode !== 'string' || !Object.hasOwn(TRANSPORT, mode)) throw new RouteInputError('Unknown mode.');
  const to = { lat: round(coordinate(q.lat, -90, 90)), lng: round(coordinate(q.lng, -180, 180)) };
  return { code, to, mode: mode as Mode };
}

export const inServiceArea = (p: Point) =>
  p.lat >= SERVICE_AREA.south && p.lat <= SERVICE_AREA.north && p.lng >= SERVICE_AREA.west && p.lng <= SERVICE_AREA.east;

export function kmBetween(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// An active listing's saved spot, or null (missing, not active, no usable location, outside the area).
export function listingOrigin(d: Record<string, unknown> | undefined): Point | null {
  if (!d || d.status !== 'active') return null;
  const loc = d.location as { lat?: unknown; lng?: unknown } | null | undefined;
  if (!loc || typeof loc !== 'object') return null;
  const { lat, lng } = loc;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = { lat, lng };
  return inServiceArea(p) ? p : null;
}

// Why a destination is refused, or null when it may be routed to.
export function reachProblem(from: Point, to: Point, mode: Mode): string | null {
  if (!inServiceArea(to)) return 'Outside the map area.';
  if (kmBetween(from, to) > MAX_KM[mode]) return 'Too far from the room.';
  return null;
}

// The key is added here and nowhere else; callers must never log the result.
export function hereRouteUrl(from: Point, to: Point, mode: Mode, apiKey: string): string {
  const u = new URL(HERE_ROUTES);
  u.searchParams.set('transportMode', TRANSPORT[mode]);
  u.searchParams.set('origin', `${from.lat},${from.lng}`);
  u.searchParams.set('destination', `${to.lat},${to.lng}`);
  u.searchParams.set('return', 'polyline,summary');
  // a typical drive, not the traffic at the moment of the first visitor (answers are kept for a day)
  if (mode === 'drive') u.searchParams.set('departureTime', 'any');
  u.searchParams.set('apiKey', apiKey);
  return u.toString();
}

interface HereSection {
  polyline?: unknown;
  summary?: { duration?: unknown; length?: unknown };
}

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// HERE's first route: every section's line joined, with the summed time and length; null if unusable.
export function toRoute(json: unknown): { points: LatLng[]; seconds: number; meters: number } | null {
  const sections = (json as { routes?: { sections?: HereSection[] }[] } | null)?.routes?.[0]?.sections;
  if (!Array.isArray(sections) || !sections.length) return null;
  const points: LatLng[] = [];
  let seconds = 0;
  let meters = 0;
  for (const s of sections) {
    const d = s?.summary?.duration;
    const m = s?.summary?.length;
    if (!isAmount(d) || !isAmount(m) || typeof s.polyline !== 'string') return null;
    let line: LatLng[];
    try {
      line = decodeFlexPolyline(s.polyline).points;
    } catch {
      return null;
    }
    for (const p of line) {
      const prev = points[points.length - 1];
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) points.push(p);
    }
    seconds += d;
    meters += m;
  }
  if (points.length < 2) return null;
  return { points, seconds: Math.round(seconds), meters: Math.round(meters) };
}

// At most `max` points, evenly spread along the line, keeping the first and the last.
export function thin(points: LatLng[], max = MAX_POINTS): LatLng[] {
  if (points.length <= max) return points;
  const out: LatLng[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
  return out;
}

// The routed line from the room's own pin to the place's: HERE starts and ends on the nearest street.
export function lineBetween(from: Point, to: Point, route: LatLng[], max = MAX_POINTS): LatLng[] {
  const at = (p: Point): LatLng => [round(p.lat), round(p.lng)];
  const same = (a: LatLng, b: LatLng) => kmBetween({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) < 0.002;
  const line = route.map(([lat, lng]): LatLng => [round(lat), round(lng)]);
  if (!same(line[0], at(from))) line.unshift(at(from));
  if (!same(line[line.length - 1], at(to))) line.push(at(to));
  return thin(line, max);
}

export interface Deps {
  listing: (code: string) => Promise<Record<string, unknown> | undefined>;
  route: (from: Point, to: Point, mode: Mode) => Promise<unknown>; // HERE's JSON; throws when HERE fails
  now?: () => number;
  maxEntries?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Everything but the HTTP plumbing, so it is tested with stubs (no Firestore, no HERE, no key).
export function routeHandler(deps: Deps): (query: Record<string, unknown>) => Promise<Answer> {
  const now = deps.now ?? Date.now;
  const max = deps.maxEntries ?? 500;
  const cache = new Map<string, { at: number; answer: Answer }>();
  const keep = (key: string, answer: Answer) => {
    cache.delete(key);
    cache.set(key, { at: now(), answer });
    while (cache.size > max) cache.delete(cache.keys().next().value as string);
  };

  return async (query) => {
    let q: RouteQuery;
    try {
      q = parseRouteQuery(query);
    } catch (e) {
      if (e instanceof RouteInputError) return { status: 400, cache: CACHE_BAD_INPUT, body: { error: e.message } };
      throw e;
    }
    const empty: RouteBody = { points: [], seconds: null, meters: null, mode: q.mode };

    let from: Point | null;
    try {
      from = listingOrigin(await deps.listing(q.code));
    } catch (e) {
      logger.warn('route listing read failed', { error: (e as Error)?.name ?? 'Error' });
      return { status: 200, cache: CACHE_FAILED, body: empty };
    }
    if (!from) return { status: 404, cache: CACHE_NO_LISTING, body: { error: 'No route for this listing.' } };
    const problem = reachProblem(from, q.to, q.mode);
    if (problem) return { status: 400, cache: CACHE_BAD_INPUT, body: { error: problem } };

    // the room's spot is part of the key, so a listing that moves gets new routes
    const key = `${q.code}|${from.lat},${from.lng}|${q.to.lat},${q.to.lng}|${q.mode}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < DAY_MS) return hit.answer;

    let json: unknown;
    try {
      json = await deps.route(from, q.to, q.mode);
    } catch {
      return { status: 200, cache: CACHE_FAILED, body: empty }; // not kept: HERE may be back soon
    }
    const route = toRoute(json);
    const answer: Answer = route
      ? { status: 200, cache: CACHE_OK, body: { points: lineBetween(from, q.to, route.points), seconds: route.seconds, meters: route.meters, mode: q.mode } }
      : { status: 200, cache: CACHE_NO_ROUTE, body: empty };
    keep(key, answer);
    return answer;
  };
}

class HereRouteError extends Error {}

// Logs carry the mode and HTTP status only, never the URL (it holds the key).
async function hereRoute(from: Point, to: Point, mode: Mode): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(hereRouteUrl(from, to, mode, HERE_API_KEY.value()), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    logger.warn('HERE route request did not complete', { mode, error: (e as Error)?.name ?? 'Error' });
    throw new HereRouteError();
  }
  if (!res.ok) {
    logger.warn('HERE route request failed', { mode, status: res.status });
    throw new HereRouteError();
  }
  try {
    return await res.json();
  } catch {
    logger.warn('HERE route answer was not JSON', { mode });
    throw new HereRouteError();
  }
}

if (!getApps().length) initializeApp();

const handle = routeHandler({
  listing: async (code) => (await getFirestore().doc(`listings/${code}`).get()).data(),
  route: hereRoute,
});

export const routeLine = onRequest(
  { region: 'us-central1', invoker: 'public', secrets: [HERE_API_KEY], memory: '256MiB', timeoutSeconds: 15, maxInstances: 5 },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.set('Allow', 'GET, HEAD').set('Cache-Control', 'no-store').status(405).json({ error: 'Method not allowed.' });
      return;
    }
    let answer: Answer;
    try {
      answer = await handle(req.query as Record<string, unknown>);
    } catch (e) {
      logger.warn('route failed', { error: (e as Error)?.name ?? 'Error' });
      const m = req.query.mode;
      const mode: Mode = typeof m === 'string' && Object.hasOwn(TRANSPORT, m) ? (m as Mode) : 'walk';
      answer = { status: 200, cache: CACHE_FAILED, body: { points: [], seconds: null, meters: null, mode } };
    }
    res.set('Cache-Control', answer.cache).status(answer.status).json(answer.body);
  },
);
