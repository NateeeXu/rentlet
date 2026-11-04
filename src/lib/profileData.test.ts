import { describe, expect, it } from 'vitest';
import {
  affiliation,
  cleanFirstName,
  contactEmailError,
  instagramError,
  isListingCode,
  listingFilePaths,
  liveCount,
  normalizeInstagram,
  requestView,
  sortOwnListings,
  storagePathFromUrl,
  validListingShape,
  validRequestShape,
} from './profileData';

const url = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/rentlet-nu.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=abc`;

describe('names and contact fields', () => {
  it('keeps one first name of at most 24 characters', () => {
    expect(cleanFirstName('  Emily Chen ')).toBe('Emily');
    expect(cleanFirstName('')).toBe('');
    expect(cleanFirstName(null)).toBe('');
    expect(cleanFirstName('A'.repeat(30))).toHaveLength(24);
  });
  it('tells students from staff', () => {
    expect(affiliation('emily2027@u.northwestern.edu')).toBe('Northwestern student');
    expect(affiliation('prof@northwestern.edu')).toBe('Northwestern');
    expect(affiliation(undefined)).toBe('Northwestern');
  });
  it('cleans Instagram handles', () => {
    expect(normalizeInstagram('@sam.k')).toBe('sam.k');
    expect(normalizeInstagram(' https://www.instagram.com/sam_k/?hl=en ')).toBe('sam_k');
    expect(normalizeInstagram('instagram.com/sam.k')).toBe('sam.k');
    expect(instagramError('sam.k')).toBe('');
    expect(instagramError('')).toBe('');
    expect(instagramError('sam k')).not.toBe('');
    expect(instagramError('a'.repeat(31))).not.toBe('');
  });
  it('checks contact emails', () => {
    expect(contactEmailError('')).toBe('');
    expect(contactEmailError('sam@gmail.com')).toBe('');
    expect(contactEmailError('sam@gmail')).not.toBe('');
    expect(contactEmailError('sam gmail.com')).not.toBe('');
  });
});

describe('own listings', () => {
  it('puts live listings first, newest first', () => {
    const list = [
      { code: 'a', status: 'taken' as const, createdAtMs: 5 },
      { code: 'b', status: 'active' as const, createdAtMs: 1 },
      { code: 'c', status: 'hidden' as const, createdAtMs: 9 },
      { code: 'd', status: 'active' as const, createdAtMs: 3 },
    ];
    expect(sortOwnListings(list).map((l) => l.code)).toEqual(['d', 'b', 'c', 'a']);
    expect(liveCount(list)).toBe(2);
  });
  it('accepts only 8-digit listing codes', () => {
    expect(isListingCode('12345678')).toBe(true);
    expect(isListingCode('02345678')).toBe(false);
    expect(isListingCode('1234567')).toBe(false);
    expect(isListingCode(12345678)).toBe(false);
  });
});

describe('listing files', () => {
  it('reads the path out of a download URL', () => {
    expect(storagePathFromUrl(url('listings/u1/12345678-1.jpg'))).toBe('listings/u1/12345678-1.jpg');
    expect(storagePathFromUrl('https://example.com/x.jpg')).toBeNull();
    expect(storagePathFromUrl(null)).toBeNull();
  });
  it('lists the photos and video of one listing, inside the owner folder only', () => {
    const l = {
      code: '12345678',
      photos: [url('listings/u1/12345678-1.jpg'), 'https://example.com/odd.jpg', url('listings/u2/12345678-3.jpg'), url('listings/u1/87654321-1.jpg')],
      video: url('videos/u1/12345678.mov'),
    };
    expect(listingFilePaths(l, 'u1')).toEqual(['listings/u1/12345678-1.jpg', 'listings/u1/12345678-2.jpg', 'videos/u1/12345678.mov']);
  });
  it('ignores a video stored for another listing or person', () => {
    expect(listingFilePaths({ code: '12345678', photos: [], video: url('videos/u2/12345678.mp4') }, 'u1')).toEqual([]);
    expect(listingFilePaths({ code: '12345678', photos: [], video: null }, 'u1')).toEqual([]);
  });
});

describe('rule mirrors', () => {
  const listing = {
    ownerId: 'u1',
    kind: 'sublet',
    campus: 'evanston',
    title: 'Private room in a 3-bed',
    price: 1250,
    start: '2027-01-02',
    end: '2027-04-30',
    status: 'hidden',
    code: '12345678',
    ownerName: 'Emily',
    area: 'Evanston',
    photos: ['p'],
  };
  it('matches validListing', () => {
    expect(validListingShape(listing)).toBe(true);
    expect(validListingShape({ ...listing, status: 'live' })).toBe(false);
    expect(validListingShape({ ...listing, price: 12.5 })).toBe(false);
    expect(validListingShape({ ...listing, photos: [] })).toBe(false);
    expect(validListingShape({ ...listing, end: '2027-01-01' })).toBe(false);
    expect(validListingShape({ ...listing, description: 7 })).toBe(false);
  });
  it('matches validRequest', () => {
    const r = { ownerId: 'u1', campus: 'chicago', start: '2027-01-02', end: '2027-04-30', budget: 1400, status: 'closed' };
    expect(validRequestShape(r)).toBe(true);
    expect(validRequestShape({ ...r, budget: null })).toBe(false);
    expect(validRequestShape({ ...r, note: 'x'.repeat(2001) })).toBe(false);
  });
});

describe('requestView', () => {
  it('turns a stored request into the card fields', () => {
    const v = requestView(
      'r1',
      { status: 'open', kind: 'Private room', start: '2027-01-02', end: '2027-04-30', budget: 1400, campusId: 'nu-chi', note: ' Quiet ' },
      'Emily',
      'Northwestern student',
    );
    expect(v).toMatchObject({ open: true, name: 'Emily', need: 'a private room', budget: 1400, campus: 'Northwestern · Chicago', note: 'Quiet' });
  });
  it('falls back quietly on odd fields', () => {
    const v = requestView('r2', { status: 'closed', kind: 'whole', campus: 'downtown', budget: 0, start: 'soon' }, 'Emily', 'Northwestern');
    expect(v).toMatchObject({ open: false, need: 'a whole place', budget: null, campus: 'Downtown Chicago', start: '' });
    expect(requestView('r4', { budget: 20000, anyPrice: true, role: 'newhire', ownerName: 'Sam' }, 'Emily', 'Northwestern')).toMatchObject({
      budget: null,
      role: 'New hire',
      name: 'Sam',
    });
    expect(requestView('r3', {}, 'Emily', 'Northwestern').need).toBe('a place');
  });
});
