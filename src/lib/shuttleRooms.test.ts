import { describe, expect, it } from 'vitest';
import { DIRECTIONS, metersBetween } from './shuttleData';
import {
  alongRoute,
  areaGroups,
  areaKey,
  campusesOf,
  campusShort,
  DEFAULT_DATES,
  homepagePlan,
  inArea,
  NEAR_STOP_METERS,
  OTHER_AREA,
  parseView,
  viewDirections,
  viewParam,
  withSchool,
} from './shuttleRooms';

// Ward, the Chicago campus stop: the only stop for kilometres, so distances from it are clean.
const WARD = DIRECTIONS['to-chicago'].stops.find((s) => s.name === 'Ward')!;
const M_PER_DEG_LAT = 111_195;
const northOfWard = (m: number) => ({ lat: WARD.lat + m / M_PER_DEG_LAT, lng: WARD.lng });
const NOYES = DIRECTIONS['loop-a'].stops.find((s) => s.name === 'Noyes L')!;

describe('views', () => {
  it('shows both directions of a line in its Route overview, one otherwise', () => {
    expect(viewDirections('intercampus', 'all')).toEqual(['to-chicago', 'to-evanston']);
    expect(viewDirections('loop', 'all')).toEqual(['loop-a', 'loop-b']);
    expect(viewDirections('intercampus', 'to-evanston')).toEqual(['to-evanston']);
  });
  it('reads ?d= as a direction or a line, and falls back to the Intercampus overview', () => {
    expect(parseView('to-chicago')).toEqual({ line: 'intercampus', view: 'to-chicago' });
    expect(parseView('loop-b')).toEqual({ line: 'loop', view: 'loop-b' });
    expect(parseView('loop')).toEqual({ line: 'loop', view: 'all' });
    expect(parseView('intercampus')).toEqual({ line: 'intercampus', view: 'all' });
    for (const bad of [null, undefined, '', 'all', 'toString', '__proto__', 'LOOP']) expect(parseView(bad)).toEqual({ line: 'intercampus', view: 'all' });
    expect(parseView(viewParam('loop', 'all'))).toEqual({ line: 'loop', view: 'all' });
    expect(parseView(viewParam('intercampus', 'to-evanston'))).toEqual({ line: 'intercampus', view: 'to-evanston' });
  });
});

