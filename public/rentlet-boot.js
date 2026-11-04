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
  try { var st = document.createElement('style'); st.id = 'rl-msgs-css'; st.textContent = MSG_CSS; document.head.appendChild(st); } catch (_) {}
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
      if (!window.RL.authed) return '';
      var n = window.RL.unread || 0;
      /* Saved (heart) sits just before Messages */
      return '<a class="rl-msgs rl-saved" href="profile.html#saved" aria-label="Saved">' + HEART + '</a>'
        + '<a class="rl-msgs" href="messages.html" data-rl-msgs aria-label="' + (n ? 'Messages, ' + n + ' unread' : 'Messages') + '"' + (current ? ' aria-current="page"' : '') + '>'
        + MSG_ICON + '<span class="rl-msgs-n"' + (n ? '' : ' hidden') + '>' + (n > 9 ? '9+' : n) + '</span></a>';
    },
    /* inside the round account button: the Google photo when there is one, else the first initial */
    me: function () {
      return user && user.photo
        ? '<img src="' + esc(user.photo) + '" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">'
        : esc(initial);
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

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-rl-signin]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    window.RL.signIn();
  }, true);
})();
