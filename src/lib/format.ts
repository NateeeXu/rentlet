export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_MS = 86_400_000;

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isoOf(y: number, m0: number, d: number): string {
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);
}

// Today in the visitor's own time zone, as YYYY-MM-DD.
export function todayISO(now: Date = new Date()): string {
  return isoOf(now.getFullYear(), now.getMonth(), now.getDate());
}

// "$1,250"
export function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// "Jun 1"
export function monthDay(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

// One date format everywhere, with an en dash between dates:
//   no year inside the current year            "Nov 5 – Dec 20"
//   one year at the end for a later year        "Jun 1 – Aug 31, 2027"
//   both years when the stay crosses New Year   "Dec 20, 2026 – Mar 15, 2027"
export function dateRange(start: string, end: string, today: string = todayISO()): string {
  const a = start.slice(0, 4);
  const b = end.slice(0, 4);
  if (a !== b) return `${monthDay(start)}, ${a} – ${monthDay(end)}, ${b}`;
  if (a === today.slice(0, 4)) return `${monthDay(start)} – ${monthDay(end)}`;
  return `${monthDay(start)} – ${monthDay(end)}, ${b}`;
}

// "Jun 1" this year, "Jun 1, 2027" in another year
export function oneDay(iso: string, today: string = todayISO()): string {
  return iso.slice(0, 4) === today.slice(0, 4) ? monthDay(iso) : `${monthDay(iso)}, ${iso.slice(0, 4)}`;
}

// "Dec 7–12" inside one month, "Mar 20 – Apr 2" across months
export function shortSpan(start: string, end: string): string {
  return start.slice(5, 7) === end.slice(5, 7)
    ? `${monthDay(start)}–${Number(end.slice(8, 10))}`
    : `${monthDay(start)} – ${monthDay(end)}`;
}

export function nights(start: string, end: string): number {
  return Math.max(0, Math.round((utc(end) - utc(start)) / DAY_MS));
}

export type YM = [number, number]; // [year, month 0–11]

export function addMonths([y, m]: YM, n: number): YM {
  const k = y * 12 + m + n;
  return [Math.floor(k / 12), k % 12];
}

export function monthKey([y, m]: YM): number {
  return y * 12 + m;
}

export interface DayCell {
  day: string;
  d: number;
  col: number;
}

// A month as weeks of seven cells, Sunday first; null pads the first and last week.
export function monthWeeks([y, m]: YM): (DayCell | null)[][] {
  const lead = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (DayCell | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) cells.push({ day: isoOf(y, m, d), d, col: (lead + d - 1) % 7 });
  while (cells.length % 7) cells.push(null);
  const rows: (DayCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}
