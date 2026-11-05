// Pure helpers for the profile page (profile.html + src/profile.ts): field cleaning, the checks the
// Firestore rules make before an update, and which Storage files belong to a listing. Also the Saved
// page's pieces (saved.html + src/saved.ts): what a saved card shows and when the page reloads. Tested.
import { CAMPUS_NAME, hasEnded, localDay, type CampusId, type ListingDoc } from './listingView';
import { KIND_LABEL, LAYOUTS, ROLE_LABEL } from './requestsView';

export const MAX_LIVE = 3;
const LISTING_CODE = /^[1-9][0-9]{7}$/;
// A request's id is its owner's uid; src/rentlet.ts saves only ids of this shape.
const REQUEST_ID = /^[A-Za-z0-9]{10,64}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isListingCode(s: unknown): s is string {
  return typeof s === 'string' && LISTING_CODE.test(s);
}

export function isRequestId(s: unknown): s is string {
  return typeof s === 'string' && REQUEST_ID.test(s);
}

// Public profiles show a first name only, at most 24 characters.
export function cleanFirstName(raw: string | null | undefined): string {
  return (raw ?? '').trim().split(/\s+/)[0].slice(0, 24);
}

// Northwestern student accounts are @u.northwestern.edu and staff use @northwestern.edu; anyone else
// signed in with another school's .edu address.
export function affiliation(email: string | null | undefined): string {
  const e = (email ?? '').trim();
  if (/@u\.northwestern\.edu$/i.test(e)) return 'Northwestern student';
  if (/@northwestern\.edu$/i.test(e)) return 'Northwestern';
  return 'School email (.edu)';
}

// "@sam.k", "instagram.com/sam.k/" and " sam.k " all become "sam.k".
export function normalizeInstagram(raw: string | null | undefined): string {
  let s = (raw ?? '').trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i.exec(s);
  if (url) s = url[1];
  return s.replace(/^@+/, '').trim();
}

export function instagramError(handle: string): string {
  if (!handle) return '';
  if (handle.length > 30) return 'Instagram handles are at most 30 characters.';
  return /^[A-Za-z0-9._]+$/.test(handle) ? '' : 'Instagram handles use only letters, numbers, periods and underscores.';
}

export function contactEmailError(email: string): string {
  if (!email) return '';
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Enter a full email address.';
  return '';
}

type Status = ListingDoc['status'];
// What the profile shows for one of your listings: its stored status, or 'ended' once its last day has
// passed (an ended listing shows nowhere, whatever its status says). A taken listing stays "Taken".
export type OwnStatus = Status | 'ended';
const STATUS_ORDER: Record<OwnStatus, number> = { active: 0, hidden: 1, ended: 2, taken: 3 };

export function ownStatus(l: { status: Status; end?: unknown }, today: string = localDay()): OwnStatus {
  return l.status !== 'taken' && hasEnded(l.end, today) ? 'ended' : l.status;
}

// Live listings first, then hidden, then ended, then taken; newest first inside each group.
export function sortOwnListings<T extends { status: OwnStatus; createdAtMs?: number }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4) || (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0),
  );
}

// Listings that count toward the live cap: active and not ended.
export function liveCount(list: { status: OwnStatus; end?: unknown }[], today: string = localDay()): number {
  return list.filter((l) => l.status === 'active' && !hasEnded(l.end, today)).length;
}

