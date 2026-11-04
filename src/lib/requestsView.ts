// Requests (people looking for a place): what request.html publishes, and the shapes the moved-over
// pages already render (requests.html's REQ rows, index.html's Q rows). Pure functions, tested.
import { CAMPUS_KEY, CAMPUS_NAME, layoutCode, type CampusId, type CampusKey, type ListingDoc } from './listingView';

export type RequestKind = 'room' | 'whole' | 'either';
export type Near = 'any' | 'walk' | 'shuttle';
export type Flex = 'exact' | '3d' | '1w';
export type Furn = 'full' | 'part' | 'any';
export type Mates = 'yes' | 'no' | 'depends';
export type Role = 'student' | 'intern' | 'newhire' | 'researcher' | 'other';

// The rules allow a budget from $1 to $20,000; "No max" is stored as the cap with anyPrice set.
export const MAX_BUDGET = 20000;
export const NAME_MAX = 40;
export const NOTE_MAX = 160;
export const ORG_MAX = 80;

export const KIND_LABEL: Record<RequestKind, string> = {
  room: 'Private room',
  whole: 'Whole place',
  either: 'Room or whole place',
};
export const ROLE_LABEL: Record<Role, string> = {
  student: 'Student',
  intern: 'Intern',
  newhire: 'New hire',
  researcher: 'Visiting researcher',
  other: 'Other',
};
export const LIFE = ['Quiet', 'Early riser', 'Night owl', 'Cooks often', 'Non-smoker', 'Has a pet', 'Works from home'];

const NEARS: Near[] = ['any', 'walk', 'shuttle'];
const FLEXES: Flex[] = ['exact', '3d', '1w'];
const FURNS: Furn[] = ['full', 'part', 'any'];
const MATES: Mates[] = ['yes', 'no', 'depends'];

const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d);
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clip = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();

// What request.html's form keeps (its S), minus screen state.
export interface RequestForm {
  campusId: string;
  near: string;
  start: string;
  end: string;
  flex: string;
  budget: number | null; // Infinity (or null after a JSON round trip) is "No max"
  util: boolean;
  kind: string;
  furn: string;
  bath: boolean;
  mates: string;
  role: string;
  orgMode: string;
  multi: { life: string[] };
  f: Record<string, string>;
}

// requests/{id} in Firestore. Everything here is public: first name and Google photo, never email.
export interface RequestDoc {
  ownerId: string;
  ownerName: string;
  ownerPhoto: string;
  status: 'open' | 'closed';
  campus: CampusKey;
  campusId: CampusId;
  start: string;
  end: string;
  budget: number;
  anyPrice: boolean;
  kind: RequestKind;
  near: Near;
  flex: Flex;
  util: boolean;
  furn: Furn;
  bath: boolean;
  mates: Mates;
  role: Role;
  org?: string;
  life: string[];
  note?: string;
}

export type BuildError = 'name' | 'dates' | 'campus';
export type Built = { ok: true; doc: RequestDoc } | { ok: false; error: BuildError };

// The form -> the stored request. Checks what firestore.rules' validRequest checks, plus a name and
// a move-in that has not passed.
export function buildRequest(form: RequestForm, owner: { uid: string; photo: string }, today: string): Built {
  if (!(form.campusId in CAMPUS_KEY)) return { ok: false, error: 'campus' };
  const campusId = form.campusId as CampusId;
  if (!isDate(form.start) || !isDate(form.end) || form.start >= form.end || form.start < today) return { ok: false, error: 'dates' };
  const ownerName = clip(form.f?.name, NAME_MAX);
  if (!ownerName) return { ok: false, error: 'name' };

  const any = form.budget == null || !Number.isFinite(form.budget);
  const budget = any ? MAX_BUDGET : Math.min(MAX_BUDGET, Math.max(1, Math.round(Number(form.budget) || 0)));
  const role = pick(Object.keys(ROLE_LABEL) as Role[], form.role, 'student');
  const org = role !== 'student' && form.orgMode === 'other' ? clip(form.f?.org, ORG_MAX) : '';
  const note = clip(form.f?.line, NOTE_MAX);

  const doc: RequestDoc = {
    ownerId: owner.uid,
    ownerName,
    ownerPhoto: owner.photo || '',
    status: 'open',
    campus: CAMPUS_KEY[campusId],
    campusId,
    start: form.start,
    end: form.end,
    budget,
    anyPrice: any,
    kind: pick(Object.keys(KIND_LABEL) as RequestKind[], form.kind, 'room'),
    near: pick(NEARS, form.near, 'any'),
    flex: pick(FLEXES, form.flex, 'exact'),
    util: !!form.util,
    furn: pick(FURNS, form.furn, 'any'),
    bath: !!form.bath,
    mates: pick(MATES, form.mates, 'yes'),
    role,
    life: LIFE.filter((x) => (form.multi?.life || []).includes(x)),
  };
  if (org) doc.org = org;
  if (note) doc.note = note;
  return { ok: true, doc };
}

