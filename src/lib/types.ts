import type { Timestamp } from 'firebase/firestore';

export type Campus = 'evanston' | 'chicago';
export type ListingKind = 'sublet' | 'takeover';
export type ListingStatus = 'active' | 'taken' | 'hidden';

export interface Listing {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerPhoto: string;
  kind: ListingKind;
  campus: Campus;
  title: string;
  area: string;
  bedrooms: number;
  bathrooms: number;
  furnished: boolean;
  price: number;
  deposit?: number;
  start: string; // YYYY-MM-DD, first night
  end: string; // YYYY-MM-DD, move-out day
  photos: string[];
  description?: string;
  walkMinutes?: number;
  status: ListingStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export const CAMPUS_LABEL: Record<Campus, string> = {
  evanston: 'Northwestern · Evanston',
  chicago: 'Northwestern · Chicago',
};

export const KIND_LABEL: Record<ListingKind, string> = {
  sublet: 'Short sublet',
  takeover: 'Lease takeover',
};
