// Conversations between a guest and a host about one listing, turned into what messages.html
// renders. Pure functions only; src/chat.ts does the Firestore reads and writes.
import { dateRange, money } from './format';
import type { ListingDoc } from './listingView';

export type SettleKey = 'dates' | 'stays' | 'money' | 'tour' | 'landlord';
export const SETTLE_KEYS: SettleKey[] = ['dates', 'stays', 'money', 'tour', 'landlord'];
export type ShareKind = 'whatsapp' | 'email' | 'instagram'; // instagram: only handles shared before Nov 9
export const SHARE_KINDS: ShareKind[] = ['whatsapp', 'email'];
export type Tab = 'looking' | 'subletting';

// One checklist item someone has touched. Untouched items are open and are not stored.
export interface Note {
  s: 'wait' | 'done';
  by: string;
  v?: string;
}

export interface ShareEntry {
  kind: ShareKind;
  val: string;
  atMs: number;
}

// What the conversation keeps about the listing, so it still reads when the listing comes down.
export interface ConvListing {
  title: string;
  photo: string;
  price: number;
  start: string;
  end: string;
  area: string;
  deposit: number;
  refund: boolean;
  incl: string;
  extra: string;
  stays: string[];
  keep: boolean;
  takeover: boolean;
  channel: 'official' | 'private';
}

export type LastKind = 'text' | 'image' | 'listing' | 'recalled';

export interface Conv {
  id: string;
  listingId: string;
  hostId: string;
  guestId: string;
  participants: string[];
  listing: ConvListing;
  names: Record<string, string>;
  photos: Record<string, string>;
  lastMessage: string;
  lastSender: string;
  updatedAtMs: number;
  read: Record<string, number>;
  notes: Partial<Record<SettleKey, Note>>;
  share: Record<string, ShareEntry>;
  safetyMs: number;
  blocked: Record<string, boolean>;
  // per person, each changed only at the writer's own key (see firestore.rules ownOnly)
  pinned: Record<string, boolean>;
  muted: Record<string, boolean>;
  hidden: Record<string, number>; // out of that person's list until a newer message (updatedAt) arrives
  clearedAt: Record<string, number>; // "Delete conversation": that person sees only messages after it
  lastHidden: Record<string, number>; // that person deleted the last message for themselves
  lastKind: LastKind;
}

export type MsgKind = 'text' | 'image' | 'listing' | 'recalled';

// A quoted message, as the reply stores it: the snippet is kept so it reads without the original.
export interface ReplyTo {
  id: string;
  senderId: string;
  text: string;
}

export interface MsgImage {
  url: string;
  w: number;
  h: number;
}

// A listing card someone sent: what the card shows, so it still reads when the listing comes down.
export interface MsgListing {
  code: string;
  title: string;
  price: number;
  start: string;
  end: string;
  area: string;
  photo: string;
}

export interface Msg {
  id: string;
  senderId: string;
  text: string;
  kind: MsgKind;
  atMs: number;
  replyTo?: ReplyTo | null;
  image?: MsgImage | null;
  listing?: MsgListing | null;
  hiddenFor?: Record<string, boolean>; // deleted for that person only
}

export interface Profile {
  name: string;
  photoURL: string;
  nu: boolean;
  joinedAtMs: number;
  bio: string;
  year: string;
}

// A message bubble. k is what it holds; img, card and re only on the kinds that have them; rcl is
// when my own text message can no longer be recalled.
export interface Bubble {
  f: 'me' | 'them';
  x: string;
  t: string;
  id: string;
  k?: 'text' | 'image' | 'listing';
  img?: MsgImage;
  card?: MsgListing;
  re?: { id: string; who: string; x: string; gone: boolean };
  rcl?: number;
}

export type Item =
  | { f: 'day'; x: string }
  | Bubble
  | { f: 'sys'; x: string }
  | { f: 'unlock' }
  | { f: 'recalled'; x: string; id: string; mine: boolean };

