import type { Campus, Listing } from './types';

export interface ListingFilter {
  campus: Campus | 'all';
  start: string; // '' when not set
  end: string;
  maxPrice: number | null;
}

export const NO_FILTER: ListingFilter = { campus: 'all', start: '', end: '', maxPrice: null };

// A listing fits when it is on the chosen campus, under the rent cap, and free for at least part
// of the chosen dates (sublets rarely line up to the day, so partial overlap still shows).
export function fits(l: Listing, f: ListingFilter): boolean {
  if (f.campus !== 'all' && l.campus !== f.campus) return false;
  if (f.maxPrice != null && l.price > f.maxPrice) return false;
  if (f.start && l.end <= f.start) return false;
  if (f.end && l.start >= f.end) return false;
  return true;
}

export function applyFilter(list: Listing[], f: ListingFilter): Listing[] {
  return list.filter((l) => fits(l, f));
}
