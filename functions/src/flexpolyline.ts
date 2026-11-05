// HERE's flexible polyline, the shape HERE Routing v8 returns for each route section
// (https://github.com/heremaps/flexible-polyline). Decoding only; the tests carry an encoder.
//
// The text is a run of URL-safe base64 characters, each 6 bits: the low 5 bits are data and 0x20 means
// "more of this value follows". Values are unsigned varints, least significant chunk first. The first is
// the format version (1); the second is the header: bits 0-3 the precision (decimal places), bits 4-6 the
// third dimension (0 none, 1 level, 2 altitude, 3 elevation, 6 and 7 custom), bits 7-10 its precision.
// Then every point: latitude, longitude and the third dimension if any, each a zigzag-signed delta from
// the previous point (the first from zero), scaled by 10^precision.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const TABLE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) TABLE[ALPHABET.charCodeAt(i)] = i;

export const FORMAT_VERSION = 1;

export interface FlexPolyline {
  precision: number;
  thirdDim: number; // 0 when absent
  thirdDimPrecision: number;
  points: [number, number][]; // [lat, lng]; a third dimension is read past, not kept
}

export class PolylineError extends Error {}

function unsignedValues(encoded: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (let i = 0; i < encoded.length; i++) {
    const c = encoded.charCodeAt(i);
    const v = c < 128 ? TABLE[c] : -1;
    if (v < 0) throw new PolylineError('Invalid character.');
    value += (v & 0x1f) * 2 ** shift; // arithmetic, not bit shifts: values can pass 32 bits
    if (v & 0x20) {
      shift += 5;
      if (shift > 45) throw new PolylineError('Value too long.');
    } else {
      out.push(value);
      value = 0;
      shift = 0;
    }
  }
  if (shift) throw new PolylineError('Unfinished value.');
  return out;
}

// zigzag: 0, 1, 2, 3, 4 … -> 0, -1, 1, -2, 2 …
const signed = (u: number) => (u % 2 ? -(u + 1) / 2 : u / 2);

export function decodeFlexPolyline(encoded: string): FlexPolyline {
  if (typeof encoded !== 'string') throw new PolylineError('Expected text.');
  const v = unsignedValues(encoded);
  if (v.length < 2) throw new PolylineError('Missing header.');
  if (v[0] !== FORMAT_VERSION) throw new PolylineError('Unsupported version.');
  const header = v[1];
  if (header > 0x7ff) throw new PolylineError('Invalid header.');
  const precision = header & 15;
  const thirdDim = (header >> 4) & 7;
  const thirdDimPrecision = (header >> 7) & 15;
  const dims = thirdDim ? 3 : 2;
  if ((v.length - 2) % dims) throw new PolylineError('Unfinished point.');

  // sums are kept as integers and scaled per point, so long lines do not drift
  const scale = 10 ** precision;
  const points: [number, number][] = [];
  let lat = 0;
  let lng = 0;
  for (let i = 2; i < v.length; i += dims) {
    lat += signed(v[i]);
    lng += signed(v[i + 1]);
    points.push([lat / scale, lng / scale]);
  }
  return { precision, thirdDim, thirdDimPrecision, points };
}
