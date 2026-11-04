import { describe, expect, it } from 'vitest';
import { fits, NO_FILTER } from './filter';
import type { Listing } from './types';

const emily: Listing = {
  id: 'a', ownerId: 'u1', ownerName: 'Emily', ownerPhoto: '', kind: 'sublet', campus: 'evanston',
  title: 'Furnished 2-bed near campus', area: 'Downtown Evanston', bedrooms: 2, bathrooms: 1, furnished: true,
  price: 1250, start: '2027-06-01', end: '2027-08-31', photos: [], status: 'active',
};

describe('fits', () => {
  it('shows everything with no filter', () => {
    expect(fits(emily, NO_FILTER)).toBe(true);
  });
  it('filters by campus and rent', () => {
    expect(fits(emily, { ...NO_FILTER, campus: 'chicago' })).toBe(false);
    expect(fits(emily, { ...NO_FILTER, maxPrice: 1200 })).toBe(false);
    expect(fits(emily, { ...NO_FILTER, maxPrice: 1250 })).toBe(true);
  });
  it('keeps partial date overlaps and drops ranges that miss', () => {
    expect(fits(emily, { ...NO_FILTER, start: '2027-07-01', end: '2027-09-30' })).toBe(true);
    expect(fits(emily, { ...NO_FILTER, start: '2027-08-31', end: '2027-09-30' })).toBe(false);
    expect(fits(emily, { ...NO_FILTER, start: '2027-05-01', end: '2027-06-01' })).toBe(false);
  });
});
