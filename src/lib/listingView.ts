// Turns a stored listing into the shapes the moved-over pages already render: the homepage card
// (index.html's L rows) and the room page (room.html's ROOM object). Pure functions, tested.

export type CampusId = 'nu-evn' | 'nu-chi' | 'chi-dt';
export type CampusKey = 'evanston' | 'chicago' | 'downtown';

export const CAMPUS_KEY: Record<CampusId, CampusKey> = { 'nu-evn': 'evanston', 'nu-chi': 'chicago', 'chi-dt': 'downtown' };
export const CAMPUS_NAME: Record<CampusId, string> = {
  'nu-evn': 'Northwestern · Evanston',
  'nu-chi': 'Northwestern · Chicago',
  'chi-dt': 'Downtown Chicago',
};

// Everything the 13-screen post form collects (post.html's S), minus screen state and the
// private location fields, which are stored separately. The form no longer pre-fills answers, so any
// optional answer (original rent, fees, amenities, habits, house rules, items, view, size, floor, notes,
// roommate details beyond yes/no and how many) can be empty or missing; the mappers below never fill one in.
export interface PostForm {
  subletType: 'sublet' | 'takeover';
  transferChannel: 'official' | 'private';
  dep: 'none' | 'amount';
  refund: boolean | null;
  map: boolean;
  hasRoommates: 'yes' | 'no';
  gender: string;
  shuttle: 'covered' | 'not_covered' | 'unknown';
  route: string;
  layout: string;
  start: string;
  end: string;
  rent: number;
  orig: number | null;
  unit: 'room' | 'whole';
  bath: 'private' | 'shared';
  furn: 'full' | 'part' | 'none';
  neg: 'little' | 'no' | null;
  view: string | null;
  terms: 'use' | 'gift' | null;
  proof: 'student' | 'lease';
  campus: string;
  campusId: CampusId;
  multi: { fees: string[]; amen: string[]; habits: string[]; items: string[] };
  prefs: Record<string, string>;
  f: Record<string, string>;
}

export interface ListingDoc {
  ownerId: string;
  ownerName: string;
  ownerPhoto: string;
  status: 'active' | 'taken' | 'hidden';
  code: string;
  campus: CampusKey;
  campusId: CampusId;
  kind: 'sublet' | 'takeover';
  title: string;
  area: string;
  price: number;
  start: string;
  end: string;
  photos: string[];
  captions: string[];
  video: string | null;
  walk: number | null;
  location?: { lat: number; lng: number } | null;
  near?: { kind: 'transit' | 'grocery' | 'pharmacy' | 'food'; name: string; lat: number | null; lng: number | null; walk: number | null; meters: number }[];
  form: PostForm;
  createdAtMs?: number;
}

