// Base map tiles for the site's maps: GET /tiles/{z}/{x}/{y} (Hosting rewrite -> mapTile). Fetches
// HERE Raster Tile API v3 with the key kept in the HERE_API_KEY secret, so it never reaches the browser,
// and returns the PNG with long cache headers: Hosting's CDN keeps each tile for a week and serves
// every later visitor without calling HERE. Only the Chicago area is served, which caps what the
// proxy can be used for. Maps must show hereAttribution() (HERE's required copyright notice).
import { onRequest } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';

const HERE_API_KEY = defineSecret('HERE_API_KEY');

export interface Tile {
  z: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 0;
export const MAX_ZOOM = 19;

// lite.day is HERE's quiet day style, made as a background for overlays. size=512 with scale=2 is
// HERE's high-resolution tile: the same ground as a 256 px tile at twice the pixels, so the site
// draws it at 256 CSS px (Leaflet tileSize 256, zoomOffset 0) and it stays sharp on retina screens.
export const HERE_TILE_BASE = 'https://maps.hereapi.com/v3/base/mc';
export const HERE_TILE_PARAMS = { style: 'lite.day', size: '512', scale: '2', lang: 'en' } as const;

// HERE's notice is "© <current year> HERE" plus any regional supplier; around Chicago there is none.
export function hereAttribution(year = new Date().getFullYear()): string {
  return `© ${year} HERE`;
}

// Chicago, Evanston and their suburbs, with Lake Michigan to the east.
export const SERVICE_AREA = { south: 41.4, north: 42.5, west: -88.4, east: -87.2 } as const;

// "/tiles/15/8402/12176", or the same without "/tiles" when the function is called by its own URL.
export function parseTilePath(path: string): Tile | null {
  const m = /^\/(?:tiles\/)?(\d{1,2})\/(\d{1,7})\/(\d{1,7})(?:\.png)?\/?$/.exec(path);
  if (!m) return null;
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (z < MIN_ZOOM || z > MAX_ZOOM) return null;
  const n = 2 ** z;
  if (x >= n || y >= n) return null;
  return { z, x, y };
}

const lngOf = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latOf = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

export function tileBounds({ z, x, y }: Tile): { north: number; south: number; west: number; east: number } {
  return { north: latOf(y, z), south: latOf(y + 1, z), west: lngOf(x, z), east: lngOf(x + 1, z) };
}

export function inServiceArea(t: Tile): boolean {
  const b = tileBounds(t);
  const a = SERVICE_AREA;
  return b.south < a.north && b.north > a.south && b.west < a.east && b.east > a.west;
}

// The key is added here and nowhere else; callers must never log the result.
export function hereTileUrl({ z, x, y }: Tile, apiKey: string): string {
  const u = new URL(`${HERE_TILE_BASE}/${z}/${x}/${y}/png`);
  for (const [k, v] of Object.entries(HERE_TILE_PARAMS)) u.searchParams.set(k, v);
  u.searchParams.set('apiKey', apiKey);
  return u.toString();
}

const TILE_CACHE = 'public, max-age=86400, s-maxage=604800';

export const mapTile = onRequest(
  { region: 'us-central1', invoker: 'public', secrets: [HERE_API_KEY], memory: '256MiB', timeoutSeconds: 20, maxInstances: 5 },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.set('Allow', 'GET, HEAD').set('Cache-Control', 'no-store').status(405).send('Method not allowed');
      return;
    }
    const tile = parseTilePath(req.path);
    if (!tile) {
      res.set('Cache-Control', 'public, max-age=3600').status(400).send('Not a map tile');
      return;
    }
    if (!inServiceArea(tile)) {
      res.set('Cache-Control', TILE_CACHE).status(404).send('Outside the map area');
      return;
    }
    // Logs carry the zoom and status only, never the URL (it holds the key).
    let upstream: Response;
    try {
      upstream = await fetch(hereTileUrl(tile, HERE_API_KEY.value()), {
        headers: { Accept: 'image/png' },
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      logger.warn('HERE tile request did not complete', { z: tile.z, error: (e as Error)?.name ?? 'Error' });
      res.set('Cache-Control', 'no-store').status(502).send('Map tile unavailable');
      return;
    }
    if (!upstream.ok) {
      logger.warn('HERE tile request failed', { z: tile.z, status: upstream.status });
      res.set('Cache-Control', 'no-store').status(upstream.status === 404 ? 404 : 502).send('Map tile unavailable');
      return;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    res
      .set('Content-Type', upstream.headers.get('content-type') || 'image/png')
      .set('Cache-Control', TILE_CACHE)
      .status(200)
      .send(body);
  },
);