// A stored request -> the form, for "Edit" on the requests page.
export function formFromRequest(d: RequestDoc) {
  return {
    campusId: d.campusId,
    campus: CAMPUS_NAME[d.campusId] ?? CAMPUS_NAME['nu-evn'],
    near: d.near,
    start: d.start,
    end: d.end,
    flex: d.flex,
    budget: d.anyPrice ? Infinity : d.budget,
    util: !!d.util,
    kind: d.kind,
    furn: d.furn,
    bath: !!d.bath,
    mates: d.mates,
    role: d.role,
    orgMode: d.org ? 'other' : 'campus',
    multi: { life: [...(d.life || [])] },
    f: { name: d.ownerName || '', line: d.note || '', ...(d.org ? { org: d.org } : {}) },
  };
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// requests.html REQ row / index.html Q row
export interface RequestRow {
  id: string;
  uid: string;
  who: string;
  photo: string;
  role: string;
  kind: string;
  start: string;
  end: string;
  budget: number | null;
  campusId: CampusId;
  school: string;
  near: Near;
  flex: Flex;
  util: boolean;
  furn: Furn;
  bath: boolean;
  mates: Mates;
  org: string;
  life: string[];
  note: string;
  verified: boolean;
  posted: string;
  active: string;
  createdAtMs: number;
}

export function toRow(id: string, d: RequestDoc, createdAtMs: number, updatedAtMs: number = createdAtMs): RequestRow {
  const campusId = (d.campusId in CAMPUS_NAME ? d.campusId : 'nu-evn') as CampusId;
  return {
    id,
    uid: d.ownerId,
    who: d.ownerName || 'Northwestern student',
    photo: d.ownerPhoto || '',
    role: ROLE_LABEL[d.role] ?? 'Student',
    kind: KIND_LABEL[d.kind] ?? KIND_LABEL.room,
    start: d.start,
    end: d.end,
    budget: d.anyPrice ? null : d.budget,
    campusId,
    school: CAMPUS_NAME[campusId],
    near: d.near ?? 'any',
    flex: d.flex ?? 'exact',
    util: !!d.util,
    furn: d.furn ?? 'any',
    bath: !!d.bath,
    mates: d.mates ?? 'yes',
    org: d.org ?? '',
    life: d.life ?? [],
    note: d.note ?? '',
    // only signed-in Northwestern accounts can post (firestore.rules)
    verified: true,
    posted: isoDay(createdAtMs),
    active: isoDay(Math.max(createdAtMs, updatedAtMs)),
    createdAtMs,
  };
}

// A request is shown until its move-in day.
export const isLive = (r: Pick<RequestRow, 'start'>, today: string) => r.start >= today;

export function liveRows(rows: RequestRow[], today: string): RequestRow[] {
  return rows.filter((r) => isLive(r, today)).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

// requests.html's L (your listing) for its matching rule
export function toMatchListing(d: ListingDoc) {
  return {
    code: d.code,
    title: d.title,
    campusId: d.campusId,
    area: d.area,
    walk: d.walk ?? null,
    unit: d.form.unit,
    layout: layoutCode(d.form),
    start: d.start,
    end: d.end,
    rent: d.price,
    fees: [...(d.form.multi?.fees || [])],
    furn: d.form.furn,
    shuttle: d.form.shuttle,
    createdAtMs: d.createdAtMs ?? 0,
  };
}

type Pickable = { code: string; campusId: string; start: string; end: string; createdAtMs?: number };

// Which of your listings a message to this person is about: one at their campus whose dates overlap
// theirs, else one at their campus, else your newest.
export function pickListingFor<T extends Pickable>(r: Pick<RequestRow, 'campusId' | 'start' | 'end'>, mine: T[]): T | null {
  if (!mine.length) return null;
  const newest = [...mine].sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  const here = newest.filter((l) => l.campusId === r.campusId);
  return here.find((l) => l.start < r.end && r.start < l.end) ?? here[0] ?? newest[0];
}

// messages.html opens the conversation about a listing with one person.
export const messageHref = (listingCode: string, withUid: string) =>
  `messages.html?listing=${encodeURIComponent(listingCode)}&with=${encodeURIComponent(withUid)}`;
