// Live Northwestern shuttles for the shuttle page: GET /api/shuttle (Hosting rewrite -> shuttleLive).
// Ports the Northwestern part of the CloudSublet mini program's shuttleLiveApi cloud function
// (fetchNorthwestern, parseNorthwestern, chicagoDate and the Loop pattern logic). It reads the
// university's public real-time system (TripShot) and returns the buses under way with TripShot's
// own arrival predictions. Public and anonymous: nothing about the caller is read, logged or forwarded.
// Every caller within CACHE_MS shares one upstream read, and Hosting's CDN shares the answer for 10 s.
import { onRequest } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';

export type Line = 'to-chicago' | 'to-evanston' | 'loop-a' | 'loop-b';

export interface NextStop {
  id: string;
  name: string;
  seconds: number; // after updatedAt
}

export interface Vehicle {
  id: string; // the bus number
  line: Line;
  lat: number;
  lng: number;
  heading: number | null; // degrees clockwise from north
  ageSeconds: number; // how old the position was when read
  nextStop: NextStop | null;
  arrivals: Record<string, number>; // TripShot stop id (lower case) -> seconds after updatedAt
}

export interface Reading {
  updatedAt: number; // ms since epoch, when TripShot was read
  vehicles: Vehicle[];
}

export const TRIPSHOT_HOST = 'https://northwestern.tripshot.com';
// Intercampus and the evening Loop are separate TripShot routes, read in parallel. Intercampus live
// data runs to about 1.3 MB; gzip brings it near 60 KB. One route failing still shows the other's buses.
export const TRIPSHOT_ROUTES = ['IRGI:2CA5DC76-DD3F-4AB4-BD10-056785A989ED', 'IRGI:03EDBD45-3A71-4110-A3DD-D9131DF80F9B'] as const;

const CACHE_MS = 10_000;
const FAILED_CACHE_MS = 5_000;
const TIMEOUT_MS = 6_000;
const USER_AGENT = 'Rentlet/1.0 (rentlet-nu.web.app)';

// A position older than this is a bus that is no longer running.
export const STALE_SECONDS = 180;
// The longest prediction passed on; later ones are not shown.
export const MAX_ARRIVAL_SECONDS = 3 * 3600;

// TripShot directions of the Intercampus route.
const DIRECTION_LINES: Record<string, Line> = { Inbound: 'to-chicago', Outbound: 'to-evanston' };

// The evening Loop has no direction in TripShot; it alternates two patterns, told apart by the stop
// after Fisk Hall: Weber Arch (A) or 619 Clark (B).
const LOOP_PATTERN_STOPS: Record<string, Line> = {
  '9c179fa3-3a81-4f61-9626-0ef4fe075b58': 'loop-a',
  'f1204401-3cce-41a8-80ab-86a84e250949': 'loop-b',
};

// TripShot's service day is the Chicago date. Worked out by hand: the runtime may lack full locale
// data. US daylight saving runs from the second Sunday of March to the first Sunday of November, 2:00.
function sundayOf(year: number, month: number, nth: number): number {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - firstDay) % 7) + (nth - 1) * 7;
}

export function chicagoDate(now = Date.now()): string {
  const standard = now - 6 * 3600_000;
  const year = new Date(standard).getUTCFullYear();
  const start = Date.UTC(year, 2, sundayOf(year, 2, 2), 2);
  const end = Date.UTC(year, 10, sundayOf(year, 10, 1), 1);
  const local = standard + (standard >= start && standard < end ? 3600_000 : 0);
  return new Date(local).toISOString().slice(0, 10);
}

export function tripshotUrl(routeId: string, day: string): string {
  return `${TRIPSHOT_HOST}/v2/p/shared/route/${routeId}/live?day=${day}&includePreviousDayRidesSpanningMidnight=true`;
}

// "Sheridan/Loyola (NB)" -> "Sheridan / Loyola", as the site's stop list writes them.
export function stopName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s*\((?:NB|SB|EB|WB)\)\s*$/i, '')
    .replace(/\s*\/\s*/g, ' / ')
    .trim()
    .slice(0, 80);
}

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : null);
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

function coordinate(value: unknown, limit: number): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 && Math.abs(n) <= limit ? Math.round(n * 1e6) / 1e6 : null;
}

function heading(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) % 360 : null;
}

// Each stopStatus entry is a one-key object: { Departed | Awaiting | Present | Skipped: visit }.
function visits(stopStatus: unknown): { state: string; visit: Obj }[] {
  return list(stopStatus).flatMap((entry) => {
    const e = obj(entry);
    const state = e && Object.keys(e)[0];
    const visit = state ? obj(e[state]) : null;
    return state && visit ? [{ state, visit }] : [];
  });
}

function loopLine(stopStatus: unknown): Line | null {
  for (const { visit } of visits(stopStatus)) {
    const line = LOOP_PATTERN_STOPS[String(visit.stopId).toLowerCase()];
    if (line) return line;
  }
  return null;
}