// A Firebase Storage download URL ("…/v0/b/<bucket>/o/<encoded path>?alt=media&token=…") -> its path.
export function storagePathFromUrl(url: string | null | undefined): string | null {
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?#]+)/.exec(url ?? '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

// The photos and video uploaded for one listing (src/listings.ts names them
// listings/{uid}/{code}-{n}.jpg and videos/{uid}/{code}.{ext}). Only paths inside the owner's own
// folders and named for this listing are returned, so a delete can never reach anyone else's file.
export function listingFilePaths(l: Pick<ListingDoc, 'code' | 'photos' | 'video'>, uid: string): string[] {
  const photoPrefix = `listings/${uid}/${l.code}-`;
  const videoPrefix = `videos/${uid}/${l.code}.`;
  const out = new Set<string>();
  (Array.isArray(l.photos) ? l.photos : []).forEach((url, i) => {
    const p = storagePathFromUrl(url) ?? `${photoPrefix}${i + 1}.jpg`;
    if (p.startsWith(photoPrefix)) out.add(p);
  });
  const v = storagePathFromUrl(l.video);
  if (v && v.startsWith(videoPrefix)) out.add(v);
  return [...out];
}

// The lease-proof files noted for one listing (listings/{code}/private/proof = {kind, files, sentAt};
// src/listings.ts names them proofs/{uid}/{code}-{n}.{ext}). Only paths directly in the owner's own
// proofs folder and named for this listing are returned, so a delete can never reach anyone else's file.
export function proofFilePaths(code: string, uid: string, note: unknown): string[] {
  const files = note && typeof note === 'object' ? (note as { files?: unknown }).files : null;
  const prefix = `proofs/${uid}/${code}-`;
  const ok = (p: unknown): p is string => typeof p === 'string' && p.startsWith(prefix) && /^[A-Za-z0-9._-]+$/.test(p.slice(prefix.length));
  return [...new Set((Array.isArray(files) ? files : []).filter(ok))];
}

const isDate = (s: unknown): s is string => typeof s === 'string' && ISO_DAY.test(s);
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const maxLen = (v: unknown, n: number) => typeof v === 'string' && v.length <= n;
// firestore.rules bounds a list of strings by its join(' ') length
const joinedLen = (v: unknown[]) => v.reduce<number>((n, x) => n + String(x).length, 0) + Math.max(0, v.length - 1);
const CAMPUS_PAIR: Record<string, string> = { 'nu-evn': 'evanston', 'nu-chi': 'chicago', 'chi-dt': 'downtown' };
const validCampus = (d: Record<string, unknown>) =>
  typeof d.campusId === 'string' && Object.prototype.hasOwnProperty.call(CAMPUS_PAIR, d.campusId) && CAMPUS_PAIR[d.campusId] === d.campus;

// The same checks as validListing() in firestore.rules. An update is accepted only when the whole
// merged document still passes them, so the page asks before sending a status change.
export function validListingShape(d: Record<string, unknown>): boolean {
  const form = d.form;
  return (
    typeof d.ownerId === 'string' &&
    (d.kind === 'sublet' || d.kind === 'takeover') &&
    ['evanston', 'chicago', 'downtown'].includes(d.campus as string) &&
    validCampus(d) &&
    typeof d.title === 'string' && d.title.length > 0 && d.title.length <= 120 &&
    isInt(d.price) && d.price > 0 && d.price <= 20000 &&
    isDate(d.start) && isDate(d.end) && d.start < d.end &&
    ['active', 'taken', 'hidden'].includes(d.status as string) &&
    isListingCode(d.code) &&
    typeof d.ownerName === 'string' && d.ownerName.length <= 60 &&
    (!('ownerPhoto' in d) || maxLen(d.ownerPhoto, 2048)) &&
    typeof d.area === 'string' && d.area.length <= 80 &&
    Array.isArray(d.photos) && d.photos.length > 0 && d.photos.length <= 20 &&
    d.photos.every((p) => typeof p === 'string') && joinedLen(d.photos) <= 20 * 2048 &&
    (!('captions' in d) ||
      (Array.isArray(d.captions) && d.captions.length <= 20 && d.captions.every((c) => typeof c === 'string') && joinedLen(d.captions) <= 20 * 60)) &&
    (!('video' in d) || d.video === null || (maxLen(d.video, 2048) && /^https:\/\/.+$/.test(d.video as string))) &&
    isMap(form) &&
    (!('f' in form) || isMap(form.f)) &&
    (!('multi' in form) || isMap(form.multi)) &&
    (!('prefs' in form) || isMap(form.prefs)) &&
    (!('description' in d) || (typeof d.description === 'string' && d.description.length <= 4000))
  );
}

// The same checks as validRequest() in firestore.rules.
export function validRequestShape(d: Record<string, unknown>): boolean {
  return (
    typeof d.ownerId === 'string' &&
    ['evanston', 'chicago', 'downtown'].includes(d.campus as string) &&
    (!('campusId' in d) || validCampus(d)) &&
    (!('ownerName' in d) || maxLen(d.ownerName, 60)) &&
    (!('ownerPhoto' in d) || maxLen(d.ownerPhoto, 2048)) &&
    (!('org' in d) || maxLen(d.org, 200)) &&
    isDate(d.start) && isDate(d.end) && d.start < d.end &&
    isInt(d.budget) && d.budget > 0 && d.budget <= 20000 &&
    (d.status === 'open' || d.status === 'closed') &&
    (!('note' in d) || (typeof d.note === 'string' && d.note.length <= 2000))
  );
}

const CAMPUS_BY_KEY: Record<string, string> = {
  evanston: CAMPUS_NAME['nu-evn'],
  chicago: CAMPUS_NAME['nu-chi'],
  downtown: CAMPUS_NAME['chi-dt'],
};
const KIND_KEY: Record<string, string> = { room: 'Private room', whole: 'Whole place', either: 'Room or whole place' };
const ROLE_KEY: Record<string, string> = {
  student: 'Student',
  intern: 'Intern',
  newhire: 'New hire',
  researcher: 'Visiting researcher',
  other: 'Other',
};
const NEED: Record<string, string> = {
  'Private room': 'a private room',
  'Whole place': 'a whole place',
  'Room or whole place': 'a room or a whole place',
};

export interface RequestView {
  id: string;
  open: boolean;
  name: string;
  role: string;
  need: string;
  start: string;
  end: string;
  budget: number | null;
  campus: string;
  note: string;
}

// A stored request (src/lib/requestsView.ts RequestDoc) -> what the profile card shows. Missing or
// odd fields fall back quietly; "No max" is stored as the cap with anyPrice set.
export function requestView(id: string, d: Record<string, unknown>, fallbackName: string, fallbackRole: string): RequestView {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const kindRaw = str(d.kind);
  const kind = KIND_KEY[kindRaw] ?? kindRaw;
  const need = NEED[kind] ?? (kind ? `${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind.toLowerCase()}` : 'a place');
  const campusId = str(d.campusId) as CampusId;
  return {
    id,
    open: d.status === 'open',
    name: str(d.ownerName) || str(d.who) || fallbackName,
    role: ROLE_KEY[str(d.role)] ?? (str(d.role) || fallbackRole),
    need,
    start: isDate(d.start) ? d.start : '',
    end: isDate(d.end) ? d.end : '',
    budget: !d.anyPrice && isInt(d.budget) && d.budget > 0 ? d.budget : null,
    campus: CAMPUS_NAME[campusId] ?? CAMPUS_BY_KEY[str(d.campus)] ?? str(d.school),
    note: str(d.note),
  };
}

// ---------- the Saved page (saved.html + src/saved.ts) ----------

// What a saved room's card shows: the homepage's result card (photo, dates, title, price, area, walk).
export interface SavedRoomCard {
  code: string;
  title: string;
  area: string;
  start: string;
  end: string;
  price: number;
  img: string;
  walk: number | null;
  campusId: string;
  savedAtMs: number;
}

export function savedRoomCard(l: ListingDoc, savedAtMs: number): SavedRoomCard {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    code: l.code,
    title: str(l.title) || 'Room',
    area: str(l.area),
    start: isDate(l.start) ? l.start : '',
    end: isDate(l.end) ? l.end : '',
    price: Number(l.price) || 0,
    img: Array.isArray(l.photos) ? str(l.photos[0]) : '',
    walk: typeof l.walk === 'number' ? l.walk : null,
    campusId: str(l.campusId),
    savedAtMs,
  };
}

