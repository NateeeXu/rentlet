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
  var MSG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h-1A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5z"/></svg>';

  window.RL = {
    authed: authed,
    user: user,
    initial: initial,
    unread: unread,
    msgs: function (current) {
      if (!window.RL.authed) return '';
      var n = window.RL.unread || 0;
      return '<a class="rl-msgs" href="messages.html" data-rl-msgs aria-label="' + (n ? 'Messages, ' + n + ' unread' : 'Messages') + '"' + (current ? ' aria-current="page"' : '') + '>'
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

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-rl-signin]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    window.RL.signIn();
  }, true);
})();