function stopNames(vias: unknown): Map<string, string> {
  const names = new Map<string, string>();
  for (const via of list(vias)) {
    const stop = obj(obj(obj(via)?.ViaStop)?.stop);
    if (stop && typeof stop.stopId === 'string') names.set(stop.stopId.toLowerCase(), stopName(stop.name));
  }
  return names;
}

// TripShot route live data: per direction, the rides with their bus's position and an expected arrival
// at each stop. Only rides under way (Active) with a fresh position count; a bus already given its
// next ride appears there as Accepted and is skipped.
export function parseTripShot(payload: unknown, now = Date.now()): Vehicle[] {
  const directions = list(obj(obj(payload)?.InternalRouteGroupLiveData)?.exactLiveData);
  const out: Vehicle[] = [];
  const seen = new Set<string>();
  for (const d of directions) {
    const direction = obj(d);
    if (!direction) continue;
    const directionLine = DIRECTION_LINES[String(direction.direction)] ?? null;
    for (const item of list(direction.liveRides)) {
      const status = obj(obj(item)?.vehicleStatus);
      const ride = obj(obj(item)?.ride);
      const location = obj(status?.location);
      if (!status || !ride || !location || !obj(ride.state)?.Active) continue;
      const line = directionLine ?? (direction.direction === 'NonDirectional' ? loopLine(ride.stopStatus) : null);
      if (!line) continue;
      const age = (now - Date.parse(String(status.when))) / 1000;
      if (!Number.isFinite(age) || age > STALE_SECONDS) continue;
      const lat = coordinate(location.lt, 90);
      const lng = coordinate(location.lg, 180);
      if (lat === null || lng === null) continue;
      const id = String(status.name || ride.vehicleName || '').slice(0, 40);
      if (!id || seen.has(`${line}:${id}`)) continue;
      seen.add(`${line}:${id}`);

      const names = stopNames(ride.vias);
      const arrivals: Record<string, number> = {};
      let nextStop: NextStop | null = null;
      for (const { state, visit } of visits(ride.stopStatus)) {
        if ((state !== 'Awaiting' && state !== 'Present') || typeof visit.stopId !== 'string') continue;
        const seconds = state === 'Present' ? 0 : (Date.parse(String(visit.expectedArrivalTime)) - now) / 1000;
        if (!Number.isFinite(seconds) || seconds > MAX_ARRIVAL_SECONDS) continue;
        const stopId = visit.stopId.toLowerCase();
        const s = Math.max(0, Math.round(seconds));
        if (!(stopId in arrivals)) arrivals[stopId] = s;
        nextStop ??= { id: stopId, name: names.get(stopId) ?? '', seconds: s };
      }
      out.push({ id, line, lat, lng, heading: heading(status.bearing), ageSeconds: Math.max(0, Math.round(age)), nextStop, arrivals });
    }
  }
  return out;
}

async function readRoute(routeId: string, day: string): Promise<unknown> {
  // Node's fetch asks for gzip and inflates the answer itself.
  const res = await fetch(tripshotUrl(routeId, day), {
    headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return res.json();
}

export async function readNorthwestern(day = chicagoDate()): Promise<Reading> {
  const results = await Promise.allSettled(TRIPSHOT_ROUTES.map((r) => readRoute(r, day)));
  const updatedAt = Date.now();
  const read = results.filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled');
  if (!read.length) throw (results[0] as PromiseRejectedResult).reason;
  return { updatedAt, vehicles: read.flatMap((r) => parseTripShot(r.value, updatedAt)) };
}

let cache: { at: number; ttl: number; task: Promise<Reading> } | null = null;

function cachedReading(now = Date.now()): Promise<Reading> {
  if (cache && now - cache.at < cache.ttl) return cache.task;
  const entry = { at: now, ttl: CACHE_MS, task: readNorthwestern() };
  // A failure is kept briefly too, so an outage at TripShot isn't asked again on every request.
  entry.task.catch(() => (entry.ttl = FAILED_CACHE_MS));
  cache = entry;
  return entry.task;
}

// The upstream reason only (HTTP_503, TimeoutError, ...): it says nothing about the caller.
function reason(e: unknown): string {
  const r = String((e as Error)?.message || (e as Error)?.name || '');
  return /^[A-Za-z][A-Za-z0-9_]{1,30}$/.test(r) ? r : 'FAILED';
}

export const shuttleLive = onRequest(
  { region: 'us-central1', invoker: 'public', memory: '256MiB', timeoutSeconds: 15, maxInstances: 3 },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.set('Allow', 'GET, HEAD').set('Cache-Control', 'no-store').status(405).json({ error: 'method-not-allowed' });
      return;
    }
    try {
      const reading = await cachedReading();
      res.set('Cache-Control', 'public, max-age=5, s-maxage=10').status(200).json(reading);
    } catch (e) {
      logger.warn('TripShot unavailable', { reason: (e as Error)?.name === 'TimeoutError' ? 'TIMEOUT' : reason(e) });
      res.set('Cache-Control', 'no-store').status(503).json({ error: 'unavailable' });
    }
  },
);
