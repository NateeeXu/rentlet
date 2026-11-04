// Live shuttle buses on the site: reading GET /api/shuttle (functions/src/shuttle.ts, from Northwestern's
// TripShot system) and the words the shuttle page shows for them. Pure functions, tested; the page polls.
import { DIRECTIONS, metersFromRoute, type DirectionId } from './shuttleData';

export interface LiveVehicle {
  id: string;
  line: DirectionId;
  lat: number;
  lng: number;
  heading: number | null;
  nextStop: { id: string; name: string; seconds: number } | null;
  arrivals: Record<string, number>; // TripShot stop id -> seconds after updatedAt
}

export interface LiveReading {
  updatedAt: number; // ms since epoch, when the university's system was read
  vehicles: LiveVehicle[];
}

export const LIVE_URL = '/api/shuttle';
export const REFRESH_MS = 10_000;
// A bus farther than this from its line's road shape is off route (to or from the garage) and not shown.
// Generous: buses under way do leave the drawn shape for a block or two (seen 250 m on 2026-11-04).
export const OFF_ROUTE_METERS = 500;
// Predictions run on from updatedAt; a reading older than this is too old to count down from.
const MAX_ELAPSED_SECONDS = 600;

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : null);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isLine = (v: unknown): v is DirectionId => typeof v === 'string' && Object.hasOwn(DIRECTIONS, v);

// Checks what came back; anything malformed is dropped rather than drawn. null when unusable.
export function parseLiveReading(json: unknown): LiveReading | null {
  const o = obj(json);
  if (!o || !finite(o.updatedAt) || !Array.isArray(o.vehicles)) return null;
  const vehicles: LiveVehicle[] = [];
  for (const raw of o.vehicles) {
    const v = obj(raw);
    if (!v || typeof v.id !== 'string' || !isLine(v.line) || !finite(v.lat) || !finite(v.lng)) continue;
    if (Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) continue;
    const arrivals: Record<string, number> = {};
    for (const [k, s] of Object.entries(obj(v.arrivals) ?? {})) if (finite(s) && s >= 0) arrivals[k.toLowerCase()] = s;
    const n = obj(v.nextStop);
    vehicles.push({
      id: v.id.slice(0, 40),
      line: v.line,
      lat: v.lat,
      lng: v.lng,
      heading: finite(v.heading) ? ((v.heading % 360) + 360) % 360 : null,
      nextStop: n && typeof n.id === 'string' && finite(n.seconds) ? { id: n.id.toLowerCase(), name: typeof n.name === 'string' ? n.name : '', seconds: n.seconds } : null,
      arrivals,
    });
  }
  return { updatedAt: o.updatedAt, vehicles };
}

// Seconds since the reading, by this device's clock (clamped, so a clock that runs ahead or behind
// can't make arrivals jump).
export function elapsedSeconds(reading: LiveReading, now = Date.now()): number {
  return Math.min(MAX_ELAPSED_SECONDS, Math.max(0, (now - reading.updatedAt) / 1000));
}

// The buses of one direction that are on its route.
export function busesOn(reading: LiveReading | null, line: DirectionId): LiveVehicle[] {
  if (!reading) return [];
  return reading.vehicles.filter((v) => v.line === line && metersFromRoute(v, line) <= OFF_ROUTE_METERS);
}

// Seconds until each bus of the direction reaches a stop (any of the ids: a row may stand for two
// poles), soonest first, counted down from the reading.
export function arrivalsAt(reading: LiveReading | null, line: DirectionId, stopIds: string[], now = Date.now()): number[] {
  if (!reading) return [];
  const gone = elapsedSeconds(reading, now);
  const out: number[] = [];
  for (const v of busesOn(reading, line)) {
    const times = stopIds.map((id) => v.arrivals[id.toLowerCase()]).filter(finite);
    if (times.length) out.push(Math.max(0, Math.min(...times) - gone));
  }
  return out.sort((a, b) => a - b);
}

const CHICAGO_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });

// "2:45 pm" in Chicago time.
export function chicagoClock(at: number): string {
  return CHICAGO_TIME.format(at).replace(/[\s ]*([AP])M$/i, (_, x: string) => ` ${x.toLowerCase()}m`);
}

// "Arriving", "4 min", or the clock time when it is an hour or more away.
export function arrivalLabel(seconds: number, now = Date.now()): string {
  if (seconds < 60) return 'Arriving';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : chicagoClock(now + seconds * 1000);
}

// "Updated just now", "Updated 8 s ago", "Updated 2 min ago".
export function updatedLabel(updatedAt: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 5) return 'Updated just now';
  if (s < 60) return `Updated ${s} s ago`;
  if (s < 3600) return `Updated ${Math.floor(s / 60)} min ago`;
  return `Updated ${chicagoClock(updatedAt)}`;
}

export function busCountLabel(n: number): string {
  return n === 1 ? '1 bus running' : `${n} buses running`;
}
