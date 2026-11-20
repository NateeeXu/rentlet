// Deterministic Firestore seed for the E2E suite. Written with the Admin SDK straight to the
// Firestore emulator (which bypasses firestore.rules), so tests start from the same listings on
// every run. Dates are relative to today so the "ended" listing stays ended and the live ones stay
// live no matter when the suite runs.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Local day, offset by n days: listing dates are local days, not UTC ones.
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Staggered creation times, so "newest first" order is deterministic: STUDIO is newest.
function created(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

const FORM = {
  subletType: 'sublet',
  transferChannel: 'official',
  dep: 'none',
  refund: null,
  map: true,
  hasRoommates: 'no',
  gender: '',
  shuttle: 'unknown',
  route: '',
  layout: '2 bed',
  start: '',
  end: '',
  rent: 0,
  orig: null,
  unit: 'room',
  bath: 'shared',
  furn: 'full',
  neg: null,
  view: null,
  terms: null,
  proof: 'student',
  campus: 'evanston',
  campusId: 'nu-evn',
  multi: { fees: [], amen: ['Washer & dryer'], habits: [], items: [] },
  prefs: {},
  f: {},
};

function listing(over: Record<string, unknown>): Record<string, unknown> {
  return {
    ownerId: 'e2e-host-1',
    ownerName: 'Alex',
    ownerPhoto: '',
    status: 'active',
    campus: 'evanston',
    campusId: 'nu-evn',
    kind: 'sublet',
    captions: [],
    video: null,
    walk: null,
    location: null,
    form: { ...FORM },
    ...over,
  };
}

export const SEED = {
  // Live listing with a building name: the card and room page show the building as the title.
  E2_ROOM: listing({
    code: '71000001',
    title: 'Private room in a 2-bed',
    building: 'E2 Apartments',
    area: 'Downtown Evanston',
    price: 950,
    start: day(30),
    end: day(150),
    photos: ['https://example.com/e2-living.jpg'],
    captions: ['Living room'],
    walk: 12,
    createdAt: created(9),
  }),
  // Live listing with no building: the card and room page fall back to the listing title.
  STUDIO: listing({
    code: '72000002',
    title: 'Entire studio',
    area: 'North Evanston',
    price: 1400,
    start: day(20),
    end: day(200),
    photos: ['https://example.com/studio.jpg'],
    captions: ['Studio'],
    walk: 20,
    createdAt: created(2),
  }),
  // Taken down: hidden from the homepage, and its room page says it is no longer available.
  TAKEN: listing({
    code: '73000003',
    status: 'taken',
    title: 'Private room in a 3-bed',
    area: 'Downtown Evanston',
    price: 800,
    start: day(30),
    end: day(150),
    photos: ['https://example.com/taken.jpg'],
    createdAt: created(20),
  }),
  // Ended (its last day passed): hidden from the homepage, but old links still open it.
  ENDED: listing({
    code: '74000004',
    title: 'Private room in a 2-bed',
    building: 'Old Hall',
    area: 'Downtown Evanston',
    price: 700,
    start: day(-120),
    end: day(-10),
    photos: ['https://example.com/ended.jpg'],
    createdAt: created(130),
  }),
};

export async function seedEmulator(): Promise<void> {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. Run the E2E suite with `npm run test:e2e` so the ' +
        'Firestore emulator is up before seeding.',
    );
  }
  const db = getFirestore(initializeApp({ projectId: 'rentlet-nu' }));
  await Promise.all(
    Object.values(SEED).map((l) => db.collection('listings').doc(l.code as string).set(l)),
  );
}
