// Rentlet runtime, loaded as a module on every page. It owns Google sign-in and keeps the cached
// sign-in state (read by public/rentlet-boot.js before each page renders) in step with Firebase.
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { firstName, isNorthwesternEmail } from './lib/nu';
import * as listings from './listings';
import type { ListingDoc } from './lib/listingView';

export interface RentletUser {
  uid: string;
  name: string;
  photo: string;
  email: string;
}

declare global {
  interface Window {
    RL: { authed: boolean; user: RentletUser | null; initial: string; me(): string };
    RL_onAuth?: (user: RentletUser | null) => void;
    RL_onListings?: (list: ListingDoc[] | null) => void;
    RentletListings: typeof listings;
    Rentlet: {
      user: RentletUser | null;
      signIn(): Promise<boolean>;
      signOut(): Promise<void>;
      toast(message: string): void;
      report(listingId: string, reason: string, details: string): Promise<boolean>;
    };
  }
}

const NOT_NU = 'Rentlet is for Northwestern. Sign in with your @u.northwestern.edu Google account.';

function cachedUid(): string | null {
  try {
    if (localStorage.getItem('cs-web-auth') !== 'in') return null;
    return (JSON.parse(localStorage.getItem('rl-user') ?? 'null') as RentletUser | null)?.uid ?? null;
  } catch {
    return null;
  }
}

function cache(u: RentletUser | null) {
  try {
    if (u) {
      localStorage.setItem('cs-web-auth', 'in');
      localStorage.setItem('rl-user', JSON.stringify(u));
    } else {
      localStorage.setItem('cs-web-auth', 'guest');
      localStorage.removeItem('rl-user');
    }
  } catch {
    /* private mode: the page still works, it just re-checks on each load */
  }
}

const toUser = (u: User): RentletUser => ({
  uid: u.uid,
  name: firstName(u.displayName),
  photo: u.photoURL ?? '',
  email: u.email ?? '',
});

// A small toast of our own, so every page can show sign-in problems the same way.
function toast(message: string) {
  let el = document.getElementById('rl-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rl-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText =
      'position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:1000;' +
      'max-width:calc(100vw - 32px);padding:12px 18px;border-radius:14px;background:#222;color:#fff;font:600 14px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.18);opacity:0;transition:opacity .2s';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = '1';
  clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => (el!.style.opacity = '0'), 4200);
}

async function saveProfile(u: User) {
  const ref = doc(db, 'users', u.uid);
  const existing = await getDoc(ref);
  // the first name comes from Google once; after that the person may change it on their page
  await setDoc(
    ref,
    {
      photoURL: u.photoURL ?? '',
      nu: true,
      updatedAt: serverTimestamp(),
      ...(existing.exists() && existing.data().name ? {} : { name: firstName(u.displayName), joinedAt: serverTimestamp() }),
    },
    { merge: true },
  );
}

// The page rendered with the cached state; when Firebase disagrees, refresh what the page shows.
// While a sign-in is still saving the profile, the refresh waits so a reload can't cut it off.
let busy = false;
let pending = false;

function notify(next: RentletUser | null) {
  if (typeof window.RL_onAuth === 'function') window.RL_onAuth(next);
  else location.reload();
}

function apply(next: RentletUser | null) {
  const before = cachedUid();
  cache(next);
  window.Rentlet.user = next;
  window.RL.authed = !!next;
  window.RL.user = next;
  if ((before ?? null) === (next?.uid ?? null)) return;
  if (busy) pending = true;
  else notify(next);
}

async function signIn(): Promise<boolean> {
  busy = true;
  try {
    return await popupSignIn();
  } finally {
    busy = false;
    if (pending) {
      pending = false;
      notify(window.Rentlet.user);
    }
  }
}

async function popupSignIn(): Promise<boolean> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const { user } = await signInWithPopup(auth, provider);
    if (!isNorthwesternEmail(user.email) || !user.emailVerified) {
      await firebaseSignOut(auth);
      toast(NOT_NU);
      return false;
    }
    await saveProfile(user);
    return true;
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return false;
    if (code === 'auth/popup-blocked') toast('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.');
    else if (code === 'auth/unauthorized-domain') toast('Sign-in isn’t set up for this web address yet.');
    else toast('Sign-in didn’t finish. Try again.');
    return false;
  }
}

// A report goes to the reports collection, which only the project owner can read (Firebase console).
async function report(listingId: string, reason: string, details: string): Promise<boolean> {
  const u = auth.currentUser;
  if (!u) return false;
  try {
    await addDoc(collection(db, 'reports'), {
      reporterId: u.uid,
      listingId: String(listingId).slice(0, 20),
      reason: String(reason).slice(0, 100),
      details: String(details).trim().slice(0, 1000),
      createdAt: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

window.Rentlet = {
  user: null,
  signIn,
  signOut: () => firebaseSignOut(auth),
  toast,
  report,
};

onAuthStateChanged(auth, async (u) => {
  if (u && (!isNorthwesternEmail(u.email) || !u.emailVerified)) {
    await firebaseSignOut(auth);
    return; // the sign-out fires this listener again with null
  }
  apply(u ? toUser(u) : null);
});

window.RentletListings = listings;
// pages that show listings register RL_onListings; null means the list could not load
if (typeof window.RL_onListings === 'function') {
  const show = window.RL_onListings;
  listings.subscribeActive(show, () => show(null));
}

dispatchEvent(new Event('rentlet:ready'));
