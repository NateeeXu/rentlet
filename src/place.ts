// HERE address suggestions, lookups and nearby places, through Rentlet's Cloud Functions (functions/).
// The HERE key stays on the server. Every call fails soft: no suggestions, no place, no nearby list,
// so posting a listing still works when the functions are not deployed or HERE is down.
// Classic page scripts reach this as window.RentletPlace.
import type { Functions } from 'firebase/functions';
import { app, auth } from './firebase';
import { searchApartments, walkEstimate } from './lib/apartments';
import { areaFromAddress, type CampusId } from './lib/listingView';
import {
  asNearby,
  asPlace,
  asSuggestions,
  asWalk,
  buildingById,
  buildingRow,
  type BuildingRow,
  type NearbyPlace,
  type PickedPlace,
  type PlaceSuggestion,
} from './lib/place';

export type { BuildingRow, NearbyPlace, PickedPlace, PlaceSuggestion };

declare global {
  interface Window {
    RentletPlace: {
      suggest: typeof suggestPlaces;
      lookup: typeof lookupPlace;
      walk: typeof walkTo;
      nearby: typeof nearbyPlaces;
      area: typeof areaFromAddress;
      buildings: (q: string, campusId: CampusId) => BuildingRow[];
      building: typeof buildingById;
      walkEstimate: typeof walkEstimate;
    };
  }
}

// Codes that mean the functions are missing (not deployed) rather than a passing problem; after one,
// this page stops asking.
const MISSING = new Set(['functions/not-found', 'functions/internal', 'functions/unimplemented']);
let missing = false;
let functions: Promise<{ fns: Functions; mod: typeof import('firebase/functions') }> | null = null;

// The Functions SDK loads on first use, so pages that never look up a place don't download it.
function load() {
  functions ??= import('firebase/functions').then((mod) => ({ mod, fns: mod.getFunctions(app, 'us-central1') }));
  return functions;
}

async function call<T>(name: string, data: unknown, parse: (x: unknown) => T, fallback: T, timeout: number): Promise<T> {
  if (missing || !auth.currentUser) return fallback; // the functions only answer signed-in Northwestern accounts
  try {
    const { fns, mod } = await load();
    const res = await mod.httpsCallable(fns, name, { timeout })(data);
    return parse(res.data);
  } catch (e) {
    if (MISSING.has((e as { code?: string }).code ?? '')) missing = true;
    return fallback;
  }
}

// Up to 5 full street addresses near the campus.
export function suggestPlaces(q: string, campusId: CampusId): Promise<PlaceSuggestion[]> {
  const text = q.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (text.length < 3) return Promise.resolve([]);
  return call('placeSuggest', { q: text, campusId }, (x) => asSuggestions(x), [], 6000);
}

// The point, area, ZIP and minutes on foot to the campus for a suggestion id or a typed address.
export async function lookupPlace(input: { id: string } | { q: string }, campusId: CampusId): Promise<PickedPlace | null> {
  let data: { id: string; campusId: CampusId } | { q: string; campusId: CampusId };
  if ('id' in input) data = { id: input.id, campusId };
  else {
    const q = input.q.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (q.length < 3) return null;
    data = { q, campusId };
  }
  const place = await call('placeLookup', data, asPlace, null, 8000);
  if (!place) return null;
  if ('id' in input) place.id = input.id;
  place.campusId = campusId;
  return place;
}

// Minutes on foot from a point (a directory building) to the campus, by HERE pedestrian routing; null
// when HERE can't answer (the page then uses the directory's estimate).
export function walkTo(lat: number, lng: number, campusId: CampusId): Promise<number | null> {
  return call('placeLookup', { lat, lng, campusId }, asWalk, null, 8000);
}

// The nearest transit stop, grocery, pharmacy and food with walking minutes.
export function nearbyPlaces(lat: number, lng: number, campusId: CampusId): Promise<NearbyPlace[]> {
  return call('nearby', { lat, lng, campusId }, asNearby, [], 10000);
}

// area: the neighbourhood read from a typed address, the same fallback a listing uses without HERE.
// buildings / building / walkEstimate: the apartment directory for the Building field.
window.RentletPlace = {
  suggest: suggestPlaces,
  lookup: lookupPlace,
  walk: walkTo,
  nearby: nearbyPlaces,
  area: areaFromAddress,
  buildings: (q, campusId) => searchApartments(q, campusId).map(buildingRow),
  building: buildingById,
  walkEstimate,
};