// What a saved request's card shows: the same fields, labels and fallbacks as a Requests page card
// (toRow in requestsView.ts), read defensively because the stored document is someone else's.
export interface SavedRequestCard {
  id: string;
  who: string;
  photo: string;
  role: string;
  kind: string;
  layouts: string[];
  start: string;
  end: string;
  budget: number | null; // null: any price
  savedAtMs: number;
}

export function savedRequestCard(id: string, d: Record<string, unknown>, savedAtMs: number): SavedRequestCard {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const kind = str(d.kind) as keyof typeof KIND_LABEL;
  const role = str(d.role) as keyof typeof ROLE_LABEL;
  return {
    id,
    who: str(d.ownerName) || 'Student',
    photo: /^https:\/\//.test(str(d.ownerPhoto)) ? str(d.ownerPhoto) : '',
    role: ROLE_LABEL[role] ?? 'Student',
    kind: KIND_LABEL[kind] ?? KIND_LABEL.room,
    layouts: (Array.isArray(d.layouts) ? d.layouts : []).filter((x): x is string => (LAYOUTS as readonly unknown[]).includes(x)),
    start: isDate(d.start) ? d.start : '',
    end: isDate(d.end) ? d.end : '',
    budget: !d.anyPrice && isInt(d.budget) && d.budget > 0 ? d.budget : null,
    savedAtMs,
  };
}

// One saved request after looking it up: 'open' while it is open and its move-in day hasn't passed
// (the Requests page shows it until then); 'gone' when it was paused, deleted or has expired (the rules
// let only its owner read a request that isn't open, so everyone else gets permission-denied);
// 'error' when the lookup itself failed and the answer is unknown.
export function savedRequestState(
  d: Record<string, unknown> | null | undefined,
  errorCode: string | null,
  today: string,
): 'open' | 'gone' | 'error' {
  if (errorCode) return errorCode === 'permission-denied' || errorCode === 'not-found' ? 'gone' : 'error';
  if (!d || d.status !== 'open') return 'gone';
  return isDate(d.start) && d.start >= today ? 'open' : 'gone';
}

