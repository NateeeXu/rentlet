// Homepage "Rooms near <campus>": the map beside the list. Every pinned listing is a price pill at its spot;
// hovering or focusing a card in the list darkens its pill (highlight), hovering a pill outlines its card
// (onHover), and a pill opens a small card that links to the room. On phones the same map opens full
// screen from the list's Show map button (open/close), with the small card at the bottom.
// index.html renders the list and calls window.RentletHomeMap; this module owns the map.
import { createMap, L, reducedMotion } from './map';

// One room on the map. title, img and dates arrive escaped for HTML (src/lib/listingView.ts toCard and the
// page's own date labels), the same strings the list's cards print.
export interface HomeRoom {
  code: string;
  lat: number;
  lng: number;
  price: number;
  title: string;
  img: string;
  dates: string;
}

export interface DrawOptions {
  label?: string; // what the map shows, for screen readers
  onHover?: (code: string | null) => void; // a pill is hovered or focused (null when it is left)
}

declare global {
  interface Window {
    RentletHomeMap: typeof api;
    RL_homeMap?: () => void;
  }
}

const CSS = `
.hm-pin{background:none;border:0;outline:none}
.hm-pin .hm-pill{position:absolute;left:0;top:0;transform:translate(-50%,calc(-50% + var(--dy,0px)));display:flex;align-items:center;height:28px;padding:0 10px;border-radius:999px;background:#fff;color:#222;font-size:13px;font-weight:700;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 2px 6px rgba(0,0,0,.18);cursor:pointer;transition:transform .15s ease,background-color .15s,color .15s,box-shadow .15s}
.hm-pin .hm-pill::before{content:"";position:absolute;inset:-8px -4px}
/* frosted glass: the --gl values are in index.html */
@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  .hm-pin:not(.on) .hm-pill,.hm-x,.hm-map.leaflet-container .leaflet-bar{color:var(--gl-ink);background:var(--gl-bg);-webkit-backdrop-filter:var(--gl-fx);backdrop-filter:var(--gl-fx);border:var(--gl-bd);box-shadow:var(--gl-sh)}
  .hm-map.leaflet-container .leaflet-bar a{background:transparent;color:var(--gl-ink);border-bottom-color:rgba(255,255,255,.5)}
  .hm-map.leaflet-container .leaflet-bar a:hover{background:rgba(255,255,255,.4);color:var(--gl-ink)}
  .hm-map.leaflet-container .leaflet-bar a.leaflet-disabled{background:transparent;color:rgba(23,21,31,.38)}
}
@media (prefers-reduced-transparency:reduce){.hm-pin:not(.on) .hm-pill,.hm-x,.hm-map.leaflet-container .leaflet-bar{background:#fff;-webkit-backdrop-filter:none;backdrop-filter:none}}
.hm-pin:hover .hm-pill{transform:translate(-50%,calc(-50% + var(--dy,0px))) scale(1.06);box-shadow:0 0 0 1px rgba(0,0,0,.14),0 4px 10px rgba(0,0,0,.22)}
.hm-pin.on .hm-pill{background:#222;color:#fff;transform:translate(-50%,calc(-50% + var(--dy,0px))) scale(1.08);box-shadow:0 0 0 1px #222,0 4px 12px rgba(0,0,0,.28)}
.hm-pin:focus-visible{outline:none}
.hm-pin:focus-visible .hm-pill{outline:2px solid #222;outline-offset:2px}
.rl-pop.hm-pop .leaflet-popup-content-wrapper{padding:0;overflow:hidden;border-radius:14px}
.rl-pop.hm-pop .leaflet-popup-content{margin:0;min-width:0}
.hm-card,.leaflet-container a.hm-card{display:block;color:#222;text-decoration:none;font-size:14px;line-height:1.4}
.hm-card .hm-ph{display:block;aspect-ratio:3/2;background:#f2f2f4;overflow:hidden}
.hm-card img{width:100%;height:100%;object-fit:cover;display:block}
.hm-card .hm-bd{display:grid;gap:1px;padding:10px 14px 12px;min-width:0}
.hm-card .hm-t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hm-card .hm-p b{font-weight:600}
.hm-card .hm-p small{font-size:13px;color:#717171}
.hm-card .hm-d{color:#717171;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hm-card:hover .hm-t{text-decoration:underline;text-underline-offset:3px}
.hm-card:focus-visible{outline:2px solid #222;outline-offset:-2px}
.hm-lock,.hm-lock body{overflow:hidden}
.hm-full{position:fixed;inset:0;z-index:400;background:#f2f2f2}
.hm-full .hm-map{position:absolute!important;inset:0;width:auto;height:auto;border:0;border-radius:0} /* Leaflet set position:relative on the element when it was made */
.hm-full .leaflet-top{top:env(safe-area-inset-top,0px)}
.hm-full .leaflet-right{right:env(safe-area-inset-right,0px)}
.hm-full .leaflet-bottom{bottom:env(safe-area-inset-bottom,0px)}
.hm-x{position:absolute;z-index:1000;top:calc(10px + env(safe-area-inset-top,0px));left:calc(10px + env(safe-area-inset-left,0px));display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin:0;padding:0;border:1px solid #ddd;border-radius:50%;background:#fff;color:#222;box-shadow:0 2px 8px rgba(0,0,0,.14);cursor:pointer}
.hm-x svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.hm-sheet{position:absolute;z-index:1000;left:calc(12px + env(safe-area-inset-left,0px));right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(30px + env(safe-area-inset-bottom,0px));max-width:480px;margin:0 auto;border-radius:16px;background:#fff;box-shadow:0 8px 28px rgba(0,0,0,.22);overflow:hidden;animation:hmup .24s cubic-bezier(.22,1,.36,1) both}
.hm-sheet[hidden]{display:none}
.hm-sheet .hm-card{display:grid;grid-template-columns:116px minmax(0,1fr);align-items:center}
.hm-sheet .hm-ph{position:relative;align-self:stretch;aspect-ratio:auto;min-height:104px}
.hm-sheet .hm-ph img{position:absolute;inset:0}
.hm-sheet .hm-bd{padding:12px 14px}
@keyframes hmup{from{opacity:0;transform:translateY(12px)}}
@media (prefers-reduced-motion:reduce){.hm-pin .hm-pill{transition:none}.hm-sheet{animation:none}}
`;

