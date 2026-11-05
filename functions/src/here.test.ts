import { describe, expect, it } from 'vitest';
import {
  browseRequest,
  firstGeocode,
  geocodeRequest,
  hereUrl,
  nearestOf,
  shortLabel,
  streetLabel,
  SUGGEST_ASK,
  suggestRequest,
  toPlace,
  toSuggestions,
  walkMinutes,
  walkRequest,
} from './here';

const evanston = { lat: 42.0565, lng: -87.6753 };
const chicago = { lat: 41.8963, lng: -87.6188 };

describe('requests', () => {
  it('asks HERE Autosuggest from the campus, in the USA, and adds the key once', () => {
    const r = suggestRequest('733 Col & Co', evanston);
    const u = new URL(hereUrl(r.endpoint, r.params, 'KEY'));
    expect(u.origin + u.pathname).toBe('https://autosuggest.search.hereapi.com/v1/autosuggest');
    expect(u.searchParams.get('q')).toBe('733 Col & Co');
    expect(u.searchParams.get('at')).toBe('42.0565,-87.6753');
    expect(u.searchParams.get('in')).toBe('countryCode:USA');
    expect(u.searchParams.get('lang')).toBe('en-US');
    expect(Number(u.searchParams.get('limit'))).toBe(SUGGEST_ASK);
    expect(SUGGEST_ASK).toBeGreaterThan(5); // room for the streets and completions that are dropped
    expect(u.searchParams.getAll('apiKey')).toEqual(['KEY']);
    expect(u.search).toContain('q=733+Col+%26+Co');
  });
  it('builds geocode, routing and browse requests', () => {
    expect(geocodeRequest('1890 Maple Ave', evanston).params.limit).toBe('1');
    expect(walkRequest({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }).params).toEqual({
      transportMode: 'pedestrian',
      origin: '1,2',
      destination: '3,4',
      return: 'summary',
    });
    expect(browseRequest(evanston, ['600-6400', '100-1000']).params.categories).toBe('600-6400,100-1000');
  });
});

describe('labels', () => {
  it('drops the country', () => {
    expect(shortLabel('1890 Maple Ave, Evanston, IL 60201, United States')).toBe('1890 Maple Ave, Evanston, IL 60201');
  });
  it('builds the street line without a place name', () => {
    expect(
      streetLabel({ label: 'Evanston Place, 1715 Chicago Ave, Evanston, IL 60201, United States', houseNumber: '1715', street: 'Chicago Ave', city: 'Evanston', stateCode: 'IL', postalCode: '60201-3456' }),
    ).toBe('1715 Chicago Ave, Evanston, IL 60201');
    expect(streetLabel({ label: 'Evanston, IL, United States' })).toBe('Evanston, IL');
  });
});

