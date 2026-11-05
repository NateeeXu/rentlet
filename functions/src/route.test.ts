import { describe, expect, it, vi } from 'vitest';
import {
  CACHE_OK,
  hereRouteUrl,
  lineBetween,
  listingOrigin,
  parseRouteQuery,
  reachProblem,
  routeHandler,
  RouteInputError,
  thin,
  toRoute,
  type LatLng,
  type Mode,
  type Point,
  type RouteBody,
} from './route';

// A flexible-polyline encoder (precision 5, 2D) for hand-written HERE answers.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function unsigned(u: number): string {
  let s = '';
  while (u > 0x1f) {
    s += ALPHABET[(u % 32) | 0x20];
    u = Math.floor(u / 32);
  }
  return s + ALPHABET[u];
}
function encode(points: LatLng[]): string {
  let out = unsigned(1) + unsigned(5);
  let last = [0, 0];
  for (const p of points) {
    const v = [Math.round(p[0] * 1e5), Math.round(p[1] * 1e5)];
    for (const i of [0, 1]) {
      const d = v[i] - last[i];
      out += unsigned(d < 0 ? -2 * d - 1 : 2 * d);
    }
    last = v;
  }
  return out;
}

// A room near Sherman Ave, Evanston, and a grocery a few blocks away.
const ROOM: Point = { lat: 42.04812, lng: -87.68173 };
const GROCERY: Point = { lat: 42.05144, lng: -87.68232 };
const LEG_1: LatLng[] = [
  [42.04815, -87.68161],
  [42.04903, -87.68163],
  [42.04991, -87.68166],
];
const LEG_2: LatLng[] = [
  [42.04991, -87.68166],
  [42.05072, -87.68169],
  [42.05075, -87.68228],
  [42.0514, -87.6823],
];
const hereAnswer = (legs = [LEG_1, LEG_2]) => ({
  routes: [
    {
      id: 'r1',
      sections: legs.map((leg, i) => ({
        id: `s${i}`,
        type: 'pedestrian',
        summary: { duration: 200 + i * 100, length: 180 + i * 150, baseDuration: 200 },
        polyline: encode(leg),
        transport: { mode: 'pedestrian' },
      })),
    },
  ],
});
const LISTING = { status: 'active', code: '52775382', location: { ...ROOM }, title: 'Room' };
const q = (o: Record<string, unknown> = {}) => ({ code: '52775382', lat: String(GROCERY.lat), lng: String(GROCERY.lng), mode: 'walk', ...o });

describe('parseRouteQuery', () => {
  it('reads a listing code, a destination and a mode', () => {
    expect(parseRouteQuery(q())).toEqual({ code: '52775382', to: GROCERY, mode: 'walk' });
    for (const mode of ['walk', 'bike', 'drive']) expect(parseRouteQuery(q({ mode })).mode).toBe(mode);
  });
  it('rounds the destination to about a meter', () => {
    expect(parseRouteQuery(q({ lat: '42.0514449', lng: '-87.682321' })).to).toEqual({ lat: 42.05144, lng: -87.68232 });
  });
  it('refuses a bad code, mode or coordinate', () => {
    const bad: Record<string, unknown>[] = [
      { code: '02775382' }, { code: '5277538' }, { code: '527753821' }, { code: 'abcdefgh' }, { code: ['52775382'] }, { code: undefined },
      { mode: 'transit' }, { mode: 'toString' }, { mode: '__proto__' }, { mode: 'WALK' }, { mode: undefined },
      { lat: '' }, { lat: ' ' }, { lat: '1e3' }, { lat: '0x10' }, { lat: 'NaN' }, { lat: 'Infinity' }, { lat: '91' }, { lng: '-181' },
      { lat: ['42.05'] }, { lng: undefined }, { lat: '42.05.1' }, { lng: '-87.6 ' },
    ];
    for (const o of bad) expect(() => parseRouteQuery(q(o)), JSON.stringify(o)).toThrow(RouteInputError);
  });
});