function addCss(): void {
  if (document.getElementById('hm-css')) return;
  const style = document.createElement('style');
  style.id = 'hm-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
// the escaped strings as plain text, for attributes set from script (setAttribute never parses markup)
const plain = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e] as string);
const href = (code: string) => `room.html?room=${encodeURIComponent(plain(code))}`;
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const cardHtml = (r: HomeRoom) =>
  `<a class="hm-card" href="${href(r.code)}"><span class="hm-ph"><img src="${r.img}" alt=""></span><span class="hm-bd"><span class="hm-t">${r.title}</span><span class="hm-p"><b>${money(r.price)}</b><small> / mo</small></span><span class="hm-d">${r.dates}</span></span></a>`;

let map: L.Map | null = null;
let mapEl: HTMLElement | null = null;
let layer: L.LayerGroup | null = null;
let resize: ResizeObserver | null = null;
let opts: DrawOptions = {};
let rooms: HomeRoom[] = [];
const pins = new Map<string, L.Marker>();
const shift = new Map<string, number>(); // px a pill is moved down so rooms at one spot don't hide each other
let hot: string | null = null; // the card hovered or focused in the list
let sel: string | null = null; // the pill whose small card is open
let popup: L.Popup | null = null;
let lastSize = 0;

// the phone's full-screen map
let full: HTMLElement | null = null;
let home: HTMLElement | null = null; // where the map lives on the page while it isn't full screen
let opener: HTMLElement | null = null;

const sized = () => !!mapEl && mapEl.clientWidth > 0 && mapEl.clientHeight > 0;