// Hand-written answers in the shape HERE Autosuggest v1 returns (items with resultType, address,
// position, distance from `at`), for the queries in the Founder's report.
const AUTOSUGGEST_733_COL = {
  items: [
    {
      title: '733 Colfax St, Evanston, IL 60201-2111, United States',
      id: 'here:af:streetsection:Q2OAYz3LbUOp0WGUnZ8ZeA:CgcIBCDj8_RnEAEaAzczMw',
      resultType: 'houseNumber',
      houseNumberType: 'PA',
      address: { label: '733 Colfax St, Evanston, IL 60201-2111, United States', countryCode: 'USA', countryName: 'United States', stateCode: 'IL', state: 'Illinois', county: 'Cook', city: 'Evanston', street: 'Colfax St', postalCode: '60201-2111', houseNumber: '733' },
      position: { lat: 42.06074, lng: -87.68471 },
      access: [{ lat: 42.06074, lng: -87.68442 }],
      distance: 911,
      highlights: { title: [{ start: 0, end: 7 }] },
    },
    {
      title: 'Colfax St, Evanston, IL 60201, United States',
      id: 'here:af:street:Q2OAYz3LbUOp0WGUnZ8ZeA',
      resultType: 'street',
      address: { label: 'Colfax St, Evanston, IL 60201, United States', city: 'Evanston', street: 'Colfax St', stateCode: 'IL', postalCode: '60201' },
      position: { lat: 42.06061, lng: -87.68703 },
      distance: 1050,
    },
    {
      title: '733 Colby Ct, Gurnee, IL 60031-3166, United States',
      id: 'here:af:streetsection:3bUcS2F1n0bT0x9Vt0dQ2C:CgcIBCCHhLs6EAEaAzczMw',
      resultType: 'houseNumber',
      houseNumberType: 'PA',
      address: { label: '733 Colby Ct, Gurnee, IL 60031-3166, United States', countryCode: 'USA', stateCode: 'IL', city: 'Gurnee', street: 'Colby Ct', postalCode: '60031-3166', houseNumber: '733' },
      position: { lat: 42.36951, lng: -87.92288 },
      distance: 40412,
    },
    // a coffee chain matching "Col": not an address the host typed
    { title: 'Colectivo Coffee', id: 'here:pds:place:840dp3wh-colectivo', resultType: 'place', address: { label: 'Colectivo Coffee, 716 Church St, Evanston, IL 60201, United States', houseNumber: '716', street: 'Church St', city: 'Evanston', stateCode: 'IL', postalCode: '60201' }, position: { lat: 42.04805, lng: -87.68296 }, distance: 1100 },
    { title: 'Coffee', id: 'here:cm:category:100-1100-0010', resultType: 'categoryQuery', href: 'https://autosuggest.search.hereapi.com/v1/discover?q=Coffee' },
    // the same address again, under another id
    {
      title: '733 Colfax St, Evanston, IL 60201, United States',
      id: 'here:af:streetsection:Q2OAYz3LbUOp0WGUnZ8ZeA:dup',
      resultType: 'houseNumber',
      address: { label: '733 Colfax St, Evanston, IL 60201, United States', stateCode: 'IL', city: 'Evanston', street: 'Colfax St', postalCode: '60201', houseNumber: '733' },
      position: { lat: 42.06074, lng: -87.68471 },
      distance: 911,
    },
    // far away: dropped
    { title: '733 Columbus Ave, New York, NY 10025, United States', id: 'here:af:streetsection:ny', resultType: 'houseNumber', address: { label: '733 Columbus Ave, New York, NY 10025, United States', stateCode: 'NY', city: 'New York', street: 'Columbus Ave', postalCode: '10025', houseNumber: '733' }, position: { lat: 40.7921, lng: -73.9694 }, distance: 1145000 },
    // inside 60 km of Evanston but across the state line, outside the Chicago area
    { title: '733 Columbus Dr, Kenosha, WI 53140, United States', id: 'here:af:streetsection:wi', resultType: 'houseNumber', address: { label: '733 Columbus Dr, Kenosha, WI 53140, United States', stateCode: 'WI', city: 'Kenosha', street: 'Columbus Dr', postalCode: '53140', houseNumber: '733' }, position: { lat: 42.5847, lng: -87.8212 }, distance: 59800 },
    // no position: judged by its distance from the campus
    { title: '733 Colonial Ct, Glenview, IL 60025, United States', id: 'here:af:streetsection:glenview', resultType: 'houseNumber', address: { label: '733 Colonial Ct, Glenview, IL 60025, United States', stateCode: 'IL', city: 'Glenview', street: 'Colonial Ct', postalCode: '60025', houseNumber: '733' }, distance: 14200 },
    { title: '733 Colfax Ave, Denver, CO 80204, United States', id: 'here:af:streetsection:denver', resultType: 'houseNumber', address: { label: '733 Colfax Ave, Denver, CO 80204, United States' } },
  ],
  queryTerms: [],
};

// A house number alone: completions and areas, no address yet.
const AUTOSUGGEST_733 = {
  items: [
    { title: '73301, Austin, TX, United States', id: 'here:cm:namedplace:73301', resultType: 'postalCodePoint', address: { label: '73301, Austin, TX, United States', postalCode: '73301' }, position: { lat: 30.32, lng: -97.77 }, distance: 1500000 },
    { title: '733', id: 'here:cm:query:733', resultType: 'query' },
  ],
};