describe('listingOrigin', () => {
  it("is an active listing's saved spot", () => {
    expect(listingOrigin(LISTING)).toEqual(ROOM);
  });
  it('is null for anything else', () => {
    expect(listingOrigin(undefined)).toBeNull();
    expect(listingOrigin({ ...LISTING, status: 'taken' })).toBeNull();
    expect(listingOrigin({ ...LISTING, status: 'hidden' })).toBeNull();
    expect(listingOrigin({ ...LISTING, location: null })).toBeNull();
    expect(listingOrigin({ ...LISTING, location: { lat: '42.05', lng: -87.68 } })).toBeNull();
    expect(listingOrigin({ ...LISTING, location: { lat: NaN, lng: -87.68 } })).toBeNull();
    expect(listingOrigin({ ...LISTING, location: { lat: 40.7128, lng: -74.006 } })).toBeNull(); // New York
  });
});

describe('reachProblem', () => {
  const north = (km: number): Point => ({ lat: ROOM.lat + km / 111.2, lng: ROOM.lng });
  const west = (km: number): Point => ({ lat: ROOM.lat, lng: ROOM.lng - km / (111.32 * Math.cos((ROOM.lat * Math.PI) / 180)) });
  it('allows 6 km on foot or by bike and 25 km by car', () => {
    for (const mode of ['walk', 'bike'] as Mode[]) {
      expect(reachProblem(ROOM, west(5.9), mode)).toBeNull();
      expect(reachProblem(ROOM, west(6.2), mode)).toBe('Too far from the room.');
    }
    expect(reachProblem(ROOM, west(24.5), 'drive')).toBeNull();
    expect(reachProblem(ROOM, west(26), 'drive')).toBe('Too far from the room.');
  });
  it('keeps to the Chicago map area', () => {
    expect(reachProblem({ lat: 42.47, lng: -87.83 }, { lat: 42.52, lng: -87.83 }, 'drive')).toBe('Outside the map area.');
    expect(reachProblem(ROOM, north(0.5), 'walk')).toBeNull();
  });
});

describe('hereRouteUrl', () => {
  it('asks HERE Routing v8 for the line and summary, with the key once', () => {
    const u = new URL(hereRouteUrl(ROOM, GROCERY, 'bike', 'KEY'));
    expect(u.origin + u.pathname).toBe('https://router.hereapi.com/v8/routes');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      transportMode: 'bicycle',
      origin: '42.04812,-87.68173',
      destination: '42.05144,-87.68232',
      return: 'polyline,summary',
      apiKey: 'KEY',
    });
    expect(new URL(hereRouteUrl(ROOM, GROCERY, 'walk', 'K')).searchParams.get('transportMode')).toBe('pedestrian');
    const car = new URL(hereRouteUrl(ROOM, GROCERY, 'drive', 'K')).searchParams;
    expect(car.get('transportMode')).toBe('car');
    expect(car.get('departureTime')).toBe('any');
  });
});

describe('toRoute', () => {
  it('joins the sections and sums their time and length', () => {
    const r = toRoute(hereAnswer());
    expect(r).toEqual({ points: [...LEG_1, ...LEG_2.slice(1)], seconds: 500, meters: 510 });
  });
  it('is null when HERE has no usable route', () => {
    expect(toRoute(null)).toBeNull();
    expect(toRoute({ notices: [{ code: 'couldNotMatchOrigin' }], routes: [] })).toBeNull();
    expect(toRoute({ routes: [{ sections: [] }] })).toBeNull();
    const a = hereAnswer();
    delete (a.routes[0].sections[1] as { polyline?: string }).polyline;
    expect(toRoute(a)).toBeNull();
    const b = hereAnswer();
    b.routes[0].sections[0].polyline = 'BF!!';
    expect(toRoute(b)).toBeNull();
    const c = hereAnswer();
    c.routes[0].sections[0].summary.duration = -1;
    expect(toRoute(c)).toBeNull();
    expect(toRoute(hereAnswer([[[42.05, -87.68]]]))).toBeNull(); // one point is not a line
  });
});

