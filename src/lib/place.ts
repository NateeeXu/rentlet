// Places from HERE (through the Cloud Functions in functions/) and the apartment directory: checking
// what comes back, and what a listing stores from a picked address. Pure functions, tested.
import { APARTMENTS, fullAddress, PLACE_APARTMENTS, type Apartment } from './apartments';
import { areaFromAddress, type CampusId } from './listingView';

export interface PlaceSuggestion {
  id: string;
  label: string; // the street address line
  title: string;
  sub: string;
}

// What post.html keeps on S.place after a pick. id: a HERE address; apartmentId: a directory building.
export interface PickedPlace {
  id?: string;
  apartmentId?: string;
  lat: number;
  lng: number;
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
    return [{ kind: o.kind as NearbyPlace['kind'], name, meters: Math.round(o.meters), walk: minutes(o.walk) }];
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
