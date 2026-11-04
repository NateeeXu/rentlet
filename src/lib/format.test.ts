import { describe, expect, it } from 'vitest';
import { dateRange, money, monthWeeks, nights, oneDay, shortSpan } from './format';

const TODAY = '2026-11-04';

describe('format', () => {
  it('formats rent', () => {
    expect(money(1250)).toBe('$1,250');
  });
  it('drops the year inside the current year', () => {
    expect(dateRange('2026-11-05', '2026-12-20', TODAY)).toBe('Nov 5 – Dec 20');
  });
  it('puts one year at the end for a later year', () => {
    expect(dateRange('2027-06-01', '2027-08-31', TODAY)).toBe('Jun 1 – Aug 31, 2027');
  });
  it('shows both years when a stay crosses New Year', () => {
    expect(dateRange('2026-12-20', '2027-03-15', TODAY)).toBe('Dec 20, 2026 – Mar 15, 2027');
  });
  it('formats single days and short spans', () => {
    expect(oneDay('2026-12-07', TODAY)).toBe('Dec 7');
    expect(oneDay('2027-06-01', TODAY)).toBe('Jun 1, 2027');
    expect(shortSpan('2026-12-07', '2026-12-12')).toBe('Dec 7–12');
    expect(shortSpan('2027-03-21', '2027-04-02')).toBe('Mar 21 – Apr 2');
  });
  it('counts nights', () => {
    expect(nights('2027-06-01', '2027-08-31')).toBe(91);
  });
  it('lays a month out in Sunday-first weeks', () => {
    const weeks = monthWeeks([2027, 5]); // June 2027 starts on a Tuesday
    expect(weeks[0].slice(0, 2)).toEqual([null, null]);
    expect(weeks[0][2]).toEqual({ day: '2027-06-01', d: 1, col: 2 });
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });
});
