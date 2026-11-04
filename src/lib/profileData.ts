// Pure helpers for the profile page (profile.html + src/profile.ts): field cleaning, the checks the
// Firestore rules make before an update, and which Storage files belong to a listing. Tested.
import { CAMPUS_NAME, type CampusId, type ListingDoc } from './listingView';
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

// Student accounts are @u.northwestern.edu; staff and instructors use @northwestern.edu.
export function affiliation(email: string | null | undefined): string {
  return /@u\.northwestern\.edu$/i.test((email ?? '').trim()) ? 'Northwestern student' : 'Northwestern';
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
const STATUS_ORDER: Record<Status, number> = { active: 0, hidden: 1, taken: 2 };

// Live listings first, then hidden, then taken; newest first inside each group.
export function sortOwnListings<T extends { status: Status; createdAtMs?: number }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0),
  );
}

export function liveCount(list: { status: Status }[]): number {
  return list.filter((l) => l.status === 'active').length;
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

const isDate = (s: unknown): s is string => typeof s === 'string' && ISO_DAY.test(s);
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

// The same checks as validListing() in firestore.rules. An update is accepted only when the whole
// merged document still passes them, so the page asks before sending a status change.
export function validListingShape(d: Record<string, unknown>): boolean {
  return (
    typeof d.ownerId === 'string' &&
    (d.kind === 'sublet' || d.kind === 'takeover') &&
    ['evanston', 'chicago', 'downtown'].includes(d.campus as string) &&
    typeof d.title === 'string' && d.title.length > 0 && d.title.length <= 120 &&
    isInt(d.price) && d.price > 0 && d.price <= 20000 &&
    isDate(d.start) && isDate(d.end) && d.start < d.end &&
    ['active', 'taken', 'hidden'].includes(d.status as string) &&
    isListingCode(d.code) &&
    typeof d.ownerName === 'string' && d.ownerName.length <= 60 &&
    typeof d.area === 'string' && d.area.length <= 80 &&
    Array.isArray(d.photos) && d.photos.length > 0 && d.photos.length <= 20 &&
    (!('description' in d) || (typeof d.description === 'string' && d.description.length <= 4000))
  );
}

// The same checks as validRequest() in firestore.rules.
export function validRequestShape(d: Record<string, unknown>): boolean {
  return (
    typeof d.ownerId === 'string' &&
    ['evanston', 'chicago', 'downtown'].includes(d.campus as string) &&
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

// ---------- saved requests (the profile's Saved section) ----------

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
    who: str(d.ownerName) || 'Northwestern student',
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

// One string for a set of saved rooms and requests, the same whatever the order, so the Saved section
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

// Keeps the profile's Saved section in step with what is saved, as src/rentlet.ts reports it after
// every change (the rentlet:saves event), without fighting removals and undos made on the section
// itself. src/profile.ts reports what happens; check() says when to reload the section quietly.
//  - shown: the saved ids the section was built from (null: a group that couldn't be read), kept in
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
