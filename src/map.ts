// Rentlet's map: Leaflet on HERE's quiet "lite" base map, served through the site's own tile proxy
// (/tiles/{z}/{x}/{y} -> Cloud Function mapTile, functions/src/tiles.ts), so the HERE key never reaches
// the browser. The tiles are HERE's high-resolution 512 px images of the standard 256 px grid, drawn at
// 256 CSS px: sharp on retina screens. On localhost the proxy doesn't exist, so the page falls back to
// OpenStreetMap tiles there (and only there) to stay checkable. Helpers draw routes, stops, buses,
// campus outlines, an approximate area and an exact pin in the site's quiet style.
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface LatLng {
  lat: number;
  lng: number;
}

type Target = L.Map | L.LayerGroup;

export const INK = '#222222';
export const BRAND = '#4E2A84';

// The area the tile proxy serves (functions/src/tiles.ts SERVICE_AREA): Chicago, Evanston and around.
const SERVICE_BOUNDS = L.latLngBounds([41.4, -88.4], [42.5, -87.2]);
const EVANSTON: LatLng = { lat: 42.0565, lng: -87.6753 };

export const isLocalDev = (hostname = location.hostname) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname);

// HERE's required notice: "© <current year> HERE" (around Chicago no regional supplier is added).
export const hereAttribution = (year = new Date().getFullYear()) => `© ${year} HERE`;

function baseLayer(): L.TileLayer {
  if (isLocalDev()) {
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
  }
  return L.tileLayer('/tiles/{z}/{x}/{y}', {
    tileSize: 256,
    zoomOffset: 0,
    maxZoom: 19,
    maxNativeZoom: 19,
    bounds: SERVICE_BOUNDS,
    attribution: hereAttribution(),
  });
}

const CSS = `
.leaflet-container{font-family:inherit;background:#f2f2f2}
.leaflet-container .leaflet-control-attribution{background:rgba(255,255,255,.88);color:#484848;font-size:11px;line-height:1.5;padding:2px 8px;border-top-left-radius:8px}
.leaflet-container .leaflet-control-attribution a{color:#222}
.leaflet-touch .leaflet-bar,.leaflet-bar{border:1px solid #dddddd;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden;background-clip:padding-box}
.leaflet-touch .leaflet-bar a,.leaflet-bar a{width:44px;height:44px;line-height:44px;font:400 20px/44px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#222;border-bottom-color:#ebebeb}
.leaflet-bar a:hover{background:#f7f7f7;color:#222}
.leaflet-bar a.leaflet-disabled{color:#b0b0b0;background:#fff}
.rl-map-btn{display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin:0;padding:0;border:1px solid #dddddd;border-radius:12px;background:#fff;color:#222;box-shadow:0 1px 3px rgba(0,0,0,.08);cursor:pointer}
.rl-map-btn:hover{background:#f7f7f7}
.rl-map-btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.rl-pop .leaflet-popup-content-wrapper{border-radius:12px;border:1px solid #ebebeb;box-shadow:0 6px 20px rgba(0,0,0,.12)}
.rl-pop .leaflet-popup-content{margin:10px 14px;font-size:14px;line-height:1.45;color:#222;min-width:150px}
.rl-pop .leaflet-popup-tip{box-shadow:none;border:1px solid #ebebeb}
.leaflet-tooltip.rl-tip{padding:3px 8px;border:1px solid #dddddd;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.08);color:#222;font-size:13px;line-height:1.4}
.rl-bus,.rl-pin{background:none;border:0}
.rl-bus .rl-bus-turn{position:absolute;inset:0;transition:transform .8s ease}
.rl-bus .rl-bus-turn::before{content:"";position:absolute;left:50%;top:3px;margin-left:-5px;border:5px solid transparent;border-top:0;border-bottom:7px solid var(--c)}
.rl-bus .rl-bus-dot{position:absolute;left:10px;top:10px;width:24px;height:24px;border-radius:50%;background:var(--c);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.28);display:grid;place-items:center}
.rl-bus .rl-bus-dot svg{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.rl-pin .rl-pin-dot{position:absolute;left:13px;top:13px;width:18px;height:18px;border-radius:50%;background:#222;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.3)}
@media (prefers-reduced-motion:reduce){.rl-bus .rl-bus-turn{transition:none}}
`;

function addCss(): void {
  if (document.getElementById('rl-map-css')) return;
  const style = document.createElement('style');
  style.id = 'rl-map-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface MapOptions {
  center?: LatLng;
  zoom?: number;
  minZoom?: number;
  label?: string; // what the map shows, for screen readers
  scrollWheelZoom?: boolean;
}

