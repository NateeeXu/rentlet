// The shuttle page's views (a line's Route overview or one direction) and the rooms it shows along the
// route: which listings count as along it, their areas with counts, the campus they belong to and the
// saved search the homepage opens with. Pure functions (no DOM), tested.
import { CAMPUS_IDS, CAMPUS_NAME, isDay, type CampusId } from './listingView';
import { DIRECTIONS, LINES, nearestStops, type DirectionId, type LineId, type NearStop } from './shuttleData';

// "Along the route": a listing whose map spot lies within 800 m, in a straight line, of any stop of the
// route shown on the map (in the Route overview, any stop of either direction or either Loop pattern;
// otherwise any stop of the chosen direction). The distance to the road itself doesn't count: the shuttle
// only picks up at stops. 800 m is 10 minutes at the 80 m a minute walkingMinutes uses; by its street
// estimate (×1.3) the walk can be up to about 13 minutes, so the page says "within 800 m", not a time.
export const NEAR_STOP_METERS = 800;

// The Route overview of a line, or one of its directions.
export type View = 'all' | DirectionId;

export function viewDirections(line: LineId, view: View): DirectionId[] {
  return view === 'all' ? [...LINES[line].directions] : [view];
}

const isLine = (s: unknown): s is LineId => typeof s === 'string' && Object.hasOwn(LINES, s);
const isDirection = (s: unknown): s is DirectionId => typeof s === 'string' && Object.hasOwn(DIRECTIONS, s);

// The page's ?d= value: a direction ("to-chicago", "loop-a") or a line for its overview ("intercampus",
// "loop"). Anything else opens the Intercampus overview.
export function parseView(param: string | null | undefined): { line: LineId; view: View } {
  if (isDirection(param)) return { line: DIRECTIONS[param].line, view: param };
  if (isLine(param)) return { line: param, view: 'all' };
  return { line: 'intercampus', view: 'all' };
}

export function viewParam(line: LineId, view: View): string {
  return view === 'all' ? line : view;
}

export interface Spot {
  lat: number | null;
  lng: number | null;
}

export type AlongRoute<T> = T & { lat: number; lng: number; stop: NearStop };

// The rooms along the route of `directions` (NEAR_STOP_METERS above), in the order given, each with its
// nearest stop of those directions (straight-line meters and an estimated walk in minutes).
export function alongRoute<T extends Spot>(rooms: T[], directions: DirectionId[], maxMeters = NEAR_STOP_METERS): AlongRoute<T>[] {
  if (!directions.length) return [];
  const out: AlongRoute<T>[] = [];
  for (const r of rooms) {
    const { lat, lng } = r;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const stop = nearestStops({ lat, lng }, { directions, limit: 1, maxMeters })[0];
    if (stop) out.push({ ...r, lat, lng, stop });
  }
  return out;
}

export interface AreaGroup {
  key: string; // the area, trimmed and lower case ('' for listings without one)
  label: string; // as the first listing of the group writes it
  count: number;
}

export const OTHER_AREA = 'Other areas';

export const areaKey = (area: string): string => String(area ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// Listings grouped by their area field ("North Evanston", "Downtown Evanston"), most listings first, then
// by name; spelling differences of case and spacing count as one area, listings without one go last.
export function areaGroups(rooms: { area: string }[]): AreaGroup[] {
  const groups = new Map<string, AreaGroup>();
  for (const r of rooms) {
    const key = areaKey(r.area);
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { key, label: key ? String(r.area).trim().replace(/\s+/g, ' ') : OTHER_AREA, count: 1 });
  }
  return [...groups.values()].sort((a, b) => (!a.key ? 1 : !b.key ? -1 : b.count - a.count || a.label.localeCompare(b.label)));
}

// The rooms of one area (null: every area).
export function inArea<T extends { area: string }>(rooms: T[], key: string | null): T[] {
  return key === null ? rooms : rooms.filter((r) => areaKey(r.area) === key);
}

// The campus the rooms belong to: `only` when they all share one, `most` the one most of them have (in
// the campus order on ties); both null with no rooms.
export function campusesOf(rooms: { school: CampusId }[]): { only: CampusId | null; most: CampusId | null } {
  const n = new Map<CampusId, number>();
  for (const r of rooms) n.set(r.school, (n.get(r.school) ?? 0) + 1);
  let most: CampusId | null = null;
  for (const id of CAMPUS_IDS) if ((n.get(id) ?? 0) > (most ? n.get(most)! : 0)) most = id;
  return { only: n.size === 1 ? most : null, most };
}

// "Evanston", "Chicago", "Downtown Chicago": the campus name without the school.
export const campusShort = (id: CampusId): string => CAMPUS_NAME[id].split(' · ').pop() ?? CAMPUS_NAME[id];

// Both lines run from Evanston (the Loop only there), so with no rooms along them the page speaks of it.
export const HOME_CAMPUS: CampusId = 'nu-evn';

// The dates the homepage and room page fall back to when none are saved (index.html DEFAULT, room.html).
export const DEFAULT_DATES = { start: '2027-01-03', end: '2027-04-30' } as const;

type Saved = Record<string, unknown>;
const savedOf = (v: unknown): Saved => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Saved) : {});

// The saved search ('cs-plan' in sessionStorage) for the homepage's results at `school`: the dates already
// saved stay (the homepage only reads a plan with dates, so without them its own fallback dates go in),
// anything else saved stays too, and the campus becomes `school`.
export function homepagePlan(saved: unknown, school: CampusId): Saved & { start: string; end: string; school: CampusId } {
  const p = savedOf(saved);
  const dated = isDay(p.start) && isDay(p.end) && p.start < p.end;
  return { ...p, start: dated ? (p.start as string) : DEFAULT_DATES.start, end: dated ? (p.end as string) : DEFAULT_DATES.end, school };
}

// The saved search with only its campus changed (the request form reads it to pick its campus).
export function withSchool(saved: unknown, school: CampusId): Saved & { school: CampusId } {
  return { ...savedOf(saved), school };
}
