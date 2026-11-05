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

// A stored listing is someone else's data: the mappers below read every field through these, so a
// missing, mistyped or hostile value becomes a blank instead of an exception or markup.
type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// photos and videos are Firebase Storage download links; anything that isn't an https link is dropped
const httpsUrl = (v: unknown): string => (typeof v === 'string' && v.length <= 2048 && /^https:\/\/[^\s"'<>`]+$/i.test(v) ? v : '');

const num = (s: unknown): number => {
  const n = Number(str(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export const CAMPUS_IDS = Object.keys(CAMPUS_KEY) as CampusId[];

export function isCampusId(s: unknown): s is CampusId {
  return own(CAMPUS_KEY, s);
}

// The campus a stored listing (or request) belongs to: its campusId when that is one of ours, else the
// one its campus key names, else Evanston. Never the stored string itself.
export function campusOf(d: { campusId?: unknown; campus?: unknown } | null | undefined): CampusId {
  if (isCampusId(d?.campusId)) return d.campusId;
  return CAMPUS_IDS.find((id) => CAMPUS_KEY[id] === d?.campus) ?? 'nu-evn';
}

export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Today on the visitor's own calendar (a listing's dates are local days, not UTC ones).
export function localDay(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// A listing has ended once its last day is before today; it stays up through its end date.
export function hasEnded(end: unknown, today: string = localDay()): boolean {
  return isDay(end) && end < today;
}

export function layoutCode(form: { layout?: unknown; f?: unknown } | null | undefined): string {
  const layout = str(form?.layout);
  if (layout !== 'Other') return layout;
  const f = isObj(form?.f) ? form.f : {};
  return str(f.layoutOther).trim().toUpperCase() || 'Other';
}

// "3B2B" -> 3 bedrooms; Studio -> 0
export function bedrooms(layout: string): number {
  const m = /^(\d+)B/i.exec(str(layout));
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
const kindLabel = (kind: unknown) => (kind === 'takeover' ? KIND_LABEL.takeover : KIND_LABEL.sublet);

const NEAR_KINDS = ['transit', 'grocery', 'pharmacy', 'food'] as const;
type NearPlace = NonNullable<ListingDoc['near']>[number];
const MAX_MATES = 12; // more roommates than this is a typo; the room page draws one avatar each

const walkOf = (v: unknown): number | null => {
  const n = finite(v);
  return n != null && n >= 0 && n < 1000 ? Math.round(n) : null;
};
const priceOf = (v: unknown): number => {
  const n = finite(v);
  return n != null && n >= 0 ? Math.round(n) : 0;
};

// The exact spot, when it is a real point.
function spotOf(v: unknown): { lat: number; lng: number } | null {
  if (!isObj(v)) return null;
  const lat = finite(v.lat);
  const lng = finite(v.lng);
  return lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

// The area the site's map serves (src/map.ts SERVICE_BOUNDS): Chicago, Evanston and around. The homepage
// pins a listing only when its spot is a real point inside it.
const MAP_AREA = { south: 41.4, north: 42.5, west: -88.4, east: -87.2 };
function mapSpotOf(v: unknown): { lat: number; lng: number } | null {
  const p = spotOf(v);
  return p && p.lat >= MAP_AREA.south && p.lat <= MAP_AREA.north && p.lng >= MAP_AREA.west && p.lng <= MAP_AREA.east ? p : null;
}

// Places saved with the listing, cleaned to the shape src/roommap.ts draws (it escapes the names when it
// draws them). null when none were saved, so the room map can look them up itself.
function nearOf(v: unknown): NearPlace[] | null {
  if (!Array.isArray(v)) return null;
  return v.slice(0, 12).flatMap((x): NearPlace[] => {
    if (!isObj(x) || !(NEAR_KINDS as readonly unknown[]).includes(x.kind)) return [];
    const name = str(x.name).trim().slice(0, 80);
    const meters = finite(x.meters);
    if (!name) return [];
    return [{ kind: x.kind as NearPlace['kind'], name, lat: finite(x.lat), lng: finite(x.lng), walk: walkOf(x.walk), meters: meters != null && meters >= 0 ? meters : 0 }];
  });
}

// [photo link, caption] for every photo that is a real link, escaped for the page.
function photoPairs(d: Raw): [string, string][] {
  const caps = Array.isArray(d.captions) ? d.captions : [];
  return (Array.isArray(d.photos) ? d.photos.slice(0, 20) : []).flatMap((p, i): [string, string][] => {
    const url = httpsUrl(p);
    return url ? [[html(url), html(str(caps[i]).trim().slice(0, 60) || 'Photo')]] : [];
  });
}

// Whether a stored listing has what the homepage and room page need to show it at all: its listing
// number, real dates, a rent and at least one photo. Everything else may be missing (it shows blank).
export function usableListing(d: unknown): boolean {
  if (!isObj(d)) return false;
  const { start, end } = d;
  return (
    /^[1-9][0-9]{7}$/.test(str(d.code)) &&
    isDay(start) &&
    isDay(end) &&
    start < end &&
    priceOf(d.price) > 0 &&
    photoPairs(d).length > 0
  );
}

// index.html card row: {id, key, title, area, walk, price, start, end, type, who, img, school, lat, lng}
// Never throws: a field that is missing or odd comes out blank. school is always one of our campus ids.
// lat/lng place the listing's price pin on the homepage map: numbers inside the map's area, else null.
export function toCard(d: ListingDoc) {
  const r = (isObj(d) ? d : {}) as Raw;
  const form = isObj(r.form) ? r.form : {};
  const multi = isObj(form.multi) ? form.multi : {};
  const code = html(str(r.code));
  const school = campusOf(r);
  const created = finite(r.createdAtMs);
  const spot = mapSpotOf(r.location);
  return {
    id: code,
    key: code,
    code,
    title: html(str(r.title)),
    area: html(str(r.area)),
    walk: walkOf(r.walk),
    price: priceOf(r.price),
    start: isDay(r.start) ? r.start : '',
    end: isDay(r.end) ? r.end : '',
    type: kindLabel(r.kind),
    who: html(str(r.ownerName)),
    img: photoPairs(r)[0]?.[0] ?? '',
    school,
    schoolName: CAMPUS_NAME[school],
    furnished: form.furn === 'full' || form.furn === 'part',
    bath: form.bath === 'private' ? 'private' : 'shared',
    laundry: strList(multi.amen).includes('Washer & dryer'),
    layout: html(layoutCode(form)),
    createdAtMs: created ?? 0,
    lat: spot ? spot.lat : null,
    lng: spot ? spot.lng : null,
  };
}

// room.html ROOM object. An answer the host left empty is left empty here (null, '' or []), and the
// room page hides that row or says "Ask the host"; nothing is filled in from a default.
// Never throws, whatever the stored document holds. ended: the last day is before today (the page keeps
// the room readable for old links but takes the booking actions away).
export function toRoom(d: ListingDoc, today: string = localDay()) {
  const r = (isObj(d) ? d : {}) as Raw;
  const f = isObj(r.form) ? r.form : {};
  const ff = isObj(f.f) ? f.f : {};
  const m = isObj(f.multi) ? f.multi : {};
  const multi = { fees: strList(m.fees), amen: strList(m.amen), habits: strList(m.habits), items: strList(m.items) };
  const prefs = isObj(f.prefs) ? f.prefs : {};
  const pref = (c: string) => str(prefs[c]).trim();
  const text = (k: string) => str(ff[k]).trim();
  const code = layoutCode({ layout: f.layout, f: ff });
  const beds = bedrooms(code);
  const mates = f.hasRoommates === 'yes' ? Math.min(MAX_MATES, Math.max(1, Math.round(num(ff.rmN)) || 1)) : 0;
  const who = text('rmWho');
  const sqft = Math.round(num(ff.sqft));
  const floor = Math.round(num(ff.floor));
  // 0 with no deposit; null when the host chose a deposit but gave no amount
  const deposit = f.dep === 'amount' ? (/\d/.test(text('dep')) ? num(text('dep')) : null) : 0;
  const fees = multi.fees.filter((x) => x !== 'Nothing extra');
  const elevator = multi.amen.includes('Elevator');
  const view = str(f.view).trim();
  const floorMore = [elevator ? 'Elevator' : '', view ? `${html(view)} view` : ''].filter(Boolean).join(' · ');
  const price = priceOf(r.price);
  const orig = num(f.orig);
  const furnished = f.furn === 'full' || f.furn === 'part';
  const school = campusOf(r);
  const shuttle = f.shuttle === 'covered' || f.shuttle === 'not_covered' ? f.shuttle : 'unknown';
  const start = isDay(r.start) ? r.start : '';
  const end = isDay(r.end) ? r.end : '';
  return {
    who: html(str(r.ownerName)),
    role: 'Student',
    reply: 'verified school email',
    title: html(str(r.title)),
    area: html(str(r.area)),
    walk: walkOf(r.walk),
    price,
    // the host said the rent is open to a little negotiation
    neg: f.neg === 'little',
    start,
    end,
    ended: hasEnded(end, today),
    type: kindLabel(r.kind),
    // the campus id (one of ours, never the stored string) and its name for the page to print
    school,
    schoolName: CAMPUS_NAME[school],
    photos: photoPairs(r),
    video: httpsUrl(r.video) ? html(r.video) : null,
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
    furn: furnished ? multi.items.filter((x) => own(FURN_KEY, x)).map((x) => FURN_KEY[x]) : [],
    furnMore: furnished ? multi.items.filter((x) => !own(FURN_KEY, x)).map((x) => html(x)) : [],
    // what happens to the furniture; nothing when the place is not furnished
    terms: furnished ? (f.terms === 'use' || f.terms === 'gift' ? f.terms : f.subletType === 'takeover' ? 'gift' : 'use') : null,
    mates: Array.from({ length: mates }, () => html(who ? who[0].toUpperCase() : 'R')),
    matesText: html(
      mates
        ? `${mates} ${who ? who.toLowerCase() : `roommate${mates > 1 ? 's' : ''}`}${multi.habits.length ? `, ${multi.habits.join(', ').toLowerCase()}` : ''}.`
        : 'Just you.',
    ),
    prefs: PREF_ORDER.filter((c) => own(PREF_TEXT, pref(c))).map((c) => ({ k: PREF_ICON[c], t: PREF_TEXT[pref(c)] })),
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
    code: html(str(r.code)),
    layout: html(code),
    orig: orig > price ? orig : 0,
    shuttle: shuttle === 'covered' ? { s: shuttle, route: html(str(f.route)) } : { s: shuttle },
    amen: multi.amen.filter((x) => own(AMEN_KEY, x)).map((x) => AMEN_KEY[x]),
    furnished: f.furn === 'full' ? 'Fully furnished' : f.furn === 'part' ? 'Partly furnished' : 'Not furnished',
    extra: html(text('furnNote')),
    usage: html(text('ruleNote')),
    mate: {
      gender: html(str(f.gender).trim()),
      identity: html(who),
      schedule: html(multi.habits[0] || 'Ask the host'),
      cooking: html(pref('Cooking') || 'Ask the host'),
      clean: html(pref('Cleaning') || 'Ask the host'),
      guests: html(pref('Visitors') || 'Ask the host'),
      note: html(text('rmNote')),
    },
    // only what something real backs: the school (.edu) sign-in, and a lease proof the host uploaded (in review).
    // There is no separate landlord approval yet, so that mark is always "Not submitted".
    ver: { student: 'ok', lease: f.proof === 'lease' ? 'pending' : 'none', landlord: 'none' },
    // the map: the exact spot and the places saved with the listing (names are escaped when drawn)
    location: spotOf(r.location),
    near: nearOf(r.near),
  };
}

// The live list the homepage and room pages show: listings that are active, still running (their last
// day is today or later) and complete enough to show, newest first. A listing that fails any of that, or
// whose card or room can't be built, is left out instead of breaking the page for every visitor.
export function liveList(list: (ListingDoc | null | undefined)[], today: string = localDay()): ListingDoc[] {
  return list
    .filter((d): d is ListingDoc => {
      try {
        if (!d || d.status !== 'active' || !usableListing(d) || hasEnded(d.end, today)) return false;
        toCard(d);
        toRoom(d, today);
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => (finite(b.createdAtMs) ?? 0) - (finite(a.createdAtMs) ?? 0));
}
