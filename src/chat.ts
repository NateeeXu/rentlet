// Rentlet chat: conversations and messages in Firestore. Loaded as a module on messages.html, which
// renders what this sends to window.RL_chat.update(), and on room.html, which only calls
// window.RentletChat.start() from its message sheet. Every write follows firestore.rules:
// conversations/{listingCode_guestUid} with a messages subcollection; chat photos are in Storage
// under chats/{conversationId}/{senderUid}/ (storage.rules).
import { onAuthStateChanged } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { canSignIn, firstName } from './lib/nu';
import { getListing } from './listings';
import type { ListingDoc } from './lib/listingView';
import {
  chatPhotoPath,
  cleanText,
  conversationId,
  convFromData,
  fitWithin,
  imageBody,
  isUnread,
  lastFor,
  listingBody,
  listingCard,
  ms,
  msgFromData,
  PHOTO_LIMIT,
  PHOTO_MAX_BYTES,
  PHOTO_QUALITY,
  PHOTO_TYPES,
  RECALL_MS,
  replyTo,
  SEND_LIMIT,
  textBody,
  underLimit,
  needsReveal,
  newConversation,
  otherOf,
  parseConversationId,
  profileFromData,
  requestSummary,
  rolesFor,
  SETTLE_KEYS,
  SHARE_KINDS,
  threadView,
  type Conv,
  type Msg,
  type Profile,
  type RequestSummary,
  type SettleKey,
  type ShareKind,
  type ThreadView,
} from './lib/chatModel';

interface Me {
  uid: string;
  name: string;
  photo: string;
  email: string;
}

// A photo on its way up: shown at the end of the thread until its message arrives.
export interface Upload {
  id: string;
  url: string; // a local object URL
  w: number;
  h: number;
  pct: number; // 0–1
}

export interface ChatState {
  auth: 'unknown' | 'out' | 'in';
  me: Me | null;
  list: 'loading' | 'ready' | 'error';
  threads: (ThreadView & { uploads: Upload[] })[];
}

// 'limit': too many messages in 10 seconds; 'photos': too many photos this minute.
export type SendResult = 'ok' | 'limit' | 'photos' | 'type' | 'big' | 'blocked' | 'failed';

type StartResult = { ok: true; id: string } | { ok: false; reason: 'signin' | 'own' | 'gone' | 'blocked' | 'failed' };
type Entry = { id: string } | { notice: string } | null;

declare global {
  interface Window {
    RL_chat?: { update(state: ChatState): void };
    RentletChat: typeof api;
  }
}

let me: Me | null = null;
let authState: ChatState['auth'] = 'unknown';
let listState: ChatState['list'] = 'loading';
const convs = new Map<string, Conv>();
const drafts = new Map<string, { conv: Conv; listing: ListingDoc }>();
const msgs = new Map<string, Msg[]>();
const profiles = new Map<string, Profile | null>();
let active: Set<string> | null = null;
let activeDocs: ListingDoc[] = [];
const uploads = new Map<string, Upload[]>();
const sendLog = new Map<string, number[]>(); // per conversation: when each message went out
const photoLog = new Map<string, number[]>();
const sending = new Set<string>(); // one send per conversation at a time: a double-tap must not send twice
let openId: string | null = null;
let msgSubId: string | null = null;
let unsubList: Unsubscribe | null = null;
let unsubMsgs: Unsubscribe | null = null;
const marked = new Map<string, number>();

let authResolve: () => void;
const authReady = new Promise<void>((r) => (authResolve = r));
let listResolve: () => void;
let listReady = new Promise<void>((r) => (listResolve = r));

const convRef = (id: string) => doc(db, 'conversations', id);

// ---------- what the page sees ----------

