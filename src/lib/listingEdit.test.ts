import { describe, expect, it } from 'vitest';
import { editState, photosByArea, removedFiles, type PrivateLocation } from './listingEdit';
import type { ListingDoc, PostForm } from './listingView';

const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/x/o/${encodeURIComponent(path)}?alt=media&token=t`;
const form = {
  campus: 'Northwestern · Evanston',
  campusId: 'nu-evn',
  subletType: 'sublet',
  unit: 'room',
  layout: '1B1B',
  rent: 1950,
  orig: 2150,
  multi: { fees: ['Wi-Fi'], amen: [], habits: [], items: [] },
  prefs: { Pets: 'No pets' },
  f: { note: 'Quiet' },
} as unknown as PostForm;
const listing = {
  code: '46068592',
  ownerId: 'me',
  kind: 'sublet',
  campus: 'evanston',
  campusId: 'nu-evn',
  title: 'Private room',
  area: 'Downtown Evanston',
  price: 1950,
  start: '2027-01-01',
  end: '2027-03-01',
  photos: [url('listings/me/46068592-1.jpg'), url('listings/me/46068592-2.jpg')],
  captions: ['Bedroom', 'Kitchen'],
  video: url('videos/me/46068592.mp4'),
  walk: 9,
  location: { lat: 42.05, lng: -87.68 },
  form,
} as unknown as ListingDoc;
const loc: PrivateLocation = { address: '1890 Maple Ave, Evanston', building: 'E2 Apartments', site: 'https://e2.example', zip: '60201' };

describe('photosByArea', () => {
  it('puts each photo back in its area by caption', () => {
    const p = photosByArea(['https://a', 'https://b', 'https://c'], ['Bedroom', 'Window or building', 'Mystery']);
    expect(p.bedroom).toEqual(['https://a', 'https://c']);
    expect(p.building).toEqual(['https://b']);
    expect(p.kitchen).toEqual([]);
  });
  it('drops anything that is not a link and survives missing lists', () => {
    expect(photosByArea(['javascript:x', 7], ['Bedroom']).bedroom).toEqual([]);
    expect(photosByArea(undefined, undefined).bedroom).toEqual([]);
    expect(photosByArea(['https://a', 'https://b'], ['Bedroom', 'Amenities']).amenities).toEqual(['https://b']);
  });
});

describe('editState', () => {
  const s = editState(listing, loc);
  it('brings back the public answers and the host-only details', () => {
    expect(s.f).toEqual({ note: 'Quiet', addr: loc.address, building: 'E2 Apartments', site: loc.site });
    expect(s.rent).toBe(1950);
    expect(s.orig).toBe(2150);
    expect(s.start).toBe('2027-01-01');
    expect(s.subletType).toBe('sublet');
    expect(s.prefs).toEqual({ Pets: 'No pets' });
  });
  it('keeps the saved map point, so an unchanged address is not looked up again', () => {
    expect(s.place).toEqual({ lat: 42.05, lng: -87.68, area: 'Downtown Evanston', zip: '60201', walk: 9, label: loc.address, campusId: 'nu-evn' });
    expect(editState({ ...listing, location: null }, loc).place).toBeNull();
    expect(editState(listing, { ...loc, address: '  ' }).place).toBeNull();
  });
  it('labels the current video and fills lists an older listing lacks', () => {
    expect(s.video).toBe('Current video');
    expect(editState({ ...listing, video: null }, loc).video).toBeNull();
    const old = editState({ ...listing, form: { f: {} } as unknown as PostForm }, loc);
    expect(old.multi).toEqual({ fees: [], amen: [], habits: [], items: [] });
    expect(old.campus).toBe('Northwestern · Evanston');
  });
  it('falls back to the public building name, and does not share the form object', () => {
    expect(editState({ ...listing, building: 'Public' }, { ...loc, building: '' }).f.building).toBe('Public');
    s.multi.fees.push('Gas');
    expect(form.multi.fees).toEqual(['Wi-Fi']);
  });
});

describe('removedFiles', () => {
  it('lists only the old files the saved listing stopped using', () => {
    expect(removedFiles(listing, 'me', [listing.photos[0], url('listings/me/46068592-new-2.jpg')], listing.video)).toEqual(['listings/me/46068592-2.jpg']);
    expect(removedFiles(listing, 'me', listing.photos, null)).toEqual(['videos/me/46068592.mp4']);
    expect(removedFiles(listing, 'me', listing.photos, listing.video)).toEqual([]);
  });
  it('never reaches another host or listing', () => {
    const other = { ...listing, photos: [url('listings/them/46068592-1.jpg'), url('listings/me/11111111-1.jpg')], video: null };
    expect(removedFiles(other, 'me', [], null)).toEqual([]);
  });
});
