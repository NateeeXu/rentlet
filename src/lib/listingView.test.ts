import { describe, expect, it } from 'vitest';
import { areaFromAddress, bedrooms, titleOf, toCard, toRoom, type ListingDoc, type PostForm } from './listingView';

const form: PostForm = {
  subletType: 'sublet',
  transferChannel: 'official',
  dep: 'amount',
  refund: true,
  map: false,
  hasRoommates: 'yes',
  gender: 'Mixed',
  shuttle: 'covered',
  route: 'Intercampus Shuttle',
  layout: '2B1B',
  start: '2027-06-01',
  end: '2027-08-31',
  rent: 1250,
  orig: 1400,
  unit: 'room',
  bath: 'shared',
  furn: 'full',
  neg: 'little',
  view: null,
  terms: null,
  proof: 'student',
  campus: 'Northwestern · Evanston',
  campusId: 'nu-evn',
  multi: { fees: ['Wi-Fi', 'Heat'], amen: ['Washer & dryer', 'Elevator'], habits: ['Quiet weeknights'], items: ['Bed frame', 'Desk', 'Sofa'] },
  prefs: { Smoking: 'No smoking', Pets: 'Pets OK', Visitors: 'OK with notice' },
  f: { dep: '$600', extra: '60', rmN: '1', rmWho: 'Grad student', sqft: '140', floor: '3', note: 'Away for my summer internship.' },
};

const listing: ListingDoc = {
  ownerId: 'u1',
  ownerName: 'Emily',
  ownerPhoto: '',
  status: 'active',
  code: '48271936',
  campus: 'evanston',
  campusId: 'nu-evn',
  kind: 'sublet',
  title: 'Private room in a 2-bed',
  area: 'Evanston',
  price: 1250,
  start: '2027-06-01',
  end: '2027-08-31',
  photos: ['https://example.test/a.jpg', 'https://example.test/b.jpg'],
  captions: ['Bedroom', 'Kitchen'],
  video: null,
  walk: null,
  form,
};

describe('titles', () => {
  it('reads bedrooms from the layout code', () => {
    expect(bedrooms('3B2B')).toBe(3);
    expect(bedrooms('Studio')).toBe(0);
  });
  it('uses the approved listing wording', () => {
    expect(titleOf({ unit: 'room', layout: '3B2B', f: {} })).toBe('Private room in a 3-bed');
    expect(titleOf({ unit: 'whole', layout: 'Studio', f: {} })).toBe('Studio');
    expect(titleOf({ unit: 'whole', layout: '1B1B', f: {} })).toBe('Entire 1-bed apartment');
    expect(titleOf({ unit: 'room', layout: 'Other', f: { layoutOther: '4b2b' } })).toBe('Private room in a 4-bed');
  });
});

describe('areaFromAddress', () => {
  it('names the neighbourhood from the ZIP code', () => {
    expect(areaFromAddress('1890 Maple Ave, Evanston, IL 60201', 'nu-evn')).toBe('Evanston');
    expect(areaFromAddress('300 E Superior St, Chicago, IL 60611', 'nu-chi')).toBe('Streeterville');
  });
  it('falls back to the town, then the campus', () => {
    expect(areaFromAddress('Maple Ave, Evanston', 'nu-evn')).toBe('Evanston');
    expect(areaFromAddress('', 'chi-dt')).toBe('Downtown Chicago');
  });
});

