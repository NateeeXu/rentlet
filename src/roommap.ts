// Room page "Getting around": a real map of the room's spot with its campus, the nearest
// Northwestern shuttle stops and nearby places (HERE, saved with the listing when it was posted).
// room.html renders the list and calls window.RentletRoomMap.draw(); this module owns the map.
// The selected place gets its street route from GET /api/route (functions/src/route.ts, HERE Routing)
// for the Walk / Bike / Drive choice (stops: always on foot), and its row shows the routed minutes.
// Until a route arrives, or when there is none, the map keeps a dashed straight line and the estimate.
import { createMap, drawPin, drawRoute, fitTo, INK, L } from './map';
import { CAMPUS_POINT } from './lib/apartments';
import { DIRECTIONS, LINES, metersBetween, nearestStops, routePath, walkingMinutes, type DirectionId } from './lib/shuttleData';
import { callState, nearbyPlaces, resetCall } from './place';

type Cat = 'Schools' | 'Shuttle' | 'Transit' | 'Supermarkets' | 'Restaurants' | 'Pharmacies';
type Kind = 'transit' | 'grocery' | 'pharmacy' | 'food';

interface NearItem {
  kind: Kind;
  name: string;
  lat: number | null;
  lng: number | null;
  walk: number | null;
  meters: number;
}

interface RoomLike {
  code?: string;
  school?: string;
  walk?: number | null;
  location?: { lat: number; lng: number } | null;
  near?: NearItem[] | null;
  shuttle?: { s: string } | null;
}

export interface Row {
  n: string;
  sub: string;
  w: number;
  mi: string;
  lat: number;
  lng: number;
  dir?: DirectionId;
}

declare global {
  interface Window {
    RentletRoomMap: { rows: typeof rows; draw: typeof draw; placesState: typeof placesState; retryPlaces: typeof retryPlaces };
    RL_nearSelect?: (index: number) => void;
    RL_nearRedraw?: () => void;
  }
}

