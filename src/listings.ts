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
  areaFromAddress,
  CAMPUS_KEY,
  titleOf,
  toCard,
  toRoom,
  type CampusId,
  type ListingDoc,
  type PostForm,
} from './lib/listingView';

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

type PostState = PostForm & { photos: Record<string, string[]>; video?: string | null; step?: number; done?: boolean; act?: string };

export async function publishListing(S: PostState, video: File | null, onStep?: (s: PublishStep) => void): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new PublishError('signin');

  const mine = await getDocs(query(collection(db, 'listings'), where('ownerId', '==', user.uid), where('status', '==', 'active')));
  if (mine.size >= MAX_ACTIVE) throw new PublishError('limit');

  const code = await freeCode();

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
    JSON.stringify({ ...S, f, photos: undefined, video: undefined, step: undefined, done: undefined, act: undefined }),
  );
  const campusId = (S.campusId in CAMPUS_KEY ? S.campusId : 'nu-evn') as CampusId;
  form.campusId = campusId;

  await setDoc(doc(db, 'listings', code), {
    ownerId: user.uid,
    ownerName: firstName(user.displayName),
    ownerPhoto: user.photoURL ?? '',
    status: 'active',
    code,
    campus: CAMPUS_KEY[campusId],
    campusId,
    kind: S.subletType,
    title: titleOf(form),
    area: areaFromAddress(location.addr || '', campusId),
    price: Math.round(Number(S.rent) || 0),
    start: S.start,
    end: S.end,
    photos,
    captions,
    video: videoUrl,
    walk: null,
    form,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'listings', code, 'private', 'location'), {
    address: location.addr || '',
    building: location.building || '',
    site: location.site || '',
    showOnMap: !!S.map,
  });
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