const AUTOSUGGEST_SHERMAN = {
  items: [
    {
      title: 'Residences of Sherman Plaza',
      id: 'here:pds:place:840dp3wh-sherman',
      resultType: 'place',
      address: { label: 'Residences of Sherman Plaza, 807 Davis St, Evanston, IL 60201-4471, United States', houseNumber: '807', street: 'Davis St', city: 'Evanston', stateCode: 'IL', postalCode: '60201-4471' },
      position: { lat: 42.04761, lng: -87.68239 },
      distance: 1150,
      categories: [{ id: '500-5100-0000', name: 'Apartment Rental' }],
    },
    { title: 'Sherman Ave, Evanston, IL 60201, United States', id: 'here:af:street:sherman', resultType: 'street', address: { label: 'Sherman Ave, Evanston, IL 60201, United States' }, position: { lat: 42.05, lng: -87.68 }, distance: 700 },
    { title: 'Sherman Park', id: 'here:pds:place:park', resultType: 'place', address: { label: 'Sherman Park, Chicago, IL 60609, United States', city: 'Chicago' }, position: { lat: 41.7979, lng: -87.6596 }, distance: 29000 },
  ],
};

describe('suggestions', () => {
  it('completes "733 Col" to street addresses around Evanston, nearest first', () => {
    expect(toSuggestions(AUTOSUGGEST_733_COL, evanston, { q: '733 Col' })).toEqual([
      { id: 'here:af:streetsection:Q2OAYz3LbUOp0WGUnZ8ZeA:CgcIBCDj8_RnEAEaAzczMw', label: '733 Colfax St, Evanston, IL 60201', title: '733 Colfax St', sub: 'Evanston, IL 60201' },
      { id: 'here:af:streetsection:3bUcS2F1n0bT0x9Vt0dQ2C:CgcIBCCHhLs6EAEaAzczMw', label: '733 Colby Ct, Gurnee, IL 60031', title: '733 Colby Ct', sub: 'Gurnee, IL 60031' },
      { id: 'here:af:streetsection:glenview', label: '733 Colonial Ct, Glenview, IL 60025', title: '733 Colonial Ct', sub: 'Glenview, IL 60025' },
    ]);
  });
  it('drops streets, places, query completions, repeats and anything outside the Chicago area', () => {
    const ids = toSuggestions(AUTOSUGGEST_733_COL, evanston, { q: '733 Col' }).map((s) => s.id);
    expect(ids.some((id) => /street:|place|category|dup|ny|wi|denver/.test(id))).toBe(false);
  });
  it('keeps only addresses within reach of the chosen campus', () => {
    // Gurnee is 36 km from Evanston and 58 km from the Chicago campus: both within the 60 km default
    expect(toSuggestions(AUTOSUGGEST_733_COL, chicago, { q: '733 Col' }).map((s) => s.title)).toEqual(['733 Colfax St', '733 Colby Ct', '733 Colonial Ct']);
    expect(toSuggestions(AUTOSUGGEST_733_COL, chicago, { q: '733 Col', maxKm: 40 }).map((s) => s.title)).toEqual(['733 Colfax St', '733 Colonial Ct']);
    expect(toSuggestions(AUTOSUGGEST_733_COL, evanston, { q: '733 Col', maxKm: 5 }).map((s) => s.title)).toEqual(['733 Colfax St']);
  });
  it('returns at most 5', () => {
    const many = { items: Array.from({ length: 9 }, (_, i) => ({ ...AUTOSUGGEST_733_COL.items[0], id: `here:af:streetsection:${i}`, address: { ...AUTOSUGGEST_733_COL.items[0].address, houseNumber: String(700 + i) } })) };
    expect(toSuggestions(many, evanston, { q: '7' })).toHaveLength(5);
    expect(toSuggestions(many, evanston, { q: '7', max: 2 })).toHaveLength(2);
  });
  it('has nothing to offer for a house number alone', () => {
    expect(toSuggestions(AUTOSUGGEST_733, evanston, { q: '733' })).toEqual([]);
  });
  it('offers a building with a street address when a name is typed', () => {
    expect(toSuggestions(AUTOSUGGEST_SHERMAN, evanston, { q: 'Sherman Pl' })).toEqual([
      { id: 'here:pds:place:840dp3wh-sherman', label: '807 Davis St, Evanston, IL 60201', title: 'Residences of Sherman Plaza', sub: '807 Davis St, Evanston, IL 60201' },
    ]);
    // a typed number means a street address: places are left out
    expect(toSuggestions(AUTOSUGGEST_SHERMAN, evanston, { q: '807 Sherman' })).toEqual([]);
  });
  it('survives odd answers', () => {
    expect(toSuggestions(null, evanston)).toEqual([]);
    expect(toSuggestions({ items: 'no' }, evanston)).toEqual([]);
    expect(toSuggestions({ items: [null, 3, { id: 'x', resultType: 'houseNumber' }] }, evanston)).toEqual([]);
  });
});

