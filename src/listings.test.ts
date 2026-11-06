// updateListing with Firebase replaced by stand-ins: nothing here reaches a real project.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listing: {} as Record<string, unknown> | null,
  proofNote: null as Record<string, unknown> | null,
  batch: { update: vi.fn(), set: vi.fn(), commit: vi.fn() },
  uploadBytes: vi.fn(),
  deleteObject: vi.fn(),
  nearbyPlaces: vi.fn(),
  lookupPlace: vi.fn(),
}));

vi.mock('./firebase', () => ({ auth: { currentUser: { uid: 'me' } }, db: {}, storage: {} }));
vi.mock('./place', () => ({ lookupPlace: h.lookupPlace, nearbyPlaces: h.nearbyPlaces }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  getDoc: async (path: string) => {
    const data = path.endsWith('/proof') ? h.proofNote : h.listing;
    return { exists: () => !!data, data: () => data ?? undefined, get: (k: string) => data?.[k] };
  },
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  serverTimestamp: () => 'NOW',
  setDoc: vi.fn(),
  where: vi.fn(),
  writeBatch: () => h.batch,
}));
vi.mock('firebase/storage', () => ({
  ref: (_s: unknown, path: string) => path,
  uploadBytes: h.uploadBytes,
  getDownloadURL: async (path: string) => `https://firebasestorage.googleapis.com/v0/b/x/o/${encodeURIComponent(path)}?alt=media`,
  deleteObject: h.deleteObject,
}));

import { PublishError, updateListing } from './listings';