export const UNLOCK_AFTER = 3; // replies from each side before contact details can be shared
export const MAX_TEXT = 2000; // firestore.rules: message text is 1–2000 characters
export const REPLY_SNIPPET = 80; // a reply keeps at most this much of the quoted message
export const RECALL_MS = 2 * 60_000; // own text messages can be recalled for 2 minutes
// Sending limits, per conversation, like the mini program's chatApi: 12 messages in 10 seconds,
// and 6 photos a minute.
export const SEND_LIMIT = { n: 12, ms: 10_000 };
export const PHOTO_LIMIT = { n: 6, ms: 60_000 };
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_MAX_PX = 1600;
export const PHOTO_QUALITY = 0.82;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // storage.rules: chat photos under 5 MB

// ---------- ids ----------

export function conversationId(listingCode: string, guestUid: string): string {
  return `${listingCode}_${guestUid}`;
}

export function parseConversationId(id: string): { listingId: string; guestId: string } | null {
  const m = /^([1-9][0-9]{7})_([A-Za-z0-9]{6,128})$/.exec(id || '');
  return m ? { listingId: m[1], guestId: m[2] } : null;
}

// Who is the host and who is the guest when `me` opens a chat about a listing owned by `owner`.
// `withUid` names the other person; it is required when I am the host.
export function rolesFor(
  owner: string,
  me: string,
  withUid: string | null,
): { hostId: string; guestId: string } | { error: 'own' | 'who' } {
  if (owner === me) {
    if (!withUid) return { error: 'who' };
    if (withUid === me) return { error: 'own' };
    return { hostId: me, guestId: withUid };
  }
  return { hostId: owner, guestId: me };
}

// ---------- reading Firestore data ----------

type TimeLike = { toMillis(): number } | number | null | undefined;
export function ms(t: unknown): number {
  const x = t as TimeLike;
  if (typeof x === 'number') return x;
  if (x && typeof (x as { toMillis?: unknown }).toMillis === 'function') return (x as { toMillis(): number }).toMillis();
  return 0;
}

const str = (x: unknown, max = 4000) => (typeof x === 'string' ? x.slice(0, max) : '');
const num = (x: unknown) => {
  const n = Number(String(x ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const rec = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});

function readListing(x: unknown): ConvListing {
  const l = rec(x);
  return {
    title: str(l.title, 120) || 'Listing',
    photo: str(l.photo, 2000),
    price: Number(l.price) || 0,
    start: str(l.start, 10),
    end: str(l.end, 10),
    area: str(l.area, 80),
    deposit: Number(l.deposit) || 0,
    refund: l.refund === true,
    incl: str(l.incl, 200),
    extra: str(l.extra, 200),
    stays: Array.isArray(l.stays) ? l.stays.filter((s): s is string => typeof s === 'string').slice(0, 20) : [],
    keep: l.keep === true,
    takeover: l.takeover === true,
    channel: l.channel === 'official' ? 'official' : 'private',
  };
}

export function convFromData(id: string, data: Record<string, unknown>): Conv {
  const notes: Partial<Record<SettleKey, Note>> = {};
  const rawNotes = rec(data.notes);
  for (const k of SETTLE_KEYS) {
    const n = rec(rawNotes[k]);
    if ((n.s === 'wait' || n.s === 'done') && typeof n.by === 'string') {
      notes[k] = { s: n.s, by: n.by, ...(typeof n.v === 'string' ? { v: n.v.slice(0, 80) } : {}) };
    }
  }
  const share: Record<string, ShareEntry> = {};
  for (const [uid, v] of Object.entries(rec(data.share))) {
    const e = rec(v);
    if (e.kind === 'whatsapp' || e.kind === 'email' || e.kind === 'instagram') {
      share[uid] = { kind: e.kind, val: typeof e.val === 'string' ? e.val.trim().slice(0, 200) : '', atMs: ms(e.at) };
    }
  }
  const read: Record<string, number> = {};
  for (const [uid, v] of Object.entries(rec(data.read))) read[uid] = ms(v);
  const blocked = trueMap(data.blocked);
  const times = (x: unknown) => {
    const out: Record<string, number> = {};
    for (const [uid, v] of Object.entries(rec(x))) {
      const t = ms(v);
      if (t > 0) out[uid] = t;
    }
    return out;
  };
  const strMap = (x: unknown) =>
    Object.fromEntries(Object.entries(rec(x)).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  return {
    id,
    listingId: str(data.listingId, 20),
    hostId: str(data.hostId, 128),
    guestId: str(data.guestId, 128),
    participants: Array.isArray(data.participants) ? data.participants.filter((p): p is string => typeof p === 'string') : [],
    listing: readListing(data.listing),
    names: strMap(data.names),
    photos: strMap(data.photos),
    lastMessage: str(data.lastMessage, 300),
    lastSender: str(data.lastSender, 128),
    updatedAtMs: ms(data.updatedAt),
    read,
    notes,
    share,
    safetyMs: ms(data.safety),
    blocked,
    pinned: trueMap(data.pinned),
    muted: trueMap(data.muted),
    hidden: times(data.hidden),
    clearedAt: times(data.clearedAt),
    lastHidden: times(data.lastHidden),
    lastKind: (['image', 'listing', 'recalled'] as const).find((k) => k === data.lastKind) ?? 'text',
  };
}

function trueMap(x: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(rec(x))) if (v === true) out[k] = true;
  return out;
}

// Only photos in this project's Cloud Storage bucket show in a thread (firestore.rules checks the same).
const PHOTO_URL = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[a-z0-9.-]+\/o\/chats%2F/;
const dim = (x: unknown) => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 0;
};

