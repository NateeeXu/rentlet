import { describe, expect, it } from 'vitest';
import type { ListingDoc } from './listingView';
import {
  buildRequest,
  formFromRequest,
  liveRows,
  MAX_BUDGET,
  messageHref,
  pickListingFor,
  toMatchListing,
  toRow,
  type RequestForm,
} from './requestsView';

const TODAY = '2026-11-04';
const owner = { uid: 'u1', photo: 'https://lh3.googleusercontent.com/a/x' };

const form = (over: Partial<RequestForm> = {}): RequestForm => ({
  campusId: 'nu-evn',
  near: 'walk',
  start: '2027-01-03',
  end: '2027-03-20',
  flex: '3d',
  budget: 1450,
  util: true,
  kind: 'room',
  furn: 'full',
  bath: false,
  mates: 'depends',
  role: 'student',
  orgMode: 'campus',
  multi: { life: ['Quiet', 'Non-smoker', 'Not a real option'] },
  f: { name: '  Riley  ', line: ' Winter quarter only.  ' },
  ...over,
});

describe('buildRequest', () => {
  it('stores what the rules check plus the public extras, never an email', () => {
    const r = buildRequest(form(), owner, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc).toMatchObject({
      ownerId: 'u1',
      ownerName: 'Riley',
      ownerPhoto: owner.photo,
      status: 'open',
      campus: 'evanston',
      campusId: 'nu-evn',
      start: '2027-01-03',
      end: '2027-03-20',
      budget: 1450,
      anyPrice: false,
      kind: 'room',
      near: 'walk',
      flex: '3d',
      util: true,
      furn: 'full',
      mates: 'depends',
      role: 'student',
      life: ['Quiet', 'Non-smoker'],
      note: 'Winter quarter only.',
    });
    expect('org' in r.doc).toBe(false);
    expect(JSON.stringify(r.doc)).not.toMatch(/@/);
  });

  it('keeps the budget an integer the rules accept, and stores No max as the cap', () => {
    const any = buildRequest(form({ budget: Infinity }), owner, TODAY);
    expect(any.ok && any.doc.budget === MAX_BUDGET && any.doc.anyPrice).toBe(true);
    const json = buildRequest(form({ budget: null }), owner, TODAY);
    expect(json.ok && json.doc.anyPrice).toBe(true);
    const odd = buildRequest(form({ budget: 1234.6 }), owner, TODAY);
    expect(odd.ok && odd.doc.budget).toBe(1235);
  });

  it('refuses a missing name, bad or past dates, and an unknown campus', () => {
    expect(buildRequest(form({ f: { name: '  ' } }), owner, TODAY)).toEqual({ ok: false, error: 'name' });
    expect(buildRequest(form({ start: '', end: '' }), owner, TODAY)).toEqual({ ok: false, error: 'dates' });
    expect(buildRequest(form({ start: '2027-03-20', end: '2027-01-03' }), owner, TODAY)).toEqual({ ok: false, error: 'dates' });
    expect(buildRequest(form({ start: '2026-11-01' }), owner, TODAY)).toEqual({ ok: false, error: 'dates' });
    expect(buildRequest(form({ campusId: 'mit' }), owner, TODAY)).toEqual({ ok: false, error: 'campus' });
  });

  it('keeps a company only for people who are not students, and trims long text', () => {
    const intern = buildRequest(form({ role: 'intern', orgMode: 'other', f: { name: 'Sam', org: ' Acme ', line: 'x'.repeat(400) } }), owner, TODAY);
    expect(intern.ok && intern.doc.org).toBe('Acme');
    expect(intern.ok && intern.doc.note?.length).toBe(160);
    const student = buildRequest(form({ orgMode: 'other', f: { name: 'Sam', org: 'Acme' } }), owner, TODAY);
    expect(student.ok && 'org' in student.doc).toBe(false);
    const noLine = buildRequest(form({ f: { name: 'Sam' } }), owner, TODAY);
    expect(noLine.ok && 'note' in noLine.doc).toBe(false);
  });
});

describe('rows', () => {
  const built = buildRequest(form({ kind: 'either', budget: Infinity }), owner, TODAY);
  const doc = built.ok ? built.doc : null!;

  it('renders the shapes the pages already use', () => {
    const row = toRow('r1', doc, Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 28));
    expect(row).toMatchObject({
      id: 'r1',
      uid: 'u1',
      who: 'Riley',
      role: 'Student',
      kind: 'Room or whole place',
      budget: null,
      school: 'Northwestern · Evanston',
      verified: true,
      posted: '2026-10-20',
      active: '2026-10-28',
    });
  });

  it('round-trips through the edit form', () => {
    const back = formFromRequest(doc);
    expect(back.budget).toBe(Infinity);
    const again = buildRequest({ ...back, budget: back.budget }, owner, TODAY);
    expect(again.ok && again.doc).toEqual(doc);
  });

  it('shows a request until its move-in day, newest first', () => {
    const a = toRow('a', { ...doc, start: '2026-11-04' }, 2);
    const b = toRow('b', { ...doc, start: '2026-11-03' }, 3);
    const c = toRow('c', doc, 5);
    expect(liveRows([a, b, c], TODAY).map((r) => r.id)).toEqual(['c', 'a']);
  });
});

describe('listings for messages and matches', () => {
  const l = (code: string, campusId: ListingDoc['campusId'], start: string, end: string, createdAtMs: number) => ({ code, campusId, start, end, createdAtMs });
  const req = { campusId: 'nu-evn' as const, start: '2027-01-03', end: '2027-03-20' };

  it('picks your listing at their campus whose dates overlap, then at their campus, then your newest', () => {
    const chi = l('11111111', 'nu-chi', '2027-01-01', '2027-03-01', 9);
    const evnLate = l('22222222', 'nu-evn', '2027-06-01', '2027-08-31', 8);
    const evnFit = l('33333333', 'nu-evn', '2026-12-20', '2027-03-15', 1);
    expect(pickListingFor(req, [chi, evnLate, evnFit])?.code).toBe('33333333');
    expect(pickListingFor(req, [chi, evnLate])?.code).toBe('22222222');
    expect(pickListingFor(req, [chi])?.code).toBe('11111111');
    expect(pickListingFor(req, [])).toBeNull();
  });

  it('links a conversation by listing and person', () => {
    expect(messageHref('48271936', 'abc/def')).toBe('messages.html?listing=48271936&with=abc%2Fdef');
  });

  it('turns a listing into the matching rule’s shape', () => {
    const d = {
      code: '48271936',
      title: 'Private room in a 3-bed',
      campusId: 'nu-evn',
      area: 'Evanston',
      walk: null,
      price: 1480,
      start: '2026-12-20',
      end: '2027-03-15',
      createdAtMs: 7,
      form: { unit: 'room', layout: '3B2B', f: {}, furn: 'full', shuttle: 'covered', multi: { fees: ['Wi-Fi', 'Heat'], amen: [], habits: [], items: [] } },
    } as unknown as ListingDoc;
    expect(toMatchListing(d)).toEqual({
      code: '48271936',
      title: 'Private room in a 3-bed',
      campusId: 'nu-evn',
      area: 'Evanston',
      walk: null,
      unit: 'room',
      layout: '3B2B',
      start: '2026-12-20',
      end: '2027-03-15',
      rent: 1480,
      fees: ['Wi-Fi', 'Heat'],
      furn: 'full',
      shuttle: 'covered',
      createdAtMs: 7,
    });
  });
});
