// shuttle.html: Northwestern's Intercampus shuttle and evening Loop on a map that fills the page, with live
// buses from the university's shuttle system (GET /api/shuttle -> functions/src/shuttle.ts) and the rooms
// along the route. The rest floats on the map in frosted glass, after the CloudSublet mini program's campus
// transit map: the line card (where the route runs, its live bus count, the Intercampus | Loop switch), the
// route chips, round map buttons under the zoom (the whole route, locate me, full screen), and a sheet with
// the rooms along the route (price pins on the map, filtered by area) and the stops with their arrivals and
// service hours. On phones the sheet collapses (drag its handle or tap it). Live buses are polled every 10 s
// while the tab is visible; routes, stops and hours always show, and missing live parts say so plainly.
import { addMapButton, busMarker, createMap, drawRoute, drawStops, drawZone, L, moveBus, quietPopup, reducedMotion } from './map';
import { DIRECTIONS, LINES, REGION_LABEL, routePath, SOURCES, stopRows, ZONES, type DirectionId, type LineId, type StopRow } from './lib/shuttleData';
import {
  arrivalLabel,
  arrivalsAt,
  busCountLabel,
  busesOn,
  elapsedSeconds,
  LIVE_URL,
  parseLiveReading,
  REFRESH_MS,
  updatedLabel,
  type LiveReading,
  type LiveVehicle,
} from './lib/shuttleLive';
import { toCard, type ListingDoc } from './lib/listingView';
import { dateRange, money } from './lib/format';
import {
  alongRoute,
  areaGroups,
  campusesOf,
  campusShort,
  HOME_CAMPUS,
  homepagePlan,
  inArea,
  NEAR_STOP_METERS,
  parseView,
  viewDirections,
  viewParam,
  withSchool,
  type AlongRoute,
  type AreaGroup,
  type View,
} from './lib/shuttleRooms';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// toCard's strings arrive escaped for HTML (src/lib/listingView.ts); as plain text for links and labels
const plain = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e] as string);

// "No buses to Chicago right now", "No buses on Loop A right now".
const WAY: Record<DirectionId, string> = { 'to-chicago': 'to Chicago', 'to-evanston': 'to Evanston', 'loop-a': 'on Loop A', 'loop-b': 'on Loop B' };
// A reading this old is no longer shown as live when a newer one can't be fetched.
const KEEP_READING_MS = 60_000;
// The sheet says the rooms couldn't load when the live list hasn't come in by then (it still shows if it does).
const LISTINGS_WAIT_MS = 12_000;
const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const roomsText = (n: number) => `${n} room${n === 1 ? '' : 's'}`;

type Card = ReturnType<typeof toCard>;
type Room = AlongRoute<Card>;
type Tab = 'listings' | 'stops';

const first = parseView(new URLSearchParams(location.search).get('d'));
const state = {
  line: first.line,
  view: first.view,
  reading: null as LiveReading | null,
  failed: false,
  tab: 'listings' as Tab,
  cards: null as Card[] | null, // the live listings that have a spot on the map; null until the list arrives
  cardsFailed: false,
  area: null as string | null, // the chosen area chip (an AreaGroup key); null: every area
  open: true, // phones: the sheet is expanded
  stop: null as { dir: DirectionId; row: number } | null, // the stop shown in the popup
  bus: '', // or the bus shown in it
  room: '', // the room whose small card is open
};
const lastView: Record<LineId, View> = { intercampus: 'all', loop: 'all' };
lastView[state.line] = state.view;
const dirs = () => viewDirections(state.line, state.view);
const rowsCache = new Map<DirectionId, StopRow[]>();
function rowsOf(id: DirectionId): StopRow[] {
  let rows = rowsCache.get(id);
  if (!rows) rowsCache.set(id, (rows = stopRows(id)));
  return rows;
}
// "to-chicago:3" -> the direction and the stop row
function ref(s = ''): [DirectionId, number] {
  const k = s.lastIndexOf(':');
  return [s.slice(0, k) as DirectionId, Number(s.slice(k + 1))];
}

const stage = $('#app');
const topBox = $('[data-top]');
const sheet = $('[data-sheet]');
const sheetBody = $('#sheet-body');

// ---------- map ----------

const map = createMap($('#map'), { label: 'Shuttle map', minZoom: 10 });
for (const z of ZONES) if (z.kind === 'campus') drawZone(map, z.points, 'campus');
const routeLayer = L.layerGroup().addTo(map);
const roomLayer = L.layerGroup().addTo(map);
const busLayer = L.layerGroup().addTo(map);
const buses = new Map<string, L.Marker>();
const popup = quietPopup();
popup.on('remove', () => {
  state.stop = null;
  state.bus = '';
  markCurrent();
});