// The room page and the homepage put these strings straight into HTML, so anything a host typed is
// escaped here, once, before it reaches them.
export const html = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const num = (s: unknown): number => {
  const n = Number(String(s ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function layoutCode(form: Pick<PostForm, 'layout' | 'f'>): string {
  return form.layout === 'Other' ? (form.f.layoutOther || '').trim().toUpperCase() || 'Other' : form.layout;
}

// "3B2B" -> 3 bedrooms; Studio -> 0
export function bedrooms(layout: string): number {
  const m = /^(\d+)B/i.exec(layout);
  return m ? Number(m[1]) : 0;
}

// The same wording as the approved example listings.
export function titleOf(form: Pick<PostForm, 'unit' | 'layout' | 'f'>): string {
  const code = layoutCode(form);
  const beds = bedrooms(code);
  if (form.unit === 'whole') {
    if (code === 'Studio') return 'Studio';
    return beds ? `Entire ${beds}-bed apartment` : 'Entire apartment';
  }
  return beds >= 2 ? `Private room in a ${beds}-bed` : 'Private room';
}

// Street address -> neighbourhood, used until HERE gives a district.
const ZIP_AREA: Record<string, string> = {
  '60201': 'Evanston',
  '60202': 'South Evanston',
  '60203': 'North Evanston',
  '60208': 'Northwestern campus',
  '60601': 'The Loop',
  '60602': 'The Loop',
  '60603': 'The Loop',
  '60604': 'The Loop',
  '60605': 'South Loop',
  '60606': 'The Loop',
  '60607': 'West Loop',
  '60610': 'Gold Coast',
  '60611': 'Streeterville',
  '60616': 'South Loop',
  '60654': 'River North',
  '60661': 'West Loop',
  '60614': 'Lincoln Park',
  '60657': 'Lakeview',
  '60622': 'Wicker Park',
  '60642': 'River West',
};

export function areaFromAddress(address: string, campusId: CampusId): string {
  const zip = /\b(6\d{4})\b/.exec(address)?.[1];
  if (zip && ZIP_AREA[zip]) return ZIP_AREA[zip];
  if (/evanston/i.test(address)) return 'Evanston';
  if (/chicago/i.test(address)) return 'Chicago';
  return campusId === 'nu-evn' ? 'Evanston' : campusId === 'nu-chi' ? 'Streeterville' : 'Downtown Chicago';
}

const FURN_KEY: Record<string, string> = {
  'Bed frame': 'bedframe',
  Mattress: 'mattress',
  Bedding: 'bedding',
  Wardrobe: 'wardrobe',
  Desk: 'desk',
  Chair: 'chair',
  Lamp: 'lamp',
  'Floor lamp': 'floorlamp',
};
const AMEN_KEY: Record<string, string> = {
  'Washer & dryer': 'washer',
  Elevator: 'elevator',
  Gym: 'gym',
  'Store downstairs': 'store',
  'Package room': 'package',
  Parking: 'parking',
};
// House rules as the host chose them on the post form, in a fixed order, each with its category icon.
const PREF_ORDER = ['Smoking', 'Pets', 'Cooking', 'Cleaning', 'Visitors'] as const;
const PREF_ICON: Record<string, string> = { Smoking: 'smoking', Pets: 'pets', Cooking: 'cooking', Cleaning: 'cleaning', Visitors: 'visitors' };
const PREF_TEXT: Record<string, string> = {
  'No smoking': 'No smoking',
  'Outside only': 'Smoking outside only',
  'No pets': 'No pets',
  'Pets OK': 'Pets OK',
  'Let’s talk': 'Pets: ask the host',
  'Cooking often is fine': 'Cooking OK',
  'Less smoke, please': 'Light cooking',
  'Weekly clean-up': 'Weekly clean-up',
  'Clean after use': 'Clean up after use',
  'Basically tidy': 'Keep it tidy',
  'No overnight guests': 'No overnight guests',
  'OK with notice': 'Guests with notice',
};

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export const KIND_LABEL = { sublet: 'Short sublet', takeover: 'Lease takeover' } as const;

// index.html card row: {id, key, title, area, walk, price, start, end, type, who, img, school}
export function toCard(d: ListingDoc) {
  return {
    id: d.code,
    key: d.code,
    code: d.code,
    title: html(d.title),
    area: html(d.area),
    walk: d.walk ?? null,
    price: d.price,
    start: d.start,
    end: d.end,
    type: KIND_LABEL[d.kind],
    who: html(d.ownerName),
    img: html(d.photos[0] ?? ''),
    school: d.campusId,
    furnished: d.form.furn !== 'none',
    bath: d.form.bath,
    laundry: (d.form.multi?.amen ?? []).includes('Washer & dryer'),
    layout: html(layoutCode(d.form)),
    createdAtMs: d.createdAtMs ?? 0,
  };
}

// room.html ROOM object. An answer the host left empty is left empty here (null, '' or []), and the
// room page hides that row or says "Ask the host"; nothing is filled in from a default.
export function toRoom(d: ListingDoc) {
  const f = d.form;
  const ff: Record<string, string> = f.f ?? {};
  const multi = { fees: f.multi?.fees ?? [], amen: f.multi?.amen ?? [], habits: f.multi?.habits ?? [], items: f.multi?.items ?? [] };
  const prefs: Record<string, string> = f.prefs ?? {};
  const text = (k: string) => String(ff[k] ?? '').trim();
  const code = layoutCode({ layout: f.layout, f: ff });
  const beds = bedrooms(code);
  const mates = f.hasRoommates === 'yes' ? Math.max(1, Math.round(num(ff.rmN)) || 1) : 0;
  const who = text('rmWho');
  const sqft = Math.round(num(ff.sqft));
  const floor = Math.round(num(ff.floor));
  // 0 with no deposit; null when the host chose a deposit but gave no amount
  const deposit = f.dep === 'amount' ? (/\d/.test(text('dep')) ? num(text('dep')) : null) : 0;
  const fees = multi.fees.filter((x) => x !== 'Nothing extra');
  const elevator = multi.amen.includes('Elevator');
  const view = String(f.view ?? '').trim();
  const floorMore = [elevator ? 'Elevator' : '', view ? `${html(view)} view` : ''].filter(Boolean).join(' · ');
  const orig = num(f.orig);
  const furnished = f.furn === 'full' || f.furn === 'part';
  const photos = d.photos.map((url, i) => [html(url), html(d.captions[i] || 'Photo')]);
  return {
    who: html(d.ownerName),
    role: 'Northwestern student',
    reply: 'verified with a Northwestern account',
    title: html(d.title),
    area: html(d.area),
    walk: d.walk ?? null,
    price: d.price,
    // the host said the rent is open to a little negotiation
    neg: f.neg === 'little',
    start: d.start,
    end: d.end,
    type: KIND_LABEL[d.kind],
    school: d.campusId,
    photos,
    video: d.video ? html(d.video) : null,
    about: html(text('note')),
    // [icon, label, detail]; an empty detail is not shown
    facts: [
      [
        'info-layout',
        f.unit === 'whole' ? (code === 'Studio' ? 'Studio' : beds ? `Entire ${beds}-bed` : 'Entire place') : beds ? `1 of ${beds} beds` : 'Private room',
        sqft ? `~${sqft} sq ft` : '',
      ],
      ['info-bathroom', f.bath === 'private' ? 'Own bath' : 'Shared bath', f.bath === 'private' ? 'Private' : mates ? `With ${mates} roommate${mates > 1 ? 's' : ''}` : 'Shared'],
      ['info-floor', floor ? `${ordinal(floor)} floor` : 'Floor', floorMore || (floor ? '' : 'Ask the host')],
      ['wash', 'Laundry', multi.amen.includes('Washer & dryer') ? 'In the building' : 'Ask the host'],
    ],
    sqft: sqft || null,
    // items with an icon on the room page, and the rest by name
    furn: furnished ? multi.items.map((x) => FURN_KEY[x]).filter(Boolean) : [],
    furnMore: furnished ? multi.items.filter((x) => !FURN_KEY[x]).map((x) => html(x)) : [],
    // what happens to the furniture; nothing when the place is not furnished
    terms: furnished ? f.terms || (f.subletType === 'takeover' ? 'gift' : 'use') : null,
    mates: Array.from({ length: mates }, () => html(who ? who[0].toUpperCase() : 'R')),
    matesText: html(
      mates
        ? `${mates} ${who ? who.toLowerCase() : `roommate${mates > 1 ? 's' : ''}`}${multi.habits.length ? `, ${multi.habits.join(', ').toLowerCase()}` : ''}.`
        : 'Just you.',
    ),
    prefs: PREF_ORDER.filter((c) => PREF_TEXT[prefs[c]]).map((c) => ({ k: PREF_ICON[c], t: PREF_TEXT[prefs[c]] })),
    // other monthly costs: null when the host left it empty (an entered 0 stays 0)
    util: /\d/.test(text('extra')) ? num(text('extra')) : null,
    deposit,
    // 'yes' or 'no' as the host answered for their deposit; '' with no deposit or no answer
    refund: deposit ? (f.refund === true ? 'yes' : f.refund === false ? 'no' : '') : '',
    utilText: 'Other costs',
    // what the rent includes; '' when the host picked nothing, and rentOnly when they picked "Nothing extra"
    included: html(fees.join(' + ')),
    rentOnly: !fees.length && multi.fees.includes('Nothing extra'),
    asks: ['Video tour?', 'Still free?', f.subletType === 'takeover' ? 'Transfer fee?' : 'Flexible dates?'],
    code: d.code,
    layout: html(code),
    orig: orig > d.price ? orig : 0,
    shuttle: f.shuttle === 'covered' ? { s: 'covered', route: f.route } : { s: f.shuttle },
    amen: multi.amen.map((x) => AMEN_KEY[x]).filter(Boolean),
    furnished: f.furn === 'full' ? 'Fully furnished' : f.furn === 'part' ? 'Partly furnished' : 'Not furnished',
    extra: html(text('furnNote')),
    usage: html(text('ruleNote')),
    mate: {
      gender: html(String(f.gender ?? '').trim()),
      identity: html(who),
      schedule: html(multi.habits[0] || 'Ask the host'),
      cooking: html(prefs.Cooking || 'Ask the host'),
      clean: html(prefs.Cleaning || 'Ask the host'),
      guests: html(prefs.Visitors || 'Ask the host'),
      note: html(text('rmNote')),
    },
    // only what something real backs: the Northwestern sign-in, and a lease proof the host uploaded (in review).
    // There is no separate landlord approval yet, so that mark is always "Not submitted".
    ver: { student: 'ok', lease: f.proof === 'lease' ? 'pending' : 'none', landlord: 'none' },
    // the map: the exact spot and the places saved with the listing (names are escaped when drawn)
    location: d.location ?? null,
    near: d.near ?? null,
  };
}