// Every pin in view with some room around it; a single pin is shown up close.
function fit(): void {
  if (!map || !sized()) return;
  map.invalidateSize({ animate: false });
  if (rooms.length === 1) map.setView([rooms[0].lat, rooms[0].lng], 15, { animate: false });
  else if (rooms.length) {
    const bounds = L.latLngBounds(rooms.map((r) => [r.lat, r.lng] as L.LatLngTuple));
    map.fitBounds(bounds, { padding: full ? [56, 56] : [48, 48], maxZoom: 16, animate: false });
  }
}

function restyle(): void {
  pins.forEach((m, code) => {
    const on = code === hot || code === sel;
    m.getElement()?.classList.toggle('on', on);
    m.setZIndexOffset(on ? 1000 : 0);
  });
}

function closeCard(refocus = false): void {
  const was = sel;
  sel = null;
  if (popup) {
    const p = popup;
    popup = null;
    map?.closePopup(p);
  }
  const sheet = full?.querySelector<HTMLElement>('.hm-sheet');
  if (sheet) {
    sheet.hidden = true;
    sheet.innerHTML = '';
  }
  restyle();
  if (refocus && was) pins.get(was)?.getElement()?.focus({ preventScroll: true });
}

// A pill's small card: above the pill on the page's map, at the bottom of the full-screen map.
function select(code: string, byKeyboard: boolean): void {
  const r = rooms.find((x) => x.code === code);
  if (!map || !r) return;
  if (sel === code && !full) return;
  closeCard();
  sel = code;
  restyle();
  if (full) {
    const sheet = full.querySelector<HTMLElement>('.hm-sheet')!;
    sheet.innerHTML = cardHtml(r);
    sheet.hidden = false;
    // keep the pill clear of the card
    map.panInside([r.lat, r.lng], { paddingTopLeft: [24, 72], paddingBottomRight: [24, sheet.offsetHeight + 56], animate: !reducedMotion() });
    if (byKeyboard) sheet.querySelector<HTMLElement>('a')?.focus();
    return;
  }
  const p = L.popup({ closeButton: false, className: 'rl-pop hm-pop', minWidth: 248, maxWidth: 248, offset: [0, (shift.get(code) ?? 0) - 12], autoPanPadding: [24, 24] })
    .setLatLng([r.lat, r.lng])
    .setContent(cardHtml(r));
  p.on('remove', () => {
    if (popup === p) popup = null;
    if (sel === code) {
      sel = null;
      restyle();
    }
  });
  popup = p;
  p.openOn(map);
  if (byKeyboard) p.getElement()?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
}

function pin(r: HomeRoom): L.Marker {
  const m = L.marker([r.lat, r.lng], {
    icon: L.divIcon({ className: 'hm-pin', html: `<span class="hm-pill" style="--dy:${shift.get(r.code) ?? 0}px">${money(r.price)}</span>`, iconSize: [0, 0], iconAnchor: [0, 0] }),
    keyboard: true,
    riseOnHover: true,
    autoPanOnFocus: false,
  });
  m.on('add', () => {
    const el = m.getElement();
    if (!el) return;
    el.setAttribute('aria-label', `${money(r.price)} a month, ${plain(r.title)}`);
    el.classList.toggle('on', r.code === hot || r.code === sel);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        select(r.code, true);
      }
    });
    el.addEventListener('focus', () => opts.onHover?.(r.code));
    el.addEventListener('blur', () => opts.onHover?.(null));
  });
  m.on('mouseover', () => opts.onHover?.(r.code));
  m.on('mouseout', () => opts.onHover?.(null));
  m.on('click', () => select(r.code, false));
  return m;
}