const phone = () => stage.clientWidth <= 860;

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// How much of the map the floating panels cover at each side, so fitting and popups keep clear of them.
function covered(): Insets {
  const s = stage.getBoundingClientRect();
  const t = topBox.getBoundingClientRect();
  const k = sheet.getBoundingClientRect();
  const ctl = map.getContainer().querySelector('.leaflet-top.leaflet-right')?.getBoundingClientRect();
  const right = ctl && ctl.width ? s.right - ctl.left + 8 : 16;
  const c: Insets = phone()
    ? { top: t.bottom - s.top + 12, right, bottom: s.bottom - k.top + 12, left: 12 }
    : { top: 24, right, bottom: 24, left: Math.max(t.right, k.right) - s.left + 24 };
  // always leave a window of map to show things in
  const fitIn = (a: 'left' | 'top', b: 'right' | 'bottom', size: number) => {
    const room = size - 120;
    if (c[a] + c[b] > room) {
      const f = Math.max(0, room) / (c[a] + c[b]);
      c[a] *= f;
      c[b] *= f;
    }
  };
  fitIn('left', 'right', s.width);
  fitIn('top', 'bottom', s.height);
  return c;
}

// Fits the points into the uncovered map, with room for a price pill or bus at the edge.
function fitPoints(points: { lat: number; lng: number }[], maxZoom = 16, animate = !reducedMotion()): void {
  if (!points.length) return;
  const c = covered();
  map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as L.LatLngTuple)), {
    paddingTopLeft: [c.left + 16, c.top + 16],
    paddingBottomRight: [c.right + 16, c.bottom + 16],
    maxZoom,
    animate,
  });
}
// The whole route shown, with the price pins along it.
const fitRoute = (animate?: boolean) => fitPoints([...dirs().flatMap((id) => routePath(id)), ...shown()], 16, animate);

// Puts a point in the middle of the part of the map nothing covers.
function centerOn(at: L.LatLng, zoom: number): void {
  const c = covered();
  const p = map.project(at, zoom).subtract(L.point((c.left - c.right) / 2, (c.top - c.bottom) / 2));
  map.setView(map.unproject(p, zoom), zoom, { animate: !reducedMotion() });
}

function padPopup(p: L.Popup): void {
  const c = covered();
  p.options.autoPanPaddingTopLeft = L.point(c.left + 8, c.top + 8);
  p.options.autoPanPaddingBottomRight = L.point(c.right + 8, c.bottom + 8);
}

// Leaflet pans to fit a popup each time its place or content changes, and stops any pan under way to do
// so; here it pans only when a popup opens from a click on the map, never on the live refreshes.
function showPopup(at: L.LatLngExpression, html: string, pan: boolean): void {
  padPopup(popup);
  popup.options.autoPan = pan;
  popup.setLatLng(at);
  if (popup.getContent() !== html) popup.setContent(html);
  if (!popup.isOpen()) popup.openOn(map);
  popup.options.autoPan = false;
}

function routeName(): string {
  if (state.view === 'all') return state.line === 'loop' ? 'the Loop shuttle, Loop A and Loop B' : 'the Intercampus shuttle, both directions';
  const d = DIRECTIONS[state.view];
  return d.line === 'loop' ? `the ${d.label} shuttle` : `the Intercampus shuttle ${WAY[d.id]}`;
}

function drawRoutes(): void {
  routeLayer.clearLayers();
  const ids = dirs();
  for (const id of ids) drawRoute(routeLayer, routePath(id), DIRECTIONS[id].color);
  // stops above every line
  for (const id of ids) {
    const d = DIRECTIONS[id];
    const rows = rowsOf(id);
    drawStops(routeLayer, d.stops, d.color, (i) => openStop(id, rows.findIndex((r) => r.ids.includes(d.stops[i].id)), false));
  }
  map.getContainer().setAttribute('aria-label', `Map of ${routeName()}, with the rooms along the route`);
}

// ---------- the round map buttons ----------

const FIT_SVG = '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16"/>';
const LOCATE_SVG = '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5"/>';
const FULL_SVG = '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>';
const EXIT_SVG = '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>';

const fitBtn = addMapButton(map, 'Show the whole route', FIT_SVG, () => fitRoute());
fitBtn.dataset.fit = '';
const locBtn = addMapButton(map, 'Show where I am', LOCATE_SVG, locate);
const fullBtn = addMapButton(map, 'Full screen', FULL_SVG, () => void toggleFull());
fullBtn.setAttribute('aria-pressed', 'false');

const toastEl = $('[data-toast]');
let toastTimer = 0;
// A short message over the map (inside it, so it shows in full screen too).
function say(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), 4000);
}

let me: L.Marker | null = null;
// The browser's position only centres the map (and shows a dot there): it is never saved or sent anywhere.
function locate(): void {
  if (!('geolocation' in navigator)) return say('This browser can’t share your location.');
  locBtn.setAttribute('aria-busy', 'true');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locBtn.removeAttribute('aria-busy');
      const at = L.latLng(pos.coords.latitude, pos.coords.longitude);
      const area = map.options.maxBounds;
      if (area instanceof L.LatLngBounds && !area.contains(at)) return say('You’re outside the area this map covers.');
      if (me) me.setLatLng(at);
      else
        me = L.marker(at, {
          icon: L.divIcon({ className: 'sp-me', html: '<i></i>', iconSize: [40, 40], iconAnchor: [20, 20] }),
          interactive: false,
          keyboard: false,
          zIndexOffset: 500,
        }).addTo(map);
      centerOn(at, Math.max(map.getZoom(), 15));
    },
    (err) => {
      locBtn.removeAttribute('aria-busy');
      say(err.code === err.PERMISSION_DENIED ? 'Location is off for this site. Allow it in your browser to centre the map on you.' : 'Couldn’t find where you are. Try again.');
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  );
}

