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

  window.RL = {
    authed: authed,
    user: user,
    initial: initial,
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
