/* Where field for the homepage search bars (A1, A4, C5).
   The campus field becomes a text box. Left empty it lists cities, and a city opens its campuses; it still picks a campus, and it also finds a listing by its 8-digit
   number (the same rule as the mini program's findListingByCode, also inside pasted share text) or by area
   and layout. Room numbers and fields match room.html. */
(function () {
  /* live listings, when the page has them (window.RL_SEARCH_ROOMS: {key, code, title, area, layout, price}) */
  const rooms = () => window.RL_SEARCH_ROOMS || [];
  /* the same two levels as the mini program: city / metro area first, then a campus in it */
  const CITIES = [
    ['Chicago area', [['nu-evn', 'Northwestern · Evanston'], ['nu-chi', 'Northwestern · Chicago'], ['chi-dt', 'Downtown Chicago']]]
  ];
  const SCHOOLS = CITIES.flatMap(([city, list]) => list.map(([v, name]) => [v, name, city]));
  const cityOf = name => (SCHOOLS.find(s => s[1] === name) || [])[2];
  const CODE_RE = /(?<!\d)[1-9]\d{7}(?!\d)|ES-[A-Z0-9]{2,8}-[A-Z0-9]{3,6}/i;
  const money = n => '$' + n.toLocaleString('en-US');
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICON = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4 4 9-9"/></svg>',
    city: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V9.5l5-2.5V20M9 20V4.5l7 3V20M16 20v-8l4 2v6M3 20h18M12 10.5h1M12 14h1"/></svg>',
    r: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
    l: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>'
  };

  const css = `
.ws-in{display:block;width:100%;min-width:0;border:0;background:none;outline:0;padding:0;margin:0;font:inherit;color:inherit;text-overflow:ellipsis}
.ws-in::placeholder{color:#9a9aa0}
.ws-pop{position:absolute;z-index:200;width:min(380px,calc(100vw - 24px));padding:8px;border-radius:20px;background:rgba(255,255,255,.66);-webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6);border:1px solid rgba(255,255,255,.75);box-shadow:inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(255,255,255,.35),0 18px 44px rgba(30,25,40,.16),0 2px 6px rgba(30,25,40,.06);opacity:0;transform:translateY(-6px) scale(.98);transform-origin:20% 0;transition:opacity .18s,transform .3s cubic-bezier(.22,1,.36,1);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#222;-webkit-font-smoothing:antialiased}
.ws-pop.on{opacity:1;transform:none}
.ws-pop[hidden]{display:none}
.ws-lab{margin:4px 8px 2px;font-size:12px;font-weight:650;color:#717171}
.ws-list{display:grid;grid-template-columns:minmax(0,1fr);gap:0;max-height:min(380px,60vh);overflow:auto}
.ws-it{min-width:0;display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:12px;color:inherit;text-decoration:none;cursor:pointer}
.ws-it.on{background:rgba(0,0,0,.05)}
.ws-ic{width:34px;height:34px;border-radius:10px;background:rgba(0,0,0,.05);display:grid;place-items:center;flex:none}
.ws-ic svg{width:16px;height:16px;fill:none;stroke:#484848;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.ws-it img{width:46px;height:34px;border-radius:9px;object-fit:cover;flex:0 0 46px;display:block}
.ws-it img.flip{transform:scaleX(-1)}
.ws-tx{flex:1;min-width:0}
.ws-tx b{display:block;font-size:14px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ws-tx span{display:block;font-size:12px;line-height:1.3;color:#717171;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ws-tx em{font-style:normal;font-weight:600;color:#484848;font-variant-numeric:tabular-nums}
.ws-pr{flex:none;display:flex;flex-direction:column;align-items:flex-end;font-size:14px;font-weight:750;line-height:1.15;font-variant-numeric:tabular-nums}
.ws-pr small{font-size:11px;font-weight:500;color:#717171}
.ws-go svg{width:16px;height:16px;fill:none;stroke:#9a9aa0;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;display:block}
.ws-back{gap:4px;padding:4px 8px;font-size:13px;font-weight:650;color:#484848}
.ws-back svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ws-back+.ws-lab{margin-top:2px}
.ws-cur svg{width:16px;height:16px;fill:none;stroke:#222;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ws-none{margin:8px;display:grid;gap:3px}.ws-none b{font-size:14px}.ws-none span{font-size:13px;color:#717171}
.ws-hint{margin:4px 8px 2px;font-size:12px;line-height:1.5;color:#717171}`;
  function ensureStyle(doc) {
    if (doc.getElementById('ws-style')) return;
    const st = doc.createElement('style'); st.id = 'ws-style'; st.textContent = css; doc.head.appendChild(st);
  }

  function search(q) {
    const m = String(q || '').match(CODE_RE);
    if (m) { const code = m[0].toUpperCase(); return { code, rooms: rooms().filter(r => r.code === code), schools: [] }; }
    const t = String(q || '').trim().toLowerCase();
    if (!t) return { rooms: [], schools: [] };
    const words = t.split(/\s+/);
    const hit = hay => words.every(w => hay.toLowerCase().includes(w));
    return {
      schools: SCHOOLS.filter(([, name, city]) => hit(name + ' ' + city)),
      rooms: t.length < 2 ? [] : rooms().filter(r => hit([r.title, r.area, r.layout, r.code].join(' ')))
    };
  }

  /* attach to one bar: seg = the campus segment; valueEl shows the chosen campus; select (optional) = the native
     campus select the page already listens to. The field is pick-only (Founder, Oct 30): a click opens the city →
     campus list, nothing is typed. The listing-number lookup that used to live in this box is gone with it. */
  function attach({ form, seg, valueEl, labelEl, select, current, onCampus }) {
    if (!seg || seg.dataset.wsDone) return;
    if (seg.tagName === 'BUTTON') { const d = seg.ownerDocument.createElement('div'); d.className = seg.className; while (seg.firstChild) d.appendChild(seg.firstChild); seg.replaceWith(d); seg = d; }
    seg.dataset.wsDone = '1';
    const doc = seg.ownerDocument, win = doc.defaultView;
    ensureStyle(doc);
    if (labelEl) labelEl.textContent = 'Where';
    if (select) { select.style.display = 'none'; select.tabIndex = -1; }
    let campus = current || (select && select.selectedIndex >= 0 ? select.options[select.selectedIndex].text : '');
    const out = valueEl || (() => { const s = doc.createElement('span'); seg.appendChild(s); return s; })();
    out.textContent = campus;
    seg.tabIndex = 0; seg.setAttribute('role', 'button'); seg.setAttribute('aria-haspopup', 'listbox'); seg.setAttribute('aria-expanded', 'false');
    if (!seg.getAttribute('aria-label')) seg.setAttribute('aria-label', 'Campus');

    const pop = doc.createElement('div'); pop.className = 'ws-pop'; pop.hidden = true; pop.setAttribute('role', 'listbox');
    doc.body.appendChild(pop);
    let items = [], sel = -1, step = null; /* step: null = the city list, or the chosen city */
    let anchor = seg; /* the list can also open under another element, such as the compact header bar's Where */

    function place() {
      /* stay inside the phone preview frame when there is one */
      const fr = anchor.closest('.stage.phone'), box = fr ? fr.getBoundingClientRect() : { left: 0, right: win.innerWidth };
      const r = anchor.getBoundingClientRect(), w = Math.min(380, box.right - box.left - 24);
      pop.style.width = w + 'px';
      let fixed = false; for (let n = anchor; n && n !== doc.body; n = n.parentElement) { const ps = win.getComputedStyle(n).position; if (ps === 'fixed' || ps === 'sticky') { fixed = true; break; } }
      pop.style.position = fixed ? 'fixed' : 'absolute';
      pop.style.left = (Math.max(box.left + 12, Math.min(r.left - 8, box.right - w - 12)) + (fixed ? 0 : win.scrollX)) + 'px';
      pop.style.top = (r.bottom + 10 + (fixed ? 0 : win.scrollY)) + 'px';
    }
    function draw() {
      const row = (html, i, attrs) => `<div class="ws-it${i === sel ? ' on' : ''}" role="option" data-i="${i}" ${attrs}>${html}</div>`;
      const schoolRow = ([v, name], i) => row(`<span class="ws-ic">${ICON.pin}</span><span class="ws-tx"><b>${esc(name)}</b></span>${name === campus ? `<span class="ws-cur">${ICON.check}</span>` : ''}`, i, `data-school="${v}"`);
      const cityRow = ([city, list], i) => row(`<span class="ws-ic">${ICON.city}</span><span class="ws-tx"><b>${esc(city)}</b><span>${city === cityOf(campus) ? esc(campus) : `${list.length} campus${list.length > 1 ? 'es' : ''}`}</span></span><span class="ws-go">${ICON.r}</span>`, i, `data-city="${esc(city)}"`);
      items = []; let html;
      /* pick a city, then a campus in it */
      /* with a single city (Rentlet: Chicago area) the city step is skipped and there is no way back to it */
      if (!step && CITIES.length > 1) html = `<p class="ws-lab">Choose a city</p>` + CITIES.map(c => cityRow(c, items.push({ city: c[0] }) - 1)).join('');
      else {
        step = step || CITIES[0][0];
        const list = SCHOOLS.filter(x => x[2] === step);
        const back = CITIES.length > 1 ? `<div class="ws-it ws-back${sel === 0 ? ' on' : ''}" role="option" data-i="${items.push({ back: 1 }) - 1}">${ICON.l}All cities</div>` : '';
        html = back + `<p class="ws-lab">${esc(step)}</p>` + list.map(x => schoolRow(x, items.push({ school: x }) - 1)).join('');
      }
      if (sel >= items.length) sel = items.length - 1;
      pop.innerHTML = `<div class="ws-list">${html}</div>`;
    }
    /* the list opens on the campus's own city, so the current campus is one tap away */
    function open() { place(); sel = -1; step = cityOf(campus) || null; draw(); pop.hidden = false; seg.setAttribute('aria-expanded', 'true'); anchor.classList.add('ws-on'); win.requestAnimationFrame(() => pop.classList.add('on')); }
    function openAt(el) { anchor = el || seg; open(); }
    function close() {
      anchor.classList.remove('ws-on'); anchor = seg; pop.classList.remove('on'); seg.setAttribute('aria-expanded', 'false');
      win.setTimeout(() => { if (!pop.classList.contains('on')) pop.hidden = true; }, 200);
    }
    const toggle = () => { if (pop.hidden || !pop.classList.contains('on')) open(); else close(); };
    function choose(i) {
      const it = items[i]; if (!it) return false;
      if (it.city) { step = it.city; sel = -1; draw(); return true; }
      if (it.back) { step = null; sel = -1; draw(); return true; }
      const [v, name] = it.school; campus = name; out.textContent = name; close();
      if (select) { select.value = v; select.dispatchEvent(new win.Event('change', { bubbles: true })); }
      if (onCampus) onCampus(v, name);
      return true;
    }
    seg.addEventListener('click', e => { if (select && e.target === select) return; e.preventDefault(); toggle(); });
    seg.addEventListener('keydown', e => {
      const openNow = !pop.hidden && pop.classList.contains('on');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!openNow) { open(); return; } if (!items.length) return; sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; draw(); }
      else if (e.key === 'ArrowLeft' && openNow && step) { e.preventDefault(); step = null; sel = -1; draw(); }
      else if (e.key === 'Escape' && openNow) { e.preventDefault(); close(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!openNow) open(); else if (sel >= 0) choose(sel); }
    });
    pop.addEventListener('pointerdown', e => e.preventDefault());
    pop.addEventListener('click', e => { const it = e.target.closest('.ws-it'); if (it) choose(+it.dataset.i); });
    pop.addEventListener('mousemove', e => { const it = e.target.closest('.ws-it'); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; draw(); } });
    doc.addEventListener('pointerdown', e => { if (!pop.hidden && !anchor.contains(e.target) && !pop.contains(e.target)) close(); });
    doc.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden && !seg.contains(doc.activeElement)) close(); });
    win.addEventListener('resize', () => { if (!pop.hidden) place(); });
    /* the list rides with the field while the page scrolls, and closes once the field is covered or off screen */
    win.addEventListener('scroll', (e) => { if (pop.hidden) return; const r = anchor.getBoundingClientRect();
      const hit = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (r.width === 0 || r.bottom < 0 || r.top > win.innerHeight || !(hit && (anchor.contains(hit) || pop.contains(hit)))) close(); else if (e.target !== doc || pop.style.position === 'fixed') place(); }, true);
    return { openAt, close };
  }

  window.WhereSearch = { attach, search, CODE_RE, SCHOOLS }; /* SCHOOLS: [id, name, city] rows, so other pages can name a campus from its id */
})();
