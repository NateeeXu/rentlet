import { describe, expect, it } from 'vitest';
import {
  areaFromAddress,
  bedrooms,
  campusOf,
  hasEnded,
  liveList,
  localDay,
  titleOf,
  toCard,
  toRoom,
  usableListing,
  type ListingDoc,
  type PostForm,
} from './listingView';

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

// A stored listing is someone else's data: the rules may not have checked it (an older listing, or rules
// not yet deployed), so the mappers must never throw and never let it reach the page as markup.
const HOSTILE = [`x" onmouseover="alert(1)`, `'><script>alert(1)</script>`, '<img src=x onerror=alert(1)>', 'javascript:alert(1)'];
const loose = (d: Record<string, unknown>) => d as unknown as ListingDoc;

describe('hostile values', () => {
  it('only ever gives the page one of our campus ids, and its name', () => {
    for (const bad of [...HOSTILE, '__proto__', 'constructor', 7, null, undefined]) {
      const card = toCard(loose({ ...listing, campusId: bad }));
      const room = toRoom(loose({ ...listing, campusId: bad }));
      expect(card.school).toBe('nu-evn'); // from campus: 'evanston'
      expect(room.school).toBe('nu-evn');
      expect(room.schoolName).toBe('Northwestern · Evanston');
    }
    expect(toRoom(loose({ ...listing, campusId: 'bad', campus: 'chicago' })).school).toBe('nu-chi');
    expect(toRoom(loose({ ...listing, campusId: 'bad', campus: 'bad' })).school).toBe('nu-evn');
    expect(toRoom({ ...listing, campusId: 'chi-dt', campus: 'downtown' })).toMatchObject({ school: 'chi-dt', schoolName: 'Downtown Chicago' });
    expect(toCard({ ...listing, campusId: 'nu-chi', campus: 'chicago' })).toMatchObject({ school: 'nu-chi', schoolName: 'Northwestern · Chicago' });
    expect(campusOf(null)).toBe('nu-evn');
  });
  it('escapes every host-typed string that reaches HTML', () => {
    for (const bad of HOSTILE.slice(0, 3)) {
      const evil = loose({
        ...listing,
        code: bad,
        campusId: bad,
        campus: bad,
        kind: bad,
        title: bad,
        area: bad,
        ownerName: bad,
        captions: [bad, bad],
        form: {
          ...form,
          gender: bad,
          route: bad,
          view: bad,
          layout: 'Other',
          multi: { fees: [bad], amen: [bad], habits: [bad], items: [bad] },
          prefs: { Cooking: bad, Cleaning: bad, Visitors: bad },
          f: { note: bad, rmWho: bad, rmNote: bad, furnNote: bad, ruleNote: bad, layoutOther: bad, dep: bad, extra: bad },
        },
      });
      const out = JSON.stringify([toCard(evil), toRoom(evil)]);
      expect(out).not.toMatch(/[<>]/);
      expect(out).not.toContain(`x\\" on`); // no raw quote before the handler
      expect(out).not.toContain("'>");
    }
  });
  it('passes on only https photo and video links', () => {
    const r = toRoom(loose({ ...listing, photos: ['javascript:alert(1)', 'https://example.test/a.jpg', 'https://x.test/"onerror="y', 7, 'data:image/svg+xml,<svg>'], captions: ['A', 'B', 'C', 'D', 'E'], video: 'javascript:alert(1)' }));
    expect(r.photos).toEqual([['https://example.test/a.jpg', 'B']]);
    expect(r.video).toBeNull();
    expect(toCard(loose({ ...listing, photos: ['javascript:alert(1)', 'https://example.test/a.jpg'] })).img).toBe('https://example.test/a.jpg');
    expect(toRoom({ ...listing, video: 'https://example.test/v.mp4' }).video).toBe('https://example.test/v.mp4');
  });
  it('maps only known answers to icons, whatever the keys are called', () => {
    const r = toRoom(loose({ ...listing, form: { ...form, multi: { fees: [], amen: ['constructor', 'Gym'], habits: [], items: ['constructor', '__proto__', 'Desk'] }, prefs: { Smoking: 'constructor', Pets: 'toString' } } }));
    expect(r.amen).toEqual(['gym']);
    expect(r.furn).toEqual(['desk']);
    expect(r.furnMore).toEqual(['constructor', '__proto__']);
    expect(r.prefs).toEqual([]);
  });
  it('keeps numbers numbers and caps the roommates it draws', () => {
    const r = toRoom(loose({ ...listing, price: '<b>9</b>', walk: '5 min', form: { ...form, f: { ...form.f, rmN: '99999999' } } }));
    expect(r.price).toBe(0);
    expect(r.walk).toBeNull();
    expect(r.mates.length).toBe(12);
    expect(toCard(loose({ ...listing, price: 1250.4, walk: -3, createdAtMs: 'x' }))).toMatchObject({ price: 1250, walk: null, createdAtMs: 0 });
  });
  it('cleans the map spot and the places saved with it', () => {
    const r = toRoom(
      loose({
        ...listing,
        location: { lat: 42.05, lng: -87.68 },
        near: [
          { kind: 'grocery', name: '<b>Jewel</b>', lat: 42.05, lng: -87.68, walk: 4, meters: 300 },
          { kind: 'evil', name: 'x', lat: 1, lng: 1, walk: 1, meters: 1 },
          { kind: 'food', name: 7, lat: 1, lng: 1 },
          { kind: 'transit', name: 'Davis', lat: 'x', lng: null, walk: '<i>', meters: 'far' },
          'junk',
        ],
      }),
    );
    expect(r.location).toEqual({ lat: 42.05, lng: -87.68 });
    expect(r.near).toEqual([
      { kind: 'grocery', name: '<b>Jewel</b>', lat: 42.05, lng: -87.68, walk: 4, meters: 300 }, // escaped by src/roommap.ts when drawn
      { kind: 'food', name: '7', lat: 1, lng: 1, walk: null, meters: 0 },
      { kind: 'transit', name: 'Davis', lat: null, lng: null, walk: null, meters: 0 },
    ]);
    expect(toRoom(loose({ ...listing, location: { lat: '42', lng: -87 }, near: 'x' }))).toMatchObject({ location: null, near: null });
    expect(toRoom(listing).near).toBeNull();
  });
  it('gives the homepage card its map spot only as numbers inside the map area', () => {
    const at = (location: unknown) => {
      const c = toCard(loose({ ...listing, location }));
      return [c.lat, c.lng];
    };
    expect(at({ lat: 42.05, lng: -87.68, address: '1890 Maple Ave' })).toEqual([42.05, -87.68]);
    expect(at(undefined)).toEqual([null, null]);
    expect(at(null)).toEqual([null, null]);
    expect(at({ lat: '42.05', lng: -87.68 })).toEqual([null, null]);
    expect(at({ lat: Number.NaN, lng: -87.68 })).toEqual([null, null]);
    expect(at({ lat: 42.05, lng: Number.POSITIVE_INFINITY })).toEqual([null, null]);
    expect(at({ lat: 40.71, lng: -74.0 })).toEqual([null, null]); // New York: off the map
    expect(at([42.05, -87.68])).toEqual([null, null]);
    // nothing else about the spot reaches the card
    const c = toCard(loose({ ...listing, location: { lat: 42.05, lng: -87.68, address: '<b>1890 Maple Ave</b>' } }));
    expect(c).not.toHaveProperty('location');
    expect(JSON.stringify(c)).not.toContain('Maple');
  });
});

