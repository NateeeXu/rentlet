// The small map above the post form's Street address (like the mini program's): the picked place as a
// black pin, still, so the page scrolls over it. In adjust mode the host drags the pin, taps the spot
// or moves it with the arrow keys to the exact entrance; it stays within PIN_RANGE_M of the address
// point and inside the service area (src/lib/place.ts clampPin). Loaded by src/place.ts on first use,
// so pages without a picked place never download Leaflet.
import { clampPin, inServiceArea, metersBetween, PIN_RANGE_M, type LatLng } from './lib/place';
import { createMap, INK, L, reducedMotion } from './map';

export interface PlaceMap {
  show(at: LatLng, origin: LatLng): void; // the pin at `at`; a move is kept near `origin`
  adjust(on: boolean): void; // dragging, tapping and the arrow keys move the pin while on
  point(): LatLng; // where the pin is now
  destroy(): void;
}

const VIEW_ZOOM = 16;
const ADJUST_ZOOM = 17;
const STEP_PX = 8; // an arrow key; with Shift five times as far

// A teardrop with a white eye, its tip on the spot, in a 44 px target.
const TEAR =
  '<svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true"><path d="M14 1C6.8 1 1 6.7 1 13.8 1 23 14 35 14 35s13-12 13-21.2C27 6.7 21.2 1 14 1z" fill="#222" stroke="#fff" stroke-width="2"/><circle cx="14" cy="13.6" r="4.6" fill="#fff"/></svg>';

const CSS = `
.rl-tear{background:none;border:0;outline:0}
.rl-tear svg{position:absolute;left:8px;top:10px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.3));transition:transform .15s}
.rl-tear.leaflet-drag-target svg{transform:scale(1.08)}
.rl-tear:focus-visible{border-radius:12px;box-shadow:0 0 0 2px #fff,0 0 0 4px ${INK}}
.rl-pm-off .rl-tear{cursor:default;pointer-events:none}
@media (prefers-reduced-motion:reduce){.rl-tear svg{transition:none}}
`;

function addCss(): void {
  if (document.getElementById('rl-placemap-css')) return;
  const style = document.createElement('style');
  style.id = 'rl-placemap-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const same = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;

export function mountPlaceMap(el: HTMLElement, at: LatLng, origin: LatLng): PlaceMap {
  addCss();
  const map = createMap(el, { center: at, zoom: VIEW_ZOOM, minZoom: 12, label: 'Map of the listing’s spot', scrollWheelZoom: false });
  const moving = [map.dragging, map.touchZoom, map.scrollWheelZoom];
  for (const h of [...moving, map.doubleClickZoom, map.boxZoom, map.keyboard]) h.disable();
  el.tabIndex = -1; // the pin takes the keyboard in adjust mode
  el.classList.add('rl-pm-off');

  let home = origin;
  let on = false;
  const pin = L.marker(at, {
    icon: L.divIcon({ className: 'rl-tear', html: TEAR, iconSize: [44, 48], iconAnchor: [22, 46] }),
    interactive: true,
    keyboard: false,
    autoPan: true,
    autoPanPadding: L.point(48, 48),
    bubblingMouseEvents: false,
    zIndexOffset: 500,
  }).addTo(map);
  // how far a pin may go, shown while adjusting; the address point once the pin has left it
  const ring = L.circle(home, { radius: PIN_RANGE_M, color: INK, weight: 1, opacity: 0.5, dashArray: '4 5', fill: false, interactive: false });
  const dot = L.circleMarker(home, { radius: 5, color: '#717171', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false });

  const icon = () => pin.getElement();
  const setPin = (p: LatLng) => pin.setLatLng(clampPin(home, p));
  const marks = () => {
    if (!on) return;
    ring.setLatLng(home).addTo(map);
    if (metersBetween(home, pin.getLatLng()) >= 1) dot.setLatLng(home).addTo(map);
    else dot.remove();
  };
  const view = (zoom: number) => map.setView(pin.getLatLng(), zoom, { animate: !reducedMotion() });

  // a drag past the limit stays on its edge
  pin.on('drag', () => {
    const p = pin.getLatLng();
    if (metersBetween(home, p) > PIN_RANGE_M || !inServiceArea(p)) pin.setLatLng(clampPin(home, p));
  });
  pin.on('dragend', () => {
    setPin(pin.getLatLng());
    marks();
  });
  map.on('click', (e: L.LeafletMouseEvent) => {
    if (!on) return;
    setPin(e.latlng);
    marks();
  });
  const onKey = (e: KeyboardEvent) => {
    if (!on) return;
    const d = STEP_PX * (e.shiftKey ? 5 : 1);
    const move = { ArrowUp: [0, -d], ArrowDown: [0, d], ArrowLeft: [-d, 0], ArrowRight: [d, 0] }[e.key];
    if (!move) return;
    e.preventDefault();
    const p = map.latLngToContainerPoint(pin.getLatLng()).add(L.point(move[0], move[1]));
    setPin(map.containerPointToLatLng(p));
    map.panInside(pin.getLatLng(), { padding: L.point(48, 48), animate: false });
    marks();
  };

  function adjust(next: boolean): void {
    if (next === on) return;
    on = next;
    for (const h of moving) {
      if (on) h.enable();
      else h.disable();
    }
    if (on) pin.dragging?.enable();
    else pin.dragging?.disable();
    el.classList.toggle('rl-pm-on', on);
    el.classList.toggle('rl-pm-off', !on);
    const i = icon();
    if (i) {
      if (on) {
        i.tabIndex = 0;
        i.setAttribute('role', 'button');
        i.setAttribute('aria-roledescription', 'movable pin');
        i.setAttribute('aria-label', 'The listing’s pin. Arrow keys move it; Shift moves it further.');
        i.removeAttribute('aria-hidden');
        i.addEventListener('keydown', onKey);
      } else {
        i.tabIndex = -1;
        i.setAttribute('aria-hidden', 'true');
        i.removeEventListener('keydown', onKey);
      }
    }
    if (on) {
      marks();
      view(ADJUST_ZOOM);
      i?.focus({ preventScroll: true });
    } else {
      ring.remove();
      dot.remove();
      view(VIEW_ZOOM);
    }
  }

  icon()?.setAttribute('aria-hidden', 'true');
  if (icon()) icon()!.tabIndex = -1;
  requestAnimationFrame(() => map.invalidateSize());

  return {
    show(p, o) {
      if (on) adjust(false);
      const moved = !same(p, pin.getLatLng()) || !same(o, home);
      home = { lat: o.lat, lng: o.lng };
      pin.setLatLng(p);
      map.invalidateSize();
      if (moved || map.getZoom() !== VIEW_ZOOM) map.setView(p, VIEW_ZOOM, { animate: false });
    },
    adjust,
    point() {
      const p = clampPin(home, pin.getLatLng());
      return { lat: p.lat, lng: p.lng };
    },
    destroy() {
      icon()?.removeEventListener('keydown', onKey);
      map.remove();
    },
  };
}
