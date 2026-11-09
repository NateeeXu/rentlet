/* When field for the search bars (homepage A1, A4, C5 and the room page).
   A month calendar with the school calendar laid over it: quarters, finals and breaks are shown as text
   labels; finals and breaks take their colour only while the pointer is on them (a tap on phones).
   The month title opens a year and month chooser. First tap is move-in, second is move-out.
   Done or a click outside keeps the dates; Escape leaves them unchanged.
   School dates are Northwestern's published 2026-27 calendar (see EVENTS). */
(function () {
  const DAY = 864e5;
  const D = s => Date.parse(s + 'T00:00:00Z');
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const nights = (a, b) => Math.round((D(b) - D(a)) / DAY);
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MOL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const md = s => s ? `${MO[+s.slice(5, 7) - 1]} ${+s.slice(8)}` : '';
  /* One date format for the whole site (the web form of FD-117): an en dash between dates; no year inside the
     current year; one year at the end when both dates fall in the same later year; both years when the stay
     crosses into a new year. "Nov 5 – Dec 20", "Jan 3 – Apr 30, 2027", "Dec 20, 2026 – Mar 15, 2027". */
  const CUR = String(new Date().getFullYear());
  const ends = (s, e) => { const a = s.slice(0, 4), b = e.slice(0, 4);
    return a !== b ? [`${md(s)}, ${a}`, `${md(e)}, ${b}`] : a === CUR ? [md(s), md(e)] : [md(s), `${md(e)}, ${b}`]; };
  const wl = (s, e) => ends(s, e).join(' – ');
  const day = s => s.slice(0, 4) === CUR ? md(s) : `${md(s)}, ${s.slice(0, 4)}`;
  const rng = (a, b) => a.slice(5, 7) === b.slice(5, 7) ? `${md(a)}–${+b.slice(8)}` : `${md(a)} – ${md(b)}`;
  const now = new Date();
  const TODAY = iso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const mkey = ([y, m]) => y * 12 + m;
  const addM = ([y, m], n) => { const k = y * 12 + m + n; return [Math.floor(k / 12), k % 12]; };
  const FIRST = [now.getFullYear(), now.getMonth()], LAST = addM(FIRST, 14);
  const viewOf = d => [+d.slice(0, 4), +d.slice(5, 7) - 1];

  /* Northwestern (Evanston) 2026-27 undergraduate calendar, from the Office of the Registrar
     (registrar.northwestern.edu/calendars/academic-calendars, 2026-27 tab, read Nov 4, 2026).
     Breaks are the gaps between a quarter's last exam and the next quarter's first class. */
  const EVENTS = [['Fall quarter', '2026-09-23', '2026-12-05', 'term'], ['Fall finals', '2026-12-07', '2026-12-12', 'exam'], ['Winter break', '2026-12-13', '2027-01-03', 'brk'], ['Winter quarter', '2027-01-04', '2027-03-13', 'term'], ['Winter finals', '2027-03-15', '2027-03-20', 'exam'], ['Spring break', '2027-03-21', '2027-03-29', 'brk'], ['Spring quarter', '2027-03-30', '2027-06-05', 'term'], ['Spring finals', '2027-06-07', '2027-06-11', 'exam'], ['Summer session', '2027-06-21', '2027-08-29', 'term']];
  const kindOf = d => { const e = EVENTS.find(e => e[3] !== 'term' && e[1] <= d && e[2] >= d); return e ? e[3] : null; };
  const SVG = p => `<svg class="wp-ic" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const IC = {
    term: SVG('<path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5v4.2c1.6 1.4 3.4 2 5.5 2s3.9-.6 5.5-2v-4.2"/>'),
    exam: SVG('<path d="M15.5 4.5l4 4L9 19H5v-4z"/><path d="M13 7l4 4"/>'),
    brk: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
    l: SVG('<path d="m15 5-7 7 7 7"/>'), r: SVG('<path d="m9 5 7 7-7 7"/>'), down: SVG('<path d="m6 9 6 6 6-6"/>')
  };

  const css = `
.wp-scrim{position:fixed;inset:0;z-index:299;background:transparent}
.wp{position:absolute;z-index:300;width:min(420px,calc(100vw - 24px));border-radius:26px;background:rgba(255,255,255,.66);-webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6);border:1px solid rgba(255,255,255,.75);box-shadow:inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(255,255,255,.35),0 18px 44px rgba(30,25,40,.16),0 2px 6px rgba(30,25,40,.06);display:flex;flex-direction:column;max-height:calc(100vh - 24px);color:#222;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;text-align:left;opacity:0;transform:translateY(-6px);transition:opacity .18s,transform .18s;-webkit-user-select:none;user-select:none}
.wp.on{opacity:1;transform:none}
.wp button{font:inherit;color:inherit;cursor:pointer;margin:0}
.wp-b{padding:18px 20px 10px;overflow:auto;min-height:0}
.wp-ic{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.wp-hd{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.wp-hd>div{flex:1;min-width:0}
.wp-mt{border:0;background:none;font-size:16px!important;font-weight:700;letter-spacing:-.2px;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;min-height:44px;margin-left:-10px!important;border-radius:10px}
.wp-mt:hover,.wp-mt[aria-expanded=true]{background:rgba(0,0,0,.05)}
.wp-mt .wp-ic{width:14px;height:14px;stroke-width:2.2;transition:transform .2s}
.wp-mt[aria-expanded=true] .wp-ic{transform:rotate(180deg)}
.wp-nv{width:44px;height:44px;border-radius:50%;border:1px solid rgba(0,0,0,.12);background:rgba(255,255,255,.6);display:grid;place-items:center;flex:none;padding:0}
.wp-nv:hover:not(:disabled){border-color:#222}
.wp-nv:disabled{opacity:.3;cursor:default}
.wp-nv .wp-ic{width:15px;height:15px;stroke-width:2}
.wp-wk{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.wp-wk span{text-align:center;font-size:11px;font-weight:650;color:#717171;padding-bottom:4px}
.wp-row{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));position:relative;padding-top:24px}
.wp-d{height:44px;border:0;background:none;padding:0;display:grid;place-items:center;position:relative}
.wp-d>span{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-size:14px;font-weight:550;font-variant-numeric:tabular-nums;position:relative;z-index:2;transition:background .15s,color .15s}
.wp-d:hover>span{box-shadow:inset 0 0 0 1.5px #222}
.wp-d.rg{background:rgba(0,0,0,.045)}
.wp-d.s{background:linear-gradient(90deg,transparent 50%,rgba(0,0,0,.045) 50%)}
.wp-d.e{background:linear-gradient(90deg,rgba(0,0,0,.045) 50%,transparent 50%)}
.wp-d.s.e{background:none}
.wp-d.s>span,.wp-d.e>span{background:#222;color:#fff;font-weight:700}
.wp-d.ps{cursor:default}.wp-d.ps>span{color:#d0d0d4}.wp-d.ps:hover>span{box-shadow:none}
.wp-d.on-ex:not(.s):not(.e)>span{color:#b86e00;background:#fff4e5}
.wp-d.on-bk:not(.s):not(.e)>span{color:#1a7f37;background:rgba(52,199,89,.14)}
.wp-x{visibility:hidden}
.wp-ev{position:absolute;top:3px;height:19px;padding:0 2px;border-radius:99px;display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;z-index:3;color:#484848;transition:background .15s,color .15s,padding .15s;cursor:default}
.wp-ev.term{color:#717171;border-radius:0;box-shadow:inset 0 -2px 0 rgba(0,0,0,.14)}
.wp-ev.exam.on{background:#fff4e5;color:#b86e00;padding:0 8px}
.wp-ev.brk.on{background:rgba(52,199,89,.14);color:#1a7f37;padding:0 8px}
.wp-ev.cont{color:transparent;padding:0}
.wp-mp .wp-yr{display:flex;align-items:center;justify-content:center;gap:18px;margin:6px 0 16px}
.wp-mp .wp-yr b{font-size:22px;letter-spacing:-.5px;font-variant-numeric:tabular-nums;min-width:70px;text-align:center}
.wp-mg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding-bottom:6px}
.wp-mg button{height:58px;border-radius:14px;border:1px solid rgba(0,0,0,.08);background:rgba(255,255,255,.55);font-size:14px!important;font-weight:650;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:0}
.wp-mg button small{font-size:11px;font-weight:600;color:#717171}
.wp-mg button:hover:not(:disabled){border-color:#222}
.wp-mg button.st{background:rgba(0,0,0,.05);border-color:transparent}
.wp-mg button.cur{background:#222;border-color:#222;color:#fff!important}
.wp-mg button.cur small{color:#bdbdc2}
.wp-mg button:disabled{opacity:.3;cursor:default}
.wp-f{display:flex;align-items:center;gap:12px;padding:14px 18px 16px 20px;border-top:1px solid rgba(0,0,0,.07)}
.wp-sum{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.wp-sum b{font-size:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
.wp-sum span{font-size:13px;color:#717171;white-space:nowrap}
.wp-done{height:44px;padding:0 22px;border:0;border-radius:14px;background:#222;color:#fff!important;font-size:15px!important;font-weight:650;white-space:nowrap}
.wp-done:disabled{background:#c8c8cd;cursor:default}
.wp.sheet{position:fixed;left:0!important;right:0;bottom:0;top:auto!important;width:auto;border-radius:24px 24px 0 0;max-height:90vh;transform:translateY(16px);background:rgba(255,255,255,.88)}
.wp.sheet.on{transform:none}
.wp.sheet::before{content:"";display:block;width:38px;height:5px;border-radius:9px;background:rgba(0,0,0,.16);margin:8px auto 0;flex:none}
.wp.sheet .wp-b{padding:10px 14px 6px}
.wp.sheet .wp-f{padding:12px 16px calc(14px + env(safe-area-inset-bottom)) 18px}
.wp-scrim.sheet{background:rgba(20,18,26,.22)}
.wp.inline{position:static;width:100%;max-height:none;opacity:1;transform:none;background:#fff;-webkit-backdrop-filter:none;backdrop-filter:none;border:1px solid #dddddd;border-radius:16px;box-shadow:none;transition:none;z-index:auto}
.wp.inline .wp-b{padding:14px 16px 10px;overflow:visible}
@media (prefers-reduced-motion:reduce){.wp,.wp-d>span,.wp-ev,.wp-mt .wp-ic{transition:none}}`;

  let cur = null;
  function ensureStyle() {
    if (document.getElementById('wp-style')) return;
    const st = document.createElement('style'); st.id = 'wp-style'; st.textContent = css; document.head.appendChild(st);
  }

  function weeks([y, m]) {
    const lead = new Date(Date.UTC(y, m, 1)).getUTCDay(), n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), c = [];
    for (let i = 0; i < lead; i++) c.push(null);
    for (let d = 1; d <= n; d++) { const day = iso(Date.UTC(y, m, d)); c.push({ day, d, col: (lead + d - 1) % 7 }); }
    while (c.length % 7) c.push(null);
    const r = []; for (let i = 0; i < c.length; i += 7) r.push(c.slice(i, i + 7)); return r;
  }
  const evsIn = r => {
    const real = r.filter(Boolean), a = real[0].day, b = real[real.length - 1].day;
    return EVENTS.filter(e => e[1] <= b && e[2] >= a).map(e => {
      const s0 = e[1] < a ? a : e[1], e0 = e[2] > b ? b : e[2];
      return { e, c0: real.find(c => c.day === s0).col, c1: real.find(c => c.day === e0).col };
    });
  };
  /* a label sits on the first piece of its bar that is at least three days wide, so it is never cut off */
  function labelRows(rows) {
    const at = {};
    rows.forEach((r, ri) => evsIn(r).forEach(({ e, c0, c1 }) => {
      const k = e[1] + e[3], w = c1 - c0 + 1;
      if (!(k in at) || (!at[k].ok && w > at[k].w)) at[k] = { ri, w, ok: w >= 3 };
    }));
    return at;
  }

  function calendar(c) {
    const { s, e, view } = c, rows = weeks(view), at = labelRows(rows);
    const cell = c => {
      if (!c) return '<span class="wp-d wp-x"></span>';
      const ps = c.day < TODAY, k = kindOf(c.day), ev = EVENTS.find(x => x[3] !== 'term' && x[1] <= c.day && x[2] >= c.day);
      const cls = ['wp-d', ps && 'ps', c.day === s && 's', c.day === e && 'e', e && c.day > s && c.day < e && 'rg', k === 'exam' && 'ex', k === 'brk' && 'bk'].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-wp-d="${c.day}" ${ps ? 'disabled' : ''} aria-label="${MOL[view[1]]} ${c.d}, ${view[0]}${ev ? ', ' + ev[0] : ''}${c.day === s ? ', move in' : ''}${c.day === e ? ', move out' : ''}"><span>${c.d}</span></button>`;
    };
    return `${head(c)}<div class="wp-wk">${'S M T W T F S'.split(' ').map(x => `<span>${x}</span>`).join('')}</div>` +
      rows.map((r, ri) => `<div class="wp-row">${evsIn(r).map(({ e: v, c0, c1 }) => {
        const lab = at[v[1] + v[3]].ri === ri;
        return `<span class="wp-ev ${v[3]}${lab ? '' : ' cont'}" data-wp-ev="${v[1]}|${v[2]}" title="${v[0]}: ${rng(v[1], v[2])}" style="left:calc(${c0}/7*100% + 2px);width:calc(${c1 - c0 + 1}/7*100% - 4px)">${lab ? IC[v[3]] + v[0] : ''}</span>`;
      }).join('')}${r.map(cell).join('')}</div>`).join('');
  }
  function head(c) {
    const v = c.view;
    return `<div class="wp-hd"><div><button type="button" class="wp-mt" data-wp-mt aria-expanded="${c.picker}" aria-label="Choose month and year">${MOL[v[1]]} ${v[0]}${IC.down}</button></div>${c.picker ? '' :
      `<button type="button" class="wp-nv" data-wp-nav="-1" ${mkey(v) > mkey(FIRST) ? '' : 'disabled'} aria-label="Previous month">${IC.l}</button><button type="button" class="wp-nv" data-wp-nav="1" ${mkey(v) < mkey(LAST) ? '' : 'disabled'} aria-label="Next month">${IC.r}</button>`}</div>`;
  }
  function chooser(c) {
    const y = c.py, a = c.s && c.s.slice(0, 7), b = c.e && c.e.slice(0, 7);
    return `${head(c)}<div class="wp-mp"><div class="wp-yr"><button type="button" class="wp-nv" data-wp-py="-1" ${y > FIRST[0] ? '' : 'disabled'} aria-label="Previous year">${IC.l}</button><b>${y}</b><button type="button" class="wp-nv" data-wp-py="1" ${y < LAST[0] ? '' : 'disabled'} aria-label="Next year">${IC.r}</button></div>
      <div class="wp-mg">${MO.map((m, i) => {
        const k = `${y}-${String(i + 1).padStart(2, '0')}`, off = mkey([y, i]) < mkey(FIRST) || mkey([y, i]) > mkey(LAST), on = y === c.view[0] && i === c.view[1];
        const tag = k === a ? 'Move in' : k === b ? 'Move out' : (a && b && k > a && k < b) ? 'Staying' : '';
        return `<button type="button" data-wp-pm="${y}-${i}" class="${on ? 'cur' : ''}${tag ? ' st' : ''}" ${off ? 'disabled' : ''}>${m}${tag ? `<small>${tag}</small>` : ''}</button>`;
      }).join('')}</div></div>`;
  }

  function draw(c) {
    const w = c.el;
    w.querySelector('.wp-b').innerHTML = c.picker ? chooser(c) : calendar(c);
    const { s, e } = c, ok = s && e && nights(s, e) > 0, sum = w.querySelector('.wp-sum');
    if (sum) { /* the popover's footer; the inline calendar has none */
      sum.innerHTML = ok ? `<b>${wl(s, e)}</b><span>${nights(s, e)} nights</span>` : s ? `<b>${day(s)} – ?</b><span>Now pick your move-out</span>` : `<b>Pick your move-in</b>`;
      w.querySelector('.wp-done').disabled = !ok;
    }
    c.rev = null;
  }
  /* finals and breaks show their colour while the pointer is on their label or days */
  function reveal(c, r) {
    const w = c.el;
    w.querySelectorAll('.wp-ev[data-wp-ev]').forEach(x => x.classList.toggle('on', !!r && x.dataset.wpEv === r.join('|')));
    w.querySelectorAll('.wp-d[data-wp-d]').forEach(c => {
      const d = c.dataset.wpD, inr = !!r && d >= r[0] && d <= r[1];
      c.classList.toggle('on-ex', inr && c.classList.contains('ex')); c.classList.toggle('on-bk', inr && c.classList.contains('bk'));
    });
  }

  const stuck = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  function place() {
    const w = cur.el, sc = cur.scrim, sheet = window.innerWidth < 640 || cur.host !== document.body;
    w.classList.toggle('sheet', sheet); sc.classList.toggle('sheet', sheet);
    if (sheet) return;
    const r = cur.anchor.getBoundingClientRect(), W = w.offsetWidth;
    const left = Math.max(12, Math.min(r.left, window.innerWidth - W - 12));
    let top = r.bottom + 10;
    if (top + w.offsetHeight > window.innerHeight - 12) top = Math.max(12, window.innerHeight - w.offsetHeight - 12);
    const fixed = stuck(cur.anchor); w.style.position = fixed ? 'fixed' : 'absolute';
    w.style.left = (left + (fixed ? 0 : window.scrollX)) + 'px'; w.style.top = (top + (fixed ? 0 : window.scrollY)) + 'px';
  }

  function close(keep) {
    if (!cur) return;
    const c = cur; cur = null;
    if (keep && c.s && c.e && nights(c.s, c.e) > 0 && (c.s !== c.s0 || c.e !== c.e0)) c.onDone(c.s, c.e);
    c.el.classList.remove('on');
    c.anchor.setAttribute('aria-expanded', 'false');
    window.removeEventListener('resize', c.onResize);
    document.removeEventListener('scroll', c.onScroll, true);
    document.removeEventListener('keydown', c.onKey, true);
    c.scrim.remove();
    setTimeout(() => c.el.remove(), 180);
  }

  function open(opts) {
    if (cur) { const same = cur.anchor === opts.anchor; close(same ? false : true); if (same) return; } // a second click on the same field cancels, like Escape
    if (window.BudgetPicker) window.BudgetPicker.close();
    ensureStyle();
    const scrim = document.createElement('div'); scrim.className = 'wp-scrim';
    const el = document.createElement('div'); el.className = 'wp'; el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', opts.mode === 'leave' ? 'When is your place free?' : 'Choose your dates');
    el.innerHTML = `<div class="wp-b"></div><div class="wp-f"><span class="wp-sum"></span><button type="button" class="wp-done">Done</button></div>`;
    /* inside a phone preview frame the picker belongs to the frame */
    const host = opts.anchor.closest('.stage.phone') || document.body;
    host.appendChild(scrim); host.appendChild(el);
    const start = opts.start && opts.start >= TODAY ? opts.start : null;
    let v = start ? viewOf(start) : FIRST; if (mkey(v) > mkey(LAST)) v = LAST;
    cur = { el, scrim, host, anchor: opts.anchor, s: start, e: start ? opts.end : null, s0: opts.start, e0: opts.end, act: 'in', view: v, picker: false, py: v[0], rev: null, onDone: opts.onDone };
    opts.anchor.setAttribute('aria-expanded', 'true');
    draw(cur);
    /* on a desktop, scroll the page so the calendar fits under its field instead of covering it */
    const ar = opts.anchor.getBoundingClientRect(), need = ar.bottom + 10 + el.offsetHeight - (window.innerHeight - 12);
    if (host === document.body && window.innerWidth >= 640 && need > 0) window.scrollBy(0, Math.min(need, ar.top - 72));
    place(); requestAnimationFrame(() => el.classList.add('on'));
    bind(cur);
    scrim.addEventListener('click', () => close(true));
    cur.onResize = () => cur && place();
    /* the popover rides with its field while the page scrolls; once the field scrolls away or under the sticky header, it closes and keeps the choice */
    cur.onScroll = (e) => {
      if (!cur || cur.el.classList.contains('sheet')) return;
      const r = cur.anchor.getBoundingClientRect();
      let covered = r.width === 0 || r.bottom < 0 || r.top > window.innerHeight;
      if (!covered) { cur.scrim.style.pointerEvents = 'none'; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); cur.scrim.style.pointerEvents = ''; covered = !(hit && (cur.anchor.contains(hit) || cur.el.contains(hit))); }
      if (covered) close(false); else if (e.target !== document || stuck(cur.anchor)) place(); /* page scrolls carry it natively; only an inner scroller needs a re-place */
    };
    document.addEventListener('scroll', cur.onScroll, true);
    cur.onKey = ev => { if (ev.key === 'Escape' && cur) { ev.stopPropagation(); close(false); } };
    window.addEventListener('resize', cur.onResize);
    document.addEventListener('keydown', cur.onKey, true);
  }

  /* the calendar's own clicks and hovers, shared by the popover and the inline calendar; after() runs when a day was picked */
  function bind(c, after) {
    c.el.addEventListener('click', ev => {
      const t = ev.target;
      if (t.closest('[data-wp-mt]')) { c.picker = !c.picker; c.py = c.view[0]; draw(c); return; }
      const nv = t.closest('[data-wp-nav]'); if (nv && !nv.disabled) { c.view = addM(c.view, +nv.dataset.wpNav); draw(c); return; }
      const py = t.closest('[data-wp-py]'); if (py && !py.disabled) { c.py += +py.dataset.wpPy; draw(c); return; }
      const pm = t.closest('[data-wp-pm]'); if (pm && !pm.disabled) { c.view = pm.dataset.wpPm.split('-').map(Number); c.picker = false; draw(c); return; }
      const lb = t.closest('[data-wp-ev]');
      if (lb && ev.pointerType === 'touch') { const k = lb.dataset.wpEv; c.rev = c.rev === k ? null : k; reveal(c, c.rev && c.rev.split('|')); return; }
      const d = t.closest('[data-wp-d]');
      if (d && !d.disabled) {
        const v2 = d.dataset.wpD;
        if (c.act === 'in' || !c.s || v2 <= c.s) { c.s = v2; if (c.e && c.e <= v2) c.e = null; if (c.act === 'in') c.e = null; c.act = 'out'; }
        else { c.e = v2; c.act = 'in'; }
        draw(c); if (after) after(); return;
      }
      if (t.closest('.wp-done') && c === cur) close(true);
    });
    c.el.addEventListener('mouseover', ev => {
      const l = ev.target.closest('[data-wp-ev]'); let r = null;
      if (l) r = l.dataset.wpEv.split('|');
      else { const x0 = ev.target.closest('.wp-d[data-wp-d]'); if (x0) { const x = EVENTS.find(x => x[3] !== 'term' && x[1] <= x0.dataset.wpD && x[2] >= x0.dataset.wpD); if (x) r = [x[1], x[2]]; } }
      const k = r ? r.join('|') : null; if (k !== c.rev) { c.rev = k; reveal(c, r); }
    });
    c.el.addEventListener('mouseleave', () => { if (c.rev) { c.rev = null; reveal(c, null); } });
  }

  /* The same calendar laid into a page (the publish form's dates step): no scrim, no footer, the page's own
     fields show the choice. onChange(start, end, nextSide) runs after every pick; end is null until the second tap. */
  function mount(opts) {
    ensureStyle();
    const el = document.createElement('div'); el.className = 'wp inline'; el.innerHTML = '<div class="wp-b"></div>';
    opts.mount.appendChild(el);
    const start = opts.start && opts.start >= TODAY ? opts.start : null;
    let v = start ? viewOf(start) : FIRST; if (mkey(v) > mkey(LAST)) v = LAST;
    const c = { el, s: start, e: start ? opts.end : null, act: opts.act || 'in', view: v, picker: false, py: v[0], rev: null };
    draw(c);
    bind(c, () => opts.onChange && opts.onChange(c.s, c.e, c.act));
    return {
      setAct(a) { c.act = a; },
      set(s, e) { c.s = s; c.e = e; c.act = 'in'; c.view = viewOf(s); c.picker = false; draw(c); },
      destroy() { el.remove(); }
    };
  }

  window.WhenPicker = { open, mount, close: () => close(true), label: wl, ends, day, nights };
})();