describe('malformed listings', () => {
  const broken: Record<string, unknown>[] = [
    {},
    { code: '48271936' },
    { ...listing, form: undefined },
    { ...listing, form: null },
    { ...listing, form: 'x' },
    { ...listing, form: { ...form, f: undefined, multi: undefined, prefs: undefined } },
    { ...listing, form: { ...form, f: null, multi: 'x', prefs: [] } },
    { ...listing, form: { ...form, multi: { fees: 'x', amen: 7, habits: [1, null], items: { a: 1 } } } },
    { ...listing, form: { ...form, f: { rmN: { x: 1 }, note: ['a'], dep: null, sqft: {}, floor: [] } } },
    { ...listing, captions: undefined },
    { ...listing, captions: 'Bedroom' },
    { ...listing, photos: undefined },
    { ...listing, photos: 'https://example.test/a.jpg' },
    { ...listing, photos: [null, {}, 3] },
    { ...listing, title: null, area: 5, ownerName: {}, kind: 'evil', start: 7, end: null, price: null, walk: {} },
    { ...listing, location: 'x', near: { a: 1 } },
  ];
  it('never throws building a card or a room', () => {
    for (const d of broken) {
      expect(() => toCard(loose(d))).not.toThrow();
      expect(() => toRoom(loose(d))).not.toThrow();
    }
    expect(() => toCard(null as unknown as ListingDoc)).not.toThrow();
    expect(() => toRoom(undefined as unknown as ListingDoc)).not.toThrow();
  });
  it('fills a missing answer with a blank, not a guess', () => {
    const r = toRoom(loose({ ...listing, form: undefined, captions: undefined }));
    expect(r.photos).toEqual([
      ['https://example.test/a.jpg', 'Photo'],
      ['https://example.test/b.jpg', 'Photo'],
    ]);
    expect(r).toMatchObject({ about: '', amen: [], furn: [], prefs: [], mates: [], furnished: 'Not furnished', terms: null, layout: '' });
    expect(toRoom(loose({ ...listing, kind: 'evil' })).type).toBe('Short sublet');
    expect(toCard(loose({ ...listing, start: 7, end: '2027-08' }))).toMatchObject({ start: '', end: '' });
  });
  it('knows which listings can be shown at all', () => {
    expect(usableListing(listing)).toBe(true);
    expect(usableListing(loose({ ...listing, form: undefined }))).toBe(true); // shown, with blanks
    for (const d of [null, {}, { ...listing, code: '1' }, { ...listing, start: 'x' }, { ...listing, end: '2027-05-01' }, { ...listing, price: 0 }, { ...listing, photos: [] }, { ...listing, photos: ['javascript:x'] }])
      expect(usableListing(d)).toBe(false);
  });
});

