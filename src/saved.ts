// The Saved page's Firebase side (saved.html renders). It loads the signed-in person's saved rooms and
// saved requests into the page (window.RLS.update) and removes or restores them when asked
// (window.RentletSaved). The hearts on every other page go through window.Rentlet.toggleSave (src/rentlet.ts).
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getListing } from './listings';
import { todayISO } from './lib/format';
import { isNorthwesternEmail } from './lib/nu';
import {
  isListingCode,
  isRequestId,
  SavedSync,
  savedGroup,
  savedRequestCard,
  savedRequestState,
  savedRoomCard,
  sortLookups,
  type SaveKind,
  type SavedRequestCard,
  type SavedRoomCard,
} from './lib/profileData';
import * as saves from './saves';

interface SavedPage {
  update(patch: Record<string, unknown>): void;
}

type SavedApi = typeof api;

declare global {
  interface Window {
    RLS?: SavedPage;
    RentletSaved: SavedApi;
  }
}

// rooms / reqs: null while loading, 'error' when they can't be shown, else { items, gone }
const page = (patch: Record<string, unknown>) => window.RLS?.update(patch);
const errCode = (e: unknown) => (e as { code?: string })?.code ?? '';
const isNU = (u: User | null): u is User => !!u && isNorthwesternEmail(u.email) && u.emailVerified;

let uid: string | null = null;
let gen = 0; // each account gets a number, so a slow answer for an earlier one never lands
let seq = 0; // each load gets a number; only the newest one lands
// whether each tab shows cards for this account: a reload that fails for that tab keeps them
const have = { rooms: false, reqs: false };

// When something is saved or removed on another page or tab, src/rentlet.ts says so (rentlet:saves)
// and the page reloads quietly, in place; SavedSync (lib/profileData.ts) decides when, so a reload
// never brings back a card the person just removed here or drops one they just restored.
const sync = new SavedSync();

function reset() {
  gen++;
  seq++;
  sync.reset();
  have.rooms = have.reqs = false;
}

function signedOut() {
  reset();
  uid = null;
  page({ authed: false, rooms: null, reqs: null });
}

function start(u: User) {
  reset();
  uid = u.uid;
  page({ authed: true, rooms: null, reqs: null });
  load(gen);
}

async function loadRooms() {
  const list = await saves.listSaved();
  const found = await Promise.all(
    list.map(async (s): Promise<SavedRoomCard | 'gone' | 'error'> => {
      const r = await getListing(s.code);
      return r.state === 'ok' ? savedRoomCard(r.listing, s.savedAtMs) : r.state === 'error' ? 'error' : 'gone';
    }),
  );
  return sortLookups(
    list.map((s) => s.code),
    found,
  );
}

// requests/{id} is readable by everyone only while it is open (firestore.rules)
async function loadRequests() {
  const list = await saves.listSavedRequests();
  const today = todayISO();
  const found = await Promise.all(
    list.map(async (s): Promise<SavedRequestCard | 'gone' | 'error'> => {
      try {
        const snap = await getDoc(doc(db, 'requests', s.id));
        const d = snap.exists() ? snap.data() : null;
        return savedRequestState(d, null, today) === 'open' && d ? savedRequestCard(s.id, d, s.savedAtMs) : 'gone';
      } catch (e) {
        return savedRequestState(null, errCode(e) || 'unknown', today) === 'error' ? 'error' : 'gone';
      }
    }),
  );
  return sortLookups(
    list.map((s) => s.id),
    found,
  );
}

// quiet: a reload while cards are already showing (a save made elsewhere, or Try again). Its answer is
// dropped when a removal or undo made here overtook it; a tab that fails to reload keeps its cards.
async function load(my: number, quiet = false) {
  const n = ++seq;
  const mark = sync.loadStarted();
  const [r, q] = await Promise.allSettled([loadRooms(), loadRequests()]);
  if (my !== gen || n !== seq) return; // signed out, another account, or a newer load
  const rl = r.status === 'fulfilled' ? r.value : null;
  const ql = q.status === 'fulfilled' ? q.value : null;
  const rooms = savedGroup(rl);
  const reqs = savedGroup(ql);
  const ids =
    rooms === 'error' && reqs === 'error'
      ? null
      : { room: rooms !== 'error' && rl ? rl.ids : null, request: reqs !== 'error' && ql ? ql.ids : null };
  if (sync.loaded(mark, quiet, ids)) {
    const patch: Record<string, unknown> = {};
    if (rooms !== 'error') {
      patch.rooms = rooms;
      have.rooms = true;
    } else if (!have.rooms) patch.rooms = 'error';
    if (reqs !== 'error') {
      patch.reqs = reqs;
      have.reqs = true;
    } else if (!have.reqs) patch.reqs = 'error';
    if (Object.keys(patch).length) page(patch);
  }
  check();
}

function check() {
  if (uid && sync.check()) load(gen, true);
}

addEventListener('rentlet:saves', (e) => {
  const d = (e as CustomEvent<{ room?: unknown; request?: unknown }>).detail;
  const ids = (v: unknown, ok: (s: unknown) => s is string) => (Array.isArray(v) ? v.filter(ok) : []);
  sync.saved({ room: ids(d?.room, isListingCode), request: ids(d?.request, isRequestId) });
  check();
});

// A removal or undo made on this page.
async function write(kind: SaveKind, ids: string[], on: boolean, run: () => Promise<unknown>): Promise<void> {
  sync.writeStarted();
  let ok = false;
  try {
    await run();
    ok = true;
  } finally {
    sync.writeEnded(kind, ids, on, ok);
    check();
  }
}

const api = {
  // remove, undo a removal (with the original time), clear the gone ones
  unsave: (code: string) => write('room', [code], false, () => saves.unsave(code)),
  resave: (code: string, savedAtMs: number) => write('room', [code], true, () => saves.save(code, savedAtMs)),
  forgetSaves: (codes: string[]) => write('room', codes, false, () => Promise.all(codes.map((c) => saves.unsave(c)))),
  unsaveRequest: (id: string) => write('request', [id], false, () => saves.unsaveRequest(id)),
  resaveRequest: (id: string, savedAtMs: number) => write('request', [id], true, () => saves.saveRequest(id, savedAtMs)),
  forgetSavedRequests: (ids: string[]) => write('request', ids, false, () => Promise.all(ids.map((i) => saves.unsaveRequest(i)))),

  // a tab's "Try again": the tabs that failed show loading again; cards already shown stay
  reload() {
    if (!uid) return;
    const patch: Record<string, unknown> = {};
    if (!have.rooms) patch.rooms = null;
    if (!have.reqs) patch.reqs = null;
    page(patch);
    sync.retry();
    load(gen, true);
  },
};

window.RentletSaved = api;

onAuthStateChanged(auth, (u) => {
  if (isNU(u)) {
    if (u.uid !== uid) start(u);
  } else {
    signedOut(); // a non-Northwestern account is signed out by src/rentlet.ts
  }
});
