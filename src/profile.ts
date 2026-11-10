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
import { deleteObject, getDownloadURL, listAll, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { hasEnded, localDay, type ListingDoc } from './lib/listingView';
import { isLive } from './lib/requestsView';
import { canSignIn, firstName } from './lib/nu';
import {
  affiliation,
  cleanFirstName,
  contactEmailError,
  whatsappError,
  listingFilePaths,
  liveCount,
  MAX_LIVE,
  normalizeWhatsApp,
  ownStatus,
  proofFilePaths,
  requestView,
  sortOwnListings,
  validListingShape,
  validRequestShape,
} from './lib/profileData';

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
const EMPTY = { profile: null, listings: null, requests: null, contact: null, notify: null };
const RECENT_MS = 4 * 60_000; // Firebase asks for a fresh sign-in before deleting an account after about 5 minutes

let uid: string | null = null;
let gen = 0; // each load gets a number, so a slow answer for an earlier account never lands
let subs: Unsubscribe[] = [];
let mine: ListingDoc[] = [];
const requests = new Map<string, DocumentData>();
let contact = { whatsapp: '', email: '' };
let leaving = false;

const errCode = (e: unknown) => (e as { code?: string })?.code ?? '';
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const millis = (t: unknown) => (t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : 0);
const isNU = (u: User | null): u is User => canSignIn(u);

function fromDoc(id: string, data: DocumentData): ListingDoc {
  return { ...(data as ListingDoc), code: id, createdAtMs: millis(data.createdAt) };
}

// what the page's listing card needs. status is 'ended' once the last day has passed (not "Live":
// it shows nowhere), with ended set too; the stored status is kept as stored.
const ownCard = (l: ListingDoc, today: string) => ({
  code: l.code,
  status: ownStatus(l, today),
  ended: ownStatus(l, today) === 'ended',
  stored: l.status,
  title: str(l.title) || 'Your listing',
  area: str(l.area),
  start: str(l.start),
  end: str(l.end),
  price: Number(l.price) || 0,
  img: Array.isArray(l.photos) ? str(l.photos[0]) : '',
  createdAtMs: l.createdAtMs ?? 0,
  takenDown: '',
});

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
  page({ authed: false, me: null, ...EMPTY });
}

function start(u: User) {
  stop();
  const my = ++gen;
  uid = u.uid;
  mine = [];
  requests.clear();
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
        mine = s.docs.map((d) => fromDoc(d.id, d.data()));
        const today = localDay();
        const cards = sortOwnListings(mine.map((l) => ownCard(l, today)));
        page({ listings: cards });
        // the team's reason for any listing they took down (reviews/{code})
        const hidden = cards.filter((c) => c.stored === 'hidden');
        if (hidden.length)
          Promise.all(hidden.map((c) => getDoc(doc(db, 'reviews', c.code)).then((r) => [c.code, r.data()] as const, () => [c.code, undefined] as const))).then((rows) => {
            const why = new Map(rows.filter(([, r]) => r?.listing === 'hidden').map(([code, r]) => [code, str(r!.listingReason) || 'Taken down by the Rentlet team.']));
            if (why.size && mine.length) page({ listings: cards.map((c) => (why.has(c.code) ? { ...c, takenDown: why.get(c.code)! } : c)) });
          });
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
  loadNotify(my, u.uid);
}

async function loadContact(my: number, id: string) {
  try {
    const d = (await getDoc(doc(db, 'users', id, 'private', 'contact'))).data() ?? {};
    if (my !== gen) return;
    contact = { whatsapp: str(d.whatsapp), email: str(d.email) };
    page({ contact: { ...contact } });
  } catch {
    if (my === gen) page({ contact: 'error' });
  }
}

// Email about new messages is on unless it was turned off.
async function loadNotify(my: number, id: string) {
  try {
    const d = (await getDoc(doc(db, 'users', id, 'private', 'notifications'))).data() ?? {};
    if (my === gen) page({ notify: { email: d.emailMessages !== false } });
  } catch {
    if (my === gen) page({ notify: 'error' });
  }
}

function need(): User {
  const u = auth.currentUser;
  if (!isNU(u)) throw new ProfileError('Sign in again to make changes.');
  return u;
}

// files in one of the person's folders (only those whose name starts with namePrefix, if given)
export const isUploadedPhoto = (url: string): boolean => url.includes('/o/avatars%2F');

// The middle square of the photo, at most 512 pixels, as a JPEG (the browser applies the photo's rotation).
async function squarePhoto(file: File, size = 512): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new ProfileError('Use a JPEG, PNG or WebP photo.');
  }
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = Math.min(size, side);
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new ProfileError('Use a JPEG, PNG or WebP photo.'))), 'image/jpeg', 0.88));
}