describe('thin and lineBetween', () => {
  it('keeps at most 400 points, the ends included', () => {
    const long: LatLng[] = Array.from({ length: 1234 }, (_, i) => [42 + i * 1e-5, -87.6 - i * 1e-5]);
    const t = thin(long);
    expect(t).toHaveLength(400);
    expect(t[0]).toEqual(long[0]);
    expect(t[399]).toEqual(long[1233]);
    expect(thin(LEG_1)).toBe(LEG_1);
  });
  it("runs from the room's pin to the place's, off the street when they are", () => {
    const line = lineBetween(ROOM, GROCERY, [...LEG_1, ...LEG_2.slice(1)]);
    expect(line[0]).toEqual([ROOM.lat, ROOM.lng]);
    expect(line[1]).toEqual(LEG_1[0]);
    expect(line[line.length - 1]).toEqual([GROCERY.lat, GROCERY.lng]);
    expect(line[line.length - 2]).toEqual([42.0514, -87.6823]);
    const onStreet = lineBetween({ lat: 42.04815, lng: -87.68161 }, { lat: 42.0514, lng: -87.6823 }, [...LEG_1, ...LEG_2.slice(1)]);
    expect(onStreet).toHaveLength(LEG_1.length + LEG_2.length - 1);
  });
});

describe('routeHandler', () => {
  const setup = (over: Partial<Parameters<typeof routeHandler>[0]> = {}) => {
    let t = 1_000_000;
    const listing = vi.fn(async (_code: string) => LISTING as Record<string, unknown> | undefined);
    const route = vi.fn(async (_from: Point, _to: Point, _mode: Mode): Promise<unknown> => hereAnswer());
    const handle = routeHandler({ listing, route, now: () => t, ...over });
    return { handle, listing, route, advance: (ms: number) => (t += ms) };
  };

  it("routes from the listing's own spot, never one the caller sends", async () => {
    const { handle, listing, route } = setup();
    const a = await handle(q({ origin: '41.88,-87.63', from: '41.88,-87.63', olat: '41.88' }));
    expect(listing).toHaveBeenCalledWith('52775382');
    expect(route).toHaveBeenCalledWith(ROOM, GROCERY, 'walk');
    expect(a.status).toBe(200);
    expect(a.cache).toBe(CACHE_OK);
    const body = a.body as RouteBody;
    expect(body).toMatchObject({ seconds: 500, meters: 510, mode: 'walk' });
    expect(body.points[0]).toEqual([ROOM.lat, ROOM.lng]);
    expect(body.points[body.points.length - 1]).toEqual([GROCERY.lat, GROCERY.lng]);
  });

  it('keeps answers for a day, one per listing spot, place and mode', async () => {
    const { handle, route, listing, advance } = setup();
    await handle(q());
    await handle(q());
    await handle(q({ lat: '42.051444' })); // the same place, rounded
    expect(route).toHaveBeenCalledTimes(1);
    expect(listing).toHaveBeenCalledTimes(3); // a listing taken down stops getting routes at once
    await handle(q({ mode: 'bike' }));
    expect(route).toHaveBeenCalledTimes(2);
    advance(24 * 60 * 60 * 1000 + 1);
    await handle(q());
    expect(route).toHaveBeenCalledTimes(3);
  });

  it('routes again when the listing moves', async () => {
    let spot = { ...ROOM };
    const { handle, route } = setup({ listing: async () => ({ ...LISTING, location: spot }) });
    await handle(q());
    spot = { lat: 42.0485, lng: -87.6815 };
    const a = await handle(q());
    expect(route).toHaveBeenCalledTimes(2);
    expect((a.body as RouteBody).points[0]).toEqual([42.0485, -87.6815]);
  });

  it('holds at most maxEntries answers, dropping the oldest', async () => {
    const { handle, route } = setup({ maxEntries: 2 });
    for (const lat of ['42.0501', '42.0502', '42.0503']) await handle(q({ lat }));
    await handle(q({ lat: '42.0503' }));
    await handle(q({ lat: '42.0502' }));
    expect(route).toHaveBeenCalledTimes(3);
    await handle(q({ lat: '42.0501' }));
    expect(route).toHaveBeenCalledTimes(4);
  });

  it("answers an empty line when HERE fails, without HERE's words, and asks again next time", async () => {
    const { handle, route } = setup();
    route.mockRejectedValueOnce(new Error('HERE 401 apiKey=SECRET-KEY invalid'));
    const a = await handle(q());
    expect(a).toEqual({ status: 200, cache: 'no-store', body: { points: [], seconds: null, meters: null, mode: 'walk' } });
    expect(JSON.stringify(a)).not.toContain('SECRET');
    const b = await handle(q());
    expect((b.body as RouteBody).points.length).toBeGreaterThan(2);
    expect(route).toHaveBeenCalledTimes(2);
  });

  it('keeps "no route" answers', async () => {
    const { handle, route } = setup();
    route.mockResolvedValue({ notices: [{ title: 'Route calculation failed', code: 'couldNotMatchDestination' }], routes: [] });
    const a = await handle(q({ mode: 'drive' }));
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ points: [], seconds: null, meters: null, mode: 'drive' });
    expect(JSON.stringify(a)).not.toContain('couldNot');
    await handle(q({ mode: 'drive' }));
    expect(route).toHaveBeenCalledTimes(1);
  });

  it('refuses listings that are not active and places out of reach, without calling HERE', async () => {
    const taken = setup({ listing: async () => ({ ...LISTING, status: 'taken' }) });
    expect((await taken.handle(q())).status).toBe(404);
    const missing = setup({ listing: async () => undefined });
    expect(await missing.handle(q())).toMatchObject({ status: 404, body: { error: 'No route for this listing.' } });
    const { handle, route } = setup();
    expect(await handle(q({ lat: '41.8781', lng: '-87.6298' }))).toMatchObject({ status: 400, body: { error: 'Too far from the room.' } }); // the Loop, on foot
    expect((await handle(q({ lat: '41.8781', lng: '-87.6298', mode: 'drive' }))).status).toBe(200); // 19 km by car
    expect(await handle(q({ lat: '43.0389', lng: '-87.9065', mode: 'drive' }))).toMatchObject({ status: 400, body: { error: 'Outside the map area.' } }); // Milwaukee
    expect(taken.route).not.toHaveBeenCalled();
    expect(missing.route).not.toHaveBeenCalled();
    expect(route).toHaveBeenCalledTimes(1);
  });

  it('refuses bad input before reading anything', async () => {
    const { handle, listing, route } = setup();
    expect(await handle(q({ code: '1' }))).toMatchObject({ status: 400, body: { error: 'Unknown listing.' } });
    expect(await handle(q({ mode: 'fly' }))).toMatchObject({ status: 400, body: { error: 'Unknown mode.' } });
    expect(await handle(q({ lat: 'x' }))).toMatchObject({ status: 400, body: { error: 'Expected coordinates.' } });
    expect(listing).not.toHaveBeenCalled();
    expect(route).not.toHaveBeenCalled();
  });

  it('answers an empty line when the listing cannot be read', async () => {
    const { handle, route } = setup({ listing: async () => Promise.reject(new Error('deadline')) });
    expect(await handle(q())).toEqual({ status: 200, cache: 'no-store', body: { points: [], seconds: null, meters: null, mode: 'walk' } });
    expect(route).not.toHaveBeenCalled();
  });
});
