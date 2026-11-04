// Listings in Firestore and their photos in Cloud Storage. The moved-over pages call this through
// window.RentletListings (set in src/rentlet.ts).
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { firstName } from './lib/nu';
import {
  CAMPUS_KEY,
  titleOf,
  toCard,
  toRoom,
  type CampusId,
  type ListingDoc,
  type PostForm,
} from './lib/listingView';
import { asPlace, listingPlace, sameAddress, type PickedPlace } from './lib/place';
import { lookupPlace, nearbyPlaces } from './place';

const MAX_ACTIVE = 3;
const AREA_CAPTION: Record<string, string> = {
  bedroom: 'Bedroom',
  living: 'Living room',
  bath: 'Bathroom',
  kitchen: 'Kitchen',
  building: 'Window or building',
};
// Fields that stay private to the host (shared only after both sides agree).
const PRIVATE_FIELDS = ['addr', 'building', 'site'];

export type PublishStep = 'photos' | 'saving';

export class PublishError extends Error {
  constructor(public reason: 'signin' | 'limit' | 'photos' | 'failed') {
    super(reason);
  }
}

function fromDoc(id: string, data: DocumentData): ListingDoc {
  const created = data.createdAt as Timestamp | undefined;
  return { ...(data as ListingDoc), code: id, createdAtMs: created ? created.toMillis() : Date.now() };
}

function newCode(): string {
  return String(10_000_000 + Math.floor(Math.random() * 90_000_000));
}

async function freeCode(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = newCode();
    try {
      if (!(await getDoc(doc(db, 'listings', code))).exists()) return code;
    } catch {
      /* a hidden listing someone else owns: take another number */
    }
  }
  throw new PublishError('failed');
}

// Phone photos are large; send at most 2000 px on the long side as an 85% JPEG.
async function compress(dataUrl: string, max = 2000, quality = 0.85): Promise<Blob> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new PublishError('photos'))), 'image/jpeg', quality),
  );
}

type PostState = PostForm & {
  photos: Record<string, string[]>;
  video?: string | null;
  step?: number;
  done?: boolean;
  act?: string;
  place?: unknown; // PickedPlace from the "Where is it?" step, when the host picked a HERE suggestion
};

// The place for this listing: the address or directory building the host picked, if the street address
// still matches it (a walk measured to another campus is looked up again or dropped), else the typed
// address looked up with HERE now. Null when neither helps.
async function placeFor(S: PostState, address: string, campusId: CampusId): Promise<PickedPlace | null> {
  let place = asPlace(S.place);
  if (place && !sameAddress(place.label, address)) place = null;
  if (place && place.campusId && place.campusId !== campusId) {
    const again = place.id ? await lookupPlace({ id: place.id }, campusId) : null;
    place = again ?? { ...place, walk: null, campusId };
  }
  if (!place && address.length >= 5) place = await lookupPlace({ q: address }, campusId);
  return place;
}

// The name on the host's page (they may have changed it), else their Google first name.
async function hostName(uid: string, displayName: string | null): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const name = snap.exists() ? String(snap.data().name || '').trim() : '';
    if (name) return name.slice(0, 60);
  } catch {
    /* fall back below */
  }
  return firstName(displayName);
}

