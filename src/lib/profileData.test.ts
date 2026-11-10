import { describe, expect, it } from 'vitest';
import {
  affiliation,
  cleanFirstName,
  contactEmailError,
  whatsappError,
  isListingCode,
  isRequestId,
  listingFilePaths,
  liveCount,
  normalizeWhatsApp,
  ownStatus,
  proofFilePaths,
  requestView,
  SavedSync,
  savedGroup,
  savedRequestCard,
  savedRequestState,
  savedRoomCard,
  savesKey,
  sortLookups,
  sortOwnListings,
  storagePathFromUrl,
  validListingShape,
  validRequestShape,
} from './profileData';
import type { ListingDoc } from './listingView';

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
    expect(affiliation('sam@uchicago.edu')).toBe('School email (.edu)');
    expect(affiliation(undefined)).toBe('School email (.edu)');
  });
  it('cleans WhatsApp numbers', () => {
    expect(normalizeWhatsApp('+1 (312) 555-0100')).toBe('+13125550100');
    expect(normalizeWhatsApp('312-555-0100')).toBe('+13125550100');
    expect(normalizeWhatsApp('1 312 555 0100')).toBe('+13125550100');
    expect(normalizeWhatsApp('+86 138 0013 8000')).toBe('+8613800138000');
    expect(normalizeWhatsApp('  ')).toBe('');
    expect(whatsappError('+13125550100')).toBe('');
    expect(whatsappError('')).toBe('');
    expect(whatsappError('5550100')).not.toBe('');
    expect(whatsappError('+1234')).not.toBe('');
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
  it('shows a listing whose last day has passed as ended, and never counts it as live', () => {
    const today = '2027-05-01';
    expect(ownStatus({ status: 'active', end: '2027-04-30' }, today)).toBe('ended');
    expect(ownStatus({ status: 'hidden', end: '2027-04-30' }, today)).toBe('ended');
    expect(ownStatus({ status: 'taken', end: '2027-04-30' }, today)).toBe('taken');
    expect(ownStatus({ status: 'active', end: '2027-05-01' }, today)).toBe('active'); // up through its last day
    expect(ownStatus({ status: 'active', end: 'soon' }, today)).toBe('active');
    const list = [
      { code: 'a', status: 'active' as const, end: '2027-04-30', createdAtMs: 9 },
      { code: 'b', status: 'active' as const, end: '2027-08-31', createdAtMs: 1 },
      { code: 'c', status: 'active' as const, end: '2027-05-01', createdAtMs: 2 },
    ];
    expect(liveCount(list, today)).toBe(2);
    const cards = list.map((l) => ({ ...l, status: ownStatus(l, today) }));
    expect(sortOwnListings([...cards, { code: 't', status: 'taken' as const, end: '', createdAtMs: 99 }]).map((l) => l.code)).toEqual(['c', 'b', 'a', 't']);
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
  it('lists the lease-proof files noted for one listing, inside the owner folder only', () => {
    const note = {
      kind: 'lease',
      files: [
        'proofs/u1/12345678-1.pdf',
        'proofs/u1/12345678-2.heic',
        'proofs/u1/12345678-1.pdf',
        'proofs/u2/12345678-1.pdf',
        'proofs/u1/87654321-1.jpg',
        'proofs/u1/12345678-3/../../../u2/x.pdf',
        'listings/u1/12345678-1.jpg',
        7,
      ],
    };
    expect(proofFilePaths('12345678', 'u1', note)).toEqual(['proofs/u1/12345678-1.pdf', 'proofs/u1/12345678-2.heic']);
    expect(proofFilePaths('12345678', 'u1', undefined)).toEqual([]);
    expect(proofFilePaths('12345678', 'u1', { files: 'proofs/u1/12345678-1.pdf' })).toEqual([]);
  });
  it('ignores a video stored for another listing or person', () => {
    expect(listingFilePaths({ code: '12345678', photos: [], video: url('videos/u2/12345678.mp4') }, 'u1')).toEqual([]);
    expect(listingFilePaths({ code: '12345678', photos: [], video: null }, 'u1')).toEqual([]);
  });
});

describe('rule mirrors', () => {
  // the shape src/listings.ts publishListing writes
  const listing = {
    ownerId: 'u1',
    ownerName: 'Emily',
    ownerPhoto: 'https://lh3.googleusercontent.com/a/x=s96-c',
    kind: 'sublet',
    campus: 'evanston',
    campusId: 'nu-evn',
    title: 'Private room in a 3-bed',
    price: 1250,
    start: '2027-01-02',
    end: '2027-04-30',
    status: 'hidden',
    code: '12345678',
    area: 'Evanston',
    photos: [url('listings/u1/12345678-1.jpg')],
    captions: ['Bedroom'],
    video: null,
    walk: 8,
    location: { lat: 42.05, lng: -87.68 },
    near: [],
    form: { subletType: 'sublet', layout: '3B2B', f: { note: 'Hi' }, multi: { fees: [], amen: [], habits: [], items: [] }, prefs: {} },
  };
  it('matches validListing', () => {
    expect(validListingShape(listing)).toBe(true);
    expect(validListingShape({ ...listing, video: url('videos/u1/12345678.mp4') })).toBe(true);
    expect(validListingShape({ ...listing, status: 'live' })).toBe(false);
    expect(validListingShape({ ...listing, price: 12.5 })).toBe(false);
    expect(validListingShape({ ...listing, photos: [] })).toBe(false);
    expect(validListingShape({ ...listing, end: '2027-01-01' })).toBe(false);
    expect(validListingShape({ ...listing, description: 7 })).toBe(false);
  });
  it('requires one of our campuses, its id and key naming the same one', () => {
    expect(validListingShape({ ...listing, campusId: 'nu-chi', campus: 'chicago' })).toBe(true);
    expect(validListingShape({ ...listing, campusId: 'x" onmouseover="alert(1)' })).toBe(false);
    expect(validListingShape({ ...listing, campusId: 'nu-chi' })).toBe(false);
    const { campusId: _, ...noId } = listing;
    expect(validListingShape(noId)).toBe(false);
  });
  it('requires the shapes the pages read', () => {
    const { form: _, ...noForm } = listing;
    expect(validListingShape(noForm)).toBe(false);
    expect(validListingShape({ ...listing, form: 'x' })).toBe(false);
    expect(validListingShape({ ...listing, form: { ...listing.form, f: [] } })).toBe(false);
    expect(validListingShape({ ...listing, form: { ...listing.form, multi: null } })).toBe(false);
    expect(validListingShape({ ...listing, captions: 'Bedroom' })).toBe(false);
    expect(validListingShape({ ...listing, captions: ['x'.repeat(1300)] })).toBe(false);
    expect(validListingShape({ ...listing, photos: [{ url: 'x' }] })).toBe(false);
    expect(validListingShape({ ...listing, photos: ['x'.repeat(41_000)] })).toBe(false);
    expect(validListingShape({ ...listing, video: 'javascript:alert(1)' })).toBe(false);
    expect(validListingShape({ ...listing, ownerPhoto: 'x'.repeat(2049) })).toBe(false);
  });
  it('matches validRequest', () => {
    const r = { ownerId: 'u1', campus: 'chicago', start: '2027-01-02', end: '2027-04-30', budget: 1400, status: 'closed' };
    expect(validRequestShape(r)).toBe(true);
    expect(validRequestShape({ ...r, campusId: 'nu-chi', ownerName: 'Emily', ownerPhoto: '', org: 'Google' })).toBe(true);
    expect(validRequestShape({ ...r, budget: null })).toBe(false);
    expect(validRequestShape({ ...r, note: 'x'.repeat(2001) })).toBe(false);
    expect(validRequestShape({ ...r, campusId: 'nu-evn' })).toBe(false);
    expect(validRequestShape({ ...r, ownerName: 'x'.repeat(61) })).toBe(false);
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

describe('saved requests', () => {
  const uid = 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9v';
  const stored = {
    ownerId: uid,
    ownerName: 'Maya',
    ownerPhoto: 'https://lh3.googleusercontent.com/a/abc=s96-c',
    status: 'open',
    campus: 'evanston',
    campusId: 'nu-evn',
    start: '2026-12-15',
    end: '2027-03-20',
    budget: 1400,
    anyPrice: false,
    kind: 'room',
    role: 'intern',
    layouts: ['2B1B', 'Studio', 'Loft'],
  };

  it('accepts the ids src/rentlet.ts saves', () => {
    expect(isRequestId(uid)).toBe(true);
    expect(isRequestId('short')).toBe(false);
    expect(isRequestId('has/slash/in/it/xx')).toBe(false);
    expect(isRequestId('a'.repeat(65))).toBe(false);
    expect(isRequestId(12345678901)).toBe(false);
  });

  it('maps a request to the Requests page card fields', () => {
    expect(savedRequestCard(uid, stored, 1700000000000)).toEqual({
      id: uid,
      who: 'Maya',
      photo: 'https://lh3.googleusercontent.com/a/abc=s96-c',
      role: 'Intern',
      kind: 'Private room',
      layouts: ['2B1B', 'Studio'],
      start: '2026-12-15',
      end: '2027-03-20',
      budget: 1400,
      savedAtMs: 1700000000000,
    });
  });

  it('falls back quietly on missing or odd fields', () => {
    const c = savedRequestCard(uid, { ownerPhoto: 'javascript:alert(1)', budget: 1400, anyPrice: true, kind: 'castle', role: 7, layouts: 'Studio' }, 0);
    expect(c).toMatchObject({ who: 'Student', photo: '', role: 'Student', kind: 'Private room', layouts: [], start: '', end: '', budget: null });
    expect(savedRequestCard(uid, { kind: 'either', role: 'newhire', budget: 0 }, 0)).toMatchObject({
      kind: 'Room or whole place',
      role: 'New hire',
      budget: null,
    });
  });

  it('tells open requests from gone ones', () => {
    const today = '2026-11-04';
    expect(savedRequestState(stored, null, today)).toBe('open');
    expect(savedRequestState({ ...stored, start: today }, null, today)).toBe('open');
    expect(savedRequestState({ ...stored, start: '2026-11-03' }, null, today)).toBe('gone'); // move-in passed
    expect(savedRequestState({ ...stored, status: 'closed' }, null, today)).toBe('gone'); // paused
    expect(savedRequestState({ ...stored, start: undefined }, null, today)).toBe('gone');
    expect(savedRequestState(null, null, today)).toBe('gone'); // deleted
    expect(savedRequestState(null, 'permission-denied', today)).toBe('gone'); // not open: only its owner can read it
    expect(savedRequestState(null, 'not-found', today)).toBe('gone');
    expect(savedRequestState(null, 'unavailable', today)).toBe('error');
  });

  it('keys a set of saved ids the same in any order', () => {
    expect(savesKey(['20000002', '10000001'], [uid])).toBe(savesKey(['10000001', '20000002'], new Set([uid])));
    expect(savesKey(['10000001', '10000001'], [])).toBe(savesKey(['10000001'], []));
    expect(savesKey(['10000001'], [])).not.toBe(savesKey([], []));
    // a room code and a request id never stand in for each other
    expect(savesKey(['10000001'], [])).not.toBe(savesKey([], ['10000001']));
  });
});

describe('SavedSync: the Saved page follows saves made elsewhere', () => {
  const A = '10000001';
  const B = '20000002';
  const Q = 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9v';
  // a first load that shows rooms A and B and request Q, then the event that agrees with it
  const shown = () => {
    const s = new SavedSync();
    const mark = s.loadStarted();
    expect(s.loaded(mark, false, { room: [A, B], request: [Q] })).toBe(true);
    s.saved({ room: [B, A], request: [Q] });
    expect(s.check()).toBe(false);
    return s;
  };

  it('waits for the first load, then reloads only when the saved set differs', () => {
    const s = new SavedSync();
    expect(s.check()).toBe(false); // no event yet
    const mark = s.loadStarted();
    s.saved({ room: [A], request: [] });
    expect(s.check()).toBe(false); // still loading
    s.loaded(mark, false, { room: [A], request: [] });
    expect(s.check()).toBe(false);
    s.saved({ room: [A, B], request: [] }); // saved on another tab
    expect(s.check()).toBe(true);
    expect(s.check()).toBe(false); // asked once
  });

  it('does not reload for a removal made here, nor for its undo', () => {
    const s = shown();
    s.writeStarted(); // heart tapped: Q goes
    s.saved({ room: [A, B], request: [] }); // Firestore's local copy reports it at once
    expect(s.check()).toBe(false);
    s.writeEnded('request', [Q], false, true);
    expect(s.check()).toBe(false);
    s.writeStarted(); // Undo
    s.saved({ room: [A, B], request: [Q] });
    expect(s.check()).toBe(false);
    s.writeEnded('request', [Q], true, true);
    expect(s.check()).toBe(false);
  });

  it('a failed removal leaves the shown set as it was', () => {
    const s = shown();
    s.writeStarted();
    s.saved({ room: [B], request: [Q] });
    s.saved({ room: [A, B], request: [Q] }); // rolled back
    s.writeEnded('room', [A], false, false);
    expect(s.check()).toBe(false);
  });

  it('drops a quiet reload overtaken by a removal, then checks again', () => {
    const s = shown();
    s.saved({ room: [A, B, '30000003'], request: [Q] }); // saved elsewhere
    expect(s.check()).toBe(true);
    const mark = s.loadStarted();
    s.writeStarted(); // meanwhile the person removes A here
    s.saved({ room: [B, '30000003'], request: [Q] });
    s.writeEnded('room', [A], false, true);
    expect(s.check()).toBe(false); // the reload is still running
    expect(s.loaded(mark, true, { room: [A, B, '30000003'], request: [Q] })).toBe(false); // may still hold A
    expect(s.check()).toBe(true); // so it loads again
    expect(s.loaded(s.loadStarted(), true, { room: [B, '30000003'], request: [Q] })).toBe(true);
    expect(s.check()).toBe(false);
  });

  it('asks once for a group that keeps failing, again when the saved set changes', () => {
    const s = new SavedSync();
    s.loaded(s.loadStarted(), false, { room: [A], request: null }); // saved requests couldn't be read
    s.saved({ room: [A], request: [Q] });
    expect(s.check()).toBe(true);
    s.loaded(s.loadStarted(), true, { room: [A], request: null });
    expect(s.check()).toBe(false);
    s.saved({ room: [A], request: [Q] }); // the same set again
    expect(s.check()).toBe(false);
    s.retry(); // Try again
    expect(s.check()).toBe(true);
    s.loaded(s.loadStarted(), true, null); // a quiet reload that fails keeps what is shown
    s.saved({ room: [], request: [Q] });
    expect(s.check()).toBe(true);
  });

  it('forgets what was shown for another account', () => {
    const s = shown();
    s.reset();
    expect(s.check()).toBe(true); // nothing shown: the next load catches up
  });
});

describe('saved rooms and the Saved tabs', () => {
  const listing = {
    code: '12345678',
    title: 'Private room near Sheridan',
    area: 'Evanston',
    start: '2027-01-02',
    end: '2027-03-20',
    price: 1150,
    photos: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    walk: 8,
    campusId: 'nu-evn',
  } as unknown as ListingDoc;

  it('shows a saved room the way the homepage card does', () => {
    expect(savedRoomCard(listing, 1700000000000)).toEqual({
      code: '12345678',
      title: 'Private room near Sheridan',
      area: 'Evanston',
      start: '2027-01-02',
      end: '2027-03-20',
      price: 1150,
      img: 'https://example.com/a.jpg',
      walk: 8,
      campusId: 'nu-evn',
      savedAtMs: 1700000000000,
    });
  });

  it('falls back quietly on missing or odd fields', () => {
    const odd = { code: '12345678', title: '', price: 'x', photos: 'a.jpg', walk: '8', start: 'soon' } as unknown as ListingDoc;
    expect(savedRoomCard(odd, 0)).toMatchObject({ title: 'Room', area: '', start: '', end: '', price: 0, img: '', walk: null, campusId: '' });
  });

  it('sorts lookups into cards, gone ids and failures, in saved order', () => {
    const r = sortLookups(['a', 'b', 'c', 'd'], [{ n: 1 }, 'gone', 'error', { n: 4 }]);
    expect(r).toEqual({ ids: ['a', 'b', 'c', 'd'], items: [{ n: 1 }, { n: 4 }], gone: ['b'], failed: 1 });
    expect(sortLookups([], [])).toEqual({ ids: [], items: [], gone: [], failed: 0 });
  });

  it('shows an error only when a tab has nothing true to show', () => {
    expect(savedGroup(null)).toBe('error'); // the list itself couldn't be read
    expect(savedGroup(sortLookups(['a'], ['error']))).toBe('error'); // every lookup failed
    expect(savedGroup(sortLookups([], []))).toEqual({ items: [], gone: [] }); // nothing saved
    expect(savedGroup(sortLookups(['a', 'b'], [{ n: 1 }, 'error']))).toEqual({ items: [{ n: 1 }], gone: [] });
    expect(savedGroup(sortLookups(['a', 'b'], ['gone', 'error']))).toEqual({ items: [], gone: ['a'] });
  });
});
