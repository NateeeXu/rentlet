import { describe, expect, it } from 'vitest';
import { hereAttribution, hereTileUrl, inServiceArea, parseTilePath, tileBounds } from './tiles';

// Tile column and row for a point, the usual Web Mercator way.
const tileAt = (lat: number, lng: number, z: number) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { z, x: Math.floor(((lng + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
};

describe('parseTilePath', () => {
  it('reads /tiles/{z}/{x}/{y}, with or without the prefix or .png', () => {
    expect(parseTilePath('/tiles/15/8402/12176')).toEqual({ z: 15, x: 8402, y: 12176 });
    expect(parseTilePath('/15/8402/12176')).toEqual({ z: 15, x: 8402, y: 12176 });
    expect(parseTilePath('/tiles/15/8402/12176.png')).toEqual({ z: 15, x: 8402, y: 12176 });
    expect(parseTilePath('/tiles/0/0/0')).toEqual({ z: 0, x: 0, y: 0 });
  });
  it('refuses anything else', () => {
    for (const bad of ['/tiles/20/1/1', '/tiles/2/4/0', '/tiles/2/0/4', '/tiles/-1/0/0', '/tiles/1.5/0/0', '/tiles/a/b/c', '/tiles/15/8402', '/tiles/15/8402/12176/x', '/tiles/15/8402/12176?x', '/../15/1/1', '']) {
      expect(parseTilePath(bad)).toBeNull();
    }
  });
});

describe('service area', () => {
  it('serves Evanston, the Chicago campus and downtown at street zoom', () => {
    expect(inServiceArea(tileAt(42.0565, -87.6753, 17))).toBe(true); // Evanston campus
    expect(inServiceArea(tileAt(41.8967, -87.6199, 17))).toBe(true); // Ward, Chicago campus
    expect(inServiceArea(tileAt(41.8781, -87.6298, 19))).toBe(true); // the Loop
  });
  it('refuses tiles elsewhere', () => {
    expect(inServiceArea(tileAt(40.7128, -74.006, 15))).toBe(false); // New York
    expect(inServiceArea(tileAt(42.0565, -88.6, 12))).toBe(false); // west of the area
  });
  it('places tile edges correctly', () => {
    const b = tileBounds({ z: 1, x: 0, y: 0 });
    expect(b.west).toBe(-180);
    expect(b.east).toBe(0);
    expect(b.south).toBeCloseTo(0, 9);
    expect(b.north).toBeCloseTo(85.0511, 3);
  });
});

describe('HERE request', () => {
  it('asks for the quiet high-resolution tile, with the key added once', () => {
    const u = new URL(hereTileUrl({ z: 15, x: 8402, y: 12176 }, 'KEY'));
    expect(u.origin + u.pathname).toBe('https://maps.hereapi.com/v3/base/mc/15/8402/12176/png');
    expect(Object.fromEntries(u.searchParams)).toEqual({ style: 'lite.day', size: '512', scale: '2', lang: 'en', apiKey: 'KEY' });
  });
  it('dates the HERE notice', () => {
    expect(hereAttribution(2026)).toBe('© 2026 HERE');
  });
});