function readMsgListing(x: unknown): MsgListing | null {
  const l = rec(x);
  const code = str(l.code, 8);
  if (!/^[1-9][0-9]{7}$/.test(code)) return null;
  const photo = str(l.photo, 2000);
  return {
    code,
    title: str(l.title, 120) || 'Listing',
    price: Number(l.price) || 0,
    start: str(l.start, 10),
    end: str(l.end, 10),
    area: str(l.area, 80),
    photo: /^https:\/\//.test(photo) ? photo : '',
  };
}

function readReply(x: unknown): ReplyTo | null {
  const r = rec(x);
  const id = str(r.id, 64);
  return id ? { id, senderId: str(r.senderId, 128), text: str(r.text, REPLY_SNIPPET) } : null;
}

export function msgFromData(id: string, data: Record<string, unknown>): Msg {
  // anything a participant writes shows as their own message, never as a Rentlet notice
  const base = {
    id,
    senderId: str(data.senderId, 128),
    atMs: ms(data.createdAt),
    hiddenFor: trueMap(data.hiddenFor),
  };
  if (data.kind === 'recalled') return { ...base, kind: 'recalled', text: '' };
  if (data.kind === 'image') {
    const url = str(data.imageUrl, 2000);
    if (PHOTO_URL.test(url)) return { ...base, kind: 'image', text: '', image: { url, w: dim(data.width), h: dim(data.height) } };
  }
  if (data.kind === 'listing') {
    const listing = readMsgListing(data.listing);
    if (listing) return { ...base, kind: 'listing', text: '', listing };
  }
  return { ...base, kind: 'text', text: str(data.text, MAX_TEXT), replyTo: readReply(data.replyTo) };
}

export function profileFromData(data: Record<string, unknown> | null | undefined, school = false): Profile | null {
  if (!data) return null;
  return {
    name: str(data.name, 60),
    photoURL: str(data.photoURL, 2000),
    nu: school, // verifications/{uid}: a .edu address confirmed with a code
    joinedAtMs: ms(data.joinedAt),
    bio: str(data.bio, 600).trim(),
    year: str(data.year, 40).trim(),
  };
}