describe('page shapes', () => {
  it('escapes everything a host typed before the pages put it into HTML', () => {
    const evil = { ...listing, ownerName: '<img src=x onerror=alert(1)>', form: { ...form, f: { ...form.f, note: '"><script>x()</script>', rmWho: 'A & B' } } };
    const r = toRoom(evil);
    expect(r.who).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(r.about).toBe('&quot;&gt;&lt;script&gt;x()&lt;/script&gt;');
    expect(r.matesText).toContain('a &amp; b');
    expect(toCard(evil).who).not.toContain('<');
  });
  it('builds the homepage card', () => {
    const c = toCard(listing);
    expect(c).toMatchObject({ id: '48271936', key: '48271936', type: 'Short sublet', who: 'Emily', img: 'https://example.test/a.jpg', school: 'nu-evn', laundry: true });
  });
  it('builds the room page object', () => {
    const r = toRoom(listing);
    expect(r.photos).toEqual([
      ['https://example.test/a.jpg', 'Bedroom'],
      ['https://example.test/b.jpg', 'Kitchen'],
    ]);
    expect(r.deposit).toBe(600);
    expect(r.util).toBe(60);
    expect(r.included).toBe('Wi-Fi + Heat');
    expect(r.furn).toEqual(['bedframe', 'desk']);
    expect(r.prefs).toEqual([
      { k: 'smoking', t: 'No smoking' },
      { k: 'pets', t: 'Pets OK' },
      { k: 'visitors', t: 'Guests with notice' },
    ]);
    expect(r.matesText).toBe('1 grad student, quiet weeknights.');
    expect(r.facts[0]).toEqual(['info-layout', '1 of 2 beds', '~140 sq ft']);
    expect(r.orig).toBe(1400);
    expect(r.about).toBe('Away for my summer internship.');
  });
});

// What a host must answer on the post form; everything else left empty, as the form now stores it.
const required: PostForm = {
  subletType: 'sublet',
  transferChannel: 'official',
  dep: 'none',
  refund: null,
  map: true,
  hasRoommates: 'yes',
  gender: '',
  shuttle: 'unknown',
  route: '',
  layout: '3B2B',
  start: '2027-06-01',
  end: '2027-08-31',
  rent: 1300,
  orig: null,
  unit: 'room',
  bath: 'shared',
  furn: 'full',
  neg: null,
  view: null,
  terms: null,
  proof: 'student',
  campus: 'Northwestern · Evanston',
  campusId: 'nu-evn',
  multi: { fees: [], amen: [], habits: [], items: [] },
  prefs: {},
  f: { rmN: '2' },
};
const bare: ListingDoc = { ...listing, price: 1300, form: required };

describe('a listing with only the required answers', () => {
  const r = toRoom(bare);
  it('invents no facts the host did not give', () => {
    expect(r.orig).toBe(0);
    expect(r.neg).toBe(false);
    expect(r.util).toBeNull();
    expect(r.deposit).toBe(0);
    expect(r.refund).toBe('');
    expect(r.included).toBe('');
    expect(r.rentOnly).toBe(false);
    expect(r.amen).toEqual([]);
    expect(r.furn).toEqual([]);
    expect(r.furnMore).toEqual([]);
    expect(r.prefs).toEqual([]);
    expect(r.about).toBe('');
    expect(r.extra).toBe('');
    expect(r.usage).toBe('');
    expect(r.sqft).toBeNull();
  });
  it('leaves unanswered facts blank or asks the host', () => {
    expect(r.facts).toEqual([
      ['info-layout', '1 of 3 beds', ''],
      ['info-bathroom', 'Shared bath', 'With 2 roommates'],
      ['info-floor', 'Floor', 'Ask the host'],
      ['wash', 'Laundry', 'Ask the host'],
    ]);
    expect(r.mates).toEqual(['R', 'R']);
    expect(r.matesText).toBe('2 roommates.');
    expect(r.mate).toEqual({ gender: '', identity: '', schedule: 'Ask the host', cooking: 'Ask the host', clean: 'Ask the host', guests: 'Ask the host', note: '' });
  });
  it('keeps what the host chose for the furniture', () => {
    expect(r.furnished).toBe('Fully furnished');
    expect(r.terms).toBe('use');
    expect(toRoom({ ...bare, form: { ...required, furn: 'none' } }).terms).toBeNull();
    const some = toRoom({ ...bare, form: { ...required, furn: 'part', multi: { ...required.multi, items: ['Desk', 'Sofa', 'TV'] } } });
    expect(some.furn).toEqual(['desk']);
    expect(some.furnMore).toEqual(['Sofa', 'TV']);
  });
  it('copes with a form missing the optional groups altogether', () => {
    const thin = { ...required } as Partial<PostForm>;
    delete thin.multi;
    delete thin.prefs;
    const t = toRoom({ ...bare, form: thin as PostForm });
    expect(t.prefs).toEqual([]);
    expect(t.amen).toEqual([]);
    expect(toCard({ ...bare, form: thin as PostForm }).laundry).toBe(false);
  });
});

