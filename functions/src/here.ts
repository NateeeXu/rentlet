// HERE REST requests and the small shapes Rentlet keeps from their answers. Pure (no network, no key
// handling beyond building the URL), so it is unit-tested. Endpoints: HERE Geocoding & Search API v7
// (autocomplete, lookup, geocode, browse) and HERE Routing API v8 (pedestrian routes).
import type { Point } from './rules.js';

export const ENDPOINT = {
  autocomplete: 'https://autocomplete.search.hereapi.com/v1/autocomplete',
  lookup: 'https://lookup.search.hereapi.com/v1/lookup',
  geocode: 'https://geocode.search.hereapi.com/v1/geocode',
  browse: 'https://browse.search.hereapi.com/v1/browse',
  routes: 'https://router.hereapi.com/v8/routes',
} as const;

export type Endpoint = keyof typeof ENDPOINT;
export type Params = Record<string, string>;
export interface Request {
  endpoint: Endpoint;
  params: Params;
}

const LANG = 'en-US';
const at = (p: Point) => `${p.lat},${p.lng}`;

// The key is added here and nowhere else; callers must never log the result.
export function hereUrl(endpoint: Endpoint, params: Params, apiKey: string): string {
  const u = new URL(ENDPOINT[endpoint]);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('apiKey', apiKey);
  return u.toString();
}

// Full street addresses as the host types, biased to the campus.
export const suggestRequest = (q: string, near: Point): Request => ({
  endpoint: 'autocomplete',
  params: { q, at: at(near), in: 'countryCode:USA', lang: LANG, limit: '8' },
});

export const lookupRequest = (id: string): Request => ({ endpoint: 'lookup', params: { id, lang: LANG } });

export const geocodeRequest = (q: string, near: Point): Request => ({
  endpoint: 'geocode',
  params: { q, at: at(near), in: 'countryCode:USA', lang: LANG, limit: '1' },
});

export const walkRequest = (from: Point, to: Point): Request => ({
  endpoint: 'routes',
  params: { transportMode: 'pedestrian', origin: at(from), destination: at(to), return: 'summary' },
});

export const browseRequest = (near: Point, categories: string[], limit = 3): Request => ({
  endpoint: 'browse',
  params: { at: at(near), categories: categories.join(','), lang: LANG, limit: String(limit) },
});

// HERE Places category ids (docs.here.com, places category system). Level-2 ids cover their children.
export const NEARBY_GROUPS = [
  { kind: 'transit', categories: ['400-4100-0035', '400-4100-0037', '400-4100-0042', '400-4100-0337'] }, // train, subway, bus stop, light rail
  { kind: 'grocery', categories: ['600-6300-0066'] },
  { kind: 'pharmacy', categories: ['600-6400'] },
  { kind: 'food', categories: ['100-1000', '100-1100'] }, // restaurants, coffee and tea
] as const;
export type NearbyKind = (typeof NEARBY_GROUPS)[number]['kind'];
export const NEARBY_MAX_METERS = 1600;

// ---------- answers ----------

interface HereAddress {
  label?: string;
  houseNumber?: string;
  street?: string;
  city?: string;
  stateCode?: string;
  postalCode?: string;
  district?: string;
  subdistrict?: string;
}
interface HereItem {
  id?: string;
  title?: string;
  resultType?: string;
  address?: HereAddress;
  position?: Partial<Point>;
  access?: Partial<Point>[];
  distance?: number;
  scoring?: { queryScore?: number };
}

export interface Suggestion {
  id: string;
  label: string; // what goes into the street address field
  title: string; // first line in the list
  sub: string; // second line
}

export interface Place extends Point {
  label: string;
  title: string;
  area: string | null;
  zip: string | null;
}

