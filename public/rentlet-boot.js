/* Rentlet boot. Runs before each page's own script, so the first render already knows whether the
   visitor is signed in (from the state src/rentlet.ts cached on the last visit). Anything marked
   data-rl-signin opens Google sign-in; src/rentlet.ts sets window.Rentlet once Firebase loads. */
(function () {
  var get = function (k) { try { return localStorage.getItem(k); } catch (_) { return null; } };
  var user = null;
  try { user = JSON.parse(get('rl-user') || 'null'); } catch (_) { user = null; }
  var authed = get('cs-web-auth') === 'in' && !!user;
  if (!authed) user = null;
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); };
  var initial = user && user.name ? user.name.trim().charAt(0).toUpperCase() : 'Y';
  var unread = 0;
  try { unread = Math.max(0, parseInt(sessionStorage.getItem('rl-unread') || '0', 10) || 0); } catch (_) { unread = 0; }
  /* the messages button in every header (signed in only); src/rentlet.ts keeps the count live */
  var MSG_CSS = '.rl-msgs{position:relative;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border-radius:50%;color:#222;text-decoration:none}'
    + '.rl-msgs:hover{background:#f2f2f4}.rl-msgs svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}'
    + '.rl-msgs-n{position:absolute;top:4px;right:3px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#4E2A84;color:#fff;font:600 11px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;box-shadow:0 0 0 2px #fff;box-sizing:border-box}'
    + '.rl-msgs-n[hidden]{display:none}';
  /* the menu: one "bars + avatar" button at the right of every header; posting, the site's pages and the
     account live inside it (Airbnb style), so the header never crowds */
  var F = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  MSG_CSS += '.rl-menu{position:relative;flex:none;display:inline-flex}'
    + '.rl-mbtn{display:inline-flex!important;align-items:center;gap:10px;width:auto!important;min-width:0;height:44px;margin:0;padding:0 5px 0 13px;border:1px solid #ddd;border-radius:999px;background:#fff;color:#222;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.06);transition:box-shadow .2s;font:inherit;box-sizing:border-box}'
    + '.rl-mbtn:hover,.rl-mbtn[aria-expanded=true]{box-shadow:0 2px 10px rgba(0,0,0,.14)}'
    + '.rl-mbtn>svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;flex:none}'
    + '.rl-mav{width:32px;height:32px;border-radius:50%;background:#222;color:#fff;display:grid;place-items:center;overflow:hidden;font:700 13px/1 ' + F + ';flex:none}'
    + '.rl-mav.out{background:#717171}.rl-mav.out svg{width:20px;height:20px;fill:#fff;stroke:none}'
    + '.rl-mlist{position:absolute;right:0;top:calc(100% + 8px);z-index:70;width:248px;max-width:calc(100vw - 32px);padding:8px;background:#fff;border-radius:16px;box-shadow:0 0 0 1px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.16);text-align:left;box-sizing:border-box}'
    + '.rl-mlist[hidden],.rl-mlist a[hidden],.rl-mlist hr[hidden]{display:none}'
    + '.rl-mlist a,.rl-mlist button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%!important;min-height:44px;margin:0;padding:0 14px;border:0;border-radius:10px;background:none;font:500 15px/1.3 ' + F + ';color:#222;text-decoration:none;text-align:left;cursor:pointer;box-sizing:border-box;white-space:nowrap}'
    + '.rl-mlist .rl-b{font-weight:650}'
    + '.rl-mlist a:hover,.rl-mlist button:hover,.rl-mlist a:focus-visible,.rl-mlist button:focus-visible{background:#f2f2f4;outline:none}'
    + '.rl-mlist a[aria-current=page]{text-decoration:underline;text-underline-offset:4px}'
    + '.rl-mlist hr{border:0;border-top:1px solid #ebebeb;margin:6px 8px}'
    + '.rl-mlist .rl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
    + '.rl-mlist .rl-msgs-n,.rl-mlist .rl-n{position:static;box-shadow:none;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#4E2A84;color:#fff;font:600 12px/20px ' + F + ';text-align:center;box-sizing:border-box}'
    + '.rl-top{display:inline-flex;align-items:center;height:44px;padding:0 14px;border-radius:999px;font:600 14px/1 ' + F + ';color:#222;text-decoration:none;white-space:nowrap;flex:none;box-sizing:border-box}'
    + '.rl-top:hover{background:#f2f2f4}.rl-top[aria-current=page]{text-decoration:underline;text-underline-offset:6px}'
    + '.rl-top.rl-post{border:1px solid #ddd;background:#fff;margin:0 6px 0 2px}.rl-top.rl-post:hover{border-color:#222;background:#fff}'
    + '.rl-msgs[aria-current=page]{background:#f2f2f4}.rl-saved[aria-current=page] svg{fill:currentColor}'
    + '@media (max-width:900px){.rl-top{display:none!important}}'
    + '@media (max-width:399px){.rl-saved{display:none!important}}';
  /* Send feedback: a glass dialog, a sheet from the bottom on phones */
  var FB_BTN = 'display:inline-flex;align-items:center;justify-content:center;min-width:0;margin:0;cursor:pointer;box-sizing:border-box;flex:none;';
  MSG_CSS += '.rl-fb-lock,.rl-fb-lock body{overflow:hidden}'
    + '.rl-fb-dim{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(20,16,30,.32);box-sizing:border-box;animation:rl-fb-in .2s ease both}'
    + '.rl-fb{position:relative;width:480px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;padding:26px;border-radius:28px;background:rgba(255,255,255,.9);-webkit-backdrop-filter:blur(26px) saturate(1.6);backdrop-filter:blur(26px) saturate(1.6);border:1px solid rgba(255,255,255,.8);box-shadow:inset 0 1px 0 #fff,0 28px 60px -18px rgba(20,16,40,.42);box-sizing:border-box;font:400 15px/1.4 ' + F + ';color:#222;text-align:left;animation:rl-fb-rise .32s cubic-bezier(.22,1,.36,1) both}'
    + '.rl-fb-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px}'
    + '.rl-fb h2{margin:0;font:500 26px/1.15 "Newsreader",Georgia,serif;letter-spacing:-.3px;color:#222}'
    + '.rl-fb-x{' + FB_BTN + 'width:44px!important;height:44px;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.05);font:400 22px/1 ' + F + ';color:#222}'
    + '.rl-fb-x:hover{background:rgba(0,0,0,.09)}'
    + '.rl-fb form{display:grid;gap:12px;margin:0}'
    + '.rl-fb-t{display:flex;gap:8px;flex-wrap:wrap}'
    + '.rl-fb-c{' + FB_BTN + 'width:auto!important;height:44px;padding:0 16px;border:1px solid #ddd;border-radius:999px;background:#fff;font:600 14px/1 ' + F + ';color:#222;white-space:nowrap}'
    + '.rl-fb-c:hover{border-color:#222}.rl-fb-c[aria-checked=true]{background:#222;border-color:#222;color:#fff}'
    + '.rl-fb-fd{display:block;width:100%!important;margin:0;padding:13px 14px;border:1px solid #ddd;border-radius:16px;background:#fff;font:400 16px/1.4 ' + F + ';color:#222;box-sizing:border-box;-webkit-appearance:none;appearance:none}'
    + 'textarea.rl-fb-fd{height:124px;resize:none}'
    + '.rl-fb-fd::placeholder{color:#717171;opacity:1}'
    + '.rl-fb-fd:focus{outline:none;border-color:#222;box-shadow:inset 0 0 0 1px #222}'
    + '.rl-fb button:focus-visible{outline:2px solid #222;outline-offset:2px}'
    + '.rl-fb-e{margin:0;font-size:13px;line-height:1.4;color:#b42318}.rl-fb-e[hidden]{display:none}'
    + '.rl-fb-f{display:flex;align-items:center;justify-content:space-between;gap:12px}'
    + '.rl-fb-f small{min-width:0;font-size:13px;line-height:1.35;color:#6a6a6a}'
    + '.rl-fb-s{' + FB_BTN + 'width:auto!important;height:48px;padding:0 24px;border:0;border-radius:999px;background:#222;color:#fff;font:650 15px/1 ' + F + ';white-space:nowrap}'
    + '.rl-fb-s:hover{background:#000}.rl-fb-s:disabled{opacity:.6;cursor:default}'
    + '.rl-fb-ok{margin:0 0 18px;font-size:16px;line-height:1.5}'
    + '.rl-fb .rl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
    + '@keyframes rl-fb-in{from{background-color:rgba(20,16,30,0)}}' /* the colour, not opacity: fading the scrim would stop the card blurring the page */
    + '@keyframes rl-fb-rise{from{opacity:0;transform:translateY(14px) scale(.98)}}'
    + '@keyframes rl-fb-sheet{from{transform:translateY(100%)}}'
    + '@media (max-width:600px){.rl-fb-dim{align-items:flex-end;padding:0}.rl-fb{width:100%;max-height:92vh;border-width:1px 0 0;border-radius:28px 28px 0 0;padding:22px 16px calc(18px + env(safe-area-inset-bottom));animation-name:rl-fb-sheet}}'
    + '@media (prefers-reduced-motion:reduce){.rl-fb-dim,.rl-fb{animation:none}}';
  try { var st = document.createElement('style'); st.id = 'rl-msgs-css'; st.textContent = MSG_CSS; document.head.appendChild(st); } catch (_) {}
  var BARS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0z"/></svg>';
  /* which page this is ('index' for /), so its own item is marked in the menu */
  var here = (location.pathname.replace(/\/+$/, '').split('/').pop() || 'index').replace(/\.html$/, '');
  /* saved rooms and requests ('room:<code>', 'request:<id>'), cached by src/rentlet.ts, which keeps RL.saved live */
  var saved = {};
  try { (JSON.parse(sessionStorage.getItem('rl-saved') || '[]') || []).forEach(function (k) { saved[k] = 1; }); } catch (_) { saved = {}; }
  var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z"/></svg>';
  var MSG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h-1A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5z"/></svg>';

  var verified = false, admin = false;
  try { admin = authed && sessionStorage.getItem('rl-admin') === '1'; } catch (_) { admin = false; }
  try { verified = authed && sessionStorage.getItem('rl-verified') === '1'; } catch (_) { verified = false; }

  window.RL = {
    authed: authed,
    verified: verified,
    admin: admin,
    user: user,
    initial: initial,
    unread: unread,
    saved: saved,
    /* whether a heart starts filled: kind is 'room' (8-digit listing code) or 'request' (request id) */
    isSaved: function (kind, id) { return !!(window.RL.authed && window.RL.saved[kind + ':' + id]); },
    msgs: function (current) {
      /* Requests and Post a listing stay in sight in every header (Founder, Nov 4); the forms leave them out.
         Below 900px they live only in the menu. */
      var top = here === 'post' || here === 'request' ? ''
        : '<a class="rl-top rl-all" href="/?rooms=1">All rooms</a>'
          + '<a class="rl-top" href="requests.html"' + (here === 'requests' ? ' aria-current="page"' : '') + '>Requests</a>'
          + '<a class="rl-top rl-post" href="post.html">Post a listing</a>';
      if (!window.RL.authed) return top;
      var n = window.RL.unread || 0;
      /* Saved (heart) sits just before Messages */
      return top + '<a class="rl-msgs rl-saved" href="saved.html" aria-label="Saved"' + (here === 'saved' ? ' aria-current="page"' : '') + '>' + HEART + '</a>'
        + '<a class="rl-msgs" href="messages.html" data-rl-msgs aria-label="' + (n ? 'Messages, ' + n + ' unread' : 'Messages') + '"' + (current ? ' aria-current="page"' : '') + '>'
        + MSG_ICON + '<span class="rl-msgs-n"' + (n ? '' : ' hidden') + '>' + (n > 9 ? '9+' : n) + '</span></a>';
    },
    /* the menu button and its list, for the right end of every header (after RL.msgs()).
       opts.requests: a count shown beside Requests (matches for your listing). */
    menu: function (opts) {
      opts = opts || {};
      var R = window.RL;
      var link = function (href, text, cls, extra) {
        var cur = href.indexOf('#') < 0 && href.replace(/\.html$/, '') === here;
        return '<a href="' + href + '"' + (cls ? ' class="' + cls + '"' : '') + (cur ? ' aria-current="page"' : '') + '><span>' + text + '</span>' + (extra || '') + '</a>';
      };
      var n = R.unread || 0;
      var req = opts.requests ? '<span class="rl-n">' + esc(opts.requests) + '<span class="rl-sr"> ' + (opts.requests == 1 ? 'match' : 'matches') + ' for your listing</span></span>' : '';
      var pages = link('/?rooms=1', 'All rooms') + link('requests.html', 'Requests', '', req) + link('shuttle.html', 'Shuttle')
        + '<button type="button" data-rl-feedback>Send feedback</button>';
      var items = R.authed
        ? link('post.html', 'Post a listing', 'rl-b') + link('request.html', 'Post a request', 'rl-b') + '<hr>'
          + '<a href="messages.html" data-rl-msgs' + (here === 'messages' ? ' aria-current="page"' : '') + '><span>Messages</span><span class="rl-msgs-n"' + (n ? '' : ' hidden') + '>' + (n > 9 ? '9+' : n) + '</span></a>'
          + link('saved.html', 'Saved') + '<hr>' + pages + '<hr>'
          + link('verification.html', 'Verification') + link('profile.html', 'Profile') + '<button type="button" data-rl-signout>Sign out</button>'
        : '<button type="button" class="rl-b" data-rl-signin>Sign in</button><hr>'
          + link('post.html', 'Post a listing') + link('request.html', 'Post a request') + '<hr>' + pages;
      var av = R.authed ? '<span class="rl-mav">' + R.me() + '</span>' : '<span class="rl-mav out">' + PERSON + '</span>';
      return '<div class="rl-menu"><button type="button" class="rl-mbtn" data-rl-menu aria-expanded="false" aria-controls="rl-mlist" aria-label="' + (R.authed ? 'Menu and your account' : 'Menu') + '">'
        + BARS + av + '</button><nav class="rl-mlist" id="rl-mlist" aria-label="Menu" hidden>' + items + '</nav></div>';
    },
    /* inside the round account button: the Google photo when there is one, else the first initial */
    me: function () {
      /* read the live user, so a sign-in on this page shows the right face without a reload */
      var u = window.RL.authed ? window.RL.user : null;
      var first = u && u.name ? String(u.name).trim().charAt(0).toUpperCase() : 'Y';
      return u && u.photo
        ? '<img src="' + esc(u.photo) + '" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">'
        : esc(first);
    },
    signIn: function () {
      if (window.Rentlet) return window.Rentlet.signIn();
      return new Promise(function (resolve) {
        addEventListener('rentlet:ready', function () { resolve(window.Rentlet.signIn()); }, { once: true });
      });
    },
    signOut: function () { return window.Rentlet ? window.Rentlet.signOut() : Promise.resolve(); },
  };

  /* every heart: data-rl-save="room:<code>" or "request:<id>". The click never reaches the card under it;
     src/rentlet.ts signs the visitor in when needed, saves or removes, and repaints every heart. */
  document.addEventListener('click', function (e) {
    var h = e.target && e.target.closest && e.target.closest('[data-rl-save]');
    if (!h) return;
    e.preventDefault();
    e.stopPropagation();
    var v = h.getAttribute('data-rl-save') || '', i = v.indexOf(':');
    var go = function () { window.Rentlet.toggleSave(v.slice(0, i), v.slice(i + 1)); };
    if (window.Rentlet) go(); else addEventListener('rentlet:ready', go, { once: true });
  }, true);

  /* a link already in plain sight in the header is left out of the menu, so nothing shows twice. This is worked
     out when the menu opens, because it varies: phones and the room page show fewer links up top, and the post
     forms none. A separator goes when there is nothing on one side of it. */
  var skipRepeats = function (b, list) {
    var box = b.parentNode.parentNode, shown = {};
    box.querySelectorAll('a.rl-top,a.rl-msgs').forEach(function (a) {
      if (a.getClientRects().length) shown[a.getAttribute('href')] = 1;
    });
    list.querySelectorAll('a[href]').forEach(function (a) { a.hidden = !!shown[a.getAttribute('href')]; });
    var last = null;
    Array.prototype.forEach.call(list.children, function (el) {
      if (el.tagName === 'HR') { el.hidden = !last || last.tagName === 'HR'; if (!el.hidden) last = el; }
      else if (!el.hidden) last = el;
    });
    if (last && last.tagName === 'HR') last.hidden = true;
  };
  /* the menu: opens and closes on its button, closes on a click outside, Escape, or Tab out of it */
  var closeMenus = function (except) {
    document.querySelectorAll('[data-rl-menu][aria-expanded="true"]').forEach(function (b) {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false');
      var l = b.parentNode.querySelector('.rl-mlist');
      if (l) l.hidden = true;
    });
  };
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var b = t.closest('[data-rl-menu]');
    if (b) {
      e.preventDefault();
      e.stopPropagation();
      var open = b.getAttribute('aria-expanded') !== 'true';
      closeMenus(b);
      /* pages close their own open panels (search cards, pickers) when the menu opens */
      if (open) dispatchEvent(new Event('rentlet:menu'));
      b.setAttribute('aria-expanded', String(open));
      var l = b.parentNode.querySelector('.rl-mlist');
      if (l && open) skipRepeats(b, l);
      if (l) {
        l.hidden = !open;
        var first = l.querySelector('a:not([hidden]),button');
        if (open && first && e.detail === 0) first.focus(); /* opened from the keyboard */
      }
      return;
    }
    if (t.closest('[data-rl-signout]')) {
      e.preventDefault();
      closeMenus();
      window.RL.signOut();
      return;
    }
    /* choosing anything in the menu closes it (Sign in, a link to this same page); a click outside does too */
    if (t.closest('.rl-mlist a, .rl-mlist button') || !t.closest('.rl-mlist')) closeMenus();
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var b = document.querySelector('[data-rl-menu][aria-expanded="true"]');
    if (!b) return;
    e.stopPropagation();
    closeMenus();
    b.focus();
  }, true);
  document.addEventListener('focusout', function (e) {
    var m = e.target && e.target.closest && e.target.closest('.rl-menu');
    if (m && e.relatedTarget && !m.contains(e.relatedTarget)) closeMenus();
  });

  /* Send feedback, from the footers and the menu ([data-rl-feedback]). src/rentlet.ts stores the note. */
  var FB_TYPES = [['bug', 'Bug'], ['idea', 'Idea'], ['other', 'Something else']];
  var fbBox = null, fbFrom = null;
  var fbKeys = function (e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFeedback(); return; }
    if (e.key !== 'Tab' || !fbBox) return;
    var els = Array.prototype.filter.call(fbBox.querySelectorAll('button,textarea,input'), function (el) {
      return !el.disabled && el.getAttribute('tabindex') !== '-1' && el.getClientRects().length;
    });
    if (!els.length) return;
    var first = els[0], last = els[els.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || !fbBox.contains(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !fbBox.contains(at))) { e.preventDefault(); first.focus(); }
  };
  function closeFeedback() {
    if (!fbBox) return;
    fbBox.remove();
    fbBox = null;
    document.documentElement.classList.remove('rl-fb-lock');
    document.removeEventListener('keydown', fbKeys, true);
    /* back to what opened it; the menu's own item is hidden again by now, so its button instead */
    var back = fbFrom && fbFrom.isConnected && fbFrom.getClientRects().length ? fbFrom : document.querySelector('[data-rl-menu]');
    fbFrom = null;
    if (back) back.focus({ preventScroll: true });
  }
  function openFeedback(from) {
    if (fbBox) return;
    fbFrom = from;
    dispatchEvent(new Event('rentlet:menu')); /* pages close their open pickers, as for the menu */
    var box = document.createElement('div');
    box.className = 'rl-fb-dim';
    box.innerHTML = '<div class="rl-fb" role="dialog" aria-modal="true" aria-labelledby="rl-fb-title">'
      + '<div class="rl-fb-h"><h2 id="rl-fb-title">Send feedback</h2><button type="button" class="rl-fb-x" data-fb-close aria-label="Close">×</button></div>'
      + '<form novalidate><div class="rl-fb-t" role="radiogroup" aria-label="Type of feedback">'
      + FB_TYPES.map(function (t, i) { return '<button type="button" class="rl-fb-c" role="radio" data-fb-type="' + t[0] + '" aria-checked="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' + t[1] + '</button>'; }).join('')
      + '</div><label class="rl-sr" for="rl-fb-text">Your feedback</label>'
      + '<textarea class="rl-fb-fd" id="rl-fb-text" maxlength="2000" placeholder="What happened, or what would make Rentlet better?"></textarea>'
      + '<label class="rl-sr" for="rl-fb-email">Email, if you’d like a reply (optional)</label>'
      + '<input class="rl-fb-fd" id="rl-fb-email" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="Email, if you’d like a reply (optional)">'
      + '<p class="rl-fb-e" role="alert" hidden></p>'
      + '<div class="rl-fb-f"><small>We’ll include the page you were on.</small><button type="submit" class="rl-fb-s">Send</button></div></form></div>';
    document.body.appendChild(box);
    fbBox = box;
    document.documentElement.classList.add('rl-fb-lock');
    document.addEventListener('keydown', fbKeys, true);
    var card = box.firstChild, form = box.querySelector('form'), text = box.querySelector('textarea'),
      email = box.querySelector('input'), err = box.querySelector('.rl-fb-e'), send = box.querySelector('.rl-fb-s'),
      types = Array.prototype.slice.call(box.querySelectorAll('[data-fb-type]')), type = FB_TYPES[0][0], sending = false;
    var pick = function (b, focus) {
      type = b.getAttribute('data-fb-type');
      types.forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); x.setAttribute('tabindex', x === b ? '0' : '-1'); });
      if (focus) b.focus();
    };
    var fail = function (msg, field) { err.textContent = msg; err.hidden = false; if (field) field.focus(); };
    box.addEventListener('click', function (e) {
      if (e.target === box) { var note = box.querySelector('textarea'); if (!note || !note.value.trim()) closeFeedback(); return; } /* a typed note is never lost to a stray click */
      if (e.target.closest('[data-fb-close]')) { closeFeedback(); return; }
      var c = e.target.closest('[data-fb-type]');
      if (c) pick(c);
    });
    box.querySelector('.rl-fb-t').addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var at = types.indexOf(document.activeElement);
      pick(types[(at + d + types.length) % types.length], true);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) return;
      var note = text.value.trim(), mail = email.value.trim();
      if (!note) return fail('Write a short note first.', text);
      if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return fail('Check the email address.', email);
      err.hidden = true;
      sending = true;
      send.disabled = true;
      send.textContent = 'Sending…';
      var go = function () {
        Promise.resolve().then(function () { return window.Rentlet.sendFeedback({ type: type, text: note, email: mail }); }).catch(function () { return false; }).then(function (ok) {
          sending = false;
          if (box !== fbBox) return; /* closed while it was on its way */
          if (ok) {
            card.innerHTML = '<div class="rl-fb-h"><h2 id="rl-fb-title">Send feedback</h2><button type="button" class="rl-fb-x" data-fb-close aria-label="Close">×</button></div>'
              + '<p class="rl-fb-ok" role="status">Thanks. Your note went to the Rentlet team.</p>'
              + '<div class="rl-fb-f" style="justify-content:flex-end"><button type="button" class="rl-fb-s" data-fb-close>Done</button></div>';
            card.querySelector('.rl-fb-s').focus();
            return;
          }
          send.disabled = false;
          send.textContent = 'Send';
          fail('Couldn’t send it. Try again.');
        });
      };
      if (window.Rentlet) go(); else addEventListener('rentlet:ready', go, { once: true });
    });
    text.focus({ preventScroll: true });
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-rl-feedback]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    closeMenus();
    openFeedback(b);
  }, true);

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-rl-signin]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    window.RL.signIn();
  }, true);
})();
