// Rentlet runtime, loaded as a module on every page. It owns Google sign-in and keeps the cached
// sign-in state (read by public/rentlet-boot.js before each page renders) in step with Firebase.
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, where, type Unsubscribe } from 'firebase/firestore';
import { auth, db } from './firebase';
import { firstName, isNorthwesternEmail } from './lib/nu';
import { badgeUnread } from './lib/chatModel';
import * as listings from './listings';
import type { ListingDoc } from './lib/listingView';

export type SaveKind = 'room' | 'request';

export interface RentletUser {
  uid: string;
  name: string;
  photo: string;
  email: string;
}

declare global {
  interface Window {
    RL: {
      authed: boolean;
      user: RentletUser | null;
      initial: string;
      me(): string;
      unread: number;
      msgs(current?: boolean): string;
      saved: Record<string, 1>;
      isSaved(kind: SaveKind, id: string): boolean;
    };
    RL_onAuth?: (user: RentletUser | null) => void;
    RL_onListings?: (list: ListingDoc[] | null) => void;
    RentletListings: typeof listings;
    Rentlet: {
      user: RentletUser | null;
      signIn(): Promise<boolean>;
      signOut(): Promise<void>;
      toast(message: string): void;
      report(listingId: string, reason: string, details: string): Promise<boolean>;
      toggleSave(kind: SaveKind, id: string): Promise<boolean | null>;
    };
  }
}

const NOT_NU = 'Rentlet needs a school Google account. Sign in with an email that ends in .edu.';

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
      'max-width:calc(100vw - 32px);padding:12px 18px;border-radius:14px;background:#222;color:#fff;font:600 14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
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

// Saved rooms (users/{uid}/saves/{code}) and saved requests (users/{uid}/savedRequests/{requestId}).
// Kept live while signed in so every heart on the page (data-rl-save="room:<code>" or "request:<id>")
// shows the right state; pages that list saved things listen for the rentlet:saves event.
const SAVE_PATH: Record<SaveKind, string> = { room: 'saves', request: 'savedRequests' };
const SAVE_ID: Record<SaveKind, RegExp> = { room: /^[1-9][0-9]{7}$/, request: /^[A-Za-z0-9]{10,64}$/ };
const savedIds: Record<SaveKind, Set<string>> = { room: new Set(), request: new Set() };
Object.keys(window.RL.saved || {}).forEach((k) => {
  const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)] as [SaveKind, string];
  if (kind in SAVE_PATH && SAVE_ID[kind].test(id)) savedIds[kind].add(id);
});
let stopSaves: Unsubscribe[] = [];

function paintSaves() {
  const keys = [...[...savedIds.room].map((id) => `room:${id}`), ...[...savedIds.request].map((id) => `request:${id}`)];
  const map: Record<string, 1> = {};
  keys.forEach((k) => (map[k] = 1));
  window.RL.saved = map;
  try {
    sessionStorage.setItem('rl-saved', JSON.stringify(keys));
  } catch {
    /* private mode */
  }
  document.querySelectorAll<HTMLElement>('[data-rl-save]').forEach((el) => {
    el.setAttribute('aria-pressed', String(!!map[el.dataset.rlSave ?? '']));
  });
  dispatchEvent(new CustomEvent('rentlet:saves', { detail: { room: [...savedIds.room], request: [...savedIds.request] } }));
}

function watchSaves(uid: string | null) {
  stopSaves.forEach((stopIt) => stopIt());
  stopSaves = [];
  if (!uid) {
    savedIds.room.clear();
    savedIds.request.clear();
    return paintSaves();
  }
  (Object.keys(SAVE_PATH) as SaveKind[]).forEach((kind) => {
    stopSaves.push(
      onSnapshot(
        collection(db, 'users', uid, SAVE_PATH[kind]),
        (snap) => {
          savedIds[kind] = new Set(snap.docs.map((d) => d.id).filter((id) => SAVE_ID[kind].test(id)));
          paintSaves();
        },
        () => undefined,
      ),
    );
  });
}

// Saves or removes; signs the visitor in first when needed. Returns whether it is saved afterwards,
// or null when nothing changed (not signed in, or the write failed and was rolled back).
async function toggleSave(kind: SaveKind, id: string): Promise<boolean | null> {
  if (!(kind in SAVE_PATH) || !SAVE_ID[kind].test(id)) {
    toast('This can’t be saved.');
    return null;
  }
  if (!auth.currentUser && !(await signIn())) return null;
  const u = auth.currentUser;
  if (!u) return null;
  const on = !savedIds[kind].has(id);
  if (on) savedIds[kind].add(id);
  else savedIds[kind].delete(id);
  paintSaves();
  const ref = doc(db, 'users', u.uid, SAVE_PATH[kind], id);
  try {
    if (on) await setDoc(ref, { savedAt: serverTimestamp() });
    else await deleteDoc(ref);
    toast(on ? (kind === 'room' ? 'Saved. Find it under the heart at the top.' : 'Request saved. Find it under the heart at the top.') : 'Removed from saved.');
    return on;
  } catch {
    if (on) savedIds[kind].delete(id);
    else savedIds[kind].add(id);
    paintSaves();
    toast('Couldn’t update your saved list. Try again.');
    return null;
  }
}

window.Rentlet = {
  user: null,
  signIn,
  // signing out also clears this browser's form drafts (they can hold a street address), for shared computers
  signOut: () => {
    for (const k of ['rl-post-draft-v3', 'rl-post-draft-v2', 'cs-request-draft']) {
      try {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      } catch {
        /* private mode */
      }
    }
    return firebaseSignOut(auth);
  },
  toast,
  report,
  toggleSave,
};

// Unread conversations for the header's messages button: the other person wrote last, after I last opened it,
// and I haven't muted, blocked or hidden it.
let stopUnread: Unsubscribe | null = null;

function showUnread(n: number) {
  try {
    sessionStorage.setItem('rl-unread', String(n));
  } catch {
    /* private mode */
  }
  window.RL.unread = n;
  document.querySelectorAll<HTMLElement>('[data-rl-msgs]').forEach((el) => {
    const badge = el.querySelector<HTMLElement>('.rl-msgs-n');
    if (badge) {
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.hidden = !n;
    }
    el.setAttribute('aria-label', n ? `Messages, ${n} unread` : 'Messages');
  });
}

function watchUnread(uid: string | null) {
  stopUnread?.();
  stopUnread = null;
  if (!uid) return showUnread(0);
  stopUnread = onSnapshot(
    query(collection(db, 'conversations'), where('participants', 'array-contains', uid)),
    (snap) => {
      // muted, blocked and hidden conversations don't count (the same check the messages page uses)
      let n = 0;
      snap.forEach((d) => {
        if (badgeUnread(d.data(), uid)) n++;
      });
      showUnread(n);
    },
    () => undefined,
  );
}

onAuthStateChanged(auth, async (u) => {
  if (u && (!isNorthwesternEmail(u.email) || !u.emailVerified)) {
    await firebaseSignOut(auth);
    return; // the sign-out fires this listener again with null
  }
  apply(u ? toUser(u) : null);
  watchUnread(u ? u.uid : null);
  watchSaves(u ? u.uid : null);
});

window.RentletListings = listings;
// pages that show listings register RL_onListings; null means the list could not load
if (typeof window.RL_onListings === 'function') {
  const show = window.RL_onListings;
  listings.subscribeActive(show, () => show(null));
}

dispatchEvent(new Event('rentlet:ready'));