const KIND: Record<Cat, Kind | null> = {
  Schools: null,
  Shuttle: null,
  Transit: 'transit',
  Supermarkets: 'grocery',
  Restaurants: 'food',
  Pharmacies: 'pharmacy',
};
const KIND_SUB: Record<Kind, string> = { transit: 'Transit stop', grocery: 'Groceries', food: 'Food and coffee', pharmacy: 'Pharmacy' };
const CAMPUS: Record<string, [string, string]> = {
  'nu-evn': ['Evanston campus', 'Northwestern'],
  'nu-chi': ['Chicago campus', 'Northwestern'],
  'chi-dt': ['The Loop', 'Downtown Chicago'],
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const miles = (m: number) => (m / 1609.344).toFixed(1);

// Places are saved with the listing when it is posted. A listing saved without any (posted before they were
// saved, or the lookup failed at the time) looks them up here for a signed-in school viewer, who has the
// account the lookup needs. An empty saved list counts as none saved.
const fetched = new Map<string, NearItem[]>();
const pending = new Set<string>();
const failed = new Set<string>();

function lookUp(room: RoomLike, code: string, p: { lat: number; lng: number }): void {
  pending.add(code);
  nearbyPlaces(p.lat, p.lng, (room.school || 'nu-evn') as 'nu-evn' | 'nu-chi' | 'chi-dt').then((list) => {
    pending.delete(code);
    if (callState('nearby') === 'ok') fetched.set(code, list as NearItem[]);
    else failed.add(code);
    window.RL_nearRedraw?.();
  });
}

function placesOf(room: RoomLike): NearItem[] {
  if (room.near?.length) return room.near;
  const code = room.code || '';
  const got = fetched.get(code);
  if (got) return got;
  if (room.location && code && !pending.has(code) && !failed.has(code) && window.RL?.authed) lookUp(room, code, room.location);
  return [];
}

// What the list should say while it has no places to show.
export function placesState(room: RoomLike): 'ready' | 'loading' | 'failed' | 'signed-out' {
  const code = room.code || '';
  if (room.near?.length || !room.location || !code || fetched.has(code)) return 'ready';
  if (failed.has(code)) return 'failed';
  return window.RL?.authed ? 'loading' : 'signed-out';
}

// Try again: the redraw that follows looks the places up once more.
export function retryPlaces(room: RoomLike): void {
  failed.delete(room.code || '');
  resetCall('nearby');
  window.RL_nearRedraw?.();
}

export function rows(cat: Cat, room: RoomLike): Row[] {
  const p = room.location;
  if (!p) return [];
  if (cat === 'Schools') {
    const id = room.school || 'nu-evn';
    const c = CAMPUS_POINT[id];
    const [n, sub] = CAMPUS[id] ?? CAMPUS['nu-evn'];
    if (!c) return [];
    const m = metersBetween(p, { lat: c[0], lng: c[1] });
    return [{ n, sub, w: room.walk ?? walkingMinutes(m), mi: miles(m * 1.3), lat: c[0], lng: c[1] }];
  }
  if (cat === 'Shuttle') {
    if (room.shuttle?.s === 'not_covered') return []; // the host's answer: no stops, no route lines
    return nearestStops(p, { limit: 3, maxMeters: 1600 }).map((s) => ({
      n: esc(s.stop.name),
      sub: `${LINES[DIRECTIONS[s.direction].line].label} · ${DIRECTIONS[s.direction].label}`,
      w: s.walk,
      mi: miles(s.meters * 1.3),
      lat: s.stop.lat,
      lng: s.stop.lng,
      dir: s.direction,
    }));
  }
  const kind = KIND[cat];
  return placesOf(room)
    .filter((x) => x.kind === kind && x.lat != null && x.lng != null)
    .map((x) => ({ n: esc(x.name), sub: KIND_SUB[x.kind], w: x.walk ?? walkingMinutes(x.meters), mi: miles(x.meters), lat: x.lat!, lng: x.lng! }))
    .sort((a, b) => a.w - b.w);
}

// ---------- street routes for the selected place ----------
export type Mode = 'Walk' | 'Bike' | 'Drive';
type RouteMode = 'walk' | 'bike' | 'drive';
const ROUTE_MODE: Record<Mode, RouteMode> = { Walk: 'walk', Bike: 'bike', Drive: 'drive' };
// how far the endpoint routes from the room, in a straight line (functions/src/route.ts MAX_KM)
const REACH_METERS: Record<RouteMode, number> = { walk: 6000, bike: 6000, drive: 25000 };
const CODE = /^[1-9][0-9]{7}$/;

interface Route {
  points: L.LatLngTuple[];
  minutes: number;
}

const routes = new Map<string, Route | null>(); // per place and mode; null: no route, keep the estimate
let routesOff = false; // no /api/route here (local dev, or not deployed yet)
let inflight: { key: string; ctl: AbortController } | null = null;
let lastDraw: Parameters<typeof draw> | null = null;
let shownKey = '';

// stops are timed on foot whatever the switch says (room.html says so above the list)
const routeModeOf = (cat: Cat, mode: Mode): RouteMode => (cat === 'Shuttle' || cat === 'Transit' ? 'walk' : (ROUTE_MODE[mode] ?? 'walk'));

// '' when this place isn't routed from this room (no listing code, too far, no endpoint)
function routeKey(room: RoomLike, r: Row | undefined, mode: RouteMode): string {
  const code = String(room.code || '');
  const p = room.location;
  if (!r || !p || routesOff || !CODE.test(code)) return '';
  if (metersBetween(p, r) > REACH_METERS[mode]) return '';
  return `${code}|${r.lat.toFixed(5)},${r.lng.toFixed(5)}|${mode}`;
}

const isTuple = (x: unknown): x is L.LatLngTuple =>
  Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === 'number' && Number.isFinite(n));

// The endpoint's answer as a line from the room to the place; null when it is empty or doesn't fit
// (a line that doesn't start at the room's pin is an old answer for a spot that has since moved).
function toRoute(json: unknown, from: { lat: number; lng: number }, to: Row): Route | null {
  const j = json as { points?: unknown; seconds?: unknown } | null;
  if (!j || !Array.isArray(j.points) || j.points.length < 2 || !j.points.every(isTuple)) return null;
  if (typeof j.seconds !== 'number' || !Number.isFinite(j.seconds) || j.seconds < 0) return null;
  const pts = j.points as L.LatLngTuple[];
  const [a, b] = [pts[0], pts[pts.length - 1]];
  if (metersBetween(from, { lat: a[0], lng: a[1] }) > 60 || metersBetween(to, { lat: b[0], lng: b[1] }) > 60) return null;
  return { points: pts, minutes: Math.max(1, Math.round(j.seconds / 60)) };
}

