// Apartment directory for the post flow's Building field: the Northwestern buildings from the
// CloudSublet mini program's directory (pages/publish/apartment-directory.js, copied November 4, 2026),
// with addresses and coordinates from the Northwestern Graduate School housing guide, Northwestern
// off-campus housing and each property's own site (see `source`). Search mirrors the mini program's
// rules: aliases, prefix and substring matches, and small typos.

export type ApartmentCampus = 'evanston' | 'chicago';

export interface Apartment {
  id: string;
  name: string;
  aliases: string[];
  street: string;
  city: 'Evanston' | 'Chicago';
  lat: number;
  lng: number;
  area: string;
  campus: ApartmentCampus;
  popular: boolean;
  priority: number;
  website: string;
  source: string;
}

export const APARTMENTS: Apartment[] = [
  { id: "nu_e2", name: "E2 Apartments", aliases: ["E2", "E 2", "E2 Apartment", "E2 Evanston"], street: "1890 Maple Ave", city: "Evanston", lat: 42.0517876, lng: -87.6856596, area: "Downtown Evanston", campus: "evanston", popular: true, priority: 100, website: "https://e2apts.com/", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_park_evanston", name: "Park Evanston Apartments", aliases: ["Park Evanston", "The Park Evanston", "Park Evanston Apartment"], street: "1630 Chicago Ave", city: "Evanston", lat: 42.0472748, lng: -87.6797761, area: "Downtown Evanston", campus: "evanston", popular: false, priority: 98, website: "https://www.parkevanstonapts.com/", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_link_evanston", name: "The Link Evanston", aliases: ["The Link", "Link Evanston", "Link Apartments", "The Link Apartments"], street: "811 Emerson St", city: "Evanston", lat: 42.0524502, lng: -87.6829588, area: "Downtown Evanston", campus: "evanston", popular: true, priority: 96, website: "https://thelinkevanston.com/", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_evanston_place", name: "Evanston Place Apartments", aliases: ["Evanston Place", "EP Apartments", "EP Evanston"], street: "1715 Chicago Ave", city: "Evanston", lat: 42.0485257, lng: -87.6780453, area: "Downtown Evanston", campus: "evanston", popular: true, priority: 94, website: "https://www.evanstonplaceapts.com/", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_reserve", name: "The Reserve at Evanston", aliases: ["The Reserve", "Reserve Evanston", "Reserve Apartments", "The Reserve Apartments"], street: "1930 Ridge Ave", city: "Evanston", lat: 42.0526395, lng: -87.6880118, area: "North Evanston", campus: "evanston", popular: false, priority: 92, website: "https://www.reserveatevanston.com/", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_albion", name: "Albion Evanston", aliases: ["Albion", "Albion Apartments", "Albion Evanston Apartments"], street: "1500 Sherman Ave", city: "Evanston", lat: 42.0447982, lng: -87.6820297, area: "Downtown Evanston", campus: "evanston", popular: true, priority: 90, website: "https://albionevanston.com/", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_centrum", name: "Centrum Evanston", aliases: ["Centrum", "Centrum Apartments"], street: "1590 Elmwood Ave", city: "Evanston", lat: 42.0466852, lng: -87.6843729, area: "Downtown Evanston", campus: "evanston", popular: false, priority: 88, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_1717", name: "1717 Apartments", aliases: ["1717", "1717 Evanston", "1717 Ridge", "1717 Ridge Apartments"], street: "1717 Ridge Ave", city: "Evanston", lat: 42.0495798, lng: -87.6881267, area: "Downtown Evanston", campus: "evanston", popular: true, priority: 86, website: "https://www.live1717apartments.com/", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_optima_horizons", name: "Optima Horizons", aliases: ["Horizons", "Optima Horizon", "Optima Horizons Apartments"], street: "850 Elgin Rd", city: "Evanston", lat: 42.0505225, lng: -87.6829083, area: "Downtown Evanston", campus: "evanston", popular: false, priority: 84, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_optima_views", name: "Optima Views", aliases: ["Optima View", "Optima Views Apartments"], street: "1720 Maple Ave", city: "Evanston", lat: 42.0494831, lng: -87.6853649, area: "Downtown Evanston", campus: "evanston", popular: false, priority: 82, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_sherman_plaza", name: "Residences of Sherman Plaza", aliases: ["Sherman Plaza", "Sherman Plaza Apartments", "Residences at Sherman Plaza"], street: "807 Davis St", city: "Evanston", lat: 42.047612, lng: -87.6823926, area: "Downtown Evanston", campus: "evanston", popular: false, priority: 80, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_tapestry_station", name: "Tapestry Station", aliases: ["Tapestry", "Tapestry Station Apartments", "Tapestry Evanston"], street: "740 Main St", city: "Evanston", lat: 42.0337768, lng: -87.6820008, area: "South Evanston", campus: "evanston", popular: true, priority: 79, website: "https://tapestrystation.com/", source: "https://chicagorentals.com/apartment/tapestry-station/" },
  { id: "nu_the_main", name: "The Main", aliases: ["Main 847", "The Main 847", "847 Chicago"], street: "847 Chicago Ave", city: "Evanston", lat: 42.0336344, lng: -87.6788541, area: "South Evanston", campus: "evanston", popular: true, priority: 78, website: "https://www.themainevanston.com/", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_415_premier", name: "415 Premier Apartments", aliases: ["415 Premier", "415 Premier Evanston", "415 Evanston", "Premier Evanston"], street: "415 Howard St", city: "Evanston", lat: 42.0196286, lng: -87.6748255, area: "South Evanston", campus: "evanston", popular: true, priority: 77, website: "https://www.415evanston.com/", source: "https://www.415evanston.com/apartments/il/evanston/contact-us" },
  { id: "nu_amli_evanston", name: "AMLI Evanston", aliases: ["AMLI", "AMLI Apartments", "AMLI Evanston Apartments", "AMLI at Evanston"], street: "737 Chicago Ave", city: "Evanston", lat: 42.0313519, lng: -87.6785313, area: "South Evanston", campus: "evanston", popular: true, priority: 76.5, website: "https://www.amli.com/apartments/chicago/near-north-suburbs-apartments/amli-evanston/", source: "https://www.amli.com/apartments/chicago/near-north-suburbs-apartments/amli-evanston/contact" },
  { id: "nu_1575_oak", name: "1575 Oak Apartments", aliases: ["1575 Oak", "1575 Oak Ave"], street: "1575 Oak Ave", city: "Evanston", lat: 42.0464863, lng: -87.6864528, area: "Downtown Evanston", campus: "evanston", popular: false, priority: 76, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_1615_ridge", name: "1615–1625 Ridge Apartments", aliases: ["1615 Ridge", "1625 Ridge", "1615 1625 Ridge"], street: "1615 Ridge Ave", city: "Evanston", lat: 42.0476732, lng: -87.6884474, area: "Downtown Evanston", campus: "evanston", popular: false, priority: 74, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_1616_hinman", name: "1616 Hinman Apartments", aliases: ["1616 Hinman", "1616 Hinman Ave"], street: "1616 Hinman Ave", city: "Evanston", lat: 42.0465572, lng: -87.6781538, area: "Downtown Evanston", campus: "evanston", popular: false, priority: 72, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_722_clark", name: "722 Clark Apartments", aliases: ["722 Clark", "722 Clark St"], street: "722 Clark St", city: "Evanston", lat: 42.0498178, lng: -87.6812512, area: "Downtown Evanston", campus: "evanston", popular: false, priority: 70, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_801_simpson", name: "801–811 Simpson Apartments", aliases: ["801 Simpson", "811 Simpson", "801 811 Simpson"], street: "801 Simpson St", city: "Evanston", lat: 42.0559317, lng: -87.6819719, area: "North Evanston", campus: "evanston", popular: false, priority: 68, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_2208_sherman", name: "2208 Sherman Apartments", aliases: ["2208 Sherman", "2208 Sherman Ave"], street: "2208 Sherman Ave", city: "Evanston", lat: 42.0578214, lng: -87.6821944, area: "North Evanston", campus: "evanston", popular: false, priority: 66, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_2238_sherman", name: "2238 Sherman Apartments", aliases: ["2238 Sherman", "2238 Sherman Ave"], street: "2238 Sherman Ave", city: "Evanston", lat: 42.0588611, lng: -87.6819011, area: "North Evanston", campus: "evanston", popular: false, priority: 64, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_2253_ridge", name: "2253 Ridge Apartments", aliases: ["2253 Ridge", "2253 Ridge Ave"], street: "2253 Ridge Ave", city: "Evanston", lat: 42.0591136, lng: -87.6849356, area: "North Evanston", campus: "evanston", popular: false, priority: 62, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_617_grove", name: "617–625 Grove Street Apartments", aliases: ["617 Grove", "625 Grove", "617 625 Grove"], street: "617 Grove St", city: "Evanston", lat: 42.0454008, lng: -87.6811734, area: "Downtown Evanston", campus: "evanston", popular: false, priority: 60, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_860_hinman", name: "860 Hinman Apartments", aliases: ["860 Hinman", "860 Hinman Ave"], street: "860 Hinman Ave", city: "Evanston", lat: 42.0337771, lng: -87.6781466, area: "South Evanston", campus: "evanston", popular: false, priority: 58, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_1000_main", name: "996–1012 Main Street Apartments", aliases: ["996 Main", "1000 Main", "1012 Main", "996 1012 Main"], street: "1000 Main St", city: "Evanston", lat: 42.0338729, lng: -87.6853768, area: "South Evanston", campus: "evanston", popular: false, priority: 56, website: "", source: "https://www.northwestern.edu/tgs/documents/services-support/2025-northwestern-graduate-school-housing-guide.pdf" },
  { id: "nu_chicago_saint_grand", name: "The Saint Grand", aliases: ["Saint Grand", "The Saint Grand Apartments", "Saint Grand Chicago"], street: "218 E Grand Ave", city: "Chicago", lat: 41.8916, lng: -87.6216, area: "Streeterville", campus: "chicago", popular: true, priority: 109, website: "https://thesaintgrand.com/", source: "https://offcampushousing.northwestern.edu/housing/neighborhood-Streeterville_t6j8wmc" },
  { id: "nu_chicago_optima_signature", name: "Optima Signature", aliases: ["Optima", "Optima Signature Apartments", "Optima Chicago"], street: "220 E Illinois St", city: "Chicago", lat: 41.8911, lng: -87.6223, area: "Streeterville", campus: "chicago", popular: true, priority: 108, website: "https://www.optimasignature.com/", source: "https://offcampushousing.northwestern.edu/housing/neighborhood-Streeterville_t6j8wmc" },
  { id: "nu_chicago_arrive_streeterville", name: "Arrive Streeterville", aliases: ["Arrive", "Arrive Apartments", "Arrive Streeterville Apartments"], street: "333 E Ontario St", city: "Chicago", lat: 41.8933, lng: -87.6192, area: "Streeterville", campus: "chicago", popular: true, priority: 107, website: "https://arrivestreeterville.com/", source: "https://offcampushousing.northwestern.edu/housing/neighborhood-Streeterville_t6j8wmc" },
  { id: "nu_chicago_moment", name: "Moment", aliases: ["Moment Chicago", "Moment Apartments", "Moment by Windsor"], street: "545 N McClurg Ct", city: "Chicago", lat: 41.8924, lng: -87.6179, area: "Streeterville", campus: "chicago", popular: true, priority: 106, website: "https://www.windsorcommunities.com/properties/moment/", source: "https://offcampushousing.northwestern.edu/housing/neighborhood-Streeterville_t6j8wmc" },
  { id: "nu_chicago_chatelaine", name: "The Chatelaine", aliases: ["Chatelaine", "Chatelaine Apartments", "The Chatelaine Apartments"], street: "215 E Chestnut St", city: "Chicago", lat: 41.8983, lng: -87.6219, area: "Streeterville", campus: "chicago", popular: true, priority: 105, website: "https://thechatelaine.groupfox.com/", source: "https://offcampushousing.northwestern.edu/housing/neighborhood-Streeterville_t6j8wmc" },
  { id: "nu_chicago_atwater", name: "Atwater Apartments", aliases: ["Atwater", "Atwater Chicago", "Atwater Apartments Chicago"], street: "355 E Ohio St", city: "Chicago", lat: 41.8926, lng: -87.619, area: "Streeterville", campus: "chicago", popular: true, priority: 104, website: "https://www.liveatwaterchicago.com/", source: "https://offcampushousing.northwestern.edu/housing/neighborhood-Streeterville_t6j8wmc" },
  { id: "nu_chicago_aqua", name: "Aqua at Lakeshore East", aliases: ["Aqua", "Aqua Apartments", "Aqua Lakeshore East"], street: "225 N Columbus Dr", city: "Chicago", lat: 41.8866, lng: -87.6204, area: "Streeterville", campus: "chicago", popular: true, priority: 103, website: "https://www.rentaqua.com/", source: "https://offcampushousing.northwestern.edu/housing/neighborhood-Streeterville_t6j8wmc" },
  { id: "nu_chicago_cascade", name: "Cascade", aliases: ["Cascade Apartments", "Cascade Lakeshore East", "Cascade Chicago"], street: "455 E Waterside Dr", city: "Chicago", lat: 41.8866, lng: -87.6163, area: "Streeterville", campus: "chicago", popular: true, priority: 102, website: "https://cascadeapartments.com/", source: "https://offcampushousing.northwestern.edu/housing/neighborhood-Streeterville_t6j8wmc" },
  { id: "nu_chicago_columbus_plaza", name: "Columbus Plaza", aliases: ["Columbus", "Columbus Plaza Apartments", "Columbus Plaza Chicago"], street: "233 E Wacker Dr", city: "Chicago", lat: 41.8876, lng: -87.6217, area: "Streeterville", campus: "chicago", popular: true, priority: 101, website: "https://www.columbusplaza.com/", source: "https://offcampushousing.northwestern.edu/housing/neighborhood-Streeterville_t6j8wmc" },
];

// Rentlet places -> which buildings to offer: Evanston for the Evanston campus, the Chicago list for
// the Chicago campus and downtown Chicago.
export const PLACE_APARTMENTS: Record<string, ApartmentCampus> = { 'nu-evn': 'evanston', 'nu-chi': 'chicago', 'chi-dt': 'chicago' };

export function fullAddress(a: Apartment): string {
  return `${a.street}, ${a.city}, IL`;
}

export function normalizeQuery(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(apartments?|residences?|condos?|at)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const compact = (value: string) => normalizeQuery(value).replace(/\s/g, '');

export function editDistance(left: string, right: string): number {
  const a = compact(left);
  const b = compact(right);
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let r = 1; r <= a.length; r++) {
    const cur = [r];
    for (let c = 1; c <= b.length; c++) cur[c] = Math.min(cur[c - 1] + 1, prev[c] + 1, prev[c - 1] + (a[r - 1] === b[c - 1] ? 0 : 1));
    prev.splice(0, prev.length, ...cur);
  }
  return prev[b.length];
}

const terms = (a: Apartment) => [a.name, ...a.aliases].map(compact).filter(Boolean);

export function matchScore(query: string, a: Apartment): number {
  const q = compact(query);
  if (!q) return a.priority;
  let best = -1;
  for (const t of terms(a)) {
    if (t === q) best = Math.max(best, 10000);
    else if (t.startsWith(q)) best = Math.max(best, 8000 - (t.length - q.length));
    else if (t.includes(q)) best = Math.max(best, 6000 - t.indexOf(q));
    else if (q.length >= 4) {
      const d = editDistance(q, t);
      if (d <= (q.length >= 8 ? 2 : 1)) best = Math.max(best, 4000 - d * 100);
    }
  }
  return best < 0 ? -1 : best + a.priority / 100;
}

// Up to `limit` buildings near the chosen place; with an empty query, the popular ones first.
export function searchApartments(query: string, placeId: string, limit = 6): Apartment[] {
  const campus = PLACE_APARTMENTS[placeId] ?? 'evanston';
  const pool = APARTMENTS.filter((a) => a.campus === campus);
  if (!compact(query)) {
    return pool
      .slice()
      .sort((a, b) => Number(b.popular) - Number(a.popular) || b.priority - a.priority || a.name.localeCompare(b.name))
      .slice(0, limit);
  }
  return pool
    .map((a) => ({ a, s: matchScore(query, a) }))
    .filter((x) => x.s >= 0)
    .sort((x, y) => y.s - x.s || x.a.name.localeCompare(y.a.name))
    .slice(0, limit)
    .map((x) => x.a);
}

export function findApartment(query: string, placeId: string): Apartment | null {
  const q = compact(query);
  if (!q) return null;
  const campus = PLACE_APARTMENTS[placeId] ?? 'evanston';
  return APARTMENTS.find((a) => a.campus === campus && terms(a).includes(q)) ?? null;
}

// Campus points used for walking estimates (same points the HERE functions route to).
export const CAMPUS_POINT: Record<string, [number, number]> = {
  'nu-evn': [42.0565, -87.6753],
  'nu-chi': [41.8963, -87.6188],
  'chi-dt': [41.8826, -87.6233],
};

// Straight-line distance × 1.3 for streets, at 80 m a minute. Used only until HERE routing answers.
export function walkEstimate(lat: number, lng: number, placeId: string): number | null {
  const p = CAMPUS_POINT[placeId];
  if (!p) return null;
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(p[0] - lat);
  const dLng = toRad(p[1] - lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(p[0])) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * R * Math.asin(Math.sqrt(h));
  return Math.max(1, Math.round((meters * 1.3) / 80));
}
