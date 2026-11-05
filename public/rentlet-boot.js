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
    + '.rl-mlist[hidden]{display:none}'
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

  window.RL = {
    authed: authed,
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
        : '<a class="rl-top" href="requests.html"' + (here === 'requests' ? ' aria-current="page"' : '') + '>Requests</a>'
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
      var pages = link('index.html', 'Find a place') + link('requests.html', 'Requests', '', req) + link('shuttle.html', 'Shuttle');
      var items = R.authed
        ? link('post.html', 'Post a listing', 'rl-b') + link('request.html', 'Post a request', 'rl-b') + '<hr>'
          + '<a href="messages.html" data-rl-msgs' + (here === 'messages' ? ' aria-current="page"' : '') + '><span>Messages</span><span class="rl-msgs-n"' + (n ? '' : ' hidden') + '>' + (n > 9 ? '9+' : n) + '</span></a>'
          + link('saved.html', 'Saved') + '<hr>' + pages + '<hr>'
          + link('profile.html', 'Your page') + '<button type="button" data-rl-signout>Sign out</button>'
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
      if (l) {
        l.hidden = !open;
        var first = l.querySelector('a,button');
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

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-rl-signin]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    window.RL.signIn();
  }, true);
})();