// requests/{id}, as the host sees it on a guest's profile.
const REQ_KIND: Record<string, string> = { room: 'Private room', whole: 'Whole place', either: 'Room or whole place' };
const REQ_ROLE: Record<string, string> = {
  student: 'Student',
  intern: 'Intern',
  newhire: 'New hire',
  researcher: 'Visiting researcher',
  other: 'Other',
};

export function requestSummary(data: Record<string, unknown>) {
  const start = str(data.start, 10);
  const end = str(data.end, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const budget = Number(data.budget);
  return {
    start,
    end,
    budget: data.anyPrice === true || !Number.isFinite(budget) || budget <= 0 ? null : Math.round(budget),
    kind: REQ_KIND[str(data.kind, 20)] ?? '',
    role: REQ_ROLE[str(data.role, 20)] ?? '',
    org: str(data.org, 80).trim(),
    note: str(data.note, 400).trim(),
    life: Array.isArray(data.life) ? data.life.filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
  };
}
export type RequestSummary = NonNullable<ReturnType<typeof requestSummary>>;

// ---------- writing ----------

// The listing as the conversation keeps it (title, photo, price, dates, and what the checklist shows).
export function listingSnapshot(d: ListingDoc): ConvListing {
  const f = d.form;
  const fees = (f?.multi?.fees ?? []).filter((x) => x !== 'Nothing extra');
  const extra = num(f?.f?.extra);
  const terms = f?.terms || (d.kind === 'takeover' ? 'gift' : 'use');
  return {
    title: d.title,
    photo: d.photos?.[0] ?? '',
    price: d.price,
    start: d.start,
    end: d.end,
    area: d.area,
    deposit: f?.dep === 'amount' ? num(f?.f?.dep) : 0,
    refund: !!f?.refund,
    incl: fees.join(' + '),
    extra: extra ? `About ${money(extra)} / mo` : '',
    stays: f?.furn === 'none' ? [] : (f?.multi?.items ?? []).slice(0, 20),
    keep: terms === 'gift',
    takeover: d.kind === 'takeover',
    channel: f?.transferChannel === 'official' ? 'official' : 'private',
  };
}

// The fields a new conversation starts with (the caller adds the server timestamps).
export function newConversation(opts: {
  listing: ListingDoc;
  hostId: string;
  guestId: string;
  names: Record<string, string>;
  photos: Record<string, string>;
}) {
  const { listing, hostId, guestId } = opts;
  return {
    listingId: listing.code,
    hostId,
    guestId,
    participants: [guestId, hostId],
    listing: listingSnapshot(listing),
    names: opts.names,
    photos: opts.photos,
  };
}

// A message's text as it is stored: trimmed of trailing space, at most 2000 characters.
export function cleanText(text: string): string {
  return String(text ?? '').replace(/\s+$/, '').replace(/^\s*\n/, '').slice(0, MAX_TEXT);
}

// The quoted part of a reply: one line, at most 80 characters.
export function snippet(text: string, max = REPLY_SNIPPET): string {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
}

// What a message reads as when it is quoted, copied into a menu title or shown as the last line.
export function msgSnippet(m: Pick<Msg, 'kind' | 'text' | 'listing'>, max = REPLY_SNIPPET): string {
  if (m.kind === 'image') return 'Photo';
  if (m.kind === 'listing') return snippet(`Listing: ${m.listing?.title ?? ''}`, max);
  if (m.kind === 'recalled') return '';
  return snippet(m.text, max);
}

export function replyTo(m: Msg): ReplyTo {
  return { id: m.id, senderId: m.senderId, text: msgSnippet(m) };
}

// The message document's own fields for each kind (the caller adds senderId and createdAt).
// They match the create rule proposed for firestore.rules: text 1–2000 with an optional replyTo;
// a photo in Storage under chats/{conversation}/{sender}/; a card of one of the sender's own listings.
export function textBody(text: string, reply?: ReplyTo | null) {
  return { kind: 'text' as const, text, ...(reply ? { replyTo: reply } : {}) };
}

export function imageBody(url: string, width: number, height: number) {
  return { kind: 'image' as const, text: '', imageUrl: url, width: Math.round(width), height: Math.round(height) };
}

export function listingCard(d: ListingDoc): MsgListing {
  return {
    code: d.code,
    title: String(d.title ?? '').slice(0, 120) || 'Listing',
    price: Math.round(Number(d.price) || 0),
    start: String(d.start ?? '').slice(0, 10),
    end: String(d.end ?? '').slice(0, 10),
    area: String(d.area ?? '').slice(0, 80),
    photo: String(d.photos?.[0] ?? '').slice(0, 2000),
  };
}

export function listingBody(card: MsgListing) {
  return { kind: 'listing' as const, text: '', listing: card };
}

// The conversation's last line for each kind of message.
export function lastFor(body: { kind: LastKind; text?: string; listing?: MsgListing }) {
  const lastMessage =
    body.kind === 'image' ? 'Photo' : body.kind === 'listing' ? `Listing: ${body.listing?.title ?? ''}` : body.kind === 'recalled' ? 'Message recalled' : body.text ?? '';
  return { lastMessage: lastMessage.slice(0, 200), lastKind: body.kind };
}

// chats/{conversationId}/{uid}/{timestamp}.jpg (storage.rules: only that uid, a participant, writes there)
export function chatPhotoPath(conversationId: string, uid: string, at: number): string {
  return `chats/${conversationId}/${uid}/${at}.jpg`;
}

// A photo's size after scaling it to fit within max px on its long side (never enlarged).
export function fitWithin(w: number, h: number, max = PHOTO_MAX_PX): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// True while fewer than lim.n sends happened in the last lim.ms.
export function underLimit(times: number[], now: number, lim: { n: number; ms: number }): boolean {
  return times.filter((t) => now - t < lim.ms).length < lim.n;
}

// Seconds left to recall my own text message, or 0.
export function recallLeft(m: Pick<Msg, 'kind' | 'senderId' | 'atMs'>, me: string, now: number): number {
  if (m.kind !== 'text' || m.senderId !== me || !m.atMs) return 0;
  return Math.max(0, Math.ceil((m.atMs + RECALL_MS - now) / 1000));
}

// ---------- state ----------

export function otherOf(conv: Pick<Conv, 'hostId' | 'guestId'>, me: string): string {
  return conv.hostId === me ? conv.guestId : conv.hostId;
}

export function tabOf(conv: Pick<Conv, 'hostId'>, me: string): Tab {
  return conv.hostId === me ? 'subletting' : 'looking';
}

export function isUnread(conv: Pick<Conv, 'lastSender' | 'updatedAtMs' | 'read'>, me: string): boolean {
  if (!conv.lastSender || conv.lastSender === me) return false;
  return conv.updatedAtMs > (conv.read[me] ?? 0);
}

// Hidden (or deleted) by me, and nothing newer has arrived since.
export function isHiddenFor(conv: Pick<Conv, 'hidden' | 'updatedAtMs'>, me: string): boolean {
  const h = conv.hidden[me];
  return !!h && h >= conv.updatedAtMs;
}

// For the header's unread count, from a raw conversations/{id} document: unread, and not muted,
// hidden or blocked by me (src/rentlet.ts may import this).
export function badgeUnread(data: Record<string, unknown>, me: string): boolean {
  const c = convFromData('', data);
  return isUnread(c, me) && !c.muted[me] && !c.blocked[me] && !isHiddenFor(c, me);
}

export function counts(msgs: Msg[], me: string): { me: number; them: number } {
  let a = 0;
  let b = 0;
  for (const m of msgs) {
    if (m.kind !== 'text') continue;
    if (m.senderId === me) a++;
    else b++;
  }
  return { me: a, them: b };
}

// Index of the message after which both sides had replied three times; -1 if not yet.
export function unlockIndex(msgs: Msg[], me: string): number {
  let a = 0;
  let b = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.kind !== 'text') continue;
    if (m.senderId === me) a++;
    else b++;
    if (a >= UNLOCK_AFTER && b >= UNLOCK_AFTER) return i;
  }
  return -1;
}