describe('ended listings', () => {
  it('reads today on the local calendar', () => {
    expect(localDay(new Date(2027, 0, 5, 23, 30))).toBe('2027-01-05');
  });
  it('ends after its last day, not on it', () => {
    expect(hasEnded('2027-08-31', '2027-08-31')).toBe(false);
    expect(hasEnded('2027-08-31', '2027-09-01')).toBe(true);
    expect(hasEnded('', '2027-09-01')).toBe(false);
    expect(toRoom(listing, '2027-09-01').ended).toBe(true);
    expect(toRoom(listing, '2027-08-31').ended).toBe(false);
  });
});

describe('the live list', () => {
  const at = (code: string, ms: number, extra: Record<string, unknown> = {}) => loose({ ...listing, code, createdAtMs: ms, ...extra });
  it('shows only active, running, showable listings, newest first', () => {
    const list = liveList(
      [
        at('11111111', 1),
        at('22222222', 3),
        at('33333333', 2, { end: '2027-05-31' }), // ended
        at('44444444', 9, { status: 'hidden' }),
        at('55555555', 8, { photos: [] }), // nothing to show
        at('66666666', 7, { form: 'x', captions: 5 }), // shown, with blanks
        null,
        loose({ code: '77777777' }),
      ],
      '2027-06-01',
    );
    expect(list.map((d) => d.code)).toEqual(['66666666', '22222222', '11111111']);
  });
  it('one broken listing never stops the others', () => {
    const throwing = new Proxy(at('88888888', 5), {
      get(t, k) {
        if (k === 'form' || k === 'photos') throw new Error('boom');
        return Reflect.get(t, k);
      },
    });
    expect(liveList([throwing, at('11111111', 1)], '2027-06-01').map((d) => d.code)).toEqual(['11111111']);
  });
});