const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/x/o/${encodeURIComponent(path)}?alt=media`;
const cover = url('listings/me/46068592-1.jpg');
const second = url('listings/me/46068592-2.jpg');
const oldVideo = url('videos/me/46068592.mp4');

const state = () =>
  ({
    subletType: 'sublet',
    campus: 'Northwestern · Evanston',
    campusId: 'nu-evn',
    unit: 'room',
    layout: '1B1B',
    rent: 2000,
    orig: 2150,
    start: '2027-01-01',
    end: '2027-03-01',
    dep: 'none',
    furn: 'none',
    proof: 'student',
    multi: { fees: [], amen: [], habits: [], items: [] },
    prefs: {},
    f: { addr: '1890 Maple Ave, Evanston', building: 'E2 Apartments', site: 'https://e2.example', note: 'Quiet' },
    photos: { bedroom: [cover], living: [], bath: [], kitchen: [second], building: [] },
    video: 'Current video',
    step: 12,
    done: false,
    act: 'in',
    code: '46068592',
    place: { lat: 42.05, lng: -87.68, area: 'Downtown Evanston', zip: '60201', walk: 9, label: '1890 Maple Ave, Evanston', campusId: 'nu-evn' },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.batch.commit.mockResolvedValue(undefined);
  h.uploadBytes.mockResolvedValue(undefined);
  h.deleteObject.mockResolvedValue(undefined);
  h.nearbyPlaces.mockResolvedValue([]);
  h.lookupPlace.mockResolvedValue(null);
  h.proofNote = null;
  h.listing = {
    ownerId: 'me',
    ownerName: 'Nate',
    status: 'hidden',
    campusId: 'nu-evn',
    photos: [cover, second],
    video: oldVideo,
    location: { lat: 42.05, lng: -87.68 },
    near: [{ kind: 'food', name: 'Cafe' }],
  };
});

const fields = () => h.batch.update.mock.calls[0][1];

describe('updateListing', () => {
  it('saves the new answers and leaves the host, status, number and post date alone', async () => {
    await updateListing('46068592', state(), null, []);
    expect(h.batch.update.mock.calls[0][0]).toBe('listings/46068592');
    const f = fields();
    expect(f).toMatchObject({ price: 2000, building: 'E2 Apartments', title: 'Private room', kind: 'sublet', campus: 'evanston', area: 'Downtown Evanston', walk: 9, updatedAt: 'NOW' });
    for (const k of ['ownerId', 'ownerName', 'status', 'code', 'createdAt']) expect(f).not.toHaveProperty(k);
    expect(h.batch.commit).toHaveBeenCalledTimes(1);
  });
  it('keeps host-only details out of the public form and in the private note, together', async () => {
    await updateListing('46068592', state(), null, []);
    const f = fields();
    expect(f.form.f).toEqual({ note: 'Quiet' });
    for (const k of ['photos', 'video', 'step', 'done', 'act', 'place', 'code']) expect(f.form).not.toHaveProperty(k);
    expect(h.batch.set).toHaveBeenCalledWith(
      'listings/46068592/private/location',
      { address: '1890 Maple Ave, Evanston', building: 'E2 Apartments', site: 'https://e2.example', showOnMap: true, zip: '60201' },
      { merge: true },
    );
  });
  it('keeps the current photos, video, spot and nearby places when nothing about them changed', async () => {
    await updateListing('46068592', state(), null, []);
    const f = fields();
    expect(f.photos).toEqual([cover, second]);
    expect(f.captions).toEqual(['Bedroom', 'Kitchen']);
    expect(f.video).toBe(oldVideo);
    expect(f.location).toEqual({ lat: 42.05, lng: -87.68 });
    expect(f.near).toEqual([{ kind: 'food', name: 'Cafe' }]);
    expect(h.nearbyPlaces).not.toHaveBeenCalled();
    expect(h.lookupPlace).not.toHaveBeenCalled();
    expect(h.deleteObject).not.toHaveBeenCalled();
  });
  it('looks up nearby places again when the spot moved', async () => {
    const s = state() as { place: { lat: number } };
    s.place.lat = 42.06;
    await updateListing('46068592', s as never, null, []);
    expect(h.nearbyPlaces).toHaveBeenCalledWith(42.06, -87.68, 'nu-evn');
    expect(fields().near).toEqual([]);
  });
  it('removes a dropped photo and video from storage only after the save worked', async () => {
    const s = state() as { photos: { kitchen: string[] }; video: string | null };
    s.photos.kitchen = [];
    s.video = null;
    await updateListing('46068592', s as never, null, []);
    expect(fields().photos).toEqual([cover]);
    expect(fields().video).toBeNull();
    expect(h.deleteObject.mock.calls.map((c) => c[0]).sort()).toEqual(['listings/me/46068592-2.jpg', 'videos/me/46068592.mp4']);
  });
  it('uploads a new video under a new name and removes the old one', async () => {
    const file = new File(['x'], 'tour.mp4', { type: 'video/mp4' });
    await updateListing('46068592', state(), file, []);
    const path = h.uploadBytes.mock.calls[0][0] as string;
    expect(path).toMatch(/^videos\/me\/46068592\.[a-z0-9]+\.mp4$/);
    expect(fields().video).toBe(url(path));
    expect(h.deleteObject.mock.calls.map((c) => c[0])).toEqual(['videos/me/46068592.mp4']);
  });
  it('adds new lease proof to the files already noted', async () => {
    h.proofNote = { kind: 'lease', files: ['proofs/me/46068592-1.pdf'] };
    const s = state() as { proof: string };
    s.proof = 'lease';
    await updateListing('46068592', s as never, null, [new File(['x'], 'lease.pdf', { type: 'application/pdf' })]);
    const [ref, note] = h.batch.set.mock.calls.find((c) => c[0] === 'listings/46068592/private/proof')!;
    expect(ref).toBe('listings/46068592/private/proof');
    expect(note.files[0]).toBe('proofs/me/46068592-1.pdf');
    expect(note.files[1]).toMatch(/^proofs\/me\/46068592-[a-z0-9]+-1\.pdf$/);
  });
  it('cleans up new uploads and keeps every old file when the save fails', async () => {
    h.batch.commit.mockRejectedValue(new Error('offline'));
    const file = new File(['x'], 'tour.mp4', { type: 'video/mp4' });
    await expect(updateListing('46068592', state(), file, [])).rejects.toBeInstanceOf(PublishError);
    const path = h.uploadBytes.mock.calls[0][0];
    expect(h.deleteObject.mock.calls.map((c) => c[0])).toEqual([path]);
  });
  it('refuses a listing that belongs to someone else, or one with no photos left', async () => {
    h.listing = { ...h.listing, ownerId: 'them' };
    await expect(updateListing('46068592', state(), null, [])).rejects.toMatchObject({ reason: 'failed' });
    h.listing = { ...h.listing, ownerId: 'me' };
    const s = state() as { photos: Record<string, string[]> };
    s.photos = { bedroom: [], living: [], bath: [], kitchen: [], building: [] };
    await expect(updateListing('46068592', s as never, null, [])).rejects.toMatchObject({ reason: 'invalid' });
    expect(h.batch.commit).not.toHaveBeenCalled();
  });
});
