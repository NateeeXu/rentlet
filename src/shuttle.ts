// shuttle.html: Northwestern's Intercampus shuttle and evening Loop on the map, with live buses from the
// university's shuttle system (GET /api/shuttle -> functions/src/shuttle.ts). Polls every 10 s while the
// tab is visible. Routes, stops and hours always show; live parts say plainly when they are missing.
import { addMapButton, busMarker, createMap, drawRoute, drawStops, drawZone, fitTo, L, moveBus, quietPopup, reducedMotion } from './map';
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

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// "No buses to Chicago right now", "No buses on Loop A right now".
const WAY: Record<DirectionId, string> = { 'to-chicago': 'to Chicago', 'to-evanston': 'to Evanston', 'loop-a': 'on Loop A', 'loop-b': 'on Loop B' };
// A reading this old is no longer shown as live when a newer one can't be fetched.
const KEEP_READING_MS = 60_000;
const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const params = new URLSearchParams(location.search);
const asked = params.get('d');
const state = {
  dir: (asked && asked in DIRECTIONS ? asked : 'to-chicago') as DirectionId,
  reading: null as LiveReading | null,
  failed: false,
  rows: [] as StopRow[],
  current: -1, // the stop row shown in the popup
  bus: '', // or the bus shown in the popup
};
const line = (): LineId => DIRECTIONS[state.dir].line;
const lastDir: Record<LineId, DirectionId> = { intercampus: 'to-chicago', loop: 'loop-a' };
lastDir[line()] = state.dir;

// ---------- map ----------

const map = createMap($('#map'), { label: 'Shuttle map', minZoom: 10 });
for (const z of ZONES) if (z.kind === 'campus') drawZone(map, z.points, 'campus');
const routeLayer = L.layerGroup().addTo(map);
const busLayer = L.layerGroup().addTo(map);
const buses = new Map<string, L.Marker>();
const popup = quietPopup();
// Leaflet pans to fit a popup each time its place or content changes, and stops any pan under way to do
// so; here it pans only when a popup opens from a click on the map, never on the live refreshes.
function showPopup(at: L.LatLngExpression, html: string, pan: boolean): void {
  popup.options.autoPan = pan;
  popup.setLatLng(at);
  if (popup.getContent() !== html) popup.setContent(html);
  if (!popup.isOpen()) popup.openOn(map);
  popup.options.autoPan = false;
}
popup.on('remove', () => {
  state.current = -1;
  state.bus = '';
  markCurrent();
});

const mobile = () => matchMedia('(max-width: 900px)').matches;
const fitRoute = () => fitTo(map, routePath(state.dir), mobile() ? [20, 20] : [48, 48]);
addMapButton(map, 'Show the whole route', '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>', fitRoute);

function drawDirection(): void {
  routeLayer.clearLayers();
  const d = DIRECTIONS[state.dir];
  drawRoute(routeLayer, routePath(state.dir), d.color);
  drawStops(routeLayer, d.stops, d.color, (i) => {
    const id = d.stops[i].id;
    openStop(state.rows.findIndex((r) => r.ids.includes(id)), false);
  });
  map.getContainer().setAttribute('aria-label', `Map of the ${d.line === 'loop' ? d.label : `Intercampus shuttle ${WAY[state.dir]}`} route`);
}

// ---------- live ----------

const fresh = (): LiveReading | null =>
  state.reading && (!state.failed || Date.now() - state.reading.updatedAt < KEEP_READING_MS) ? state.reading : null;

function stopName(id: string, fallback: string): string {
  return DIRECTIONS[state.dir].stops.find((s) => s.id === id)?.name ?? fallback;
}

function busText(v: LiveVehicle): { title: string; next: string } {
  const d = DIRECTIONS[state.dir];
  const title = d.line === 'loop' ? `${d.label} bus` : `Bus ${WAY[state.dir]}`;
  if (!v.nextStop || !state.reading) return { title, next: '' };
  const left = Math.max(0, v.nextStop.seconds - elapsedSeconds(state.reading));
  const name = stopName(v.nextStop.id, v.nextStop.name);
  return { title, next: name ? `Next stop: ${name}, ${arrivalLabel(left).toLowerCase()}` : '' };
}

function busPopupHtml(v: LiveVehicle): string {
  const { title, next } = busText(v);
  return `<span class="pop-name">${esc(title)}</span>${next ? `<span class="pop-next">${esc(next)}</span>` : ''}`;
}

