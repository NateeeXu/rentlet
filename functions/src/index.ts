// Rentlet Cloud Functions. The HERE API key lives only here, as the Firebase secret HERE_API_KEY;
// the site calls these callables and never sees the key. Every call needs a signed-in, verified
// Northwestern Google account (the same rule as firestore.rules).
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';
import {
  browseRequest,
  firstGeocode,
  geocodeRequest,
  hereUrl,
  lookupRequest,
  NEARBY_GROUPS,
  nearestList,
  suggestRequest,
  toPlace,
  toSuggestions,
  walkMinutes,
  walkRequest,
  type NearbyPlace,
  type Place,
  type Request,
  type Suggestion,
} from './here.js';
import {
  CAMPUS_POINT,
  InputError,
  isNorthwesternToken,
  kmBetween,
  MAX_WALK_KM,
  parseLookup,
  parseNearby,
  parseSuggest,
  type Point,
} from './rules.js';

const HERE_API_KEY = defineSecret('HERE_API_KEY');

const OPTIONS: CallableOptions = {
  region: 'us-central1',
  secrets: [HERE_API_KEY],
  memory: '256MiB',
  timeoutSeconds: 20,
  maxInstances: 5, // a class project: caps cost if something loops
};

class HereError extends Error {
  constructor(public status: number) {
    super(`HERE ${status}`);
  }
}

function requireNorthwestern(req: CallableRequest): void {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in with your Northwestern account.');
  if (!isNorthwesternToken(req.auth.token)) throw new HttpsError('permission-denied', 'Rentlet is for Northwestern accounts.');
}

function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch (e) {
    if (e instanceof InputError) throw new HttpsError('invalid-argument', e.message);
    throw e;
  }
}

// Logs carry the endpoint name and status only, never the URL (it holds the key).
async function here(r: Request): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(hereUrl(r.endpoint, r.params, HERE_API_KEY.value()), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
  } catch (e) {
    logger.warn('HERE request did not complete', { endpoint: r.endpoint, error: (e as Error)?.name ?? 'Error' });
    throw new HereError(0);
  }
  if (!res.ok) {
    logger.warn('HERE request failed', { endpoint: r.endpoint, status: res.status });
    throw new HereError(res.status);
  }
  return res.json();
}

async function walk(from: Point, to: Point): Promise<number | null> {
  try {
    return walkMinutes(await here(walkRequest(from, to)));
  } catch {
    return null;
  }
}

// placeSuggest({q, campusId}) -> up to 5 full street addresses around the campus (HERE Autosuggest).
// A query HERE refuses (400) has no suggestions; any other HERE failure is "unavailable", which the
// site retries after a short wait.
export const placeSuggest = onCall(OPTIONS, async (req): Promise<Suggestion[]> => {
  requireNorthwestern(req);
  const { q, campusId } = parsed(() => parseSuggest(req.data));
  if (q.length < 3) return [];
  const campus = CAMPUS_POINT[campusId];
  try {
    return toSuggestions(await here(suggestRequest(q, campus)), campus, { q });
  } catch (e) {
    if (e instanceof HereError && e.status === 400) return [];
    throw new HttpsError('unavailable', 'Suggestions are unavailable right now.');
  }
});

// placeLookup({id} or {q} or {lat, lng}, campusId) -> the point, area, ZIP and minutes on foot to the
// campus; null when not found. With coordinates only the walk is looked up (label empty, area null).
export const placeLookup = onCall(OPTIONS, async (req): Promise<(Place & { walk: number | null }) | null> => {
  requireNorthwestern(req);
  const input = parsed(() => parseLookup(req.data));
  const campus = CAMPUS_POINT[input.campusId];
  if ('point' in input) {
    const { lat, lng } = input.point;
    const minutes = kmBetween(input.point, campus) <= MAX_WALK_KM ? await walk(input.point, campus) : null;
    return { lat, lng, label: '', title: '', area: null, zip: null, walk: minutes };
  }
  let place: Place | null;
  try {
    place = 'id' in input
      ? toPlace(await here(lookupRequest(input.id)))
      : toPlace(firstGeocode(await here(geocodeRequest(input.q, campus))));
  } catch (e) {
    if (e instanceof HereError && (e.status === 400 || e.status === 404)) return null;
    throw new HttpsError('unavailable', 'Address lookup is unavailable right now.');
  }
  if (!place) return null;
  const minutes = kmBetween(place, campus) <= MAX_WALK_KM ? await walk(place, campus) : null;
  return { ...place, walk: minutes };
});

// nearby({lat, lng, campusId}) -> the nearest transit stop, grocery, pharmacy and food within about a mile.
const nearbyCache = new Map<string, { at: number; list: NearbyPlace[] }>();
const DAY_MS = 24 * 60 * 60 * 1000;

export const nearby = onCall(OPTIONS, async (req): Promise<NearbyPlace[]> => {
  requireNorthwestern(req);
  const { lat, lng } = parsed(() => parseNearby(req.data));
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = nearbyCache.get(key);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.list;

  const from = { lat, lng };
  let failed = 0;
  // up to three places of each kind, each with its walking time and position (for the room page's map)
  const found = await Promise.all(
    NEARBY_GROUPS.map(async (g): Promise<NearbyPlace[]> => {
      try {
        const near = nearestList(await here(browseRequest(from, [...g.categories])));
        return Promise.all(near.map(async (n) => ({ kind: g.kind, name: n.name, meters: n.meters, walk: await walk(from, n.to), lat: n.to.lat, lng: n.to.lng })));
      } catch {
        failed++;
        return [];
      }
    }),
  );
  if (failed === NEARBY_GROUPS.length) throw new HttpsError('unavailable', 'Nearby places are unavailable right now.');
  const list = found.flat();
  if (!failed) {
    if (nearbyCache.size > 500) nearbyCache.clear();
    nearbyCache.set(key, { at: Date.now(), list });
  }
  return list;
});

// Northwestern shuttle live positions and the HERE base map tiles (agent 5)
export { shuttleLive } from './shuttle.js';
export { mapTile } from './tiles.js';
// link previews for shared rooms (GET /r/{code})
export { sharePreview } from './share.js';
// real walk / bike / drive routes from a listing to a nearby place (GET /api/route)
export { routeLine } from './route.js';
// an email when someone messages you and you haven't opened the chat
export { emailOnMessage } from './notify.js';