// Draws (or redraws) the pins of `list` on the map in `el`. A new element (the page re-rendered the list)
// gets a new map.
function draw(el: HTMLElement | null, list: HomeRoom[], o: DrawOptions = {}): void {
  if (!el) return;
  opts = o;
  rooms = list.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  if (map && mapEl !== el) {
    if (full) close(false);
    resize?.disconnect();
    map.remove();
    map = null;
    popup = null;
  }
  if (!map) {
    addCss();
    el.classList.add('hm-map');
    map = createMap(el, { zoom: 13, label: o.label ?? 'Map of rooms', scrollWheelZoom: true });
    mapEl = el;
    layer = L.layerGroup().addTo(map);
    map.on('click', () => closeCard());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sel && !full) {
        e.stopPropagation();
        closeCard(true);
      }
    });
    lastSize = 0;
    resize = new ResizeObserver(() => {
      const size = el.clientWidth * el.clientHeight;
      if (size && !lastSize) fit(); // shown again (wider window, or the full-screen map): every pin in view
      else if (size) map?.invalidateSize({ animate: false });
      lastSize = size;
    });
    resize.observe(el);
  } else if (o.label) el.setAttribute('aria-label', o.label);
  closeCard();
  layer!.clearLayers();
  pins.clear();
  hot = null;
  // rooms in one building (within about 20 m) stack their pills in a column centred on the spot
  shift.clear();
  const groups: HomeRoom[][] = [];
  for (const r of rooms) {
    const g = groups.find(([a]) => Math.abs(a.lat - r.lat) < 0.0002 && Math.abs(a.lng - r.lng) < 0.0003);
    if (g) g.push(r);
    else groups.push([r]);
  }
  for (const g of groups) g.forEach((r, k) => shift.set(r.code, Math.round((k - (g.length - 1) / 2) * 34)));
  for (const r of rooms) pins.set(r.code, pin(r).addTo(layer!));
  fit();
}

// The list's card under the pointer or focus darkens its pill (null: none).
function highlight(code: string | null): void {
  if (hot === code) return;
  hot = code;
  restyle();
}

function trap(e: KeyboardEvent): void {
  if (!full) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (sel) closeCard(true);
    else close();
    return;
  }
  if (e.key !== 'Tab') return;
  const all = [...full.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')].filter((x) => !x.closest('[hidden]'));
  if (!all.length) return;
  const first = all[0];
  const last = all[all.length - 1];
  if (e.shiftKey && (document.activeElement === first || !full.contains(document.activeElement))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !full.contains(document.activeElement))) {
    e.preventDefault();
    first.focus();
  }
}

// Phones: the map full screen over the page, a close button top left; Escape or close returns focus.
function open(from?: HTMLElement | null): void {
  if (!map || !mapEl || full) return;
  closeCard();
  opener = from ?? (document.activeElement as HTMLElement | null);
  home = mapEl.parentElement;
  const box = document.createElement('div');
  box.className = 'hm-full';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', mapEl.getAttribute('aria-label') || 'Map of rooms');
  box.innerHTML = `<button type="button" class="hm-x" aria-label="Close map">${X_SVG}</button><div class="hm-sheet" hidden></div>`;
  box.prepend(mapEl);
  (document.querySelector('.stage.phone') || document.body).appendChild(box);
  full = box;
  document.documentElement.classList.add('hm-lock');
  box.querySelector<HTMLButtonElement>('.hm-x')!.addEventListener('click', () => close());
  document.addEventListener('keydown', trap, true);
  lastSize = 1;
  fit();
  box.querySelector<HTMLButtonElement>('.hm-x')!.focus();
}

function close(refocus = true): void {
  if (!full) return;
  closeCard();
  const box = full;
  full = null;
  document.removeEventListener('keydown', trap, true);
  if (mapEl && home && home.isConnected) home.appendChild(mapEl);
  box.remove();
  document.documentElement.classList.remove('hm-lock');
  map?.invalidateSize({ animate: false });
  if (refocus) {
    const back = opener?.isConnected ? opener : document.querySelector<HTMLElement>('[data-cxshowmap]');
    back?.focus({ preventScroll: true });
  }
  opener = null;
}

// Back to the page's map once the window is wide enough to show it beside the list.
matchMedia('(min-width: 901px)').addEventListener('change', (e) => {
  if (e.matches && full) close(false);
});

const api = { draw, highlight, open, close, isOpen: () => !!full };
window.RentletHomeMap = api;
window.RL_homeMap?.();