// Contact details are swapped in two steps so neither value is ever stored before both agree:
// "Share" stores only which kind (val ''); a side writes its value once the other side has shared
// too. The other person's value shows once both have shared and theirs has been written.
export function shareView(share: Record<string, ShareEntry>, me: string, other: string) {
  const mine = share[me] ?? null;
  const theirs = share[other] ?? null;
  return {
    mine: mine ? mine.kind : null,
    theirsShared: !!theirs,
    theirs: mine && theirs && theirs.val ? { kind: theirs.kind, val: theirs.val } : null,
  };
}

// My value is due once we both shared and I haven't written it yet.
export function needsReveal(share: Record<string, ShareEntry>, me: string, other: string): ShareKind | null {
  const mine = share[me];
  return mine && !mine.val && share[other] ? mine.kind : null;
}

// ---------- words ----------

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (t: number, now: Date) => Math.round((dayStart(now) - dayStart(new Date(t))) / 86_400_000);

// "9:41 AM"
export function clockLabel(t: number): string {
  if (!t) return '';
  return new Date(t)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(/[  ]/g, ' ');
}

function dateLabel(t: number, now: Date): string {
  const d = new Date(t);
  const base = `${MON[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

// The day stamp in a thread: "Today", "Yesterday", "Mon", "Oct 28", "Oct 28, 2025".
export function dayLabel(t: number, now: Date = new Date()): string {
  const n = daysAgo(t, now);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 7) return WEEKDAY[new Date(t).getDay()];
  return dateLabel(t, now);
}

// The time in the conversation list: "9:41 AM" today, then "Yesterday", "Mon", "Oct 28".
export function whenLabel(t: number, now: Date = new Date()): string {
  if (!t) return '';
  const n = daysAgo(t, now);
  if (n <= 0) return clockLabel(t);
  return dayLabel(t, now);
}

export function lastLine(
  conv: Pick<Conv, 'lastMessage' | 'lastSender'> & Partial<Pick<Conv, 'lastKind' | 'lastHidden' | 'updatedAtMs'>>,
  me: string,
  otherName = '',
): string {
  const gone = conv.lastHidden?.[me];
  if (gone && gone >= (conv.updatedAtMs ?? 0)) return 'Message deleted';
  const mine = conv.lastSender === me;
  if (conv.lastKind === 'recalled') return mine ? 'You recalled a message' : `${otherName || 'They'} recalled a message`;
  if (!conv.lastMessage) return 'New conversation';
  return (mine ? 'You: ' : '') + conv.lastMessage.replace(/\s*\n+\s*/g, ' ');
}

export const SAFE: Record<Tab, string> = {
  looking: 'You pay the host directly. Rentlet never holds money.',
  subletting: 'Your subletter pays you directly. Rentlet never holds money.',
};

// The thread as rendered: messages, a day stamp whenever the day changes, and the notes that
// mark the money reminder, the contact unlock and the swap at the moment each happened.
// Messages I deleted for myself, and everything up to "Delete conversation", are left out; they
// still count toward the contact unlock, which the other side sees too.
export function timeline(
  msgs: Msg[],
  conv: (Pick<Conv, 'safetyMs' | 'share'> & Partial<Pick<Conv, 'clearedAt'>>) | null,
  me: string,
  other: string,
  otherName: string,
  tab: Tab,
  now: Date = new Date(),
): Item[] {
  type Ev = { at: number; seq: number; item: Item };
  const evs: Ev[] = [];
  let seq = 0;
  const cleared = conv?.clearedAt?.[me] ?? 0;
  const shown = (at: number) => !cleared || at > cleared;
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const quote = (r: ReplyTo) => {
    const q = byId.get(r.id);
    const gone = !!q && (q.kind === 'recalled' || !!q.hiddenFor?.[me] || (!!cleared && q.atMs > 0 && q.atMs <= cleared));
    return { id: r.id, who: r.senderId === me ? 'You' : otherName, x: gone ? '' : r.text, gone };
  };
  const unlockAt = unlockIndex(msgs, me);
  msgs.forEach((m, i) => {
    const at = m.atMs || now.getTime();
    if (i === unlockAt && shown(at)) evs.push({ at, seq: seq + 1, item: { f: 'unlock' } });
    const item = m.hiddenFor?.[me] || !shown(at) ? null : bubble(m, at, me, otherName, quote);
    if (item) evs.push({ at, seq, item });
    seq += 2;
  });
  if (conv?.safetyMs && shown(conv.safetyMs)) evs.push({ at: conv.safetyMs, seq: seq++, item: { f: 'sys', x: SAFE[tab] } });
  const a = conv?.share[me];
  const b = conv?.share[other];
  const swapAt = a && b && b.val ? Math.max(a.atMs, b.atMs) || now.getTime() : 0;
  if (swapAt && shown(swapAt)) evs.push({ at: swapAt, seq: seq++, item: { f: 'sys', x: `You and ${otherName} swapped contact details` } });
  evs.sort((x, y) => x.at - y.at || x.seq - y.seq);
  const out: Item[] = [];
  let day = '';
  for (const e of evs) {
    const d = dayLabel(e.at, now);
    if (d !== day) {
      out.push({ f: 'day', x: d });
      day = d;
    }
    out.push(e.item);
  }
  return out;
}

function bubble(m: Msg, at: number, me: string, otherName: string, quote: (r: ReplyTo) => Bubble['re']): Item | null {
  const mine = m.senderId === me;
  if (m.kind === 'recalled') return { f: 'recalled', x: mine ? 'You recalled a message' : `${otherName} recalled a message`, id: m.id, mine };
  const b: Bubble = { f: mine ? 'me' : 'them', x: m.text, t: clockLabel(at), id: m.id };
  if (m.kind === 'image' && m.image) return { ...b, k: 'image', x: '', img: m.image };
  if (m.kind === 'listing' && m.listing) return { ...b, k: 'listing', x: m.listing.title, card: m.listing };
  if (!m.text.trim()) return null;
  if (m.replyTo) b.re = quote(m.replyTo);
  if (mine && m.atMs) b.rcl = m.atMs + RECALL_MS;
  return b;
}

const listText = (a: string[]) => {
  const l = a.map((x, i) => (i ? x.toLowerCase() : x));
  return l.length > 1 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l[0] || '';
};
export const shortList = (a: string[]) =>
  a.length > 3 ? listText(a.slice(0, 3)).replace(' and ', ', ') + ` +${a.length - 3} more` : listText(a);

// The five-item checklist as [state, detail] rows, worded for the person looking at it.
export function settleView(
  notes: Partial<Record<SettleKey, Note>>,
  ctx: { me: string; otherName: string; host: boolean; listing: ConvListing },
): Record<SettleKey, ['open' | 'wait' | 'done', string]> {
  const { me, otherName: n, host, listing: L } = ctx;
  const out = {} as Record<SettleKey, ['open' | 'wait' | 'done', string]>;
  for (const k of SETTLE_KEYS) {
    const note = notes[k];
    if (!note) {
      out[k] = ['open', ''];
      continue;
    }
    const mine = note.by === me;
    if (note.s === 'wait') {
      out[k] = ['wait', mine ? `Waiting on ${n}` : `${n} asked`];
      continue;
    }
    const done: Record<SettleKey, string> = {
      dates: note.v || (L.start && L.end ? dateRange(L.start, L.end) : ''),
      stays: L.stays.length ? (L.keep ? (host ? 'Theirs to keep: ' : 'Yours to keep: ') : '') + shortList(L.stays) : 'Nothing stays',
      money: `${money(L.price)} / mo · ${L.deposit ? `${money(L.deposit)} deposit` : 'no deposit'}`,
      tour: host ? 'Sent' : 'Received',
      landlord: mine ? 'You confirmed' : `Confirmed by ${n}`,
    };
    out[k] = ['done', done[k]];
  }
  return out;
}

// "Usually replies within an hour" once the thread shows at least two replies to go on.
export function replyTime(msgs: Msg[], me: string): string {
  const gaps: number[] = [];
  let pending: number | null = null;
  for (const m of msgs) {
    if (m.kind !== 'text' || !m.atMs) continue;
    if (m.senderId === me) {
      if (pending == null) pending = m.atMs;
    } else if (pending != null) {
      gaps.push((m.atMs - pending) / 60_000);
      pending = null;
    }
  }
  if (gaps.length < 2) return '';
  const worst = Math.max(...gaps);
  return worst <= 60 ? 'Usually replies within an hour' : worst <= 1440 ? 'Usually replies within a day' : '';
}

const COLORS = ['#3d3d45', '#4f5f4a', '#8a6d3b', '#2f5d7a', '#3b6a5a', '#7a4b3a', '#4a5d6b', '#6b5b45'];
export function colorFor(uid: string): string {
  let h = 0;
  for (const c of uid || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function memberSince(t: number): string {
  if (!t) return '';
  const d = new Date(t);
  return `Member since ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

// ---------- the thread as messages.html renders it ----------

export interface ThreadOpts {
  me: string;
  msgs: Msg[] | null; // null until the thread's messages load
  profile: Profile | null;
  activeCodes: Set<string> | null; // null until active listings load
  draft?: boolean;
  now?: Date;
}

export function threadView(conv: Conv, o: ThreadOpts) {
  const { me } = o;
  const other = otherOf(conv, me);
  const tab = tabOf(conv, me);
  const host = tab === 'subletting';
  const P = o.profile;
  const name = (P?.name || conv.names[other] || '').trim() || 'Student';
  const photo = P?.photoURL || conv.photos[other] || '';
  const msgs = o.msgs ?? [];
  const L = conv.listing;
  return {
    id: conv.id,
    tab,
    other,
    isDraft: !!o.draft,
    p: {
      uid: other,
      name,
      photo,
      col: colorFor(other),
      ok: P ? P.nu : false,
      role: P?.year ? String(P.year) : 'Verified school email',
      bio: P?.bio ?? '',
      year: P?.year ?? '',
      since: memberSince(P?.joinedAtMs ?? 0),
      joinedMs: P?.joinedAtMs ?? 0,
    },
    r: { key: conv.listingId, ...L, span: L.start && L.end ? dateRange(L.start, L.end) : '' },
    msgs: o.msgs ? timeline(msgs, conv, me, other, name, tab, o.now) : [],
    n: counts(msgs, me), // replies each side sent (for the contact unlock), deleted-for-me ones included
    loaded: !!o.msgs || !!o.draft,
    last: lastLine(conv, me, name),
    when: whenLabel(conv.updatedAtMs, o.now),
    ord: conv.updatedAtMs || Number.MAX_SAFE_INTEGER,
    unread: isUnread(conv, me),
    pinned: !!conv.pinned[me],
    muted: !!conv.muted[me],
    hidden: isHiddenFor(conv, me),
    taken: !!o.activeCodes && !o.activeCodes.has(conv.listingId),
    blocked: !!conv.blocked[me],
    blockedBy: !!conv.blocked[other],
    settle: settleView(conv.notes, { me, otherName: name, host, listing: L }),
    share: shareView(conv.share, me, other),
    replyTime: replyTime(msgs, me),
  };
}

export type ThreadView = ReturnType<typeof threadView>;
