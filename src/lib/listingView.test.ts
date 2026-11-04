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
    expect(r.prefs).toEqual(['smoking', 'visitors']);
    expect(r.matesText).toBe('1 grad student, quiet weeknights.');
    expect(r.facts[0]).toEqual(['info-layout', '1 of 2 beds', '~140 sq ft']);
    expect(r.orig).toBe(1400);
    expect(r.about).toBe('Away for my summer internship.');
  });
});