// One group of saved things (rooms or requests) after each one was looked up: a card for each that is
// still listed or open, the ids of the ones that are gone, and how many lookups failed.
export interface SavedGroupLoad<T> {
  ids: string[];
  items: T[];
  gone: string[];
  failed: number;
}

export function sortLookups<T>(ids: string[], found: (T | 'gone' | 'error')[]): SavedGroupLoad<T> {
  const items: T[] = [];
  const gone: string[] = [];
  let failed = 0;
  found.forEach((r, i) => {
    if (r === 'error') failed++;
    else if (r === 'gone') gone.push(ids[i]);
    else items.push(r);
  });
  return { ids: [...ids], items, gone, failed };
}

// What a Saved tab shows: 'error' when its list couldn't be read, or when nothing is left to show and
// some lookups failed (an empty tab would be wrong). Lookups that fail beside cards that loaded are left out.
export type SavedGroup<T> = 'error' | { items: T[]; gone: string[] };

export function savedGroup<T>(load: SavedGroupLoad<T> | null): SavedGroup<T> {
  if (!load || (load.failed > 0 && !load.items.length && !load.gone.length)) return 'error';
  return { items: load.items, gone: load.gone };
}

// One string for a set of saved rooms and requests, the same whatever the order, so the Saved page
// can tell whether what it shows still matches what is saved (src/rentlet.ts's rentlet:saves event).
export function savesKey(room: Iterable<string>, request: Iterable<string>): string {
  const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort().join(',');
  return `room:${sorted(room)}|request:${sorted(request)}`;
}

export type SaveKind = 'room' | 'request';
export interface SavedIds {
  room: string[];
  request: string[];
}

// Keeps the Saved page in step with what is saved, as src/rentlet.ts reports it after every change
// (the rentlet:saves event), without fighting removals and undos made on the page itself.
// src/saved.ts reports what happens; check() says when to reload the page quietly.
//  - shown: the saved ids the page was built from (null: a group that couldn't be read), kept in
//    step with removals made here once Firestore has them.
//  - While a removal or undo is in flight, or a load is running, it never asks for a reload; a quiet
//    reload that was running while one landed has its answer dropped, then it checks again.
//  - It asks once per saved set: a reload that still can't match (a list that won't load) isn't repeated
//    until the saved set changes again.
export class SavedSync {
  private shown: Record<SaveKind, Set<string> | null> = { room: null, request: null };
  private latest: SavedIds | null = null;
  private loading = false;
  private pending = 0;
  private writes = 0;
  private answered = '';

  // a new account (or none): nothing is shown yet
  reset(): void {
    this.shown = { room: null, request: null };
    this.loading = false;
    this.answered = '';
  }

  saved(latest: SavedIds): void {
    this.latest = { room: [...latest.room], request: [...latest.request] };
  }

  // returns a mark to hand back to loaded()
  loadStarted(): number {
    this.loading = true;
    return this.writes;
  }

  // ids: what the answer was built from, or null when the load failed. Returns false when the answer
  // must not be shown (a quiet reload overtaken by a removal or undo made here).
  loaded(mark: number, quiet: boolean, ids: { room: string[] | null; request: string[] | null } | null): boolean {
    this.loading = false;
    if (quiet && (this.pending || this.writes !== mark)) {
      this.answered = '';
      return false;
    }
    if (ids) this.shown = { room: ids.room && new Set(ids.room), request: ids.request && new Set(ids.request) };
    else if (!quiet) this.shown = { room: null, request: null };
    return true;
  }

  writeStarted(): void {
    this.pending++;
    this.writes++;
  }

  writeEnded(kind: SaveKind, ids: string[], on: boolean, ok: boolean): void {
    this.pending = Math.max(0, this.pending - 1);
    const set = this.shown[kind];
    if (ok && set) ids.forEach((id) => (on ? set.add(id) : set.delete(id)));
  }

  // the next check() may reload even for a saved set it already reloaded for ("Try again")
  retry(): void {
    this.answered = '';
  }

  check(): boolean {
    if (!this.latest || this.pending || this.loading) return false;
    const want = savesKey(this.latest.room, this.latest.request);
    const { room, request } = this.shown;
    if (room && request && savesKey(room, request) === want) {
      this.answered = '';
      return false;
    }
    if (want === this.answered) return false;
    this.answered = want;
    return true;
  }
}