function drawBuses(): void {
  const reading = fresh();
  const list = busesOn(reading, state.dir);
  const color = DIRECTIONS[state.dir].color;
  const keep = new Set<string>();
  for (const v of list) {
    const key = `${v.line}:${v.id}`;
    keep.add(key);
    const { title, next } = busText(v);
    const label = next ? `${title}. ${next}` : title;
    const have = buses.get(key);
    if (have) moveBus(have, v, v.heading, label);
    else {
      const m = busMarker(v, { color, heading: v.heading, label });
      m.on('click', () => {
        state.bus = key;
        state.current = -1;
        markCurrent();
        const now = fresh() && busesOn(fresh(), state.dir).find((x) => `${x.line}:${x.id}` === key);
        if (now) showPopup(m.getLatLng(), busPopupHtml(now), true);
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
  const v = busesOn(fresh(), state.dir).find((x) => `${x.line}:${x.id}` === state.bus);
  const m = buses.get(state.bus);
  if (v && m) showPopup(m.getLatLng(), busPopupHtml(v), false);
}

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
    words = 'Live positions are unavailable';
    small = 'Routes and stops still show.';
  } else if (reading) {
    const here = busesOn(reading, state.dir).length;
    const onLine = LINES[line()].directions.reduce((n, d) => n + busesOn(reading, d).length, 0);
    tone = here ? 'live' : 'off';
    words = here ? busCountLabel(here) : onLine ? `No buses ${WAY[state.dir]} right now` : 'No buses running right now';
    small = updatedLabel(reading.updatedAt);
  }
  box.dataset.tone = tone;
  if (text.textContent !== words) text.textContent = words;
  upd.textContent = small;
}

function etaHtml(row: StopRow): string {
  const reading = fresh();
  if (!reading) return '';
  const next = arrivalsAt(reading, state.dir, row.ids);
  if (!next.length) return '';
  return `<b>${esc(arrivalLabel(next[0]))}</b>${next[1] !== undefined ? `<span>then ${esc(arrivalLabel(next[1]).toLowerCase())}</span>` : ''}`;
}

function stopPopupHtml(row: StopRow): string {
  const reading = fresh();
  const area = REGION_LABEL[row.region];
  let next = '';
  if (reading) {
    const times = arrivalsAt(reading, state.dir, row.ids);
    next = times.length
      ? `Next bus ${arrivalLabel(times[0]).toLowerCase()}${times[1] !== undefined ? `, then ${arrivalLabel(times[1]).toLowerCase()}` : ''}`
      : 'No live arrival right now';
  }
  const d = DIRECTIONS[state.dir];
  return `<span class="pop-name">${esc(row.name)}</span><span class="pop-line">${esc(d.line === 'loop' ? d.label : `Intercampus ${WAY[state.dir]}`)}${area ? ` · ${esc(area)}` : ''}</span>${next ? `<span class="pop-next">${esc(next)}</span>` : ''}`;
}

function renderEtas(): void {
  document.querySelectorAll<HTMLElement>('[data-eta]').forEach((el) => {
    const html = etaHtml(state.rows[Number(el.dataset.eta)]);
    if (el.innerHTML !== html) el.innerHTML = html;
  });
  const row = state.rows[state.current];
  if (row && popup.isOpen()) showPopup(row.stops[0], stopPopupHtml(row), false);
}

function renderLive(): void {
  renderStatus();
  drawBuses();
  renderEtas();
}

// ---------- panel ----------

function markCurrent(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-row]').forEach((b) => {
    if (Number(b.dataset.row) === state.current) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
}

function openStop(i: number, fromList: boolean): void {
  const row = state.rows[i];
  if (!row) return;
  state.current = i;
  state.bus = '';
  markCurrent();
  const at = row.stops[0];
  if (fromList) {
    map.setView(at, Math.max(map.getZoom(), 15), { animate: !reducedMotion() });
    // on phones the map sits above the list: bring it into view
    const box = $('.mapbox').getBoundingClientRect();
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr')) || 64;
    if (mobile() && (box.top < top || box.bottom > innerHeight)) scrollBy({ top: box.top - top, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
  showPopup(at, stopPopupHtml(row), !fromList);
}

function renderPanel(): void {
  const d = DIRECTIONS[state.dir];
  $('#app').style.setProperty('--c', d.color);
  document.querySelectorAll<HTMLButtonElement>('[data-line]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.line === line())));
  $('[data-dirs]').innerHTML = LINES[line()].directions
    .map((id) => {
      const x = DIRECTIONS[id];
      return `<button type="button" class="dir" data-dir="${id}" aria-pressed="${id === state.dir}"><span class="dot" style="--c:${x.color}" aria-hidden="true"></span>${esc(x.label)}</button>`;
    })
    .join('');
  $('[data-route]').textContent = d.route;
  $('[data-hours]').textContent = d.hours;
  const src = line() === 'loop' ? SOURCES.loop : SOURCES.intercampus;
  $('[data-checked]').textContent = `Routes and hours: ${src.label}, checked ${longDate(src.checkedAt)}. Times are Chicago time${line() === 'intercampus' ? ', and a Wildcard is needed to ride' : ''}.`;
  $<HTMLAnchorElement>('[data-official]').href = src.url;

  state.rows = stopRows(state.dir);
  const list = $('[data-stops]');
  list.classList.toggle('loop', d.line === 'loop');
  list.innerHTML = state.rows
    .map((r, i) => {
      const area = REGION_LABEL[r.region];
      return `<li class="stop"><button type="button" data-row="${i}"><span class="rail" aria-hidden="true"><i></i></span><span><span class="stop-name">${esc(r.name)}</span>${area ? `<span class="stop-area">${esc(area)}</span>` : ''}</span><span class="eta" data-eta="${i}"></span></button></li>`;
    })
    .join('');
}

function choose(dir: DirectionId): void {
  if (dir === state.dir && state.rows.length) return;
  state.dir = dir;
  lastDir[line()] = dir;
  state.current = -1;
  state.bus = '';
  map.closePopup(popup);
  busLayer.clearLayers();
  buses.clear();
  const u = new URL(location.href);
  u.searchParams.set('d', dir);
  history.replaceState(null, '', u);
  renderPanel();
  drawDirection();
  fitRoute();
  renderLive();
}

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const l = t.closest<HTMLElement>('[data-line]');
  if (l) return choose(lastDir[l.dataset.line as LineId]);
  const d = t.closest<HTMLElement>('[data-dir]');
  if (d) return choose(d.dataset.dir as DirectionId);
  const r = t.closest<HTMLElement>('[data-row]');
  if (r) openStop(Number(r.dataset.row), true);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && popup.isOpen()) map.closePopup(popup);
});

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

renderPanel();
drawDirection();
fitRoute();
renderStatus();
if (!document.hidden) start();
