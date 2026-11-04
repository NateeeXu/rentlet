/* Budget field for the search bars (homepage bar, its compact header bar, and the room page).
   A slider over a histogram of the rooms nearby: bars inside the budget turn dark, bars up to 5% over turn grey
   (those rooms still show). The far end of the slider is "No max"; the striped bar there holds rooms above $2,600,
   which only show with No max. Done or a click outside keeps the budget; Escape leaves it unchanged.
   The value is a number of dollars a month, or Infinity for No max.
   mode:'rent' is the same picker for the host's own rent on the publish form: no "No max" stop, the bars below
   your rent turn dark ("this many rooms here ask less"), and the title/note come from the caller. */
(function () {
  const LO = 800, HI = 2600, ST = 50, N = (HI - LO) / ST, U = N + 1;
  const money = v => '$' + v.toLocaleString('en-US');
  const label = v => v === Infinity ? 'Any price' : 'Up to ' + money(v);
  const iOf = v => v === Infinity ? U : Math.round((Math.min(Math.max(v, LO), HI) - LO) / ST);
  const vOf = i => i > N ? Infinity : LO + i * ST;
  const fits = (p, v) => p <= v * 1.05;
  const KEY = 'cs-budget';
  const load = def => { try { const s = sessionStorage.getItem(KEY); if (s === 'any') return Infinity; if (s && +s > 0) return +s; } catch (_) {} return def; };
  const save = v => { try { sessionStorage.setItem(KEY, v === Infinity ? 'any' : String(v)); } catch (_) {} };

  const css = `
.bp-scrim{position:fixed;inset:0;z-index:299;background:transparent}
.bp{position:absolute;z-index:300;width:min(440px,calc(100vw - 24px));border-radius:26px;background:rgba(255,255,255,.66);-webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6);border:1px solid rgba(255,255,255,.75);box-shadow:inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(255,255,255,.35),0 18px 44px rgba(30,25,40,.16),0 2px 6px rgba(30,25,40,.06);display:flex;flex-direction:column;max-height:calc(100vh - 24px);color:#222;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;text-align:left;opacity:0;transform:translateY(-6px);transition:opacity .18s,transform .18s;-webkit-user-select:none;user-select:none}
.bp.on{opacity:1;transform:none}
.bp button{font:inherit;color:inherit;cursor:pointer;margin:0}
.bp-b{padding:20px 22px 8px;overflow:auto;min-height:0}
.bp-h{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
.bp-h small{display:block;font-size:13px;font-weight:600;color:#717171;margin-bottom:3px}
.bp-pr{display:inline-block;font-size:28px;font-weight:800;letter-spacing:-.8px;font-variant-numeric:tabular-nums;line-height:1.15}
.bp-pr i{font-style:normal;font-size:14px;font-weight:600;color:#717171;letter-spacing:0;margin-left:3px}
.bp-pr.pop{animation:bp-pop .35s cubic-bezier(.3,1.6,.5,1)}
@keyframes bp-pop{0%{transform:scale(.88)}100%{transform:scale(1)}}
.bp-n{font-size:13px;color:#717171;white-space:nowrap;padding-bottom:5px;font-variant-numeric:tabular-nums}
.bp-n b{color:#222}
.bp-hist{position:relative;height:96px;margin:16px 14px 0}
.bp-hist i{position:absolute;bottom:0;border-radius:5px 5px 2px 2px;background:rgba(0,0,0,.1);transition:background .18s}
.bp-hist i.on{background:#222}
.bp-hist i.lean{background:#9a9aa0}
.bp-hist i.top{background:repeating-linear-gradient(135deg,rgba(0,0,0,.18) 0 3px,rgba(0,0,0,.04) 3px 7px)}
.bp-hist i.top.on{background:repeating-linear-gradient(135deg,#222 0 3px,#4a4a50 3px 7px)}
.bp-r{display:block;width:100%;margin:0!important;height:34px;-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer}
.bp-r:focus{outline:none}
.bp-r::-webkit-slider-runnable-track{height:4px;border-radius:9px;background:linear-gradient(90deg,#222 var(--p),rgba(0,0,0,.1) var(--p))}
.bp-r::-moz-range-track{height:4px;border-radius:9px;background:linear-gradient(90deg,#222 var(--p),rgba(0,0,0,.1) var(--p))}
.bp-r::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;margin-top:-12px;border-radius:50%;background:#fff;border:1px solid #c8c8cc;box-shadow:0 2px 8px rgba(0,0,0,.18);transition:transform .15s}
.bp-r::-moz-range-thumb{width:26px;height:26px;border-radius:50%;background:#fff;border:1px solid #c8c8cc;box-shadow:0 2px 8px rgba(0,0,0,.18)}
.bp-r:active::-webkit-slider-thumb{transform:scale(1.1)}
.bp-r:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px #fff,0 0 0 5px #222}
.bp-ax{position:relative;height:18px;margin:2px 14px 0;font-size:12px;color:#717171;font-variant-numeric:tabular-nums}
.bp-ax span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
.bp-ax span.end{transform:translateX(-100%);font-weight:700;color:#222}
.bp-typ{margin:10px 0 14px;font-size:13px;color:#717171}
.bp-ch{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.bp-ch button{height:36px;min-width:0;padding:0 6px;border-radius:999px;border:1px solid rgba(0,0,0,.14);background:rgba(255,255,255,.55);font-size:14px!important;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center}
.bp-ch button:hover{border-color:#222}
.bp-ch button[aria-pressed=true]{background:#222;border-color:#222;color:#fff!important}
.bp-f{display:flex;align-items:center;gap:12px;padding:14px 18px 16px 22px;border-top:1px solid rgba(0,0,0,.07);margin-top:14px}
.bp-f span{flex:1;min-width:0;font-size:13px;color:#717171}
.bp-done{height:44px;padding:0 22px;border:0;border-radius:14px;background:#222;color:#fff!important;font-size:15px!important;font-weight:650;white-space:nowrap;flex:none}
.bp.sheet{position:fixed;left:0!important;right:0;bottom:0;top:auto!important;width:auto;border-radius:24px 24px 0 0;max-height:90vh;transform:translateY(16px);background:rgba(255,255,255,.88)}
.bp.sheet.on{transform:none}
.bp.sheet::before{content:"";display:block;width:38px;height:5px;border-radius:9px;background:#dcdcdf;margin:8px auto 0;flex:none}
.bp.sheet .bp-b{padding:12px 18px 4px}
.bp.sheet .bp-f{padding:12px 16px calc(14px + env(safe-area-inset-bottom)) 18px}
.bp-scrim.sheet{background:rgba(20,18,26,.22)}
.bp.inline{position:static;width:100%;max-height:none;opacity:1;transform:none;background:#fff;-webkit-backdrop-filter:none;backdrop-filter:none;border:1px solid #dddddd;border-radius:16px;box-shadow:none;transition:none;z-index:auto}
.bp.inline .bp-b{padding:16px 16px 14px;overflow:visible}
@media (prefers-reduced-motion:reduce){.bp,.bp-hist i{transition:none}.bp-pr.pop{animation:none}}`;

  let cur = null;
  function ensureStyle() {
    if (document.getElementById('bp-style')) return;
    const st = document.createElement('style'); st.id = 'bp-style'; st.textContent = css; document.head.appendChild(st);
  }

  /* $100 bars up to $2,600, then one striped bar for everything above */
  function histHtml(prices) {
    const bk = [];
    for (let s = LO; s < HI; s += 100) bk.push({ s, i0: (s - LO) / ST, w: 2, n: prices.filter(p => p >= s && p < s + 100).length });
    bk.push({ s: HI, i0: N, w: 1, n: prices.filter(p => p >= HI).length, top: 1 });
    const mx = Math.max(3, ...bk.map(x => x.n)); /* a few rooms should not look like a full market */
    return bk.map(x => `<i data-s="${x.s}"${x.top ? ' data-top class="top"' : ''} title="${x.top ? money(HI) + ' and up' : money(x.s) + '–' + money(x.s + 99)}: ${x.n} room${x.n === 1 ? '' : 's'}" style="left:calc(${x.i0 / U * 100}% + 1.5px);width:calc(${x.w / U * 100}% - 3px);height:${x.n ? Math.max(10, x.n / mx * 100) : 2}%"></i>`).join('');
  }
  function typical(prices) {
    if (prices.length < 5) return '';
    const s = [...prices].sort((a, b) => a - b), q = f => Math.round(s[Math.floor((s.length - 1) * f)] / 50) * 50;
    return `Most rooms here are ${money(q(.25))}–${money(q(.75))} a month.`;
  }

  function draw(c, pop) {
    const v = c.v, el = c.el, r = el.querySelector('.bp-r'), i = iOf(v), rent = c.mode === 'rent', M = rent ? N : U;
    if (+r.value !== i) r.value = i;
    r.style.setProperty('--p', i / M * 100 + '%');
    r.setAttribute('aria-valuetext', v === Infinity ? 'No max' : money(v) + ' a month');
    const pr = el.querySelector('.bp-pr');
    pr.innerHTML = v === Infinity ? 'No max' : `${money(v)}<i>/ mo</i>`;
    if (pop) { pr.classList.remove('pop'); void pr.offsetWidth; pr.classList.add('pop'); }
    const n = c.prices.filter(p => fits(p, v)).length, T = c.prices.length;
    if (rent) { const less = c.prices.filter(p => p < v).length; el.querySelector('.bp-n').innerHTML = T < 3 ? '' : `<b>${less}</b> of ${T} rooms ask less`; }
    else el.querySelector('.bp-n').innerHTML = `<b>${n}</b> of ${T} room${T === 1 ? '' : 's'}`;
    el.querySelectorAll('.bp-hist i').forEach(x => {
      const s = +x.dataset.s, top = x.hasAttribute('data-top');
      x.classList.toggle('on', v === Infinity || (top ? rent && v >= HI : s + 99 <= v));
      x.classList.toggle('lean', !rent && v !== Infinity && !top && s + 99 > v && s <= v * 1.05);
    });
    el.querySelectorAll('[data-bp-v]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.bpV === 'any' ? Infinity : +b.dataset.bpV) === v)));
  }
  function set(c, v) { const was = c.v; if (v === was) return; c.v = v; draw(c, v === Infinity || was === Infinity); if (c.onChange) c.onChange(v); }
  /* the picker's own body: title, count, histogram, slider, axis, typical range, chips */
  function bodyHtml(prices, rent, title) {
    const M = rent ? N : U, ty = typical(prices);
    return `<div class="bp-h"><div><small>${title}</small><span class="bp-pr"></span></div><span class="bp-n"></span></div>
      <div class="bp-hist" aria-hidden="true">${histHtml(prices)}</div>
      <input type="range" class="bp-r" min="0" max="${M}" step="1" aria-label="${title}">
      <div class="bp-ax" aria-hidden="true">${[800, 1200, 1600, 2000].map(v => `<span style="left:${(v - LO) / ST / M * 100}%">${money(v)}</span>`).join('')}<span class="end" style="left:100%">${rent ? money(HI) + '+' : 'No max'}</span></div>
      ${ty ? `<p class="bp-typ">${ty}</p>` : '<div style="height:14px"></div>'}
      <div class="bp-ch">${(rent ? [1200, 1500, 1800, 2200] : [1200, 1500, 2000, 'any']).map(v => `<button type="button" data-bp-v="${v}">${v === 'any' ? 'No max' : money(v)}</button>`).join('')}</div>`;
  }
  function bind(c) {
    c.el.querySelector('.bp-r').addEventListener('input', e => set(c, vOf(+e.target.value)));
    c.el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-bp-v]'); if (b) { set(c, b.dataset.bpV === 'any' ? Infinity : +b.dataset.bpV); return; }
      if (ev.target.closest('.bp-done') && c === cur) close(true);
    });
  }

  const stuck = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  function place() {
    const w = cur.el, sc = cur.scrim, sheet = window.innerWidth < 640 || cur.host !== document.body;
    w.classList.toggle('sheet', sheet); sc.classList.toggle('sheet', sheet);
    if (sheet) return;
    const r = cur.anchor.getBoundingClientRect(), W = w.offsetWidth;
    const left = Math.max(12, Math.min(r.right - W, window.innerWidth - W - 12));
    let top = r.bottom + 10;
    if (top + w.offsetHeight > window.innerHeight - 12) top = Math.max(12, window.innerHeight - w.offsetHeight - 12);
    const fixed = stuck(cur.anchor); w.style.position = fixed ? 'fixed' : 'absolute';
    w.style.left = (left + (fixed ? 0 : window.scrollX)) + 'px'; w.style.top = (top + (fixed ? 0 : window.scrollY)) + 'px';
  }

  function close(keep) {
    if (!cur) return;
    const c = cur; cur = null;
    if (keep && c.v !== c.v0) c.onDone(c.v);
    c.el.classList.remove('on');
    c.anchor.setAttribute('aria-expanded', 'false');
    window.removeEventListener('resize', c.onResize);
    document.removeEventListener('scroll', c.onScroll, true);
    document.removeEventListener('keydown', c.onKey, true);
    c.scrim.remove();
    setTimeout(() => c.el.remove(), 180);
  }

  function open(opts) {
    if (cur) { const same = cur.anchor === opts.anchor; close(true); if (same) return; }
    if (window.WhenPicker) window.WhenPicker.close();
    ensureStyle();
    const prices = (opts.prices || []).filter(p => p > 0), rent = opts.mode === 'rent';
    const title = opts.title || (rent ? 'Your rent a month' : "Most you'd pay a month");
    const scrim = document.createElement('div'); scrim.className = 'bp-scrim';
    const el = document.createElement('div'); el.className = 'bp'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
    el.innerHTML = `<div class="bp-b">${bodyHtml(prices, rent, title)}</div>
      <div class="bp-f"><span>${opts.note || (rent ? 'You can change it any time.' : 'Rooms up to 5% over your budget still show.')}</span><button type="button" class="bp-done">Done</button></div>`;
    /* inside a phone preview frame the picker belongs to the frame */
    const host = opts.anchor.closest('.stage.phone') || document.body;
    host.appendChild(scrim); host.appendChild(el);
    const v0 = opts.value === Infinity && !rent || opts.value > 0 ? opts.value : rent ? 1500 : Infinity;
    cur = { el, scrim, host, anchor: opts.anchor, v: v0, v0, prices, mode: opts.mode, onDone: opts.onDone };
    opts.anchor.setAttribute('aria-expanded', 'true');
    draw(cur);
    const ar = opts.anchor.getBoundingClientRect(), need = ar.bottom + 10 + el.offsetHeight - (window.innerHeight - 12);
    if (host === document.body && window.innerWidth >= 640 && need > 0) window.scrollBy(0, Math.min(need, ar.top - 72));
    place(); requestAnimationFrame(() => el.classList.add('on'));
    if (!el.classList.contains('sheet')) el.querySelector('.bp-r').focus({ preventScroll: true });
    bind(cur);
    scrim.addEventListener('click', () => close(true));
    cur.onResize = () => cur && place();
    /* the popover rides with its field while the page scrolls; once the field scrolls away or under the sticky header, it closes and keeps the choice */
    cur.onScroll = (e) => {
      if (!cur || cur.el.classList.contains('sheet')) return;
      const r = cur.anchor.getBoundingClientRect();
      let covered = r.width === 0 || r.bottom < 0 || r.top > window.innerHeight;
      if (!covered) { cur.scrim.style.pointerEvents = 'none'; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); cur.scrim.style.pointerEvents = ''; covered = !(hit && (cur.anchor.contains(hit) || cur.el.contains(hit))); }
      if (covered) close(true); else if (e.target !== document || stuck(cur.anchor)) place(); /* page scrolls carry it natively; only an inner scroller needs a re-place */
    };
    document.addEventListener('scroll', cur.onScroll, true);
    cur.onKey = ev => { if (ev.key === 'Escape' && cur) { ev.stopPropagation(); close(false); } };
    window.addEventListener('resize', cur.onResize);
    document.addEventListener('keydown', cur.onKey, true);
  }

  /* The same picker laid into a page (the request form's budget step): no scrim, no footer; the page's own field
     shows the label. onChange(v) runs on every move; v is dollars a month or Infinity for No max. */
  function mount(opts) {
    ensureStyle();
    const prices = (opts.prices || []).filter(p => p > 0), rent = opts.mode === 'rent';
    const title = opts.title || (rent ? 'Your rent a month' : "Most you'd pay a month");
    const el = document.createElement('div'); el.className = 'bp inline';
    el.innerHTML = `<div class="bp-b">${bodyHtml(prices, rent, title)}</div>`;
    opts.mount.appendChild(el);
    const v0 = opts.value === Infinity && !rent || opts.value > 0 ? opts.value : rent ? 1500 : Infinity;
    const c = { el, v: v0, prices, mode: opts.mode, onChange: opts.onChange };
    draw(c); bind(c);
    return { set(v) { set(c, v); }, get: () => c.v, destroy() { el.remove(); } };
  }

  window.BudgetPicker = { open, mount, close: () => close(true), label, load, save };
})();