// Full screen with the Fullscreen API, or the page's own where there is none (iPhone Safari).
const canFullscreen = () => !!document.fullscreenEnabled && typeof stage.requestFullscreen === 'function';
const isFull = () => document.fullscreenElement === stage || stage.classList.contains('full');
function cssFull(on: boolean): void {
  stage.classList.toggle('full', on);
  document.documentElement.classList.toggle('sp-lock', on);
}
async function toggleFull(): Promise<void> {
  if (isFull()) {
    if (document.fullscreenElement === stage) await document.exitFullscreen().catch(() => undefined);
    cssFull(false);
  } else if (canFullscreen()) {
    try {
      await stage.requestFullscreen();
    } catch {
      cssFull(true);
    }
  } else cssFull(true);
  paintFull();
}
function paintFull(): void {
  const on = isFull();
  fullBtn.setAttribute('aria-pressed', String(on));
  fullBtn.title = on ? 'Exit full screen' : 'Full screen';
  fullBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${on ? EXIT_SVG : FULL_SVG}</svg>`;
  requestAnimationFrame(() => {
    measure();
    map.invalidateSize({ animate: false });
  });
}
document.addEventListener('fullscreenchange', paintFull);

// ---------- live buses ----------

const fresh = (): LiveReading | null =>
  state.reading && (!state.failed || Date.now() - state.reading.updatedAt < KEEP_READING_MS) ? state.reading : null;
const liveOn = (reading: LiveReading | null) => dirs().flatMap((id) => busesOn(reading, id));
const busKey = (v: LiveVehicle) => `${v.line}:${v.id}`;

function busText(v: LiveVehicle): { title: string; next: string } {
  const d = DIRECTIONS[v.line];
  const title = d.line === 'loop' ? `${d.label} bus` : `Bus ${WAY[v.line]}`;
  const reading = fresh();
  if (!v.nextStop || !reading) return { title, next: '' };
  const left = Math.max(0, v.nextStop.seconds - elapsedSeconds(reading));
  const id = v.nextStop.id;
  const name = d.stops.find((s) => s.id === id)?.name ?? v.nextStop.name;
  return { title, next: name ? `Next stop: ${name}, ${arrivalLabel(left).toLowerCase()}` : '' };
}

function busPopupHtml(v: LiveVehicle): string {
  const { title, next } = busText(v);
  return `<span class="pop-name">${esc(title)}</span>${next ? `<span class="pop-next">${esc(next)}</span>` : ''}`;
}

const findBus = (key: string) => liveOn(fresh()).find((x) => busKey(x) === key);

function drawBuses(): void {
  const keep = new Set<string>();
  for (const v of liveOn(fresh())) {
    const key = busKey(v);
    keep.add(key);
    const { title, next } = busText(v);
    const label = next ? `${title}. ${next}` : title;
    const have = buses.get(key);
    if (have) moveBus(have, v, v.heading, label);
    else {
      const m = busMarker(v, { color: DIRECTIONS[v.line].color, heading: v.heading, label });
      m.on('click', () => {
        const now = findBus(key);
        if (!now) return;
        showPopup(m.getLatLng(), busPopupHtml(now), true);
        state.bus = key;
        state.stop = null;
        markCurrent();
      });
      // an open bus popup rides along as the bus glides to its new place
      m.on('move', () => {
        if (state.bus === key && popup.isOpen()) showPopup(m.getLatLng(), popup.getContent() as string, false);
      });
      busLayer.addLayer(m);
      buses.set(key, m);
    }
  }
  for (const [key, m] of buses) {
    if (keep.has(key)) continue;
    if (state.bus === key) map.closePopup(popup);
    busLayer.removeLayer(m);
    buses.delete(key);
  }
  refreshBusPopup();
}

// An open bus popup keeps its next-stop countdown current.
function refreshBusPopup(): void {
  if (!state.bus || !popup.isOpen()) return;
  const v = findBus(state.bus);
  const m = buses.get(state.bus);
  if (v && m) showPopup(m.getLatLng(), busPopupHtml(v), false);
}

// "● 2 buses running · updated just now" in the line card. Only the count is announced; the age ticks.
function renderStatus(): void {
  const box = $('[data-status]');
  const text = $('[data-status-text]');
  const upd = $('[data-updated]');
  const reading = fresh();
  let tone = 'wait';
  let words = 'Checking for live buses…';
  let small = '';
  if (!reading && state.failed) {
    tone = 'off';
    words = 'Live bus positions are unavailable';
  } else if (reading) {
    const here = liveOn(reading).length;
    const onLine = LINES[state.line].directions.reduce((n, d) => n + busesOn(reading, d).length, 0);
    tone = here ? 'live' : 'off';
    words = here ? busCountLabel(here) : state.view !== 'all' && onLine ? `No buses ${WAY[state.view]} right now` : 'No buses running right now';
    small = updatedLabel(reading.updatedAt).replace(/^Updated /, '');
  }
  box.dataset.tone = tone;
  if (text.textContent !== words) text.textContent = words;
  // " · updated just now"; the narrowest phones leave out "updated"
  if (upd.dataset.v !== small) {
    upd.dataset.v = small;
    upd.innerHTML = small ? ` · <span class="upd-w">updated </span>${esc(small)}` : '';
  }
}

function etaHtml(id: DirectionId, row: StopRow | undefined): string {
  const reading = fresh();
  if (!reading || !row) return '';
  const next = arrivalsAt(reading, id, row.ids);
  if (!next.length) return '';
  return `<b>${esc(arrivalLabel(next[0]))}</b>${next[1] !== undefined ? `<span>then ${esc(arrivalLabel(next[1]).toLowerCase())}</span>` : ''}`;
}

function stopPopupHtml(id: DirectionId, row: StopRow): string {
  const reading = fresh();
  const area = REGION_LABEL[row.region];
  let next = '';
  if (reading) {
    const times = arrivalsAt(reading, id, row.ids);
    next = times.length
      ? `Next bus ${arrivalLabel(times[0]).toLowerCase()}${times[1] !== undefined ? `, then ${arrivalLabel(times[1]).toLowerCase()}` : ''}`
      : 'No live arrival right now';
  }
  const d = DIRECTIONS[id];
  return `<span class="pop-name">${esc(row.name)}</span><span class="pop-line">${esc(d.line === 'loop' ? d.label : `Intercampus ${WAY[id]}`)}${area ? ` · ${esc(area)}` : ''}</span>${next ? `<span class="pop-next">${esc(next)}</span>` : ''}`;
}

function renderEtas(): void {
  document.querySelectorAll<HTMLElement>('[data-eta]').forEach((el) => {
    const [id, i] = ref(el.dataset.eta);
    const html = etaHtml(id, rowsOf(id)[i]);
    if (el.innerHTML !== html) el.innerHTML = html;
  });
  const row = state.stop && rowsOf(state.stop.dir)[state.stop.row];
  if (state.stop && row && popup.isOpen()) showPopup(row.stops[0], stopPopupHtml(state.stop.dir, row), false);
}

function renderLive(): void {
  renderStatus();
  drawBuses();
  renderEtas();
}

// ---------- stops ----------

function markCurrent(): void {
  const current = state.stop ? `${state.stop.dir}:${state.stop.row}` : '';
  document.querySelectorAll<HTMLButtonElement>('[data-stop]').forEach((b) => {
    if (b.dataset.stop === current) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
}

function openStop(id: DirectionId, i: number, fromList: boolean): void {
  const row = rowsOf(id)[i];
  if (!row) return;
  const at = L.latLng(row.stops[0].lat, row.stops[0].lng);
  if (fromList) centerOn(at, Math.max(map.getZoom(), 15));
  showPopup(at, stopPopupHtml(id, row), !fromList);
  // after showPopup: opening it closes a room's card or the bus popup, whose removal must not clear this
  state.stop = { dir: id, row: i };
  state.bus = '';
  markCurrent();
}

// The stop list of each direction shown, with its service hours; arrivals fill in from the live reading.
function renderStops(): void {
  const ids = dirs();
  const many = ids.length > 1;
  $('[data-stops]').innerHTML = ids
    .map((id) => {
      const d = DIRECTIONS[id];
      const head = many ? `<h3 class="sg-h"><span class="dot" aria-hidden="true"></span>${esc(d.label)}</h3><p class="sg-route">${esc(d.route)}</p>` : '';
      const rows = rowsOf(id)
        .map((r, i) => {
          const area = REGION_LABEL[r.region];
          return `<li class="stop"><button type="button" data-stop="${id}:${i}"><span class="rail" aria-hidden="true"><i></i></span><span><span class="stop-name">${esc(r.name)}</span>${area ? `<span class="stop-area">${esc(area)}</span>` : ''}</span><span class="eta" data-eta="${id}:${i}"></span></button></li>`;
        })
        .join('');
      return `<section class="sgroup" style="--c:${d.color}">${head}<p class="hours"><b>Service hours</b>${esc(d.hours)}</p><ol class="stops${d.line === 'loop' ? ' loop' : ''}" aria-label="${esc(d.line === 'loop' ? `${d.label} stops` : `Stops ${WAY[id]}`)}">${rows}</ol></section>`;
    })
    .join('');
  const src = state.line === 'loop' ? SOURCES.loop : SOURCES.intercampus;
  $('[data-checked]').textContent = `Routes and hours: ${src.label}, checked ${longDate(src.checkedAt)}. Times are Chicago time${state.line === 'intercampus' ? ', and a Wildcard is needed to ride' : ''}.`;
  $<HTMLAnchorElement>('[data-official]').href = src.url;
  markCurrent();
  renderEtas();
}

// ---------- rooms along the route ----------

let near: Room[] = []; // along the route on the map (src/lib/shuttleRooms.ts NEAR_STOP_METERS)
let groups: AreaGroup[] = [];
const shown = (): Room[] => inArea(near, state.area);

function computeRooms(): void {
  near = state.cards ? alongRoute(state.cards, dirs()) : [];
  groups = areaGroups(near);
  if (state.area !== null && !groups.some((g) => g.key === state.area)) state.area = null;
}

// The campus the shown rooms belong to (most of them), for the homepage results and the request form.
const ctaCampus = () => campusesOf(shown().length ? shown() : near).most ?? HOME_CAMPUS;

const pins = new Map<string, L.Marker>();
const shift = new Map<string, number>(); // px a pill is moved down so rooms at one spot don't hide each other
let roomPop: L.Popup | null = null;
let pinSig = '';

function restyle(): void {
  pins.forEach((m, code) => {
    const on = code === state.room;
    m.getElement()?.classList.toggle('on', on);
    m.setZIndexOffset(on ? 900 : 0);
  });
}

function closeRoom(): void {
  if (roomPop) {
    const p = roomPop;
    roomPop = null;
    map.closePopup(p);
  }
  if (state.room) {
    state.room = '';
    restyle();
  }
}

// The room's photo, title, rent and area, the walk to its nearest stop (estimated) and its dates.
function cardHtml(r: Room): string {
  return `<a class="sp-card" href="room.html?room=${encodeURIComponent(plain(r.code))}">${r.img ? `<span class="sp-ph"><img src="${r.img}" alt=""></span>` : ''}<span class="sp-bd"><span class="sp-t">${r.title || 'Room'}</span><span class="sp-p"><b>${money(r.price)}</b><small> / mo${r.area ? ` · ${r.area}` : ''}</small></span><span class="sp-d">${r.stop.walk} min walk to ${esc(r.stop.stop.name)}</span>${r.start && r.end ? `<span class="sp-d">${dateRange(r.start, r.end)}</span>` : ''}</span></a>`;
}

// A pill's small card, above the pill; it links to the room.
function openRoom(code: string, byKeyboard: boolean): void {
  const r = shown().find((x) => x.code === code);
  if (!r || (state.room === code && roomPop)) return;
  closeRoom();
  const p = L.popup({ closeButton: false, className: 'rl-pop sp-pop', minWidth: 248, maxWidth: 248, offset: [0, (shift.get(code) ?? 0) - 12] })
    .setLatLng([r.lat, r.lng])
    .setContent(cardHtml(r));
  padPopup(p);
  p.on('remove', () => {
    if (roomPop === p) roomPop = null;
    if (state.room === code) {
      state.room = '';
      restyle();
    }
  });
  roomPop = p;
  p.openOn(map);
  state.room = code;
  restyle();
  if (byKeyboard) p.getElement()?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
}

function pin(r: Room): L.Marker {
  const m = L.marker([r.lat, r.lng], {
    icon: L.divIcon({ className: 'sp-pin', html: `<span class="sp-pill" style="--dy:${shift.get(r.code) ?? 0}px">${money(r.price)}</span>`, iconSize: [0, 0], iconAnchor: [0, 0] }),
    keyboard: true,
    riseOnHover: true,
    autoPanOnFocus: false,
  });
  m.on('add', () => {
    const el = m.getElement();
    if (!el) return;
    el.setAttribute('aria-label', `${money(r.price)} a month, ${plain(r.title) || 'Room'}${r.area ? `, ${plain(r.area)}` : ''}`);
    el.classList.toggle('on', r.code === state.room);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        openRoom(r.code, true);
      }
    });
  });
  m.on('click', () => openRoom(r.code, false));
  return m;
}

// Price pills for the rooms shown (along the route, in the chosen area); redrawn only when they change.
function drawPins(): void {
  const list = shown();
  const sig = list.map((r) => `${r.code}:${r.price}:${r.lat},${r.lng}`).join(' ');
  if (sig === pinSig) return;
  pinSig = sig;
  closeRoom();
  roomLayer.clearLayers();
  pins.clear();
  // rooms in one building (within about 20 m) stack their pills in a column centred on the spot
  shift.clear();
  const spots: Room[][] = [];
  for (const r of list) {
    const g = spots.find(([a]) => Math.abs(a.lat - r.lat) < 0.0002 && Math.abs(a.lng - r.lng) < 0.0003);
    if (g) g.push(r);
    else spots.push([r]);
  }
  for (const g of spots) g.forEach((r, k) => shift.set(r.code, Math.round((k - (g.length - 1) / 2) * 34)));
  for (const r of list) pins.set(r.code, pin(r).addTo(roomLayer));
}

function renderAreas(): void {
  const box = $('[data-areas]');
  box.hidden = !near.length;
  const focused = box.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.area : undefined;
  box.innerHTML = near.length
    ? [
        `<button type="button" class="achip" data-area="-1" aria-pressed="${state.area === null}" aria-label="All areas, ${roomsText(near.length)}">All <b>${near.length}</b></button>`,
        ...groups.map(
          (g, i) =>
            `<button type="button" class="achip" data-area="${i}" aria-pressed="${state.area === g.key}" aria-label="${g.label}, ${roomsText(g.count)}">${g.label} <b>${g.count}</b></button>`,
        ),
      ].join('')
    : '';
  if (focused !== undefined) box.querySelector<HTMLElement>(`[data-area="${focused}"]`)?.focus({ preventScroll: true });
}

function chooseArea(i: number): void {
  const key = i < 0 ? null : (groups[i]?.key ?? null);
  state.area = state.area === key ? null : key; // the chosen area again: every area
  drawPins();
  renderSheet();
  if (state.area === null) fitRoute();
  else fitPoints(shown(), 16);
}

// The sheet's title and the line under it, as HTML (area names arrive escaped from toCard).
function sheetCopy(): { title: string; meta: string } {
  if (state.tab === 'stops') {
    if (state.view === 'all') return { title: esc(`${LINES[state.line].label} stops`), meta: esc(LINES[state.line].summary.replace(/\.$/, '')) };
    const d = DIRECTIONS[state.view];
    return { title: esc(d.line === 'loop' ? `${d.label} stops` : `Stops ${WAY[d.id]}`), meta: esc(`${d.route} · ${rowsOf(d.id).length} stops`) };
  }
  const list = shown();
  // one campus for all of them names it ("Evanston listings"); rooms of several campuses don't
  const campus = near.length ? campusesOf(list.length ? list : near).only : HOME_CAMPUS;
  const title = campus ? `${campusShort(campus)} listings along the route` : 'Listings along the route';
  let meta: string;
  if (!state.cards) meta = state.cardsFailed ? 'Rooms couldn’t load right now. The routes and stops still show.' : 'Finding rooms near the stops…';
  else if (!near.length) meta = `No rooms within ${NEAR_STOP_METERS} m of a stop yet`;
  else if (state.area !== null) meta = `${roomsText(list.length)} in ${groups.find((g) => g.key === state.area)?.label ?? ''} within ${NEAR_STOP_METERS} m of a stop`;
  else meta = `${roomsText(near.length)} within ${NEAR_STOP_METERS} m of a stop`;
  return { title: esc(title), meta: esc(plain(meta)) };
}

function renderSheet(): void {
  const { title, meta } = sheetCopy();
  $('[data-sheet-title]').innerHTML = title;
  $('[data-sheet-meta]').innerHTML = meta;
  $('[data-n]').textContent = state.cards && near.length ? String(near.length) : '';
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === state.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $('#pane-listings').hidden = state.tab !== 'listings';
  $('#pane-stops').hidden = state.tab !== 'stops';
  renderAreas();
}

function chooseTab(tab: Tab, focus = false): void {
  if (tab !== state.tab) {
    state.tab = tab;
    renderSheet();
  }
  if (focus) $(`[data-tab="${tab}"]`).focus();
  if (phone() && !state.open) setOpen(true);
}

// ---------- the line card and route chips ----------

const via = (a: string, b: string, mark: string, word: string) => `${a} <span aria-hidden="true">${mark}</span><span class="sr">${word}</span> ${b}`;
// Where the route shown runs, as the mini program's search bar says it: the Loop stays on the Evanston
// campus; the Intercampus joins the two campuses (a direction names where it goes).
function titleHtml(): string {
  if (state.line === 'loop') return 'Evanston · Northwestern';
  if (state.view === 'to-chicago') return via('Evanston', 'Chicago', '→', 'to');
  if (state.view === 'to-evanston') return via('Chicago', 'Evanston', '→', 'to');
  return via('Evanston', 'Chicago', '↔', 'and');
}

function renderTop(lineChanged: boolean): void {
  $('[data-title]').innerHTML = titleHtml();
  document.querySelectorAll<HTMLButtonElement>('[data-line]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.line === state.line)));
  const box = $('[data-views]');
  if (lineChanged || !box.childElementCount) {
    box.innerHTML = [
      `<button type="button" class="chip glass" data-view="all" aria-pressed="false">Route overview</button>`,
      ...LINES[state.line].directions.map(
        (id) =>
          `<button type="button" class="chip glass" data-view="${id}" aria-pressed="false"><span class="dot" style="--c:${DIRECTIONS[id].color}" aria-hidden="true"></span>${esc(DIRECTIONS[id].label)}</button>`,
      ),
    ].join('');
  }
  let chosen: HTMLElement | null = null;
  for (const b of box.querySelectorAll<HTMLElement>('[data-view]')) {
    const pressed = b.dataset.view === state.view;
    b.setAttribute('aria-pressed', String(pressed));
    if (pressed) chosen = b;
  }
  // the chosen chip in sight when the row scrolls (phones)
  if (chosen) {
    const left = chosen.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
    if (left < box.scrollLeft) box.scrollLeft = left - 4;
    else if (left + chosen.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = left + chosen.offsetWidth - box.clientWidth + 4;
  }
}

function choose(line: LineId, view: View): void {
  if (line === state.line && view === state.view) return fitRoute(); // the chosen chip again: the whole route
  const lineChanged = line !== state.line;
  state.line = line;
  state.view = view;
  lastView[line] = view;
  map.closePopup();
  state.stop = null;
  state.bus = '';
  busLayer.clearLayers();
  buses.clear();
  const u = new URL(location.href);
  u.searchParams.set('d', viewParam(line, view));
  history.replaceState(null, '', u);
  renderTop(lineChanged);
  drawRoutes();
  computeRooms();
  drawPins();
  renderStops();
  renderSheet();
  renderLive();
  fitRoute();
}

// ---------- the sheet on phones: collapse and expand ----------

const grip = $<HTMLButtonElement>('[data-grip]');
function applyOpen(): void {
  const open = state.open || !phone();
  sheet.dataset.open = String(open);
  grip.setAttribute('aria-expanded', String(open));
  grip.setAttribute('aria-label', open ? 'Collapse the panel' : 'Expand the panel');
  if (open) sheetBody.removeAttribute('inert');
  else sheetBody.setAttribute('inert', '');
}
function setOpen(open: boolean): void {
  state.open = open;
  applyOpen();
}

const grab = $('[data-grab]');
let drag: { id: number; y: number; dy: number } | null = null;
let dragged = false;
grab.addEventListener('pointerdown', (e) => {
  if (!phone() || e.button !== 0 || (e.target as HTMLElement).closest('[data-copy]')) return;
  drag = { id: e.pointerId, y: e.clientY, dy: 0 };
  dragged = false;
});
grab.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.dy = e.clientY - drag.y;
  if (!dragged && Math.abs(drag.dy) > 8) {
    dragged = true;
    grab.setPointerCapture(e.pointerId);
    sheet.classList.add('drag');
  }
  // the open sheet follows the finger down; the collapsed one gives a little upwards
  if (dragged) sheet.style.transform = `translateY(${state.open ? Math.max(0, drag.dy) : Math.max(-40, Math.min(0, drag.dy / 2))}px)`;
});
const endDrag = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = drag.dy;
  drag = null;
  sheet.classList.remove('drag');
  sheet.style.transform = '';
  if (!dragged) return;
  if (dy > 40) setOpen(false);
  else if (dy < -30) setOpen(true);
};
grab.addEventListener('pointerup', endDrag);
grab.addEventListener('pointercancel', endDrag);
// a tap on the handle or the title toggles; the click that ends a drag doesn't
grab.addEventListener('click', (e) => {
  if (dragged) {
    dragged = false;
    return;
  }
  if (!phone() || (e.target as HTMLElement).closest('[data-copy]')) return;
  setOpen(!state.open);
});

// ---------- links and the copy button ----------

const readPlan = (): unknown => {
  try {
    return JSON.parse(sessionStorage.getItem('cs-plan') || 'null');
  } catch {
    return null;
  }
};
const savePlan = (p: object) => {
  try {
    sessionStorage.setItem('cs-plan', JSON.stringify(p));
  } catch {
    /* private mode: the homepage opens with its own campus */
  }
};

async function copyOfficial(from: HTMLElement): Promise<void> {
  const url = (state.line === 'loop' ? SOURCES.loop : SOURCES.intercampus).url;
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    stage.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    from.focus({ preventScroll: true });
  }
  say(ok ? `Link copied: Northwestern’s ${state.line === 'loop' ? 'Loop' : 'Intercampus'} route page` : `Couldn’t copy. The official page is ${url}`);
}

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const l = t.closest<HTMLElement>('[data-line]');
  if (l) {
    const line = l.dataset.line as LineId;
    if (line in LINES) choose(line, lastView[line]);
    return;
  }
  const v = t.closest<HTMLElement>('[data-view]');
  if (v) {
    const view = v.dataset.view as View;
    if (view === 'all' || LINES[state.line].directions.includes(view)) choose(state.line, view);
    return;
  }
  const a = t.closest<HTMLElement>('[data-area]');
  if (a) return chooseArea(Number(a.dataset.area));
  const tab = t.closest<HTMLElement>('[data-tab]');
  if (tab) return chooseTab(tab.dataset.tab === 'stops' ? 'stops' : 'listings');
  const s = t.closest<HTMLElement>('[data-stop]');
  if (s) {
    const [id, i] = ref(s.dataset.stop);
    return openStop(id, i, true);
  }
  const c = t.closest<HTMLElement>('[data-copy]');
  if (c) return void copyOfficial(c);
  // the homepage's results for the campus of these rooms (it scrolls to them with ?find=1), dates kept
  if (t.closest('[data-find]')) savePlan(homepagePlan(readPlan(), ctaCampus()));
  else if (t.closest('[data-request]')) savePlan(withSchool(readPlan(), ctaCampus()));
});

// the two tabs: arrow keys move between them
$('[role=tablist]').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const next: Tab = e.key === 'Home' ? 'listings' : e.key === 'End' ? 'stops' : state.tab === 'listings' ? 'stops' : 'listings';
  chooseTab(next, true);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (roomPop) {
    const code = state.room;
    closeRoom();
    pins.get(code)?.getElement()?.focus({ preventScroll: true });
  } else if (popup.isOpen()) map.closePopup(popup);
  else if (stage.classList.contains('full')) {
    cssFull(false);
    paintFull();
  }
});

// ---------- layout ----------

// Where the panels end, for the CSS: the zoom and map buttons sit under the chips on phones (--top-h), in a
// row when the map is short (.short), the sheet never grows over them (--ctl-b), and the map's attribution
// stays above the sheet (--attr-b).
function measure(): void {
  const s = stage.getBoundingClientRect();
  stage.classList.toggle('short', phone() && s.height < 700);
  stage.style.setProperty('--top-h', `${Math.round(topBox.getBoundingClientRect().bottom - s.top)}px`);
  const ctl = map.getContainer().querySelector('.leaflet-top.leaflet-right');
  if (ctl) stage.style.setProperty('--ctl-b', `${Math.round(ctl.getBoundingClientRect().bottom - s.top)}px`);
  stage.style.setProperty('--attr-b', phone() ? `${Math.max(0, Math.round(s.bottom - sheet.getBoundingClientRect().top + 4))}px` : '0px');
}
let wasPhone = phone();
new ResizeObserver(() => {
  if (phone() !== wasPhone) {
    wasPhone = phone();
    applyOpen();
  }
  measure();
  map.invalidateSize({ animate: false });
}).observe(stage);
const panels = new ResizeObserver(() => measure());
panels.observe(topBox);
panels.observe(sheet);

// ---------- the live listings ----------

let touched = false; // the visitor has dragged, zoomed or clicked the map
for (const ev of ['pointerdown', 'wheel', 'keydown'] as const) map.getContainer().addEventListener(ev, () => (touched = true), { passive: true });

const listingsTimer = window.setTimeout(() => {
  if (state.cards) return;
  state.cardsFailed = true;
  renderSheet();
}, LISTINGS_WAIT_MS);

// The live list (active, still running, complete: src/lib/listingView.ts liveList) as homepage cards; only
// those with a spot on the map can be along the route.
function onListings(list: ListingDoc[] | null): void {
  if (!list) {
    state.cardsFailed = true;
    return renderSheet();
  }
  clearTimeout(listingsTimer);
  state.cardsFailed = false;
  const cards: Card[] = [];
  for (const d of list) {
    try {
      const c = toCard(d);
      if (c.lat !== null && c.lng !== null) cards.push(c);
    } catch {
      /* one odd listing never breaks the page */
    }
  }
  const firstList = !state.cards;
  state.cards = cards;
  computeRooms();
  drawPins();
  renderSheet();
  // the area chips just made the sheet taller: fit the route again, unless the map has been moved
  if (firstList && !touched) requestAnimationFrame(() => fitRoute(false));
}
// Exactly one subscription: src/rentlet.ts subscribes RL_onListings if it runs after this module (the dev
// server, where the page's scripts run in order); in the build its code sits in a shared chunk this one
// imports, so it has run already and window.RentletListings is set: subscribe here.
window.RL_onListings = onListings;
if (window.RentletListings) window.RentletListings.subscribeActive(onListings, () => onListings(null));

// ---------- polling, only while the tab is visible ----------

let timer = 0;
let ticker = 0;
let inflight: AbortController | null = null;

async function poll(): Promise<void> {
  clearTimeout(timer);
  if (document.hidden) return;
  inflight?.abort();
  const ac = new AbortController();
  inflight = ac;
  try {
    const res = await fetch(LIVE_URL, { headers: { Accept: 'application/json' }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reading = parseLiveReading(await res.json());
    if (!reading) throw new Error('unreadable');
    state.reading = reading;
    state.failed = false;
  } catch {
    if (ac.signal.aborted) return;
    state.failed = true;
  } finally {
    if (inflight === ac) inflight = null;
  }
  renderLive();
  if (!document.hidden) timer = window.setTimeout(poll, REFRESH_MS);
}

function start(): void {
  clearInterval(ticker);
  ticker = window.setInterval(() => {
    renderStatus();
    renderEtas();
    refreshBusPopup();
  }, 1000);
  void poll();
}

function stop(): void {
  clearTimeout(timer);
  clearInterval(ticker);
  inflight?.abort();
  inflight = null;
}

document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

renderTop(true);
drawRoutes();
computeRooms();
renderStops();
renderSheet();
renderStatus();
// on a short phone the map comes first: the sheet starts collapsed
state.open = !(phone() && stage.clientHeight < 700);
applyOpen();
measure();
fitRoute(false);
requestAnimationFrame(() => {
  measure();
  map.invalidateSize({ animate: false });
  fitRoute(false);
});
if (!document.hidden) start();
