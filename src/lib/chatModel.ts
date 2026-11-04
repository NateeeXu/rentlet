// Conversations between a guest and a host about one listing, turned into what messages.html
// renders. Pure functions only; src/chat.ts does the Firestore reads and writes.
import { dateRange, money } from './format';
import type { ListingDoc } from './listingView';

export type SettleKey = 'dates' | 'stays' | 'money' | 'tour' | 'landlord';
export const SETTLE_KEYS: SettleKey[] = ['dates', 'stays', 'money', 'tour', 'landlord'];
export type ShareKind = 'instagram' | 'email';
export const SHARE_KINDS: ShareKind[] = ['instagram', 'email'];
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
}

export interface Msg {
  id: string;
  senderId: string;
  text: string;
  kind: 'text' | 'system';
  atMs: number;
}

export interface Profile {
  name: string;
  photoURL: string;
  nu: boolean;
  joinedAtMs: number;
  bio: string;
  year: string;
}

export type Item =
  | { f: 'day'; x: string }
  | { f: 'me' | 'them'; x: string; t: string; id: string }
  | { f: 'sys'; x: string }
  | { f: 'unlock' };

export const UNLOCK_AFTER = 3; // replies from each side before contact details can be shared
export const MAX_TEXT = 2000; // firestore.rules: message text is 1–2000 characters

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
    if (e.kind === 'instagram' || e.kind === 'email') {
      share[uid] = { kind: e.kind, val: typeof e.val === 'string' ? e.val.trim().slice(0, 200) : '', atMs: ms(e.at) };
    }
  }
  const read: Record<string, number> = {};
  for (const [uid, v] of Object.entries(rec(data.read))) read[uid] = ms(v);
  const blocked: Record<string, boolean> = {};
  for (const [uid, v] of Object.entries(rec(data.blocked))) if (v === true) blocked[uid] = true;
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
  };
}

export function msgFromData(id: string, data: Record<string, unknown>): Msg {
  return {
    id,
    senderId: str(data.senderId, 128),
    text: str(data.text, MAX_TEXT),
    kind: 'text', // anything a participant writes shows as their own message, never as a Rentlet notice
    atMs: ms(data.createdAt),
  };
}

export function profileFromData(data: Record<string, unknown> | null | undefined): Profile | null {
  if (!data) return null;
  return {
    name: str(data.name, 60),
    photoURL: str(data.photoURL, 2000),
    nu: data.nu !== false,
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

export function lastLine(conv: Pick<Conv, 'lastMessage' | 'lastSender'>, me: string): string {
  if (!conv.lastMessage) return 'New conversation';
  return (conv.lastSender === me ? 'You: ' : '') + conv.lastMessage.replace(/\s*\n+\s*/g, ' ');
}

export const SAFE: Record<Tab, string> = {
  looking: 'You pay the host directly. Rentlet never holds money.',
  subletting: 'Your subletter pays you directly. Rentlet never holds money.',
};

// The thread as rendered: messages, a day stamp whenever the day changes, and the notes that
// mark the money reminder, the contact unlock and the swap at the moment each happened.
export function timeline(
  msgs: Msg[],
  conv: Pick<Conv, 'safetyMs' | 'share'> | null,
  me: string,
  other: string,
  otherName: string,
  tab: Tab,
  now: Date = new Date(),
): Item[] {
  type Ev = { at: number; seq: number; item: Item };
  const evs: Ev[] = [];
  let seq = 0;
  const unlockAt = unlockIndex(msgs, me);
  msgs.forEach((m, i) => {
    const at = m.atMs || now.getTime();
    evs.push({ at, seq: seq++, item: { f: m.senderId === me ? 'me' : 'them', x: m.text, t: clockLabel(at), id: m.id } });
    if (i === unlockAt) evs.push({ at, seq: seq++, item: { f: 'unlock' } });
  });
  if (conv?.safetyMs) evs.push({ at: conv.safetyMs, seq: seq++, item: { f: 'sys', x: SAFE[tab] } });
  const a = conv?.share[me];
  const b = conv?.share[other];
  if (a && b && b.val) evs.push({ at: Math.max(a.atMs, b.atMs) || now.getTime(), seq: seq++, item: { f: 'sys', x: `You and ${otherName} swapped contact details` } });
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
  const name = (P?.name || conv.names[other] || '').trim() || 'Northwestern student';
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
      ok: P ? P.nu : true,
      role: P?.year ? `${P.year} · Northwestern` : 'Verified Northwestern account',
      bio: P?.bio ?? '',
      year: P?.year ?? '',
      since: memberSince(P?.joinedAtMs ?? 0),
      joinedMs: P?.joinedAtMs ?? 0,
    },
    r: { key: conv.listingId, ...L, span: L.start && L.end ? dateRange(L.start, L.end) : '' },
    msgs: o.msgs ? timeline(msgs, conv, me, other, name, tab, o.now) : [],
    loaded: !!o.msgs || !!o.draft,
    last: lastLine(conv, me),
    when: whenLabel(conv.updatedAtMs, o.now),
    ord: conv.updatedAtMs || Number.MAX_SAFE_INTEGER,
    unread: isUnread(conv, me),
    taken: !!o.activeCodes && !o.activeCodes.has(conv.listingId),
    blocked: !!conv.blocked[me],
    blockedBy: !!conv.blocked[other],
    settle: settleView(conv.notes, { me, otherName: name, host, listing: L }),
    share: shareView(conv.share, me, other),
    replyTime: replyTime(msgs, me),
  };
}

export type ThreadView = ReturnType<typeof threadView>;
