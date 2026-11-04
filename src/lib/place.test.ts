import { describe, expect, it } from 'vitest';
import { asNearby, asPlace, asSuggestions, asWalk, buildingById, listingPlace, sameAddress, type PickedPlace } from './place';

const picked: PickedPlace = {
  id: 'here:af:streetsection:2',
  lat: 42.051234,
  lng: -87.687149,
  area: 'Downtown Evanston',
  zip: '60201',
  walk: 13,
  label: '1890 Maple Ave, Evanston, IL 60201',
  campusId: 'nu-evn',
};

describe('answers from the functions', () => {
  it('keeps well-formed suggestions only', () => {
    expect(asSuggestions([{ id: 'here:1', label: '1890 Maple Ave', title: '1890 Maple Ave', sub: 'Evanston' }, { id: 2 }, null, { id: 'here:3' }])).toEqual([
      { id: 'here:1', label: '1890 Maple Ave', title: '1890 Maple Ave', sub: 'Evanston' },
    ]);
    expect(asSuggestions('nope')).toEqual([]);
  });
  it('checks a place, including one restored from a saved draft', () => {
    expect(asPlace(picked)).toEqual(picked);
    expect(asPlace({ ...picked, lat: '42' })).toBeNull();
    expect(asPlace({ ...picked, lat: 120 })).toBeNull();
    expect(asPlace({ ...picked, label: '' })).toBeNull();
    expect(asPlace({ ...picked, walk: -3, zip: 'abc', campusId: 'mit', area: 7 })).toEqual({
      id: picked.id,
      lat: picked.lat,
      lng: picked.lng,
      area: null,
      zip: null,
      walk: null,
      label: picked.label,
    });
  });
  it('keeps nearby places of known kinds', () => {
    expect(asNearby([{ kind: 'grocery', name: 'Jewel-Osco', meters: 420.2, walk: 6 }, { kind: 'bar', name: 'x', meters: 1 }])).toEqual([
      { kind: 'grocery', name: 'Jewel-Osco', meters: 420, walk: 6 },
    ]);
  });
});

describe('what a listing stores', () => {
  it('notices an address typed over after a pick', () => {
    expect(sameAddress('1890 Maple Ave, Evanston, IL 60201', '1890 maple ave evanston il 60201')).toBe(true);
    expect(sameAddress('1890 Maple Ave, Evanston, IL 60201', '1890 Maple Ave, Apt 3, Evanston')).toBe(false);
    expect(sameAddress('', '')).toBe(false);
  });
  it('uses the area, walk and exact map spot of the picked place', () => {
    expect(listingPlace(picked, picked.label, 'nu-evn')).toEqual({
      area: 'Downtown Evanston',
      walk: 13,
      location: { lat: 42.051234, lng: -87.687149 },
      zip: '60201',
    });
  });
  it('falls back to the address when HERE gives no area', () => {
    expect(listingPlace({ ...picked, area: null }, picked.label, 'nu-evn').area).toBe('Evanston');
  });
  it('drops a walk measured to another campus', () => {
    expect(listingPlace(picked, picked.label, 'chi-dt').walk).toBeNull();
  });
  it('works without HERE: area from the address, no walk, no map spot', () => {
    expect(listingPlace(null, '233 E Erie St, Chicago, IL 60611', 'nu-chi')).toEqual({ area: 'Streeterville', walk: null, location: null, zip: null });
  });
});

describe('the apartment directory', () => {
  it('finds a building by id, only within the campus\'s list when asked', () => {
    expect(buildingById('nu_e2')).toMatchObject({ name: 'E2 Apartments', address: '1890 Maple Ave, Evanston, IL', area: 'Downtown Evanston' });
    expect(buildingById('nu_e2', 'nu-evn')).not.toBeNull();
    expect(buildingById('nu_e2', 'chi-dt')).toBeNull();
    expect(buildingById('nu_chicago_saint_grand', 'nu-chi')).not.toBeNull();
    expect(buildingById('nu_chicago_saint_grand', 'chi-dt')).not.toBeNull();
    expect(buildingById('nope')).toBeNull();
  });
  it('keeps a picked building as a place that a listing can store', () => {
    const b = buildingById('nu_e2')!;
    const place = asPlace({ lat: b.lat, lng: b.lng, area: b.area, zip: null, walk: 16, label: b.address, apartmentId: b.id, campusId: 'nu-evn' });
    expect(place).toMatchObject({ apartmentId: 'nu_e2', walk: 16 });
    expect(listingPlace(place, b.address, 'nu-evn')).toEqual({ area: 'Downtown Evanston', walk: 16, location: { lat: b.lat, lng: b.lng }, zip: null });
  });
  it('reads the walk from a lookup by coordinates', () => {
    expect(asWalk({ lat: 1, lng: 2, label: '', walk: 9 })).toBe(9);
    expect(asWalk(null)).toBeNull();
  });
});
