// Northwestern (Evanston) 2026–27 undergraduate calendar, shown over the date picker so people can
// line a sublet up with quarters, finals and breaks.
// Source: Office of the Registrar, https://www.registrar.northwestern.edu/calendars/academic-calendars/
// (2026-27 tab, read November 4, 2026). Breaks are the gaps between one quarter's last exam and the
// next quarter's first class. Re-check against the registrar before each new academic year.

export type SchoolEventKind = 'term' | 'exam' | 'brk';

export interface SchoolEvent {
  name: string;
  start: string; // inclusive, YYYY-MM-DD
  end: string; // inclusive
  kind: SchoolEventKind;
}

export const NU_EVENTS: SchoolEvent[] = [
  { name: 'Fall quarter', start: '2026-09-23', end: '2026-12-05', kind: 'term' },
  { name: 'Fall finals', start: '2026-12-07', end: '2026-12-12', kind: 'exam' },
  { name: 'Winter break', start: '2026-12-13', end: '2027-01-03', kind: 'brk' },
  { name: 'Winter quarter', start: '2027-01-04', end: '2027-03-13', kind: 'term' },
  { name: 'Winter finals', start: '2027-03-15', end: '2027-03-20', kind: 'exam' },
  { name: 'Spring break', start: '2027-03-21', end: '2027-03-29', kind: 'brk' },
  { name: 'Spring quarter', start: '2027-03-30', end: '2027-06-05', kind: 'term' },
  { name: 'Spring finals', start: '2027-06-07', end: '2027-06-11', kind: 'exam' },
  { name: 'Summer session', start: '2027-06-21', end: '2027-08-29', kind: 'term' },
];

// The final or break that covers a day (quarters are background and not returned).
export function markOn(day: string, events: SchoolEvent[] = NU_EVENTS): SchoolEvent | undefined {
  return events.find((e) => e.kind !== 'term' && e.start <= day && e.end >= day);
}