// Sets the photo on the profile (and on an open request, which keeps its own copy), removes the old uploaded file,
// and updates the header everywhere through the cached user.
async function usePhoto(u: User, url: string): Promise<string> {
  const had = (await getDoc(doc(db, 'users', u.uid))).data() ?? {};
  const before = had.photoURL;
  await setDoc(doc(db, 'users', u.uid), { photoURL: url, updatedAt: serverTimestamp() }, { merge: true });
  updateDoc(doc(db, 'requests', u.uid), { photo: url }).catch(() => undefined);
  if (typeof before === 'string' && before !== url && isUploadedPhoto(before)) deleteObject(ref(storage, before)).catch(() => undefined);
  if (window.RL?.user) {
    window.RL.user = { ...window.RL.user, photo: url };
    try {
      localStorage.setItem('rl-user', JSON.stringify(window.RL.user));
    } catch {
      /* private mode */
    }
  }
  page({ profile: { name: str(had.name), photo: url } });
  return url;
}

async function sweep(folder: string, namePrefix = '') {
  const res = await listAll(ref(storage, folder));
  await Promise.allSettled(res.items.filter((i) => i.name.startsWith(namePrefix)).map((i) => deleteObject(i)));
}

// A listing's private notes (street address, lease-proof note), then the listing, then its photos, video
// and lease-proof files. The private notes go first: their rule looks up the listing to check who owns
// it, so once the listing is gone nobody could delete them. The proof note is read before it goes, for
// the names of its files; a proof upload whose note never saved is found by its name in the folder.
async function removeListing(l: ListingDoc, owner: string) {
  const priv = await getDocs(collection(db, 'listings', l.code, 'private'));
  const proof = proofFilePaths(l.code, owner, priv.docs.find((d) => d.id === 'proof')?.data());
  const ids = new Set(['location', 'proof', ...priv.docs.map((d) => d.id)]);
  await Promise.all([...ids].map((id) => deleteDoc(doc(db, 'listings', l.code, 'private', id))));
  await deleteDoc(doc(db, 'listings', l.code));
  await Promise.allSettled([...listingFilePaths(l, owner), ...proof].map((p) => deleteObject(ref(storage, p))));
  await sweep(`proofs/${owner}`, `${l.code}-`).catch(() => undefined);
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
  await deleteDoc(doc(db, 'verifications', owner)).catch(() => undefined);
  // and anything left from uploads that never became a listing, lease proofs included
  await Promise.allSettled([sweep(`listings/${owner}`), sweep(`videos/${owner}`), sweep(`proofs/${owner}`), sweep(`avatars/${owner}`)]);
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
    // an ended listing shows nowhere, so it can't go live again; it needs new dates
    if (status === 'active' && hasEnded(l.end))
      throw new ProfileError('This listing’s dates have passed. Post it again with new dates.');
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
    // a request whose move-in day has passed shows nowhere, so it must not block opening another
    if (status === 'open' && [...requests].some(([k, r]) => k !== id && r.status === 'open' && isLive(r as { start: string }, localDay())))
      throw new ProfileError('One request at a time. Pause your live request first.');
    if (!validRequestShape({ ...d, status })) throw new ProfileError('This request can’t be changed here. Delete it and post a new one.');
    await updateDoc(doc(db, 'requests', id), { status, updatedAt: serverTimestamp() });
  },

  async deleteRequest(id: string): Promise<void> {
    need();
    await deleteDoc(doc(db, 'requests', id));
  },

  // '' when both fields can be saved
  checkContact(whatsapp: string, email: string): string {
    return whatsappError(normalizeWhatsApp(whatsapp)) || contactEmailError(email.trim());
  },

  async saveContact(whatsappRaw: string, emailRaw: string): Promise<{ whatsapp: string; email: string; changed: boolean }> {
    const u = need();
    const next = { whatsapp: normalizeWhatsApp(whatsappRaw), email: emailRaw.trim() };
    const bad = whatsappError(next.whatsapp) || contactEmailError(next.email);
    if (bad) throw new ProfileError(bad);
    if (next.whatsapp === contact.whatsapp && next.email === contact.email) return { ...next, changed: false };
    await setDoc(doc(db, 'users', u.uid, 'private', 'contact'), next);
    contact = next;
    return { ...next, changed: true };
  },

  // A photo of your own in place of the Google one: cropped square and shrunk in the browser, then stored under
  // avatars/{uid}/ (storage.rules) and set as users/{uid}.photoURL, which every page shows.
  async uploadPhoto(file: File): Promise<string> {
    const u = need();
    if (file.size > 20 * 1024 * 1024) throw new ProfileError('Use a photo under 20 MB.');
    const blob = await squarePhoto(file);
    const r = ref(storage, `avatars/${u.uid}/${Date.now()}.jpg`);
    await uploadBytes(r, blob, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000' });
    return usePhoto(u, await getDownloadURL(r));
  },

  // Back to the photo from the Google account.
  async useGooglePhoto(): Promise<string> {
    const u = need();
    return usePhoto(u, u.photoURL ?? '');
  },

  async saveEmailPref(on: boolean): Promise<void> {
    const u = need();
    await setDoc(doc(db, 'users', u.uid, 'private', 'notifications'), { emailMessages: on });
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
    signedOut(); // an account without a school (.edu) email is signed out by src/rentlet.ts
  }
});
