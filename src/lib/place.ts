// Places from HERE (through the Cloud Functions in functions/) and the apartment directory: checking
// what comes back, and what a listing stores from a picked address. Pure functions, tested.
import { APARTMENTS, fullAddress, matchScore, PLACE_APARTMENTS, type Apartment } from './apartments';
import { areaFromAddress, type CampusId } from './listingView';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlaceSuggestion {
  id: string;
  label: string; // the street address line
  title: string;
  sub: string;
}

// What post.html keeps on S.place after a pick. id: a HERE address; apartmentId: a directory building.
// lat/lng is the listing's map spot; origin is the address point it came from, kept only while the host
// has moved the pin away from it ("Adjust position").
export interface PickedPlace {
  id?: string;
  apartmentId?: string;
  lat: number;
  lng: number;
  origin?: LatLng;
  area: string | null;
  zip: string | null;
  walk: number | null; // minutes on foot to campusId's point
  label: string;
  campusId?: CampusId;
}

export interface NearbyPlace {
  kind: 'transit' | 'grocery' | 'pharmacy' | 'food';
  name: string;
  meters: number;
  walk: number | null;
  lat: number | null;
  lng: number | null;
}

const CAMPUSES: CampusId[] = ['nu-evn', 'nu-chi', 'chi-dt'];
const NEARBY_KINDS = ['transit', 'grocery', 'pharmacy', 'food'];

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const minutes = (v: unknown): number | null => (finite(v) && v > 0 && v < 1000 ? Math.round(v) : null);

export function asSuggestions(x: unknown, max = 5): PlaceSuggestion[] {
  if (!Array.isArray(x)) return [];
  const out: PlaceSuggestion[] = [];
  for (const it of x) {
    const o = obj(it);
    const id = text(o?.id, 400);
    const label = text(o?.label, 200);
    if (!o || !id || !label) continue;
    out.push({ id, label, title: text(o.title, 200) ?? label, sub: text(o.sub, 200) ?? '' });
    if (out.length >= max) break;
  }
  return out;
}

// A place from the lookup function, or one restored from a saved draft: anything malformed is dropped.
export function asPlace(x: unknown): PickedPlace | null {
  const o = obj(x);
  if (!o || !finite(o.lat) || !finite(o.lng) || Math.abs(o.lat) > 90 || Math.abs(o.lng) > 180) return null;
  const label = text(o.label, 200);
  if (!label) return null;
  const zip = typeof o.zip === 'string' && /^\d{5}$/.test(o.zip) ? o.zip : null;
  const place: PickedPlace = { lat: o.lat, lng: o.lng, area: text(o.area, 80), zip, walk: minutes(o.walk), label };
  const id = text(o.id, 400);
  if (id) place.id = id;
  const apartmentId = text(o.apartmentId, 80);
  if (apartmentId) place.apartmentId = apartmentId;
  if (typeof o.campusId === 'string' && (CAMPUSES as string[]).includes(o.campusId)) place.campusId = o.campusId as CampusId;
  // a moved pin from a saved draft stays within reach of its address point
  const from = obj(o.origin);
  if (from && finite(from.lat) && finite(from.lng) && Math.abs(from.lat) <= 90 && Math.abs(from.lng) <= 180) {
    return movePin({ ...place, lat: from.lat, lng: from.lng }, { lat: place.lat, lng: place.lng });
  }
  return place;
}

// The walk alone, from a lookup by coordinates.
export function asWalk(x: unknown): number | null {
  return minutes(obj(x)?.walk);
}

