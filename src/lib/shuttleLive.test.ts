import { describe, expect, it } from 'vitest';
import { arrivalLabel, arrivalsAt, busCountLabel, busesOn, chicagoClock, elapsedSeconds, parseLiveReading, updatedLabel } from './shuttleLive';

const T = Date.parse('2026-11-04T19:33:03Z'); // 1:33 pm in Chicago
const GREENLEAF = '127d653b-04c8-403b-9773-7d8ad76b69f3';
const DAVIS = 'd463d994-bb7f-40fc-a01c-4413ad12f855';

// As GET /api/shuttle answered on 2026-11-04 (trimmed).
const ANSWER = {
  updatedAt: T,
  vehicles: [
    {
      id: '35012',
      line: 'to-evanston',
      lat: 42.034054,
      lng: -87.679359,
      heading: 350,
      ageSeconds: 3,
      nextStop: { id: GREENLEAF, name: 'Chicago / Greenleaf', seconds: 57 },
      arrivals: { [GREENLEAF]: 57, [DAVIS]: 237 },
    },
    {
      id: '35005',
      line: 'to-evanston',
      lat: 41.896768,
      lng: -87.619725,
      heading: null,
      ageSeconds: 11,
      nextStop: null,
      arrivals: { '6983f6d3-fcd9-4932-b9fb-7120f8c2f999': 417, [DAVIS]: 3637 },
    },
    // to or from the garage, well off the line: not shown
    { id: '35009', line: 'to-evanston', lat: 42.0, lng: -87.75, heading: 90, nextStop: null, arrivals: { [DAVIS]: 30 } },
    { id: '35001', line: 'to-chicago', lat: 42.061559, lng: -87.684598, heading: 17, nextStop: null, arrivals: {} },
    { id: 'bad-line', line: 'to-mars', lat: 42, lng: -87.6, arrivals: {} },
    { id: 'bad-point', line: 'loop-a', lat: 'x', lng: -87.6, arrivals: {} },
  ],
};

describe('parseLiveReading', () => {
  it('keeps well-formed buses on known lines', () => {
    const r = parseLiveReading(ANSWER)!;
    expect(r.updatedAt).toBe(T);
    expect(r.vehicles.map((v) => v.id)).toEqual(['35012', '35005', '35009', '35001']);
    expect(r.vehicles[0].nextStop).toEqual({ id: GREENLEAF, name: 'Chicago / Greenleaf', seconds: 57 });
  });
  it('refuses answers of the wrong shape', () => {
    for (const bad of [null, 'x', [], {}, { updatedAt: 'now', vehicles: [] }, { updatedAt: T }]) expect(parseLiveReading(bad)).toBeNull();
    expect(parseLiveReading({ updatedAt: T, vehicles: [] })).toEqual({ updatedAt: T, vehicles: [] });
  });
});

describe('buses and arrivals', () => {
  const r = parseLiveReading(ANSWER)!;

  it('shows only buses on their route', () => {
    expect(busesOn(r, 'to-evanston').map((v) => v.id)).toEqual(['35012', '35005']);
    expect(busesOn(r, 'to-chicago').map((v) => v.id)).toEqual(['35001']);
    expect(busesOn(r, 'loop-a')).toEqual([]);
    expect(busesOn(null, 'loop-a')).toEqual([]);
  });

  it('lists the next arrivals at a stop, soonest first, counted down from the reading', () => {
    expect(arrivalsAt(r, 'to-evanston', [DAVIS], T)).toEqual([237, 3637]);
    expect(arrivalsAt(r, 'to-evanston', [DAVIS], T + 20_000)).toEqual([217, 3617]);
    expect(arrivalsAt(r, 'to-evanston', [GREENLEAF], T + 90_000)).toEqual([0]);
    expect(arrivalsAt(r, 'to-chicago', [DAVIS], T)).toEqual([]);
    // a row standing for two poles takes the sooner of each bus
    expect(arrivalsAt(r, 'to-evanston', [DAVIS, GREENLEAF.toUpperCase()], T)).toEqual([57, 3637]);
  });

  it('counts down by this device’s clock, within limits', () => {
    expect(elapsedSeconds(r, T - 5000)).toBe(0);
    expect(elapsedSeconds(r, T + 8000)).toBe(8);
    expect(elapsedSeconds(r, T + 3_600_000)).toBe(600);
  });
});

describe('labels', () => {
  it('says when the next bus comes', () => {
    expect(arrivalLabel(0, T)).toBe('Arriving');
    expect(arrivalLabel(59, T)).toBe('Arriving');
    expect(arrivalLabel(237, T)).toBe('4 min');
    expect(arrivalLabel(3569, T)).toBe('59 min');
    expect(arrivalLabel(3637, T)).toBe('2:33 pm');
  });
  it('writes Chicago clock times in lower case', () => {
    expect(chicagoClock(Date.parse('2026-11-05T03:05:00Z'))).toBe('9:05 pm');
    expect(chicagoClock(Date.parse('2026-07-01T14:00:00Z'))).toBe('9:00 am');
  });
  it('says how fresh the reading is', () => {
    expect(updatedLabel(T, T + 2000)).toBe('Updated just now');
    expect(updatedLabel(T, T + 8000)).toBe('Updated 8 s ago');
    expect(updatedLabel(T, T + 150_000)).toBe('Updated 2 min ago');
    expect(updatedLabel(T, T + 2 * 3_600_000)).toBe('Updated 1:33 pm');
    expect(updatedLabel(T, T - 4000)).toBe('Updated just now');
  });
  it('counts buses', () => {
    expect(busCountLabel(1)).toBe('1 bus running');
    expect(busCountLabel(3)).toBe('3 buses running');
  });
});