export interface NearbyPlace {
  kind: NearbyKind;
  name: string;
  meters: number;
  walk: number | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const items = (json: unknown): HereItem[] => {
  const list = (json as { items?: unknown } | null)?.items;
  return Array.isArray(list) ? (list.filter((x) => x && typeof x === 'object') as HereItem[]) : [];
};
const isPoint = (p: Partial<Point> | undefined): p is Point =>
  !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng);

export const zipOf = (a: HereAddress | undefined): string | null => /^\d{5}/.exec(str(a?.postalCode))?.[0] ?? null;

// "1890 Maple Ave, Evanston, IL 60201, United States" -> "1890 Maple Ave, Evanston, IL 60201"
export function shortLabel(label: string): string {
  return label.replace(/,\s*(United States( of America)?|USA)\s*$/i, '').trim();
}

// The street line without a place's name in front: "1715 Chicago Ave, Evanston, IL 60201".
export function streetLabel(a: HereAddress | undefined): string {
  const street = [str(a?.houseNumber), str(a?.street)].filter(Boolean).join(' ');
  const region = [str(a?.stateCode), zipOf(a) ?? ''].filter(Boolean).join(' ');
  if (street) return [street, str(a?.city), region].filter(Boolean).join(', ');
  return shortLabel(str(a?.label));
}

// Only complete addresses (a house number on a street) can be picked.
export function toSuggestions(json: unknown, max = 5): Suggestion[] {
  const out: Suggestion[] = [];
  for (const it of items(json)) {
    const id = str(it.id);
    if (!id.startsWith('here:') || it.resultType !== 'houseNumber') continue;
    const label = streetLabel(it.address) || shortLabel(str(it.title));
    if (!label) continue;
    const cut = label.indexOf(', ');
    out.push({ id, label, title: cut > 0 ? label.slice(0, cut) : label, sub: cut > 0 ? label.slice(cut + 2) : '' });
    if (out.length >= max) break;
  }
  return out;
}

export function toPlace(item: unknown): Place | null {
  if (!item || typeof item !== 'object') return null;
  const it = item as HereItem;
  if (!isPoint(it.position)) return null;
  const label = streetLabel(it.address);
  if (!label) return null;
  const area = str(it.address?.district) || str(it.address?.subdistrict);
  return {
    lat: it.position.lat,
    lng: it.position.lng,
    label,
    title: it.resultType === 'place' ? str(it.title) : '',
    area: area ? area.slice(0, 80) : null,
    zip: zipOf(it.address),
  };
}

// A typed address is only trusted when HERE matched a building or a house number with confidence.
export function firstGeocode(json: unknown, minScore = 0.7): HereItem | null {
  const it = items(json)[0];
  if (!it) return null;
  if (it.resultType !== 'houseNumber' && it.resultType !== 'place') return null;
  const score = it.scoring?.queryScore;
  if (typeof score === 'number' && score < minScore) return null;
  return it;
}

export function walkMinutes(json: unknown): number | null {
  const route = (json as { routes?: { sections?: { summary?: { duration?: unknown } }[] }[] } | null)?.routes?.[0];
  if (!route || !Array.isArray(route.sections) || !route.sections.length) return null;
  let seconds = 0;
  for (const s of route.sections) {
    const d = s?.summary?.duration;
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) return null;
    seconds += d;
  }
  return Math.max(1, Math.round(seconds / 60));
}

// The nearest place in a browse answer within walking range, and the point to walk to (an entrance when known).
export function nearestOf(json: unknown, maxMeters = NEARBY_MAX_METERS): { name: string; meters: number; to: Point } | null {
  for (const it of items(json)) {
    const name = str(it.title);
    const to = isPoint(it.access?.[0]) ? it.access![0] : it.position;
    if (!name || !isPoint(to) || typeof it.distance !== 'number') continue;
    if (it.distance > maxMeters) return null; // answers come nearest first
    return { name: name.slice(0, 80), meters: Math.round(it.distance), to: { lat: to.lat, lng: to.lng } };
  }
  return null;
}