export function asNearby(x: unknown): NearbyPlace[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((it) => {
    const o = obj(it);
    const name = text(o?.name, 80);
    if (!o || !name || typeof o.kind !== 'string' || !NEARBY_KINDS.includes(o.kind) || !finite(o.meters)) return [];
    return [{ kind: o.kind as NearbyPlace['kind'], name, meters: Math.round(o.meters), walk: minutes(o.walk), lat: finite(o.lat) ? o.lat : null, lng: finite(o.lng) ? o.lng : null }];
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Did the host keep the picked address, or type over it afterwards?
export function sameAddress(a: string, b: string): boolean {
  return !!norm(a) && norm(a) === norm(b);
}

export interface ListingPlace {
  area: string;
  walk: number | null;
  location: { lat: number; lng: number } | null; // public: every listing shows at its spot on the map
  zip: string | null; // host only, with the street address
}

// What a listing stores: the area, walk and map spot of the picked place (a HERE address or a directory
// building), else only the area read from the typed address: no walking time and no map spot.
export function listingPlace(place: PickedPlace | null, address: string, campusId: CampusId): ListingPlace {
  if (!place) return { area: areaFromAddress(address, campusId), walk: null, location: null, zip: null };
  return {
    area: (place.area || areaFromAddress(place.label || address, campusId)).slice(0, 80),
    walk: !place.campusId || place.campusId === campusId ? place.walk : null,
    location: { lat: place.lat, lng: place.lng },
    zip: place.zip,
  };
}

// ---------- the apartment directory (src/lib/apartments.ts), as rows for the post form's Building field ----------

export interface BuildingRow {
  id: string;
  name: string;
  street: string;
  area: string;
  address: string; // goes into the street address field
  website: string;
  lat: number;
  lng: number;
}

export const buildingRow = (a: Apartment): BuildingRow => ({
  id: a.id,
  name: a.name,
  street: a.street,
  area: a.area,
  address: fullAddress(a),
  website: a.website,
  lat: a.lat,
  lng: a.lng,
});

// A building by id; with a campus, only when it is one of that campus's buildings.
export function buildingById(id: string, campusId?: CampusId): BuildingRow | null {
  const a = APARTMENTS.find((x) => x.id === id);
  if (!a || (campusId && PLACE_APARTMENTS[campusId] !== a.campus)) return null;
  return buildingRow(a);
}

// ---------- the map spot: "Adjust position" on the post form ----------

// A moved pin stays this close to the address point HERE (or the directory) gave, so it can mark the
// entrance or the right building on a corner but not another street or town.
export const PIN_RANGE_M = 300;
// The area Rentlet's maps cover (src/map.ts SERVICE_BOUNDS, functions/src/tiles.ts SERVICE_AREA).
export const SERVICE_AREA = { south: 41.4, north: 42.5, west: -88.4, east: -87.2 } as const;

export function metersBetween(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const inServiceArea = (p: LatLng): boolean =>
  p.lat >= SERVICE_AREA.south && p.lat <= SERVICE_AREA.north && p.lng >= SERVICE_AREA.west && p.lng <= SERVICE_AREA.east;

const round6 = (v: number) => Math.round(v * 1e6) / 1e6; // about 10 cm
const within = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Where a pin dragged to p may go: pulled back toward the address point to `range` metres, along the
// same bearing, then kept inside the service area.
export function clampPin(origin: LatLng, p: LatLng, range = PIN_RANGE_M): LatLng {
  let { lat, lng } = p;
  const d = metersBetween(origin, p);
  if (d > range) {
    const k = (range * 0.999) / d;
    lat = origin.lat + (lat - origin.lat) * k;
    lng = origin.lng + (lng - origin.lng) * k;
  }
  return { lat: round6(within(lat, SERVICE_AREA.south, SERVICE_AREA.north)), lng: round6(within(lng, SERVICE_AREA.west, SERVICE_AREA.east)) };
}

// The place with its pin moved to p (clamped). Moved back onto the address point (under a metre), it
// is the plain address point again, without an origin. The walk is measured again by the page.
export function movePin(place: PickedPlace, p: LatLng): PickedPlace {
  const origin = place.origin ? { lat: place.origin.lat, lng: place.origin.lng } : { lat: place.lat, lng: place.lng };
  const to = clampPin(origin, p);
  const next: PickedPlace = { ...place };
  delete next.origin;
  if (metersBetween(origin, to) < 1) return Object.assign(next, origin);
  return Object.assign(next, to, { origin });
}

// Back to the address point.
export function resetPin(place: PickedPlace): PickedPlace {
  if (!place.origin) return place;
  const next: PickedPlace = { ...place, lat: place.origin.lat, lng: place.origin.lng };
  delete next.origin;
  return next;
}

// ---------- the Street address field without HERE: the directory's street addresses ----------

// Directory buildings offered in the Street address field: what a signed-out host gets (HERE needs a
// school account), and what fills in while HERE answers.
export interface DirectoryAddress {
  apartmentId: string;
  label: string; // goes into the street address field
  title: string; // the street line
  sub: string; // town and building name
}

const WORD: Record<string, string> = {
  avenue: 'ave', av: 'ave', street: 'st', road: 'rd', drive: 'dr', boulevard: 'blvd', place: 'pl', court: 'ct', lane: 'ln',
  terrace: 'ter', parkway: 'pkwy', north: 'n', south: 's', east: 'e', west: 'w', illinois: 'il',
};
const addressKey = (s: string) => norm(s).split(' ').filter(Boolean).map((w) => WORD[w] ?? w).join(' ');

// Up to `limit` of the campus's buildings whose street address starts with what was typed ("1890 Ma",
// "1890 Maple Avenue", "maple ave"), then those whose name or alias contains it ("E2").
export function directoryAddresses(q: string, campusId: CampusId, limit = 5): DirectoryAddress[] {
  const key = addressKey(q);
  if (key.length < 2) return [];
  const pool = APARTMENTS.filter((a) => a.campus === PLACE_APARTMENTS[campusId]);
  const scored: { a: Apartment; s: number }[] = [];
  for (const a of pool) {
    const full = addressKey(fullAddress(a));
    const street = full.replace(/^\d+[a-z]?\s/, '');
    let s = -1;
    if (full.startsWith(key) || (key.startsWith(full) && /^\d/.test(key))) s = 3;
    else if (!/^\d/.test(key) && street.startsWith(key)) s = 2;
    else if (matchScore(q, a) >= 6000) s = 1; // the name or an alias, not a typo
    if (s > 0) scored.push({ a, s });
  }
  return scored
    .sort((x, y) => y.s - x.s || y.a.priority - x.a.priority)
    .slice(0, limit)
    .map(({ a }) => ({ apartmentId: a.id, label: fullAddress(a), title: a.street, sub: `${a.city}, IL · ${a.name}` }));
}

// HERE's addresses first, then directory buildings on a street line HERE didn't already offer.
export function mergeAddresses(here: PlaceSuggestion[], directory: DirectoryAddress[], max = 5): (PlaceSuggestion | DirectoryAddress)[] {
  const out: (PlaceSuggestion | DirectoryAddress)[] = here.slice(0, max);
  const lines = here.map((h) => addressKey(h.label));
  for (const d of directory) {
    if (out.length >= max) break;
    const street = addressKey(d.title);
    if (!lines.some((l) => l.startsWith(street))) out.push(d);
  }
  return out;
}

// ---------- calling the functions: a failure waits a little, it doesn't switch them off ----------

// After a failed call the next one waits 1 s, then 2, 5, 10 and 30 s, so a deploy rolling out, a cold
// start or a busy HERE never turns suggestions off for the rest of the page's life. Only
// functions/not-found (the function isn't deployed) stops the page asking. Answers about the request
// or the account (invalid-argument, unauthenticated, permission-denied) are not failures of the service.
export const RETRY_MS = [1000, 2000, 5000, 10000, 30000];
const NOT_FAILURES = new Set(['functions/invalid-argument', 'functions/unauthenticated', 'functions/permission-denied']);

export type CallState = 'ok' | 'failed' | 'signed-out';

export class CallHealth {
  fails = 0;
  until = 0;
  gone = false;
  last: CallState = 'ok';

  // May a call go out now? When not, the last state is "failed".
  allow(now: number): boolean {
    if (this.gone || now < this.until) {
      this.last = 'failed';
      return false;
    }
    return true;
  }

  ok(): void {
    this.fails = 0;
    this.until = 0;
    this.last = 'ok';
  }

  fail(code: string, now: number): void {
    if (code === 'functions/unauthenticated' || code === 'functions/permission-denied') this.last = 'signed-out';
    else if (NOT_FAILURES.has(code)) this.last = 'ok';
    else {
      this.last = 'failed';
      if (code === 'functions/not-found') this.gone = true;
      else this.until = now + RETRY_MS[Math.min(this.fails, RETRY_MS.length - 1)];
      this.fails++;
    }
  }
}