describe('places', () => {
  const item = {
    id: 'here:af:streetsection:2',
    resultType: 'houseNumber',
    position: { lat: 42.0512, lng: -87.6871 },
    address: { label: '1890 Maple Ave, Evanston, IL 60201, United States', houseNumber: '1890', street: 'Maple Ave', city: 'Evanston', stateCode: 'IL', postalCode: '60201', district: 'Downtown Evanston' },
  };
  it('keeps the point, area and ZIP', () => {
    expect(toPlace(item)).toEqual({ lat: 42.0512, lng: -87.6871, label: '1890 Maple Ave, Evanston, IL 60201', title: '', area: 'Downtown Evanston', zip: '60201' });
  });
  it('has no area when HERE gives none', () => {
    expect(toPlace({ ...item, address: { ...item.address, district: undefined } })?.area).toBeNull();
  });
  it('needs a point', () => {
    expect(toPlace({ ...item, position: undefined })).toBeNull();
    expect(toPlace(null)).toBeNull();
  });
  it('trusts only confident house-number or building matches', () => {
    expect(firstGeocode({ items: [{ ...item, scoring: { queryScore: 0.95 } }] })).not.toBeNull();
    expect(firstGeocode({ items: [{ ...item, scoring: { queryScore: 0.4 } }] })).toBeNull();
    expect(firstGeocode({ items: [{ ...item, resultType: 'locality' }] })).toBeNull();
    expect(firstGeocode({ items: [] })).toBeNull();
  });
});

describe('walking', () => {
  it('adds up the sections in minutes', () => {
    expect(walkMinutes({ routes: [{ sections: [{ summary: { duration: 400 } }, { summary: { duration: 200 } }] }] })).toBe(10);
    expect(walkMinutes({ routes: [{ sections: [{ summary: { duration: 5 } }] }] })).toBe(1);
  });
  it('is null when there is no route', () => {
    expect(walkMinutes({ routes: [] })).toBeNull();
    expect(walkMinutes({ notices: [{ code: 'noRouteFound' }] })).toBeNull();
    expect(walkMinutes({ routes: [{ sections: [{ summary: {} }] }] })).toBeNull();
  });
  it('picks the nearest place within range, walking to its entrance', () => {
    const near = nearestOf({
      items: [
        { title: 'Davis', position: { lat: 1, lng: 2 }, access: [{ lat: 1.1, lng: 2.1 }], distance: 420.4 },
        { title: 'Far', position: { lat: 3, lng: 4 }, distance: 900 },
      ],
    });
    expect(near).toEqual({ name: 'Davis', meters: 420, to: { lat: 1.1, lng: 2.1 } });
    expect(nearestOf({ items: [{ title: 'Far', position: { lat: 3, lng: 4 }, distance: 5000 }] })).toBeNull();
  });
});
