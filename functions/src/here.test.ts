import { describe, expect, it } from 'vitest';
import {
  browseRequest,
  firstGeocode,
  geocodeRequest,
  hereUrl,
  nearestOf,
  shortLabel,
  streetLabel,
  suggestRequest,
  toPlace,
  toSuggestions,
  walkMinutes,
  walkRequest,
} from './here';

const evanston = { lat: 42.0565, lng: -87.6753 };

describe('requests', () => {
  it('adds the key once and encodes the query', () => {
    const r = suggestRequest('1890 Maple & Co', evanston);
    const u = new URL(hereUrl(r.endpoint, r.params, 'KEY'));
    expect(u.origin + u.pathname).toBe('https://autocomplete.search.hereapi.com/v1/autocomplete');
    expect(u.searchParams.get('q')).toBe('1890 Maple & Co');
    expect(u.searchParams.get('at')).toBe('42.0565,-87.6753');
    expect(u.searchParams.get('in')).toBe('countryCode:USA');
    expect(u.searchParams.getAll('apiKey')).toEqual(['KEY']);
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

describe('suggestions', () => {
  const json = {
    items: [
      { id: 'here:af:street:1', resultType: 'street', title: 'Maple Ave, Evanston, IL 60201, United States', address: { label: 'Maple Ave, Evanston, IL 60201, United States' } },
      {
        id: 'here:af:streetsection:2',
        resultType: 'houseNumber',
        title: '1890 Maple Ave, Evanston, IL 60201, United States',
        address: { label: '1890 Maple Ave, Evanston, IL 60201, United States', houseNumber: '1890', street: 'Maple Ave', city: 'Evanston', stateCode: 'IL', postalCode: '60201' },
      },
      { id: 'not-here', resultType: 'houseNumber', title: 'x', address: { label: 'x' } },
      { id: 'here:pds:place:3', resultType: 'place', title: 'Evanston Place', address: { label: 'Evanston Place, 1715 Chicago Ave, Evanston, IL 60201, United States' } },
    ],
  };
  it('keeps only complete addresses (house numbers)', () => {
    expect(toSuggestions(json)).toEqual([
      { id: 'here:af:streetsection:2', label: '1890 Maple Ave, Evanston, IL 60201', title: '1890 Maple Ave', sub: 'Evanston, IL 60201' },
    ]);
  });
  it('survives odd answers', () => {
    expect(toSuggestions(null)).toEqual([]);
    expect(toSuggestions({ items: 'no' })).toEqual([]);
    expect(toSuggestions({ items: [null, 3] })).toEqual([]);
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
