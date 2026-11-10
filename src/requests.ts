// Requests (people looking for a place) in Firestore. Loaded as a module after src/rentlet.ts on the
// pages that show or post requests. Pages reach it three ways:
//   window.RentletRequests            publish, close, your listings, and the link helpers
//   window.RL_onRequests(rows | null) every open request, live (null when they could not load)
//   window.RL_onMine(mine | null)     your own open request and active listings, again on every sign-in
import { onAuthStateChanged, type User } from 'firebase/auth';
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
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { todayISO } from './lib/format';
import { canSignIn } from './lib/nu';
import type { ListingDoc } from './lib/listingView';
import {
  buildRequest,
  formFromRequest,
  liveRows,
  messageHref,
  pickListingFor,
  toMatchListing,
  toRow,
  type BuildError,
  type RequestDoc,
  type RequestForm,
  type RequestRow,
} from './lib/requestsView';

export class RequestError extends Error {
  constructor(public reason: BuildError | 'signin' | 'failed') {
    super(reason);
  }
}

type MatchListing = ReturnType<typeof toMatchListing>;
export interface Mine {
  uid: string;
  request: { id: string; row: RequestRow; form: ReturnType<typeof formFromRequest> } | null;
  listings: MatchListing[];
  error?: boolean;
}

const requests = collection(db, 'requests');
const ms = (t: unknown) => ((t as Timestamp | null)?.toMillis?.() ?? Date.now());

function rowOf(d: QueryDocumentSnapshot<DocumentData>): RequestRow {
  const data = d.data({ serverTimestamps: 'estimate' });
  return toRow(d.id, data as RequestDoc, ms(data.createdAt), ms(data.updatedAt));
}

async function signedInUser(): Promise<User | null> {
  await auth.authStateReady();
  const u = auth.currentUser;
  return canSignIn(u) ? u : null;
}

const myOpenQuery = (uid: string) => query(requests, where('ownerId', '==', uid), where('status', '==', 'open'));

// Who has confirmed a .edu address (verifications/{uid}), asked once per person.
const tags = new Map<string, boolean>();

// Every open request whose move-in day has not passed, newest first, kept live.
export function subscribeOpen(cb: (rows: RequestRow[]) => void, onError?: () => void): () => void {
  return onSnapshot(
    query(requests, where('status', '==', 'open')),
    (snap) => {
      const rows = liveRows(snap.docs.map(rowOf), todayISO());
      const paint = () => cb(rows.map((r) => ({ ...r, verified: tags.get(r.uid) === true })));
      paint();
      const ask = [...new Set(rows.map((r) => r.uid))].filter((id) => id && !tags.has(id));
      if (ask.length) {
        Promise.all(ask.map((id) => getDoc(doc(db, 'verifications', id)).then((v) => tags.set(id, v.exists()), () => tags.set(id, false)))).then(paint);
      }
    },
    () => onError?.(),
  );
}

// Your open request (one at a time), or null.
export async function myRequest(): Promise<Mine['request']> {
  const u = await signedInUser();
  if (!u) return null;
  const snap = await getDocs(myOpenQuery(u.uid));
  const newest = snap.docs.sort((a, b) => ms(b.data().createdAt) - ms(a.data().createdAt))[0];
  if (!newest) return null;
  const data = newest.data() as RequestDoc;
  return { id: newest.id, row: rowOf(newest), form: formFromRequest(data) };
}

// Your active listings, newest first, in the shape the requests page matches against.
export async function myListings(): Promise<MatchListing[]> {
  const u = await signedInUser();
  if (!u) return [];
  const snap = await getDocs(
    query(collection(db, 'listings'), where('ownerId', '==', u.uid), where('status', '==', 'active')),
  );
  return snap.docs
    .map((d) => toMatchListing({ ...(d.data() as ListingDoc), code: d.id, createdAtMs: ms(d.data().createdAt) }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

// One publish at a time: a double-tap must not run the replace below twice.
let publishing = false;

// Posts the request. One request per person: it lives at requests/{your uid}, so posting again
// replaces the one you have up. (Found with a query: the rules refuse a get on a missing request.)
export async function publishRequest(form: RequestForm): Promise<{ id: string; replaced: boolean }> {
  if (publishing) throw new RequestError('failed');
  publishing = true;
  try {
  const u = await signedInUser();
  if (!u) throw new RequestError('signin');
  const built = buildRequest(form, { uid: u.uid, photo: u.photoURL ?? '' }, todayISO());
  if (!built.ok) throw new RequestError(built.error);
  try {
    const all = (await getDocs(query(requests, where('ownerId', '==', u.uid)))).docs;
    const own = all.find((d) => d.id === u.uid);
    const others = all.filter((d) => d.id !== u.uid && d.data().status === 'open');
    let replaced = others.length > 0;
    if (own && own.data().status === 'open') {
      await setDoc(own.ref, { ...built.doc, createdAt: own.data().createdAt, updatedAt: serverTimestamp() });
      replaced = true;
    } else {
      if (own) await deleteDoc(own.ref); // a closed one: post afresh, with a new posted date
      await setDoc(doc(requests, u.uid), { ...built.doc, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    // one at a time, also for any open request saved under another id
    for (const x of others) await updateDoc(x.ref, { status: 'closed', updatedAt: serverTimestamp() });
    return { id: u.uid, replaced };
  } catch {
    throw new RequestError('failed');
  }
  } finally {
    publishing = false;
  }
}

// Takes your request down (found a place, or no longer looking).
export async function closeRequest(id: string): Promise<void> {
  const u = await signedInUser();
  if (!u) throw new RequestError('signin');
  try {
    await updateDoc(doc(db, 'requests', id), { status: 'closed', updatedAt: serverTimestamp() });
  } catch {
    throw new RequestError('failed');
  }
}

export async function loadMine(): Promise<Mine | null> {
  const u = await signedInUser();
  if (!u) return null;
  const [request, listings] = await Promise.all([myRequest(), myListings()]);
  return { uid: u.uid, request, listings };
}

const api = {
  subscribeOpen,
  myRequest,
  myListings,
  loadMine,
  publishRequest,
  closeRequest,
  refreshMine,
  pickListingFor,
  messageHref,
};

declare global {
  interface Window {
    RentletRequests: typeof api;
    RL_onRequests?: (rows: RequestRow[] | null) => void;
    RL_onMine?: (mine: Mine | null) => void;
  }
}

// Calls the page's RL_onMine with fresh data; the last call wins if two overlap.
let ticket = 0;
async function refreshMine(): Promise<void> {
  const hook = window.RL_onMine;
  if (typeof hook !== 'function') return;
  const t = ++ticket;
  let mine: Mine | null = null;
  try {
    mine = await loadMine();
  } catch {
    // signed in but the lookups failed: say so rather than show "no listing"
    const u = auth.currentUser;
    mine = u ? { uid: u.uid, request: null, listings: [], error: true } : null;
  }
  if (t === ticket) hook(mine);
}

window.RentletRequests = api;

if (typeof window.RL_onRequests === 'function') {
  const show = window.RL_onRequests;
  subscribeOpen(show, () => show(null));
}
if (typeof window.RL_onMine === 'function') {
  let last: string | null | undefined;
  onAuthStateChanged(auth, (u) => {
    const uid = u && canSignIn(u) ? u.uid : null;
    if (uid === last) return;
    last = uid;
    void refreshMine();
  });
}
