// The profile page's Firebase side. profile.html renders; this module loads the signed-in person's
// own data into it (window.RLP.update) and carries out what they ask (window.RentletProfile).
import { deleteUser, GoogleAuthProvider, onAuthStateChanged, reauthenticateWithPopup, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { deleteObject, listAll, ref } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { getListing } from './listings';
import { todayISO } from './lib/format';
import type { ListingDoc } from './lib/listingView';
import { firstName, isNorthwesternEmail } from './lib/nu';
import {
  affiliation,
  cleanFirstName,
  contactEmailError,
  instagramError,
  isListingCode,
  isRequestId,
  listingFilePaths,
  liveCount,
  MAX_LIVE,
  normalizeInstagram,
  requestView,
  SavedSync,
  savedRequestCard,
  savedRequestState,
  sortOwnListings,
  validListingShape,
  validRequestShape,
  type SavedRequestCard,
  type SaveKind,
} from './lib/profileData';
import * as saves from './saves';

// The message is shown to the person as is; an empty message means they cancelled.
class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

interface ProfilePage {
  update(patch: Record<string, unknown>): void;
}

type ProfileApi = typeof api;

declare global {
  interface Window {
    RLP?: ProfilePage;
    RentletProfile: ProfileApi;
  }
}

const page = (patch: Record<string, unknown>) => window.RLP?.update(patch);
const EMPTY = { profile: null, listings: null, requests: null, saved: null, contact: null };
const RECENT_MS = 4 * 60_000; // Firebase asks for a fresh sign-in before deleting an account after about 5 minutes

let uid: string | null = null;
let gen = 0; // each load gets a number, so a slow answer for an earlier account never lands
let subs: Unsubscribe[] = [];
let mine: ListingDoc[] = [];
const requests = new Map<string, DocumentData>();
let contact = { instagram: '', email: '' };
let leaving = false;

const errCode = (e: unknown) => (e as { code?: string })?.code ?? '';
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const millis = (t: unknown) => (t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : 0);
const isNU = (u: User | null): u is User => !!u && isNorthwesternEmail(u.email) && u.emailVerified;

function fromDoc(id: string, data: DocumentData): ListingDoc {
  return { ...(data as ListingDoc), code: id, createdAtMs: millis(data.createdAt) };
}

// what the page's listing card needs
const ownCard = (l: ListingDoc) => ({
  code: l.code,
  status: l.status,
  title: str(l.title) || 'Your listing',
  area: str(l.area),
  start: str(l.start),
  end: str(l.end),
  price: Number(l.price) || 0,
  img: Array.isArray(l.photos) ? str(l.photos[0]) : '',
  createdAtMs: l.createdAtMs ?? 0,
});

const savedCard = (l: ListingDoc, savedAtMs: number) => ({
  code: l.code,
  title: str(l.title) || 'Room',
  area: str(l.area),
  start: str(l.start),
  end: str(l.end),
  price: Number(l.price) || 0,
  img: Array.isArray(l.photos) ? str(l.photos[0]) : '',
  walk: typeof l.walk === 'number' ? l.walk : null,
  campusId: str(l.campusId),
  savedAtMs,
});

// ---------- the Saved section: saved rooms and saved requests ----------
type RoomCard = ReturnType<typeof savedCard>;
interface SavedView {
  items: RoomCard[]; // rooms still listed
  gone: string[]; // saved rooms no longer listed
  reqs: SavedRequestCard[]; // requests still open
  reqGone: string[]; // saved requests no longer open
  failed: '' | 'rooms' | 'requests'; // a group whose list couldn't be read
}

// When something is saved or removed on another page or tab, src/rentlet.ts says so (rentlet:saves)
// and the section reloads quietly, in place; SavedSync (lib/profileData.ts) decides when, so a reload
// never brings back a card the person just removed here or drops one they just restored.
const sync = new SavedSync();
let savedSeq = 0; // each Saved load gets a number; only the newest one lands

function resetSaved() {
  savedSeq++;
  sync.reset();
}

function stop() {
  subs.forEach((u) => u());
  subs = [];
}

function signedOut() {
  stop();
  gen++;
  uid = null;
  mine = [];
  requests.clear();
  resetSaved();
  page({ authed: false, me: null, ...EMPTY });
}

function start(u: User) {
  stop();
  const my = ++gen;
  uid = u.uid;
  mine = [];
  requests.clear();
  resetSaved();
  const role = affiliation(u.email);
  page({ authed: true, me: { uid: u.uid, name: firstName(u.displayName), photo: u.photoURL ?? '', email: u.email ?? '', role }, ...EMPTY });

  subs.push(
    onSnapshot(
      doc(db, 'users', u.uid),
      (s) => {
        const d = s.data() ?? {};
        page({ profile: { name: str(d.name), photo: str(d.photoURL) } });
      },
      () => page({ profile: 'error' }),
    ),
    onSnapshot(
      query(collection(db, 'listings'), where('ownerId', '==', u.uid)),
      (s) => {
        mine = sortOwnListings(s.docs.map((d) => fromDoc(d.id, d.data())));
        page({ listings: mine.map(ownCard) });
      },
      () => page({ listings: 'error' }),
    ),
    onSnapshot(
      query(collection(db, 'requests'), where('ownerId', '==', u.uid)),
      (s) => {
        requests.clear();
        s.docs.forEach((d) => requests.set(d.id, d.data()));
        const list = s.docs
          .map((d) => ({ at: millis(d.get('createdAt')), v: requestView(d.id, d.data(), '', role) }))
          .sort((a, b) => Number(b.v.open) - Number(a.v.open) || b.at - a.at)
          .map((x) => x.v);
        page({ requests: list });
      },
      () => page({ requests: 'error' }),
    ),
  );
  loadContact(my, u.uid);
  loadSaved(my);
}

async function loadContact(my: number, id: string) {
  try {
    const d = (await getDoc(doc(db, 'users', id, 'private', 'contact'))).data() ?? {};
    if (my !== gen) return;
    contact = { instagram: str(d.instagram), email: str(d.email) };
    page({ contact: { ...contact } });
  } catch {
    if (my === gen) page({ contact: 'error' });
  }
}

async function loadSavedRooms() {
  const list = await saves.listSaved();
  const found = await Promise.all(list.map((s) => getListing(s.code)));
  const items: RoomCard[] = [];
  const gone: string[] = [];
  let failed = 0;
  found.forEach((r, i) => {
    if (r.state === 'ok') items.push(savedCard(r.listing, list[i].savedAtMs));
    else if (r.state === 'error') failed++;
    else gone.push(list[i].code);
  });
  return { ids: list.map((s) => s.code), items, gone, failed };
}

// requests/{id} is readable by everyone only while it is open (firestore.rules)
async function loadSavedRequests() {
  const list = await saves.listSavedRequests();
  const today = todayISO();
  const found = await Promise.all(
    list.map(async (s) => {
      try {
        const snap = await getDoc(doc(db, 'requests', s.id));
        const d = snap.exists() ? snap.data() : null;
        const state = savedRequestState(d, null, today);
        return state === 'open' && d ? savedRequestCard(s.id, d, s.savedAtMs) : state;
      } catch (e) {
        return savedRequestState(null, errCode(e) || 'unknown', today);
      }
    }),
  );
  const reqs: SavedRequestCard[] = [];
  const gone: string[] = [];
  let failed = 0;
  found.forEach((r, i) => {
    if (typeof r === 'object') reqs.push(r);
    else if (r === 'error') failed++;
    else gone.push(list[i].id);
  });
  return { ids: list.map((s) => s.id), reqs, gone, failed };
}

// quiet: a reload while the section is already showing; it keeps what is shown until the answer is in,
// and keeps it on a failure.
async function loadSaved(my: number, quiet = false) {
  const seq = ++savedSeq;
  const mark = sync.loadStarted();
  const [rooms, reqs] = await Promise.allSettled([loadSavedRooms(), loadSavedRequests()]);
  if (my !== gen || seq !== savedSeq) return; // signed out, another account, or a newer load
  const r = rooms.status === 'fulfilled' ? rooms.value : null;
  const q = reqs.status === 'fulfilled' ? reqs.value : null;
  const empty = !r?.items.length && !r?.gone.length && !q?.reqs.length && !q?.gone.length;
  // an error only when nothing can be shown; a group that didn't load gets a note with Try again
  const failed = (!r && !q) || (empty && (!r || !q || r.failed > 0 || q.failed > 0));
  if (sync.loaded(mark, quiet, failed ? null : { room: r ? r.ids : null, request: q ? q.ids : null })) {
    if (!failed) {
      const view: SavedView = {
        items: r?.items ?? [],
        gone: r?.gone ?? [],
        reqs: q?.reqs ?? [],
        reqGone: q?.gone ?? [],
        failed: !r ? 'rooms' : !q ? 'requests' : '',
      };
      page({ saved: view });
    } else if (!quiet) page({ saved: 'error' }); // a quiet reload that fails keeps what is shown
  }
  syncSaved();
}

function syncSaved() {
  if (uid && sync.check()) loadSaved(gen, true);
}

addEventListener('rentlet:saves', (e) => {
  const d = (e as CustomEvent<{ room?: unknown; request?: unknown }>).detail;
  const ids = (v: unknown, ok: (s: unknown) => s is string) => (Array.isArray(v) ? v.filter(ok) : []);
  sync.saved({ room: ids(d?.room, isListingCode), request: ids(d?.request, isRequestId) });
  syncSaved();
});

// A removal or undo made on this page.
async function savedWrite(kind: SaveKind, ids: string[], on: boolean, run: () => Promise<unknown>): Promise<void> {
  sync.writeStarted();
  let ok = false;
  try {
    await run();
    ok = true;
  } finally {
    sync.writeEnded(kind, ids, on, ok);
    syncSaved();
  }
}

function need(): User {
  const u = auth.currentUser;
  if (!isNU(u)) throw new ProfileError('Sign in again to make changes.');
  return u;
}

// A listing, its private address, then its photos and video. The address goes first: its rule
// looks up the listing to check who owns it.
async function removeListing(l: ListingDoc, owner: string) {
  await deleteDoc(doc(db, 'listings', l.code, 'private', 'location'));
  await deleteDoc(doc(db, 'listings', l.code));
  await Promise.allSettled(listingFilePaths(l, owner).map((p) => deleteObject(ref(storage, p))));
}

// files left in the person's folders by an upload that never became a listing
async function sweep(folder: string) {
  const res = await listAll(ref(storage, folder));
  await Promise.allSettled(res.items.map((i) => deleteObject(i)));
}

async function wipe(owner: string) {
  const own = await getDocs(query(collection(db, 'listings'), where('ownerId', '==', owner)));
  for (const d of own.docs) await removeListing(fromDoc(d.id, d.data()), owner);
  const reqs = await getDocs(query(collection(db, 'requests'), where('ownerId', '==', owner)));
  await Promise.all(reqs.docs.map((d) => deleteDoc(d.ref)));
  for (const path of ['saves', 'savedRequests']) {
    const saved = await getDocs(collection(db, 'users', owner, path));
    await Promise.all(saved.docs.map((d) => deleteDoc(d.ref)));
  }
  const priv = await getDocs(collection(db, 'users', owner, 'private'));
  await Promise.all(priv.docs.map((d) => deleteDoc(d.ref)));
  await Promise.allSettled([sweep(`listings/${owner}`), sweep(`videos/${owner}`)]);
  await deleteDoc(doc(db, 'users', owner));
}

async function reauth(u: User) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account', login_hint: u.email ?? '' });
  try {
    await reauthenticateWithPopup(u, provider);
  } catch (e) {
    const c = errCode(e);
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') throw new ProfileError('');
    if (c === 'auth/user-mismatch') throw new ProfileError(`Choose ${u.email ?? 'the account you signed in with'} to confirm it’s you.`);
    if (c === 'auth/popup-blocked') throw new ProfileError('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.');
    throw new ProfileError('Google sign-in didn’t finish. Try again.');
  }
}