let queued = false;
function push() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const hook = window.RL_chat;
    if (!hook) return;
    const uid = me?.uid ?? '';
    const now = new Date();
    const view = (c: Conv, draft = false) =>
      threadView(c, {
        me: uid,
        msgs: msgs.get(c.id) ?? (draft ? [] : null),
        profile: profiles.get(otherOf(c, uid)) ?? null,
        activeCodes: active,
        draft,
        now,
      });
    const threads = uid
      ? [
          ...[...drafts.values()].filter((d) => !convs.has(d.conv.id)).map((d) => view(d.conv, true)),
          ...[...convs.values()].map((c) => view(c)),
        ].map((t) => ({ ...t, uploads: (uploads.get(t.id) ?? []).map((u) => ({ ...u })) }))
      : [];
    hook.update({ auth: authState, me, list: listState, threads });
  });
}

// ---------- subscriptions ----------

function stopAll() {
  unsubList?.();
  unsubMsgs?.();
  unsubList = unsubMsgs = null;
  msgSubId = null;
  convs.clear();
  drafts.clear();
  msgs.clear();
  marked.clear();
  uploads.clear();
  sendLog.clear();
  photoLog.clear();
  listState = 'loading';
  listReady = new Promise<void>((r) => (listResolve = r));
}

function watchList(uid: string) {
  unsubList = onSnapshot(
    query(collection(db, 'conversations'), where('participants', 'array-contains', uid)),
    (snap) => {
      convs.clear();
      snap.docs.forEach((d) => {
        const c = convFromData(d.id, d.data({ serverTimestamps: 'estimate' }));
        convs.set(d.id, c);
        drafts.delete(d.id);
        const other = otherOf(c, uid);
        if (!profiles.has(other)) loadProfile(other);
        reveal(c);
      });
      listState = 'ready';
      listResolve();
      watchMessages();
      push();
    },
    () => {
      listState = 'error';
      listResolve();
      push();
    },
  );
}

// Messages of the open conversation only, once it exists (a draft has none yet).
function watchMessages() {
  const id = openId && convs.has(openId) ? openId : null;
  if (id === msgSubId) return;
  unsubMsgs?.();
  unsubMsgs = null;
  msgSubId = id;
  if (!id) return;
  unsubMsgs = onSnapshot(
    query(collection(db, 'conversations', id, 'messages'), orderBy('createdAt'), limitToLast(500)),
    (snap) => {
      msgs.set(
        id,
        snap.docs.map((d) => msgFromData(d.id, d.data({ serverTimestamps: 'estimate' }))),
      );
      push();
    },
    () => {
      msgs.set(id, []);
      push();
    },
  );
}

// public profiles (users/{uid}), once per page; concurrent callers share one read
const profileReads = new Map<string, Promise<Profile | null>>();
function loadProfile(uid: string): Promise<Profile | null> {
  if (profiles.has(uid)) return Promise.resolve(profiles.get(uid) ?? null);
  let read = profileReads.get(uid);
  if (!read) {
    read = Promise.all([getDoc(doc(db, 'users', uid)), getDoc(doc(db, 'verifications', uid)).then((v) => v.exists(), () => false)])
      .then(([snap, school]) => {
        const p = profileFromData(snap.exists() ? snap.data() : null, school);
        profiles.set(uid, p);
        push();
        return p;
      })
      .catch(() => null)
      .finally(() => profileReads.delete(uid));
    profileReads.set(uid, read);
  }
  return read;
}

onAuthStateChanged(auth, (u) => {
  const ok = canSignIn(u);
  const next: Me | null = ok ? { uid: u!.uid, name: firstName(u!.displayName), photo: u!.photoURL ?? '', email: u!.email ?? '' } : null;
  const changed = (next?.uid ?? null) !== (me?.uid ?? null) || authState === 'unknown';
  me = next;
  authState = next ? 'in' : 'out';
  authResolve();
  if (!changed) return;
  if (window.RL_chat) {
    stopAll();
    if (next) watchList(next.uid);
    else {
      listState = 'ready';
      listResolve();
    }
  }
  push();
});

// ---------- writes ----------

function requireMe(): Me {
  if (!me) throw new Error('signin');
  return me;
}

