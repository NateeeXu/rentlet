import { describe, expect, it } from 'vitest';
import {
  decodePolyline,
  DIRECTIONS,
  LINES,
  metersBetween,
  metersFromRoute,
  nearestStop,
  nearestStops,
  routePath,
  stopRows,
  walkingMinutes,
  ZONES,
  type DirectionId,
} from './shuttleData';

const IDS = Object.keys(DIRECTIONS) as DirectionId[];

describe('decodePolyline', () => {
  it('decodes Google’s example', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
  it('ends cleanly on empty or cut-off input', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline('_p~iF~ps|U_ulL').length).toBeLessThanOrEqual(2);
  });
});

describe('routes and stops', () => {
  it('has both Intercampus directions and both Loop patterns, with their colors', () => {
    expect(LINES.intercampus.directions).toEqual(['to-chicago', 'to-evanston']);
    expect(LINES.loop.directions).toEqual(['loop-a', 'loop-b']);
    expect(DIRECTIONS['to-chicago'].color).toBe('#4E2A84');
    expect(DIRECTIONS['loop-a'].color).toBe('#e8590c');
    expect(DIRECTIONS['loop-b'].color).toBe('#1c7ed6');
    for (const id of IDS) expect(LINES[DIRECTIONS[id].line].directions).toContain(id);
  });

  it('runs to Chicago from Ryan Field to Ward, and back', () => {
    const there = DIRECTIONS['to-chicago'].stops;
    const back = DIRECTIONS['to-evanston'].stops;
    expect(there[0].name).toBe('Ryan Field - Ashland / Walker Way');
    expect(there.at(-1)!.name).toBe('Ward');
    expect(back[0].name).toBe('Ward');
    expect(back.at(-1)!.name).toBe('Ryan Field - Ashland / Walker Way');
    expect(there).toHaveLength(18);
    expect(back).toHaveLength(12);
  });

  it('decodes each road shape from its first stop to its last (a Loop back to its first)', () => {
    for (const id of IDS) {
      const path = routePath(id);
      const stops = DIRECTIONS[id].stops;
      const end = DIRECTIONS[id].line === 'loop' ? stops[0] : stops.at(-1)!;
      expect(path.length).toBeGreaterThan(50);
      expect(metersBetween(path[0], stops[0])).toBeLessThan(50);
      expect(metersBetween(path.at(-1)!, end)).toBeLessThan(50);
      expect(routePath(id)).toBe(path); // decoded once
    }
  });

  it('puts every stop on its road shape and keeps TripShot ids in lower case', () => {
    for (const id of IDS) {
      for (const s of DIRECTIONS[id].stops) {
        expect(metersFromRoute(s, id)).toBeLessThan(60);
        expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
      }
    }
  });

  it('shows Loop B’s two Noyes L poles as one row', () => {
    const rows = stopRows('loop-b');
    expect(rows).toHaveLength(DIRECTIONS['loop-b'].stops.length - 1);
    const noyes = rows.find((r) => r.name === 'Noyes L')!;
    expect(noyes.ids).toHaveLength(2);
    expect(stopRows('to-chicago')).toHaveLength(18);
  });

  it('has both campuses and the three Evanston areas as closed outlines', () => {
    expect(ZONES.map((z) => z.id)).toEqual(['nu-campus', 'northwestern-chicago-streeterville', 'north-evanston', 'downtown-evanston', 'south-evanston']);
    expect(ZONES.filter((z) => z.kind === 'campus').map((z) => z.name)).toEqual(['Evanston campus', 'Chicago campus, Streeterville']);
    for (const z of ZONES) {
      expect(z.points.length).toBeGreaterThan(5);
      expect(z.label.lat).toBeGreaterThan(41.8);
      expect(z.label.lng).toBeLessThan(-87.6);
    }
  });
});

describe('distances', () => {
  it('measures meters on the ground', () => {
    // Weber Arch to Norris along Sheridan and Campus Dr, about 400 m as the crow flies
    const d = metersBetween({ lat: 42.051982, lng: -87.677182 }, { lat: 42.053312, lng: -87.673384 });
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(370);
  });

  it('estimates walking minutes as the straight line × 1.3 at 80 m a minute', () => {
    expect(walkingMinutes(0)).toBe(1);
    expect(walkingMinutes(400)).toBe(7); // 520 m of street
    expect(walkingMinutes(1000)).toBe(16);
    expect(walkingMinutes(-1)).toBeNaN();
  });

  it('finds the nearest stops to a home, one per corner', () => {
    // 1890 Maple Ave, Evanston
    const home = { lat: 42.0517876, lng: -87.6856596 };
    const near = nearestStops(home, { limit: 3 });
    expect(near[0].stop.name).toBe('Emerson / Maple');
    expect(near[0].meters).toBeLessThan(100);
    expect(near[0].walk).toBe(1);
    expect(new Set(near.map((n) => n.stop.name)).size).toBe(near.length);
    expect(near.map((n) => n.meters)).toEqual([...near.map((n) => n.meters)].sort((a, b) => a - b));
  });

  it('limits the search to some directions or a distance', () => {
    const ward = { lat: 41.8966, lng: -87.6199 };
    expect(nearestStop(ward)!.stop.name).toBe('Ward');
    expect(nearestStop(ward, ['loop-a'])!.stop.name).not.toBe('Ward');
    expect(nearestStops(ward, { directions: ['loop-a', 'loop-b'], maxMeters: 2000 })).toEqual([]);
  });
});
