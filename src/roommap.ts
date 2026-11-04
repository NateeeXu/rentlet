// Room page "Getting around": a real map of the room's spot with its campus, the nearest
// Northwestern shuttle stops and nearby places (HERE, saved with the listing when it was posted).
// room.html renders the list and calls window.RentletRoomMap.draw(); this module owns the map.
import { createMap, drawPin, drawRoute, fitTo, L } from './map';
import { CAMPUS_POINT } from './lib/apartments';
import { DIRECTIONS, LINES, metersBetween, nearestStops, routePath, walkingMinutes, type DirectionId } from './lib/shuttleData';
import { nearbyPlaces } from './place';

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
    RentletRoomMap: { rows: typeof rows; draw: typeof draw };
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

// places for listings posted before they were saved with the listing: looked up once for a
// signed-in Northwestern viewer (the lookup needs that account)
const fetched = new Map<string, NearItem[]>();
const pending = new Set<string>();

function placesOf(room: RoomLike): NearItem[] {
  if (room.near) return room.near;
  const code = room.code || '';
  const got = fetched.get(code);
  if (got) return got;
  const p = room.location;
  if (p && code && !pending.has(code) && window.RL?.authed) {
    pending.add(code);
    nearbyPlaces(p.lat, p.lng, (room.school || 'nu-evn') as 'nu-evn' | 'nu-chi' | 'chi-dt').then((list) => {
      fetched.set(code, list as NearItem[]);
      window.RL_nearRedraw?.();
    });
  }
  return [];
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

let map: L.Map | null = null;
let mapEl: HTMLElement | null = null;
let layer: L.LayerGroup | null = null;

export function draw(el: HTMLElement | null, room: RoomLike, list: Row[], on: number, cat: Cat): void {
  const p = room.location;
  if (!el || !p) return;
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
  const sel = list[on];
  if (sel) L.polyline([p, [sel.lat, sel.lng]], { color: '#222222', weight: 2, dashArray: '4 6', interactive: false }).addTo(g);
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
  if (list.length) fitTo(map!, [p, ...list.map((r) => ({ lat: r.lat, lng: r.lng }))], [40, 40]);
  else map!.setView(p, 15);
}

window.RentletRoomMap = { rows, draw };
window.RL_nearRedraw?.();