describe('room page answers', () => {
  it('says refundable or non-refundable only as the host answered', () => {
    const dep = (refund: boolean | null, amount = '$600') => toRoom({ ...bare, form: { ...required, dep: 'amount', refund, f: { ...required.f, dep: amount } } });
    expect(dep(true)).toMatchObject({ deposit: 600, refund: 'yes' });
    expect(dep(false)).toMatchObject({ deposit: 600, refund: 'no' });
    expect(dep(null)).toMatchObject({ deposit: 600, refund: '' });
    expect(dep(true, '')).toMatchObject({ deposit: null, refund: '' });
    expect(toRoom({ ...bare, form: { ...required, refund: true } })).toMatchObject({ deposit: 0, refund: '' });
  });
  it('shows only verification something backs', () => {
    expect(toRoom(bare).ver).toEqual({ student: 'ok', lease: 'none', landlord: 'none' });
    expect(toRoom({ ...bare, form: { ...required, proof: 'lease' } }).ver).toEqual({ student: 'ok', lease: 'pending', landlord: 'none' });
    expect(toRoom(listing).ver.landlord).toBe('none');
  });
  it('shows the view whether or not there is an elevator', () => {
    const v = (amen: string[], view: string | null, floor = '') =>
      toRoom({ ...bare, form: { ...required, view, multi: { ...required.multi, amen }, f: { ...required.f, floor } } }).facts[2];
    expect(v(['Elevator'], 'Lake', '5')).toEqual(['info-floor', '5th floor', 'Elevator · Lake view']);
    expect(v([], 'Lake')).toEqual(['info-floor', 'Floor', 'Lake view']);
    expect(v(['Elevator'], null)).toEqual(['info-floor', 'Floor', 'Elevator']);
    expect(v([], null, '2')).toEqual(['info-floor', '2nd floor', '']);
    expect(v([], '<b>')[2]).toBe('&lt;b&gt; view');
  });
  it('marks the rent negotiable only when the host said so', () => {
    expect(toRoom({ ...bare, form: { ...required, neg: 'little' } }).neg).toBe(true);
    expect(toRoom({ ...bare, form: { ...required, neg: 'no' } }).neg).toBe(false);
  });
  it('reads other costs, what the rent includes and the original rent as given', () => {
    const r = (f: Partial<PostForm>, extra?: string) => toRoom({ ...bare, form: { ...required, ...f, f: { ...required.f, ...(extra === undefined ? {} : { extra }) } } });
    expect(r({}, '0').util).toBe(0);
    expect(r({}, '$75').util).toBe(75);
    expect(r({ multi: { ...required.multi, fees: ['Nothing extra'] } })).toMatchObject({ included: '', rentOnly: true });
    expect(r({ multi: { ...required.multi, fees: ['Water', 'Heat'] } })).toMatchObject({ included: 'Water + Heat', rentOnly: false });
    expect(r({ orig: 1500 }).orig).toBe(1500);
    expect(r({ orig: 1200 }).orig).toBe(0);
  });
  it('shows the roommate note and the house-rules note, escaped', () => {
    const r = toRoom({ ...bare, form: { ...required, gender: 'Mixed', f: { ...required.f, rmWho: 'Grad students', rmNote: 'Both <quiet>', ruleNote: 'No shoes & no smoke' } } });
    expect(r.mate).toMatchObject({ gender: 'Mixed', identity: 'Grad students', note: 'Both &lt;quiet&gt;' });
    expect(r.usage).toBe('No shoes &amp; no smoke');
  });
});
