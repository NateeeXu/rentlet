import { describe, expect, it } from 'vitest';
import {
  asNearby,
  asPlace,
  asSuggestions,
  asWalk,
  buildingById,
  CallHealth,
  clampPin,
  directoryAddresses,
  inServiceArea,
  listingPlace,
  mergeAddresses,
  metersBetween,
  movePin,
  PIN_RANGE_M,
  resetPin,
  RETRY_MS,
  sameAddress,
  type PickedPlace,
} from './place';

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
    expect(asNearby([{ kind: 'grocery', name: 'Jewel-Osco', meters: 420.2, walk: 6, lat: 42.05, lng: -87.68 }, { kind: 'bar', name: 'x', meters: 1 }])).toEqual([
      { kind: 'grocery', name: 'Jewel-Osco', meters: 420, walk: 6, lat: 42.05, lng: -87.68 },
    ]);
    expect(asNearby([{ kind: 'food', name: 'Cafe', meters: 90, walk: null }])[0]).toMatchObject({ lat: null, lng: null });
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

describe('moving the pin (Adjust position)', () => {
  const home = { lat: picked.lat, lng: picked.lng };
  it('keeps a small move as it is', () => {
    const p = { lat: 42.0514, lng: -87.6869 }; // about 25 m
    expect(clampPin(home, p)).toEqual(p);
  });
  it('pulls a far move back to the edge, on the same bearing', () => {
    const far = { lat: 42.0612, lng: -87.6871 }; // about 1.1 km north
    const q = clampPin(home, far);
    expect(metersBetween(home, q)).toBeLessThanOrEqual(PIN_RANGE_M);
    expect(metersBetween(home, q)).toBeGreaterThan(PIN_RANGE_M - 2);
    expect(q.lat).toBeGreaterThan(home.lat);
    expect(Math.abs(q.lng - home.lng)).toBeLessThan(0.0001);
  });
  it('stays inside the service area', () => {
    const edge = { lat: 42.4995, lng: -87.9 };
    const q = clampPin(edge, { lat: 42.502, lng: -87.9 });
    expect(inServiceArea(q)).toBe(true);
    expect(inServiceArea({ lat: 40.71, lng: -74 })).toBe(false);
  });
  it('remembers the address point while moved, and resets to it', () => {
    const moved = movePin(picked, { lat: 42.0514, lng: -87.6869 });
    expect(moved).toMatchObject({ lat: 42.0514, lng: -87.6869, origin: home, id: picked.id, label: picked.label, walk: 13 });
    // moved again: still measured from the address point, not from the last spot
    const again = movePin(moved, { lat: 42.07, lng: -87.6871 });
    expect(again.origin).toEqual(home);
    expect(metersBetween(home, again)).toBeLessThanOrEqual(PIN_RANGE_M);
    expect(resetPin(again)).toEqual(picked);
    expect(resetPin(picked)).toBe(picked);
    // dragged back onto the address point: a plain place again
    expect(movePin(moved, { lat: home.lat + 0.000003, lng: home.lng })).toEqual(picked);
  });
  it('stores the moved spot on the listing', () => {
    const moved = movePin(picked, { lat: 42.0514, lng: -87.6869 });
    expect(listingPlace(moved, picked.label, 'nu-evn').location).toEqual({ lat: 42.0514, lng: -87.6869 });
  });
  it('keeps a moved pin from a saved draft within reach of its address point', () => {
    const moved = movePin(picked, { lat: 42.0514, lng: -87.6869 });
    expect(asPlace(JSON.parse(JSON.stringify(moved)))).toEqual(moved);
    const pulled = asPlace({ ...moved, lat: 42.2, lng: -87.6869 })!;
    expect(metersBetween(home, pulled)).toBeLessThanOrEqual(PIN_RANGE_M);
    expect(asPlace({ ...picked, origin: { lat: 'x', lng: 1 } })).toEqual(picked);
  });
});

describe('the Street address field without HERE', () => {
  it('matches the directory\'s street addresses as they are typed', () => {
    expect(directoryAddresses('1890 Ma', 'nu-evn')[0]).toEqual({ apartmentId: 'nu_e2', label: '1890 Maple Ave, Evanston, IL', title: '1890 Maple Ave', sub: 'Evanston, IL · E2 Apartments' });
    expect(directoryAddresses('1890 maple avenue', 'nu-evn')[0]?.apartmentId).toBe('nu_e2');
    expect(directoryAddresses('1890 Maple Ave, Evanston, IL 60201', 'nu-evn')[0]?.apartmentId).toBe('nu_e2');
    expect(directoryAddresses('maple ave', 'nu-evn').map((a) => a.title)).toEqual(expect.arrayContaining(['1890 Maple Ave', '1720 Maple Ave']));
  });
  it('matches building names too, but not other campuses', () => {
    expect(directoryAddresses('E2', 'nu-evn')[0]?.apartmentId).toBe('nu_e2');
    expect(directoryAddresses('1890 Ma', 'nu-chi')).toEqual([]);
    expect(directoryAddresses('1', 'nu-evn')).toEqual([]);
    expect(directoryAddresses('733 Col', 'nu-evn')).toEqual([]);
    expect(directoryAddresses('Maple', 'nu-evn').length).toBeLessThanOrEqual(5);
  });
  it('puts HERE first and adds directory buildings on other streets', () => {
    const here = [{ id: 'here:1', label: '1890 Maple Ave, Evanston, IL 60201', title: '1890 Maple Ave', sub: 'Evanston, IL 60201' }];
    const dir = directoryAddresses('maple ave', 'nu-evn');
    const merged = mergeAddresses(here, dir);
    expect(merged[0]).toBe(here[0]);
    expect(merged.filter((x) => x.title === '1890 Maple Ave')).toHaveLength(1);
    expect(merged.some((x) => 'apartmentId' in x && x.title === '1720 Maple Ave')).toBe(true);
    expect(mergeAddresses([], dir, 1)).toHaveLength(1);
  });
});

describe('calling the functions', () => {
  it('waits a little after a failure instead of giving up', () => {
    const h = new CallHealth();
    expect(h.allow(0)).toBe(true);
    h.fail('functions/internal', 0); // a deploy rolling out, a cold start
    expect(h.last).toBe('failed');
    expect(h.allow(RETRY_MS[0] - 1)).toBe(false);
    expect(h.allow(RETRY_MS[0])).toBe(true);
    h.fail('functions/deadline-exceeded', 1000);
    expect(h.allow(1000 + RETRY_MS[1] - 1)).toBe(false);
    expect(h.allow(1000 + RETRY_MS[1])).toBe(true);
    for (let i = 0; i < 10; i++) h.fail('functions/unavailable', 0);
    expect(h.allow(RETRY_MS[RETRY_MS.length - 1])).toBe(true); // never longer than the last wait
    h.ok();
    expect(h.allow(0)).toBe(true);
    expect(h.last).toBe('ok');
  });
  it('stops asking only a function that is not deployed', () => {
    const h = new CallHealth();
    h.fail('functions/not-found', 0);
    expect(h.allow(10 ** 9)).toBe(false);
  });
  it('does not count answers about the request or the account as failures', () => {
    const h = new CallHealth();
    h.fail('functions/invalid-argument', 0);
    expect(h.allow(0)).toBe(true);
    h.fail('functions/unauthenticated', 0);
    expect(h.last).toBe('signed-out');
    expect(h.allow(0)).toBe(true);
  });
});