function requestRoute(key: string, room: RoomLike, r: Row, mode: RouteMode): void {
  const from = room.location!;
  const ctl = new AbortController();
  inflight = { key, ctl };
  const q = new URLSearchParams({ code: String(room.code), lat: r.lat.toFixed(5), lng: r.lng.toFixed(5), mode });
  fetch(`/api/route?${q}`, { signal: ctl.signal, headers: { Accept: 'application/json' } })
    .then(async (res) => {
      // anything but JSON is a server without the endpoint (a dev server's page, Hosting's 404)
      if (!(res.headers.get('content-type') || '').includes('application/json')) {
        routesOff = true;
        return;
      }
      routes.set(key, res.ok ? toRoute(await res.json(), from, r) : null);
    })
    .catch((e: unknown) => {
      if ((e as Error)?.name !== 'AbortError') routes.set(key, null);
    })
    .finally(() => {
      if (inflight?.ctl === ctl) inflight = null;
      // redrawn only when a route arrived for what is still selected; otherwise the dashed line stays
      if (!ctl.signal.aborted && routes.get(key) && shownKey === key && lastDraw) draw(...lastDraw);
    });
}

// Rows with a route show its minutes in place of the estimate room.html wrote.
function showMinutes(el: HTMLElement, room: RoomLike, list: Row[], mode: RouteMode): void {
  const box = el.closest('.nb-box');
  if (!box) return;
  list.forEach((r, i) => {
    const key = routeKey(room, r, mode);
    const route = key ? routes.get(key) : null;
    const em = route ? box.querySelector<HTMLElement>(`.nb-row[data-non="${i}"] em`) : null;
    if (em && route) em.textContent = `${route.minutes} min`;
  });
}

let map: L.Map | null = null;
let mapEl: HTMLElement | null = null;
let layer: L.LayerGroup | null = null;

export function draw(el: HTMLElement | null, room: RoomLike, list: Row[], on: number, cat: Cat, mode: Mode = 'Walk'): void {
  const p = room.location;
  if (!el || !p) return;
  lastDraw = [el, room, list, on, cat, mode];
  const sel = list[on];
  const how = routeModeOf(cat, mode);
  const key = routeKey(room, sel, how);
  shownKey = key;
  if (inflight && inflight.key !== key) {
    inflight.ctl.abort();
    inflight = null;
  }
  if (key && sel && !routes.has(key) && !inflight) requestRoute(key, room, sel, how);
  const route = key ? routes.get(key) : null;
  if (map && mapEl !== el) {
    map.remove();
    map = null;
  }
  if (!map) {
    map = createMap(el, { center: p, zoom: 15, scrollWheelZoom: false, label: 'Map of the room and places nearby' });
    mapEl = el;
    layer = L.layerGroup().addTo(map);
  }
  const g = layer!;
  g.clearLayers();
  if (cat === 'Shuttle') {
    for (const d of new Set(list.map((r) => r.dir).filter((d): d is DirectionId => !!d))) {
      drawRoute(g, routePath(d), DIRECTIONS[d].color, { weight: 3, opacity: 0.75 });
    }
  }
  // the street route in ink over a white casing; a dashed straight line while it loads or if there is none
  if (route) drawRoute(g, route.points.map(([lat, lng]) => ({ lat, lng })), INK, { weight: 4, opacity: 1 });
  else if (sel) L.polyline([p, [sel.lat, sel.lng]], { color: INK, weight: 2, dashArray: '4 6', interactive: false }).addTo(g);
  list.forEach((r, i) => {
    const active = i === on;
    const m = L.circleMarker([r.lat, r.lng], {
      radius: active ? 8 : 6,
      color: active ? '#222222' : '#717171',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1,
      bubblingMouseEvents: false,
    });
    m.bindTooltip(r.n, { direction: 'top', offset: [0, -8], className: 'rl-tip', permanent: active });
    m.on('click', () => window.RL_nearSelect?.(i));
    m.addTo(g);
  });
  drawPin(g, p, 'This room');
  // the whole route stays in view, with the other places, so the map doesn't jump between rows
  const shown = [p, ...list.map((r) => ({ lat: r.lat, lng: r.lng })), ...(route ? route.points.map(([lat, lng]) => ({ lat, lng })) : [])];
  if (list.length) fitTo(map!, shown, [40, 40]);
  else map!.setView(p, 15);
  showMinutes(el, room, list, how);
}

window.RentletRoomMap = { rows, draw, placesState, retryPlaces };
window.RL_nearRedraw?.();