async function createConversation(id: string, listing: ListingDoc, hostId: string, guestId: string, names: Record<string, string>, photos: Record<string, string>) {
  // merge: if it already exists this only refreshes the listing details and names
  await setDoc(convRef(id), { ...newConversation({ listing, hostId, guestId, names, photos }), createdAt: serverTimestamp() }, { merge: true });
}

type Body = ReturnType<typeof textBody> | ReturnType<typeof imageBody> | ReturnType<typeof listingBody>;

async function writeMessage(id: string, conv: Conv | null, body: Body, keys: SettleKey[]) {
  const m = requireMe();
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'conversations', id, 'messages')), {
    senderId: m.uid,
    ...body,
    createdAt: serverTimestamp(),
  });
  const upd: Record<string, unknown> = {
    ...lastFor(body),
    lastSender: m.uid,
    updatedAt: serverTimestamp(),
    [`read.${m.uid}`]: serverTimestamp(),
  };
  for (const k of keys) {
    if (SETTLE_KEYS.includes(k) && !conv?.notes[k]) upd[`notes.${k}`] = { s: 'wait', by: m.uid };
  }
  if (keys.includes('money') && !conv?.safetyMs) upd.safety = serverTimestamp();
  batch.update(convRef(id), upd);
  await batch.commit();
}

// The mini program's per-conversation limits, kept here in the browser: 12 messages in 10 seconds
// (every kind), and 6 photos a minute. Check and record are separate: only a message that actually
// went out may use up the quota, so a failed write does not lock the person out of trying again.
function checkAllowed(id: string, photo: boolean): 'ok' | 'limit' | 'photos' {
  const now = Date.now();
  if (!underLimit(sendLog.get(id) ?? [], now, SEND_LIMIT)) return 'limit';
  if (photo && !underLimit(photoLog.get(id) ?? [], now, PHOTO_LIMIT)) return 'photos';
  return 'ok';
}

function recordSent(id: string, photo: boolean): void {
  const now = Date.now();
  const sent = sendLog.get(id) ?? [];
  const shots = photoLog.get(id) ?? [];
  sendLog.set(id, [...sent.filter((t) => now - t < SEND_LIMIT.ms), now]);
  if (photo) photoLog.set(id, [...shots.filter((t) => now - t < PHOTO_LIMIT.ms), now]);
}

const isBlocked = (c: Conv, uid: string) => !!(c.blocked[uid] || c.blocked[otherOf(c, uid)]);

// A text message, optionally replying to one of the open thread's messages (by id).
async function send(id: string, raw: string, keys: SettleKey[] = [], replyId: string | null = null): Promise<SendResult> {
  const text = cleanText(raw);
  if (!text.trim() || !me) return 'failed';
  const draft = drafts.get(id);
  const conv = convs.get(id) ?? draft?.conv ?? null;
  if (!conv) return 'failed';
  if (isBlocked(conv, me.uid)) return 'blocked';
  const quoted = replyId ? (msgs.get(id) ?? []).find((m) => m.id === replyId && m.kind !== 'recalled') : null;
  const gate = checkAllowed(id, false);
  if (gate !== 'ok') return gate;
  if (sending.has(id)) return 'limit';
  sending.add(id);
  try {
    if (draft && !convs.has(id)) {
      await createConversation(id, draft.listing, conv.hostId, conv.guestId, conv.names, conv.photos);
    }
    await writeMessage(id, conv, textBody(text, quoted ? replyTo(quoted) : null), keys);
    recordSent(id, false);
    drafts.delete(id);
    watchMessages();
    return 'ok';
  } catch {
    return 'failed';
  } finally {
    sending.delete(id);
  }
}

