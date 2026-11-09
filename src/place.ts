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
  CallHealth,
  directoryAddresses,
  mergeAddresses,
  movePin,
  resetPin,
  type BuildingRow,
  type CallState,
  type LatLng,
  type NearbyPlace,
  type PickedPlace,
  type PlaceSuggestion,
} from './lib/place';
import type { PlaceMap } from './placemap';

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
      state: (name?: string) => CallState;
      addresses: typeof directoryAddresses;
      merge: typeof mergeAddresses;
      movePin: typeof movePin;
      resetPin: typeof resetPin;
      pinMap: (el: HTMLElement, at: LatLng, origin: LatLng) => Promise<PlaceMap>;
    };
  }
}

// How each function has been answering (src/lib/place.ts CallHealth): a failure makes the next call
// wait a little; only a function that isn't deployed stops being asked.
const health = new Map<string, CallHealth>();
const healthOf = (name: string) => {
  let h = health.get(name);
  if (!h) health.set(name, (h = new CallHealth()));
  return h;
};
let functions: Promise<{ fns: Functions; mod: typeof import('firebase/functions') }> | null = null;
// After a reload Firebase restores the session a moment after the page runs; until then currentUser
// is null although the host is signed in.
let authReady: Promise<void> | null = null;
const signedIn = async () => {
  authReady ??= auth.authStateReady().catch(() => undefined);
  await authReady;
  return !!auth.currentUser;
};

// The Functions SDK loads on first use, so pages that never look up a place don't download it.
function load() {
  functions ??= import('firebase/functions').then((mod) => ({ mod, fns: mod.getFunctions(app, 'us-central1') }));
  return functions;
}

async function call<T>(name: string, data: unknown, parse: (x: unknown) => T, fallback: T, timeout: number): Promise<T> {
  const h = healthOf(name);
  if (!h.allow(Date.now())) return fallback;
  // the functions only answer signed-in school (.edu) accounts
  if (!(await signedIn())) {
    h.last = 'signed-out';
    return fallback;
  }
  try {
    const { fns, mod } = await load();
    const res = await mod.httpsCallable(fns, name, { timeout })(data);
    h.ok();
    return parse(res.data);
  } catch (e) {
    h.fail(String((e as { code?: unknown })?.code ?? ''), Date.now());
    return fallback;
  }
}

// How the last call to a function went: answered ('ok', maybe with nothing), 'failed' (or waiting
// after a failure), or 'signed-out'. The post form says which under the address field.
export const callState = (name = 'placeSuggest'): CallState => healthOf(name).last;

// Someone pressed Try again: ask now, without the wait that follows a failure.
export const resetCall = (name: string): void => {
  health.delete(name);
};

// Up to 5 full street addresses around the campus. The timeout leaves room for a cold start.
export function suggestPlaces(q: string, campusId: CampusId): Promise<PlaceSuggestion[]> {
  const text = q.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (text.length < 3) return Promise.resolve([]);
  return call('placeSuggest', { q: text, campusId }, (x) => asSuggestions(x), [], 10000);
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
  // a dozen HERE lookups, sometimes from a cold start: long enough for the function's own 20-second limit
  return call('nearby', { lat, lng, campusId }, asNearby, [], 25000);
}

// area: the neighbourhood read from a typed address, the same fallback a listing uses without HERE.
// buildings / building / walkEstimate: the apartment directory for the Building field.
// state: how the last suggestion call went. addresses / merge: the directory's street addresses for the
// Street address field, and HERE's list with them. movePin / resetPin / pinMap: the map above the street
// address (src/placemap.ts, loaded with Leaflet only when a place is picked) and its "Adjust position".
window.RentletPlace = {
  suggest: suggestPlaces,
  lookup: lookupPlace,
  walk: walkTo,
  nearby: nearbyPlaces,
  area: areaFromAddress,
  buildings: (q, campusId) => searchApartments(q, campusId).map(buildingRow),
  building: buildingById,
  walkEstimate,
  state: callState,
  addresses: directoryAddresses,
  merge: mergeAddresses,
  movePin,
  resetPin,
  pinMap: (el, at, origin) => import('./placemap').then((m) => m.mountPlaceMap(el, at, origin)),
};