const signedInRecently = (u: User) => {
  const t = Date.parse(u.metadata.lastSignInTime ?? '');
  return Number.isFinite(t) && Date.now() - t < RECENT_MS;
};

function goHome() {
  location.replace('index.html');
}

const api = {
  retry() {
    const u = auth.currentUser;
    if (isNU(u)) start(u);
  },

  async saveName(raw: string): Promise<string> {
    const u = need();
    const name = cleanFirstName(raw);
    if (!name) throw new ProfileError('First name can’t be empty.');
    await setDoc(doc(db, 'users', u.uid), { name, updatedAt: serverTimestamp() }, { merge: true });
    // each listing shows its host by name, so keep them in step
    await Promise.allSettled(
      mine
        .filter((l) => l.ownerName !== name && validListingShape({ ...l, ownerName: name }))
        .map((l) => updateDoc(doc(db, 'listings', l.code), { ownerName: name, updatedAt: serverTimestamp() })),
    );
    return name;
  },

  async setListingStatus(code: string, status: ListingDoc['status']): Promise<void> {
    need();
    const l = mine.find((x) => x.code === code);
    if (!l) throw new ProfileError('That listing is no longer here.');
    if (l.status === status) return;
    if (status === 'active' && liveCount(mine) >= MAX_LIVE)
      throw new ProfileError(`Up to ${MAX_LIVE} live listings at a time. Hide one or mark it as taken first.`);
    // the rules check the whole listing on every change, not only the status
    if (!validListingShape({ ...l, status })) throw new ProfileError('This listing can’t be changed here. Delete it and post it again.');
    await updateDoc(doc(db, 'listings', code), { status, updatedAt: serverTimestamp() });
  },

  async deleteListing(code: string): Promise<void> {
    const u = need();
    const l = mine.find((x) => x.code === code);
    if (!l) return;
    await removeListing(l, u.uid);
  },

  async setRequestStatus(id: string, status: 'open' | 'closed'): Promise<void> {
    need();
    const d = requests.get(id);
    if (!d) throw new ProfileError('That request is no longer here.');
    if (status === 'open' && [...requests].some(([k, r]) => k !== id && r.status === 'open'))
      throw new ProfileError('One request at a time. Pause your live request first.');
    if (!validRequestShape({ ...d, status })) throw new ProfileError('This request can’t be changed here. Delete it and post a new one.');
    await updateDoc(doc(db, 'requests', id), { status, updatedAt: serverTimestamp() });
  },

  async deleteRequest(id: string): Promise<void> {
    need();
    await deleteDoc(doc(db, 'requests', id));
  },

  // saved rooms and requests: remove, undo a removal (with the original time), clear the gone ones
  unsave: (code: string) => savedWrite('room', [code], false, () => saves.unsave(code)),
  resave: (code: string, savedAtMs: number) => savedWrite('room', [code], true, () => saves.save(code, savedAtMs)),
  forgetSaves: (codes: string[]) => savedWrite('room', codes, false, () => Promise.all(codes.map((c) => saves.unsave(c)))),
  unsaveRequest: (id: string) => savedWrite('request', [id], false, () => saves.unsaveRequest(id)),
  resaveRequest: (id: string, savedAtMs: number) => savedWrite('request', [id], true, () => saves.saveRequest(id, savedAtMs)),
  forgetSavedRequests: (ids: string[]) =>
    savedWrite('request', ids, false, () => Promise.all(ids.map((i) => saves.unsaveRequest(i)))),
  // the Saved section's "Try again" when one group didn't load: reloads in place
  reloadSaved() {
    if (!uid) return;
    sync.retry();
    loadSaved(gen, true);
  },

  // '' when both fields can be saved
  checkContact(instagram: string, email: string): string {
    return instagramError(normalizeInstagram(instagram)) || contactEmailError(email.trim());
  },

  async saveContact(instagramRaw: string, emailRaw: string): Promise<{ instagram: string; email: string; changed: boolean }> {
    const u = need();
    const next = { instagram: normalizeInstagram(instagramRaw), email: emailRaw.trim() };
    const bad = instagramError(next.instagram) || contactEmailError(next.email);
    if (bad) throw new ProfileError(bad);
    if (next.instagram === contact.instagram && next.email === contact.email) return { ...next, changed: false };
    await setDoc(doc(db, 'users', u.uid, 'private', 'contact'), next);
    contact = next;
    return { ...next, changed: true };
  },

  // Deletes everything the person owns, then the sign-in itself. Call it straight from the tap: when
  // the last sign-in is old, Google's window opens first (before anything is deleted).
  async deleteAccount(): Promise<'done' | 'reauth'> {
    const u = need();
    if (!signedInRecently(u)) await reauth(u);
    leaving = true;
    stop();
    try {
      await wipe(u.uid);
    } catch {
      leaving = false;
      start(u);
      throw new ProfileError('Some of your data couldn’t be deleted. Your account is still here. Try again.');
    }
    try {
      await deleteUser(u);
    } catch (e) {
      if (errCode(e) === 'auth/requires-recent-login') return 'reauth';
      leaving = false;
      start(u);
      throw new ProfileError('Your data is deleted, but the account sign-in isn’t. Try again.');
    }
    goHome();
    return 'done';
  },

  // after 'reauth': sign in with Google again, then delete the account
  async finishDelete(): Promise<void> {
    const u = need();
    await reauth(u);
    await deleteUser(u);
    goHome();
  },

  cancelDelete() {
    leaving = false;
    const u = auth.currentUser;
    if (isNU(u)) start(u);
    else signedOut();
  },
};

window.RentletProfile = api;

onAuthStateChanged(auth, (u) => {
  if (leaving) return;
  if (isNU(u)) {
    if (u.uid !== uid) start(u);
  } else {
    signedOut(); // a non-Northwestern account is signed out by src/rentlet.ts
  }
});
