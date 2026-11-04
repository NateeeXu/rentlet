// Who may call the place functions and what they may send. Pure, so it is unit-tested without Firebase.

export type CampusId = 'nu-evn' | 'nu-chi' | 'chi-dt';

export interface Point {
  lat: number;
  lng: number;
}

// Search is biased to, and walking times are measured to, these points.
export const CAMPUS_POINT: Record<CampusId, Point> = {
  'nu-evn': { lat: 42.0565, lng: -87.6753 },
  'nu-chi': { lat: 41.8963, lng: -87.6188 },
  'chi-dt': { lat: 41.8826, lng: -87.6233 },
};

export const MAX_QUERY = 120;
// Points further than this from the chosen campus are refused (nearby) or not walked to (lookup).
export const MAX_KM_FROM_CAMPUS = 60;
export const MAX_WALK_KM = 6;

const NU_EMAIL = /@(u\.)?northwestern\.edu$/i;

// A signed-in Google account whose verified email is @u.northwestern.edu or @northwestern.edu.
export function isNorthwesternToken(token: unknown): boolean {
  if (!token || typeof token !== 'object') return false;
  const t = token as { email?: unknown; email_verified?: unknown };
  return t.email_verified === true && typeof t.email === 'string' && NU_EMAIL.test(t.email.trim());
}

export class InputError extends Error {}

function record(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new InputError('Expected an object.');
  return data as Record<string, unknown>;
}

export function campusOf(v: unknown): CampusId {
  if (typeof v === 'string' && v in CAMPUS_POINT) return v as CampusId;
  throw new InputError('Unknown campus.');
}

export function queryOf(v: unknown): string {
  if (typeof v !== 'string') throw new InputError('Expected text.');
  const q = v.replace(/\s+/g, ' ').trim();
  if (!q) throw new InputError('Expected text.');
  if (q.length > MAX_QUERY) throw new InputError(`Keep it under ${MAX_QUERY} characters.`);
  return q;
}

// HERE result ids look like here:af:streetsection:… or here:pds:place:…
export function hereIdOf(v: unknown): string {
  if (typeof v === 'string' && v.length <= 400 && /^here:[A-Za-z0-9:._~=+/-]+$/.test(v)) return v;
  throw new InputError('Unknown place id.');
}

export function kmBetween(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function parseSuggest(data: unknown): { q: string; campusId: CampusId } {
  const d = record(data);
  return { q: queryOf(d.q), campusId: campusOf(d.campusId) };
}

// A point near the campus (a building from the apartment directory, or a listing's map spot).
function pointNear(d: Record<string, unknown>, campusId: CampusId): Point {
  const { lat, lng } = d;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new InputError('Expected coordinates.');
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new InputError('Expected coordinates.');
  if (kmBetween({ lat, lng }, CAMPUS_POINT[campusId]) > MAX_KM_FROM_CAMPUS) throw new InputError('Too far from campus.');
  return { lat, lng };
}

// By HERE id, by typed address, or by coordinates (then only the walk is looked up).
export type LookupInput =
  | { id: string; campusId: CampusId }
  | { q: string; campusId: CampusId }
  | { point: Point; campusId: CampusId };

export function parseLookup(data: unknown): LookupInput {
  const d = record(data);
  const campusId = campusOf(d.campusId);
  if (d.id !== undefined && d.id !== null) return { id: hereIdOf(d.id), campusId };
  if (d.q !== undefined && d.q !== null) return { q: queryOf(d.q), campusId };
  if (d.lat !== undefined || d.lng !== undefined) return { point: pointNear(d, campusId), campusId };
  throw new InputError('Send an id, an address or coordinates.');
}

export function parseNearby(data: unknown): Point & { campusId: CampusId } {
  const d = record(data);
  const campusId = campusOf(d.campusId);
  return { ...pointNear(d, campusId), campusId };
}
