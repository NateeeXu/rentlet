import { describe, expect, it } from 'vitest';
import { decodeFlexPolyline, PolylineError } from './flexpolyline';

// An encoder, written from the published format, for round trips (the site never encodes).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function unsigned(u: number): string {
  let s = '';
  while (u > 0x1f) {
    s += ALPHABET[(u % 32) | 0x20];
    u = Math.floor(u / 32);
  }
  return s + ALPHABET[u];
}
const zigzag = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);
function encode(points: number[][], precision = 5, thirdDim = 0, thirdDimPrecision = 0): string {
  let out = unsigned(1) + unsigned(precision | (thirdDim << 4) | (thirdDimPrecision << 7));
  const last = [0, 0, 0];
  for (const p of points) {
    const vals = [Math.round(p[0] * 10 ** precision), Math.round(p[1] * 10 ** precision)];
    if (thirdDim) vals.push(Math.round(p[2] * 10 ** thirdDimPrecision));
    vals.forEach((v, i) => {
      out += unsigned(zigzag(v - last[i]));
      last[i] = v;
    });
  }
  return out;
}

// HERE's published example (github.com/heremaps/flexible-polyline, README)
const EXAMPLE = [
  [50.1022829, 8.6982122],
  [50.1020076, 8.6956695],
  [50.1006313, 8.691496],
  [50.09878, 8.6875156],
];
const EXAMPLE_2D = 'BFoz5xJ67i1B1B7PzIhaxL7Y';
const EXAMPLE_3D = 'BlBoz5xJ67i1BU1B7PUzIhaUxL7YU'; // the same line with altitudes 10, 20, 30, 40

const near = (got: [number, number][], want: number[][], digits: number) => {
  expect(got).toHaveLength(want.length);
  got.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(want[i][0], digits);
    expect(p[1]).toBeCloseTo(want[i][1], digits);
  });
};

describe('decodeFlexPolyline', () => {
  it("decodes HERE's published 2D example", () => {
    const d = decodeFlexPolyline(EXAMPLE_2D);
    expect(d).toMatchObject({ precision: 5, thirdDim: 0, thirdDimPrecision: 0 });
    expect(d.points).toEqual([
      [50.10228, 8.69821],
      [50.10201, 8.69567],
      [50.10063, 8.6915],
      [50.09878, 8.68752],
    ]);
  });
  it('reads past a third dimension', () => {
    const d = decodeFlexPolyline(EXAMPLE_3D);
    expect(d).toMatchObject({ precision: 5, thirdDim: 2, thirdDimPrecision: 0 });
    expect(d.points).toEqual(decodeFlexPolyline(EXAMPLE_2D).points);
  });
  it('matches the encoder written from the format', () => {
    expect(encode(EXAMPLE)).toBe(EXAMPLE_2D);
    expect(encode(EXAMPLE.map((p, i) => [...p, (i + 1) * 10]), 5, 2, 0)).toBe(EXAMPLE_3D);
  });
  it('round-trips a Chicago walk at precision 5, 6 and 7, west longitudes included', () => {
    const walk = [
      [42.05001, -87.68412],
      [42.05003, -87.6801],
      [42.05212, -87.68005],
      [42.0565, -87.6753],
    ];
    for (const precision of [5, 6, 7]) near(decodeFlexPolyline(encode(walk, precision)).points, walk, precision);
    near(decodeFlexPolyline(encode(walk.map((p) => [...p, 181.5]), 6, 3, 1)).points, walk, 6);
  });
  it('does not drift over a long line', () => {
    const pts: number[][] = [];
    let lat = 41.8781;
    let lng = -87.6298;
    for (let i = 0; i < 2000; i++) {
      lat += Math.sin(i) * 0.0003;
      lng -= Math.cos(i * 0.7) * 0.0004;
      pts.push([+lat.toFixed(5), +lng.toFixed(5)]);
    }
    const got = decodeFlexPolyline(encode(pts)).points;
    expect(got).toHaveLength(2000);
    near(got, pts, 9);
  });
  it('refuses broken text', () => {
    for (const bad of ['', 'B', 'CFoz5xJ67i1B', 'BFoz5xJ', 'BFoz5xJ67i1Bo', 'BF!z5xJ67i1B', 'BFoz5xJ67i1Bé', 'BF' + 'g'.repeat(12) + 'B']) {
      expect(() => decodeFlexPolyline(bad), bad).toThrow(PolylineError);
    }
  });
  it('reads a header with no points as an empty line', () => {
    expect(decodeFlexPolyline('BF').points).toEqual([]);
  });
});