export function createMap(el: HTMLElement, opts: MapOptions = {}): L.Map {
  addCss();
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: false,
    minZoom: opts.minZoom ?? 10,
    maxZoom: 19,
    maxBounds: SERVICE_BOUNDS.pad(0.05),
    maxBoundsViscosity: 0.8,
    zoomSnap: 0.25,
    scrollWheelZoom: opts.scrollWheelZoom ?? true,
    zoomAnimation: !reducedMotion(),
    fadeAnimation: !reducedMotion(),
    markerZoomAnimation: !reducedMotion(),
  });
  L.control.zoom({ position: 'topright', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(map);
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
  baseLayer().addTo(map);
  map.setView(opts.center ?? EVANSTON, opts.zoom ?? 14);
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', opts.label ?? 'Map');
  return map;
}

// A 44 px map button (for example "Show the whole route") under the zoom buttons.
export function addMapButton(map: L.Map, label: string, svg: string, onClick: () => void, position: L.ControlPosition = 'topright'): HTMLButtonElement {
  const control = new L.Control({ position });
  const button = document.createElement('button');
  control.onAdd = () => {
    button.type = 'button';
    button.className = 'rl-map-btn';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
    L.DomEvent.disableClickPropagation(button);
    button.addEventListener('click', onClick);
    return button;
  };
  control.addTo(map);
  return button;
}

// A line on its road shape: the line color over a thin white casing so it reads on any street.
export function drawRoute(target: Target, points: LatLng[], color: string, opts: { weight?: number; opacity?: number } = {}): L.FeatureGroup {
  const weight = opts.weight ?? 4;
  const line = { lineCap: 'round', lineJoin: 'round', interactive: false } as const;
  return L.featureGroup([
    L.polyline(points, { ...line, color: '#ffffff', weight: weight + 3, opacity: 0.9 }),
    L.polyline(points, { ...line, color, weight, opacity: opts.opacity ?? 0.9 }),
  ]).addTo(target);
}

// Small round stops, white with the line's color; a name on hover, onSelect(index) on click.
export function drawStops(target: Target, stops: (LatLng & { name: string })[], color: string, onSelect?: (index: number) => void): L.FeatureGroup {
  const group = L.featureGroup();
  stops.forEach((s, i) => {
    const m = L.circleMarker(s, { radius: 4.5, color, weight: 2, fillColor: '#ffffff', fillOpacity: 1, bubblingMouseEvents: false });
    m.bindTooltip(s.name, { direction: 'top', offset: [0, -6], className: 'rl-tip' });
    if (onSelect) m.on('click', () => onSelect(i));
    group.addLayer(m);
  });
  return group.addTo(target);
}

const BUS_SVG = '<path d="M7 18.5V20M17 18.5V20"/><rect x="5" y="4" width="14" height="14.5" rx="2.5"/><path d="M5 11h14M8.5 15h.01M15.5 15h.01"/>';

function busHtml(color: string, heading: number | null): string {
  const turn = heading === null ? '' : `<span class="rl-bus-turn" style="transform:rotate(${Math.round(heading)}deg)"></span>`;
  return `<span style="--c:${color}">${turn}<span class="rl-bus-dot"><svg viewBox="0 0 24 24" aria-hidden="true">${BUS_SVG}</svg></span></span>`;
}

// A live bus: a small dot in the line color with a bus glyph and a pointer for its heading. The
// marker is a 44 px target around the 24 px dot.
export function busMarker(p: LatLng, opts: { color: string; heading: number | null; label: string }): L.Marker {
  const marker = L.marker(p, {
    icon: L.divIcon({ className: 'rl-bus', html: busHtml(opts.color, opts.heading), iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -14] }),
    keyboard: true,
    riseOnHover: true,
    zIndexOffset: 1000,
  });
  marker.on('add', () => marker.getElement()?.setAttribute('aria-label', opts.label));
  return marker;
}

// Moves a bus to its new place over a second (at once with reduced motion) and turns its pointer.
export function moveBus(marker: L.Marker, p: LatLng, heading: number | null, label: string): void {
  const el = marker.getElement();
  el?.setAttribute('aria-label', label);
  const turn = el?.querySelector<HTMLElement>('.rl-bus-turn');
  if (turn && heading !== null) turn.style.transform = `rotate(${Math.round(heading)}deg)`;
  const from = marker.getLatLng();
  const anim = marker as L.Marker & { _rlAnim?: number };
  if (anim._rlAnim) cancelAnimationFrame(anim._rlAnim);
  if (reducedMotion() || !el || from.distanceTo(p) > 2000) {
    marker.setLatLng(p);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 1000);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    marker.setLatLng([from.lat + (p.lat - from.lat) * e, from.lng + (p.lng - from.lng) * e]);
    anim._rlAnim = t < 1 ? requestAnimationFrame(step) : 0;
  };
  anim._rlAnim = requestAnimationFrame(step);
}

// A campus outline in Rentlet purple, or a neighborhood in a quiet gray dash.
export function drawZone(target: Target, points: LatLng[], kind: 'campus' | 'area' = 'campus'): L.Polygon {
  const style: L.PathOptions =
    kind === 'campus'
      ? { color: BRAND, weight: 1, opacity: 0.45, fillColor: BRAND, fillOpacity: 0.06 }
      : { color: INK, weight: 1, opacity: 0.3, dashArray: '4 4', fillColor: INK, fillOpacity: 0.02 };
  return L.polygon(points, { ...style, interactive: false }).addTo(target);
}

// Roughly where a place is, when the exact address stays private.
export function drawArea(target: Target, center: LatLng, radiusMeters: number): L.Circle {
  return L.circle(center, { radius: radiusMeters, color: INK, weight: 1, opacity: 0.45, fillColor: INK, fillOpacity: 0.08, interactive: false }).addTo(target);
}

// Exactly where a place is: a black dot ringed in white.
export function drawPin(target: Target, p: LatLng, label?: string): L.Marker {
  const marker = L.marker(p, {
    icon: L.divIcon({ className: 'rl-pin', html: '<span class="rl-pin-dot"></span>', iconSize: [44, 44], iconAnchor: [22, 22] }),
    interactive: !!label,
    keyboard: !!label,
  });
  if (label) {
    marker.bindTooltip(label, { direction: 'top', offset: [0, -12], className: 'rl-tip' });
    marker.on('add', () => marker.getElement()?.setAttribute('aria-label', label));
  }
  return marker.addTo(target);
}

// A quiet popup (no close button: a click elsewhere or Escape closes it).
export function quietPopup(): L.Popup {
  return L.popup({ closeButton: false, autoPanPadding: [16, 16], className: 'rl-pop', maxWidth: 260 });
}

export function fitTo(map: L.Map, points: LatLng[], padding: [number, number] = [32, 32]): void {
  if (!points.length) return;
  map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as L.LatLngTuple)), { padding, animate: !reducedMotion() });
}

export { L };