// Phone photos are large: at most 1600 px on the long side, as an 82% JPEG.
async function compressPhoto(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight);
    if (!w || !h) throw new Error('empty');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#fff'; // a transparent PNG gets a white background, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', PHOTO_QUALITY));
    if (!blob) throw new Error('encode');
    return { blob, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

let uploadSeq = 0;
async function sendPhoto(id: string, file: File): Promise<SendResult> {
  if (!me) return 'failed';
  const uid = me.uid;
  const conv = convs.get(id);
  if (!conv) return 'failed'; // a draft: the first message is text
  if (isBlocked(conv, uid)) return 'blocked';
  if (!PHOTO_TYPES.includes(file.type)) return 'type';
  const gate = checkAllowed(id, true);
  if (gate !== 'ok') return gate;
  if (sending.has(id)) return 'limit';
  sending.add(id);
  const up: Upload = { id: `up${++uploadSeq}`, url: URL.createObjectURL(file), w: 0, h: 0, pct: 0 };
  const list = () => uploads.get(id) ?? [];
  uploads.set(id, [...list(), up]);
  push();
  try {
    const { blob, w, h } = await compressPhoto(file);
    if (blob.size >= PHOTO_MAX_BYTES) return 'big';
    up.w = w;
    up.h = h;
    push();
    const task = uploadBytesResumable(ref(storage, chatPhotoPath(id, uid, Date.now())), blob, { contentType: 'image/jpeg' });
    task.on('state_changed', (s) => {
      up.pct = s.totalBytes ? s.bytesTransferred / s.totalBytes : 0;
      push();
    });
    await task;
    const url = await getDownloadURL(task.snapshot.ref);
    await writeMessage(id, convs.get(id) ?? conv, imageBody(url, w, h), []);
    recordSent(id, true);
    return 'ok';
  } catch {
    return 'failed';
  } finally {
    sending.delete(id);
    uploads.set(id, list().filter((u) => u !== up));
    if (!uploads.get(id)?.length) uploads.delete(id);
    URL.revokeObjectURL(up.url);
    push();
  }
}

// My own active listings, for the "Send a listing" picker.
function myListings(): ListingDoc[] {
  return me ? activeDocs.filter((d) => d.ownerId === me!.uid && d.status === 'active') : [];
}

async function sendListing(id: string, code: string): Promise<SendResult> {
  if (!me) return 'failed';
  const conv = convs.get(id);
  const L = myListings().find((d) => d.code === code);
  if (!conv || !L) return 'failed';
  if (isBlocked(conv, me.uid)) return 'blocked';
  const gate = checkAllowed(id, false);
  if (gate !== 'ok') return gate;
  if (sending.has(id)) return 'limit';
  sending.add(id);
  try {
    await writeMessage(id, conv, listingBody(listingCard(L)), []);
    recordSent(id, false);
    return 'ok';
  } catch {
    return 'failed';
  } finally {
    sending.delete(id);
  }
}

const msgRef = (id: string, mid: string) => doc(db, 'conversations', id, 'messages', mid);
const isLast = (id: string, mid: string) => {
  const list = msgs.get(id) ?? [];
  return list.length > 0 && list[list.length - 1].id === mid;
};

// My own text message, within 2 minutes: both sides then see "… recalled a message".
async function recall(id: string, mid: string): Promise<'ok' | 'expired' | 'failed'> {
  if (!me) return 'failed';
  const m = (msgs.get(id) ?? []).find((x) => x.id === mid);
  if (!m || m.senderId !== me.uid || m.kind !== 'text') return 'failed';
  if (!m.atMs || Date.now() - m.atMs >= RECALL_MS) return 'expired';
  try {
    const batch = writeBatch(db);
    batch.update(msgRef(id, mid), { kind: 'recalled', text: '', recalledAt: serverTimestamp() });
    if (isLast(id, mid)) batch.update(convRef(id), lastFor({ kind: 'recalled' }));
    await batch.commit();
    return 'ok';
  } catch {
    return Date.now() - m.atMs >= RECALL_MS ? 'expired' : 'failed';
  }
}

// Delete for me: the message leaves my thread only.
async function deleteMessage(id: string, mid: string): Promise<boolean> {
  if (!me || !convs.has(id)) return false;
  try {
    const batch = writeBatch(db);
    batch.update(msgRef(id, mid), { [`hiddenFor.${me.uid}`]: true });
    if (isLast(id, mid)) batch.update(convRef(id), { [`lastHidden.${me.uid}`]: serverTimestamp() });
    await batch.commit();
    return true;
  } catch {
    return false;
  }
}

async function update(id: string, data: Record<string, unknown>): Promise<boolean> {
  if (!me || !convs.has(id)) return false;
  try {
    await updateDoc(convRef(id), data);
    return true;
  } catch {
    return false;
  }
}

// One checklist item: 'wait' or 'done' (with an optional detail), or null to reopen it.
function note(id: string, k: SettleKey, s: 'wait' | 'done' | null, v?: string): Promise<boolean> {
  if (!me || !SETTLE_KEYS.includes(k)) return Promise.resolve(false);
  const data: Record<string, unknown> = {
    [`notes.${k}`]: s ? { s, by: me.uid, ...(v ? { v: String(v).slice(0, 80) } : {}) } : deleteField(),
  };
  if (k === 'money' && s === 'done' && !convs.get(id)?.safetyMs) data.safety = serverTimestamp();
  return update(id, data);
}

// The signed-in person's own contact details (users/{uid}/private/contact, owner-only).
async function myContact(): Promise<Record<ShareKind, string>> {
  const m = requireMe();
  let c: Record<string, unknown> = {};
  try {
    const snap = await getDoc(doc(db, 'users', m.uid, 'private', 'contact'));
    if (snap.exists()) c = snap.data();
  } catch {
    /* fall back to the account email below */
  }
  const s = (x: unknown) => (typeof x === 'string' ? x.trim().slice(0, 200) : '');
  return { whatsapp: s(c.whatsapp), email: s(c.email) || m.email, instagram: '' };
}

// Step one of the swap: store only which kind I'll share. The value itself is written by reveal()
// once the other side has shared too, so it is never on the conversation before both agree.
async function share(id: string, kind: ShareKind): Promise<boolean> {
  if (!me || !SHARE_KINDS.includes(kind)) return false;
  if (!(await myContact())[kind]) return false;
  return update(id, { [`share.${me.uid}`]: { kind, val: '', at: serverTimestamp() } });
}

// Step two: both have shared, so write my value (read fresh from my private contact details).
const revealing = new Set<string>();
const nothingToReveal = new Set<string>(); // that contact detail was removed from my profile
async function reveal(c: Conv) {
  if (!me) return;
  const kind = needsReveal(c.share, me.uid, otherOf(c, me.uid));
  if (!kind || revealing.has(c.id) || nothingToReveal.has(`${c.id}:${kind}`)) return;
  revealing.add(c.id);
  try {
    const val = (await myContact())[kind];
    if (val) await updateDoc(convRef(c.id), { [`share.${me.uid}.val`]: val });
    else nothingToReveal.add(`${c.id}:${kind}`);
  } catch {
    /* tried again on the next change */
  } finally {
    revealing.delete(c.id);
  }
}

function withdraw(id: string): Promise<boolean> {
  if (!me) return Promise.resolve(false);
  const c = convs.get(id);
  if (c && c.share[otherOf(c, me.uid)]) return Promise.resolve(false); // they shared too: no taking it back
  return update(id, { [`share.${me.uid}`]: deleteField() });
}

function seen(id: string) {
  const c = convs.get(id);
  if (!me || !c || !isUnread(c, me.uid) || marked.get(id) === c.updatedAtMs) return;
  marked.set(id, c.updatedAtMs);
  updateDoc(convRef(id), { [`read.${me.uid}`]: serverTimestamp() }).catch(() => marked.delete(id));
}

async function report(id: string, reason: string): Promise<boolean> {
  if (!me) return false;
  const c = convs.get(id) ?? drafts.get(id)?.conv;
  try {
    await addDoc(collection(db, 'reports'), {
      reporterId: me.uid,
      reason: String(reason).slice(0, 1000),
      kind: 'conversation',
      conversationId: id,
      listingId: c?.listingId ?? '',
      reportedUid: c ? otherOf(c, me.uid) : '',
      createdAt: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

const block = (id: string) => (me ? update(id, { [`blocked.${me.uid}`]: true }) : Promise.resolve(false));
const unblock = (id: string) => (me ? update(id, { [`blocked.${me.uid}`]: deleteField() }) : Promise.resolve(false));

// Every conversation where I blocked this person.
async function unblockPerson(uid: string): Promise<boolean> {
  if (!me) return false;
  const mine = me.uid;
  const ids = [...convs.values()].filter((c) => c.blocked[mine] && otherOf(c, mine) === uid).map((c) => c.id);
  const done = await Promise.all(ids.map(unblock));
  return done.every(Boolean);
}

// ---------- conversation settings (mine only) ----------

const myKey = (f: string) => `${f}.${me!.uid}`;
const pin = (id: string, on: boolean) => (me ? update(id, { [myKey('pinned')]: on ? true : deleteField() }) : Promise.resolve(false));
const mute = (id: string, on: boolean) => (me ? update(id, { [myKey('muted')]: on ? true : deleteField() }) : Promise.resolve(false));

// Hide: out of my list until a newer message arrives. It counts as read, and it is no longer pinned.
function hide(id: string): Promise<boolean> {
  if (!me) return Promise.resolve(false);
  return update(id, {
    [myKey('hidden')]: serverTimestamp(),
    [myKey('read')]: serverTimestamp(),
    ...(convs.get(id)?.pinned[me.uid] ? { [myKey('pinned')]: deleteField() } : {}),
  });
}
const unhide = (id: string) => (me && convs.get(id)?.hidden[me.uid] ? update(id, { [myKey('hidden')]: deleteField() }) : Promise.resolve(true));

// Delete conversation, for me: hidden, and when it comes back I see only what came after.
function clear(id: string): Promise<boolean> {
  if (!me) return Promise.resolve(false);
  return update(id, {
    [myKey('hidden')]: serverTimestamp(),
    [myKey('clearedAt')]: serverTimestamp(),
    [myKey('read')]: serverTimestamp(),
    ...(convs.get(id)?.pinned[me.uid] ? { [myKey('pinned')]: deleteField() } : {}),
  });
}

// The other person's newest open request, if they have one (for the host's view of a guest).
async function openRequest(uid: string): Promise<RequestSummary | null> {
  try {
    const snap = await getDocs(query(collection(db, 'requests'), where('ownerId', '==', uid), where('status', '==', 'open')));
    const docs = snap.docs.map((d) => d.data()).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    return docs.length ? requestSummary(docs[0]) : null;
  } catch {
    return null;
  }
}

// ---------- opening a conversation ----------

function open(id: string | null) {
  openId = id;
  watchMessages();
  if (id) {
    const c = convs.get(id) ?? drafts.get(id)?.conv;
    if (c && me) loadProfile(otherOf(c, me.uid));
  }
  push();
}

// messages.html?c=<id>, ?listing=<code>&with=<uid>, or ?with=<uid>: which conversation to show.
async function resolve(params: { c?: string | null; listing?: string | null; with?: string | null }): Promise<Entry> {
  await authReady;
  if (!me) return null;
  await listReady;
  const uid = me.uid;
  if (params.c) {
    const id = params.c;
    if (convs.has(id)) return { id };
    try {
      // not in the first list snapshot yet (it only just started): read it directly
      const snap = await getDoc(convRef(id));
      if (snap.exists()) {
        convs.set(id, convFromData(id, snap.data({ serverTimestamps: 'estimate' })));
        push();
        return { id };
      }
    } catch {
      /* not mine, or it doesn't exist */
    }
    return { notice: 'That conversation isn’t available.' };
  }
  const code = (params.listing || '').trim();
  const withUid = (params.with || '').trim() || null;
  if (!code) {
    if (!withUid) return null;
    const found = [...convs.values()].filter((c) => c.participants.includes(withUid)).sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0];
    return found ? { id: found.id } : null;
  }
  if (!/^[1-9][0-9]{7}$/.test(code)) return { notice: 'We couldn’t find that listing.' };
  const look = await getListing(code);
  if (look.state !== 'ok') {
    // only the host can read a listing that came down, so here I am the guest
    const id = conversationId(code, uid);
    if (convs.has(id)) return { id };
    return { notice: look.state === 'error' ? 'Couldn’t load that listing. Try again.' : 'That listing is no longer available.' };
  }
  const L = look.listing;
  const roles = rolesFor(L.ownerId, uid, withUid);
  if ('error' in roles) {
    return { notice: roles.error === 'own' ? 'This is your own listing.' : 'Open this conversation from a request or your inbox.' };
  }
  const id = conversationId(code, roles.guestId);
  if (convs.has(id)) return { id };
  // a draft: it becomes a real conversation with the first message
  const names: Record<string, string> = { [uid]: me.name };
  const photos: Record<string, string> = { [uid]: me.photo };
  if (roles.hostId === uid) {
    const p = await loadProfile(roles.guestId);
    if (!p) return { notice: 'We couldn’t find that person.' };
    names[roles.guestId] = p.name || 'Member';
    photos[roles.guestId] = p.photoURL;
  } else {
    names[L.ownerId] = L.ownerName;
    photos[L.ownerId] = L.ownerPhoto || '';
  }
  const conv = convFromData(id, {
    ...newConversation({ listing: L, hostId: roles.hostId, guestId: roles.guestId, names, photos }),
  });
  drafts.set(id, { conv, listing: L });
  push();
  return { id };
}

// room.html: the first message about a listing. Creates the conversation if needed.
async function start(code: string, raw: string): Promise<StartResult> {
  await authReady;
  if (!me) return { ok: false, reason: 'signin' };
  const text = cleanText(raw);
  if (!text.trim()) return { ok: false, reason: 'failed' };
  const look = await getListing(code);
  if (look.state !== 'ok') return { ok: false, reason: look.state === 'error' ? 'failed' : 'gone' };
  const L = look.listing;
  const roles = rolesFor(L.ownerId, me.uid, null);
  if ('error' in roles || roles.hostId === me.uid) return { ok: false, reason: 'own' };
  const id = conversationId(code, roles.guestId);
  let existing: Conv | null = null;
  try {
    const snap = await getDoc(convRef(id));
    if (snap.exists()) existing = convFromData(id, snap.data());
  } catch {
    /* the rules hide a conversation that doesn't exist yet */
  }
  if (existing && (existing.blocked[me.uid] || existing.blocked[L.ownerId])) return { ok: false, reason: 'blocked' };
  try {
    if (!existing) {
      await createConversation(
        id,
        L,
        roles.hostId,
        roles.guestId,
        { [me.uid]: me.name, [L.ownerId]: L.ownerName },
        { [me.uid]: me.photo, [L.ownerId]: L.ownerPhoto || '' },
      );
    }
    await writeMessage(id, existing, textBody(text), []);
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

const api = {
  start,
  resolve,
  open,
  send,
  note,
  share,
  withdraw,
  myContact,
  seen,
  report,
  block,
  unblock,
  unblockPerson,
  pin,
  mute,
  hide,
  unhide,
  clear,
  sendPhoto,
  sendListing,
  recall,
  deleteMessage,
  myListings,
  openRequest,
  profile: loadProfile,
  parseId: parseConversationId,
  // active listings from src/rentlet.ts (via the page's RL_onListings): a room not among them is no longer listed
  listings(list: ListingDoc[] | null) {
    if (!list) return;
    activeDocs = list;
    active = new Set(list.map((d) => d.code));
    push();
  },
  refresh: push,
};

window.RentletChat = api;
if (window.RL_chat) push();