describe('along the route', () => {
  it('counts a room within 800 m of a stop and leaves out one just past it', () => {
    expect(NEAR_STOP_METERS).toBe(800);
    const inside = northOfWard(790);
    const outside = northOfWard(810);
    expect(metersBetween(inside, WARD)).toBeLessThan(800);
    expect(metersBetween(outside, WARD)).toBeGreaterThan(800);
    const got = alongRoute([{ id: 'in', ...inside }, { id: 'out', ...outside }], ['to-chicago']);
    expect(got.map((r) => r.id)).toEqual(['in']);
    expect(got[0].stop.stop.name).toBe('Ward');
    expect(Math.round(got[0].stop.meters)).toBe(790);
    expect(got[0].stop.walk).toBe(13); // 790 m × 1.3 at 80 m a minute
  });
  it('counts a room at a stop itself', () => {
    expect(alongRoute([{ ...WARD, lat: WARD.lat, lng: WARD.lng }], ['to-evanston'])).toHaveLength(1);
  });
  it('only looks at the stops of the route on the map', () => {
    const room = { id: 'w', ...northOfWard(300) };
    expect(alongRoute([room], ['to-chicago'])).toHaveLength(1);
    expect(alongRoute([room], ['to-chicago', 'to-evanston'])).toHaveLength(1);
    expect(alongRoute([room], ['loop-a'])).toHaveLength(0); // the Loop never goes to Chicago
    expect(alongRoute([room], ['loop-a', 'loop-b'])).toHaveLength(0);
    expect(alongRoute([room], [])).toHaveLength(0);
    // near Noyes L: along the Loop and the Intercampus (both stop there)
    const evanston = { id: 'e', lat: NOYES.lat + 0.002, lng: NOYES.lng };
    expect(alongRoute([evanston], ['loop-a'])[0].stop.stop.name).toBe('Noyes L');
    expect(alongRoute([evanston], ['to-chicago'])).toHaveLength(1);
  });
  it('gives each room the nearest stop of the shown directions', () => {
    const [r] = alongRoute([{ lat: NOYES.lat, lng: NOYES.lng + 0.0003 }], ['to-chicago', 'to-evanston']);
    expect(r.stop.stop.name).toBe('Noyes L');
    expect(r.stop.direction).toBe('to-chicago');
  });
  it('skips rooms without a usable spot and keeps the order it was given', () => {
    const a = { id: 'a', ...northOfWard(100) };
    const b = { id: 'b', ...northOfWard(500) };
    const got = alongRoute(
      [b, { id: 'x', lat: null, lng: null }, { id: 'y', lat: NaN, lng: WARD.lng }, { id: 'z', lat: WARD.lat, lng: null }, a],
      ['to-chicago'],
    );
    expect(got.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('areas', () => {
  const rooms = [
    { area: 'Downtown Evanston' },
    { area: 'North Evanston' },
    { area: ' downtown  evanston ' },
    { area: '' },
    { area: 'Evanston' },
    { area: 'Downtown Evanston' },
  ];
  it('groups by area, most listings first, then by name, the unnamed last', () => {
    expect(areaGroups(rooms)).toEqual([
      { key: 'downtown evanston', label: 'Downtown Evanston', count: 3 },
      { key: 'evanston', label: 'Evanston', count: 1 },
      { key: 'north evanston', label: 'North Evanston', count: 1 },
      { key: '', label: OTHER_AREA, count: 1 },
    ]);
    expect(areaGroups([])).toEqual([]);
  });
  it('filters by an area key, or keeps every room for null', () => {
    expect(inArea(rooms, areaKey('Downtown Evanston'))).toHaveLength(3);
    expect(inArea(rooms, '')).toEqual([{ area: '' }]);
    expect(inArea(rooms, null)).toBe(rooms);
    expect(inArea(rooms, 'lakeview')).toEqual([]);
  });
  it('counts add up to every room', () => {
    expect(areaGroups(rooms).reduce((n, g) => n + g.count, 0)).toBe(rooms.length);
  });
});

describe('campus', () => {
  it('names the one campus all rooms share, else the one most of them have', () => {
    expect(campusesOf([{ school: 'nu-evn' }, { school: 'nu-evn' }])).toEqual({ only: 'nu-evn', most: 'nu-evn' });
    expect(campusesOf([{ school: 'nu-chi' }, { school: 'nu-evn' }, { school: 'nu-chi' }])).toEqual({ only: null, most: 'nu-chi' });
    expect(campusesOf([{ school: 'nu-chi' }, { school: 'nu-evn' }])).toEqual({ only: null, most: 'nu-evn' }); // tie: campus order
    expect(campusesOf([])).toEqual({ only: null, most: null });
  });
  it('shortens campus names', () => {
    expect(campusShort('nu-evn')).toBe('Evanston');
    expect(campusShort('nu-chi')).toBe('Chicago');
    expect(campusShort('chi-dt')).toBe('Downtown Chicago');
  });
});

describe('the saved search for the homepage', () => {
  it('keeps saved dates and anything else saved, and sets the campus', () => {
    expect(homepagePlan({ start: '2027-02-01', end: '2027-05-31', school: 'nu-chi', budget: 1400 }, 'nu-evn')).toEqual({
      start: '2027-02-01',
      end: '2027-05-31',
      school: 'nu-evn',
      budget: 1400,
    });
  });
  it('puts in the homepage’s own dates when none (or broken ones) are saved', () => {
    for (const saved of [null, undefined, 'x', [], {}, { start: '2027-02-01' }, { start: '2027-05-31', end: '2027-02-01' }, { start: 'soon', end: 'later' }]) {
      expect(homepagePlan(saved, 'nu-chi')).toMatchObject({ ...DEFAULT_DATES, school: 'nu-chi' });
    }
  });
  it('changes only the campus for the request form', () => {
    expect(withSchool({ start: '2027-02-01', end: '2027-05-31', school: 'chi-dt' }, 'nu-evn')).toEqual({ start: '2027-02-01', end: '2027-05-31', school: 'nu-evn' });
    expect(withSchool(null, 'nu-evn')).toEqual({ school: 'nu-evn' });
  });
});