export async function publishListing(S: PostState, video: File | null, proof: File[], onStep?: (s: PublishStep) => void): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new PublishError('signin');

  const mine = await getDocs(query(collection(db, 'listings'), where('ownerId', '==', user.uid), where('status', '==', 'active')));
  if (mine.size >= MAX_ACTIVE) throw new PublishError('limit');

  const code = await freeCode();
  // HERE answers while the photos upload
  const placing = placeFor(S, String(S.f?.addr ?? '').trim(), (S.campusId in CAMPUS_KEY ? S.campusId : 'nu-evn') as CampusId).catch(() => null);

  onStep?.('photos');
  const photos: string[] = [];
  const captions: string[] = [];
  const order = ['bedroom', 'living', 'kitchen', 'bath', 'building'];
  for (const area of order) {
    for (const src of S.photos[area] || []) {
      if (!src.startsWith('data:image/')) continue; // only photos the host added
      const blob = await compress(src);
      const r = ref(storage, `listings/${user.uid}/${code}-${photos.length + 1}.jpg`);
      await uploadBytes(r, blob, { contentType: 'image/jpeg' });
      photos.push(await getDownloadURL(r));
      captions.push(AREA_CAPTION[area]);
    }
  }
  if (!photos.length) throw new PublishError('photos');

  let videoUrl: string | null = null;
  if (video) {
    const ext = (video.name.split('.').pop() || 'mp4').toLowerCase();
    const r = ref(storage, `videos/${user.uid}/${code}.${ext}`);
    await uploadBytes(r, video, { contentType: video.type || 'video/mp4' });
    videoUrl = await getDownloadURL(r);
  }

  onStep?.('saving');
  const f: Record<string, string> = {};
  const location: Record<string, string> = {};
  for (const [k, v] of Object.entries(S.f || {})) {
    const value = String(v ?? '').trim();
    if (PRIVATE_FIELDS.includes(k)) location[k] = value;
    else f[k] = value;
  }
  const form: PostForm = JSON.parse(
    JSON.stringify({ ...S, f, photos: undefined, video: undefined, step: undefined, done: undefined, act: undefined, place: undefined }),
  );
  const campusId = (S.campusId in CAMPUS_KEY ? S.campusId : 'nu-evn') as CampusId;
  form.campusId = campusId;
  // every listing shows at its spot on the map; the street address, building and website stay host-only
  form.map = true;
  const spot = listingPlace(await placing, location.addr || '', campusId);
  // places around the spot for the room page's Getting around (fails soft to none)
  const near = spot.location
    ? (await nearbyPlaces(spot.location.lat, spot.location.lng, campusId))
        .filter((x) => x.lat != null && x.lng != null)
        .slice(0, 12)
        .map((x) => ({ kind: x.kind, name: x.name.slice(0, 80), lat: x.lat, lng: x.lng, walk: x.walk, meters: x.meters }))
    : [];

  await setDoc(doc(db, 'listings', code), {
    ownerId: user.uid,
    ownerName: await hostName(user.uid, user.displayName),
    ownerPhoto: user.photoURL ?? '',
    status: 'active',
    code,
    campus: CAMPUS_KEY[campusId],
    campusId,
    kind: S.subletType,
    title: titleOf(form),
    area: spot.area,
    price: Math.round(Number(S.rent) || 0),
    start: S.start,
    end: S.end,
    photos,
    captions,
    video: videoUrl,
    walk: spot.walk,
    location: spot.location, // null when no place was picked or found
    near,
    form,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'listings', code, 'private', 'location'), {
    address: location.addr || '',
    building: location.building || '',
    site: location.site || '',
    showOnMap: true,
    zip: spot.zip,
  });
  // lease proof: private files (the host and the Rentlet team only, storage.rules) and a host-only note of them
  if (S.proof === 'lease' && proof.length) {
    const files: string[] = [];
    for (const [i, file] of proof.slice(0, 3).entries()) {
      const ext = file.type === 'application/pdf' ? 'pdf' : (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
      const path = `proofs/${user.uid}/${code}-${i + 1}.${ext}`;
      await uploadBytes(ref(storage, path), file, { contentType: file.type || 'application/octet-stream' });
      files.push(path);
    }
    await setDoc(doc(db, 'listings', code, 'private', 'proof'), { kind: 'lease', files, sentAt: serverTimestamp() });
  }
  return code;
}

// Every active listing, newest first, kept live.
export function subscribeActive(cb: (list: ListingDoc[]) => void, onError?: () => void): () => void {
  return onSnapshot(
    query(collection(db, 'listings'), where('status', '==', 'active')),
    (snap) => cb(snap.docs.map((d) => fromDoc(d.id, d.data())).sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))),
    () => onError?.(),
  );
}

export type Lookup = { state: 'ok'; listing: ListingDoc } | { state: 'removed' | 'missing' | 'error' };

export async function getListing(code: string): Promise<Lookup> {
  try {
    const snap = await getDoc(doc(db, 'listings', code));
    if (!snap.exists()) return { state: 'missing' };
    const listing = fromDoc(snap.id, snap.data());
    return listing.status === 'active' ? { state: 'ok', listing } : { state: 'removed' };
  } catch (e) {
    // the rules hide listings that were taken down from everyone but their host
    return (e as { code?: string }).code === 'permission-denied' ? { state: 'removed' } : { state: 'error' };
  }
}

export { toCard, toRoom };
