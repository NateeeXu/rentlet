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
  hasEnded,
  liveList,
  localDay,
  titleOf,
  toCard,
  toRoom,
  usableListing,
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
  constructor(public reason: 'signin' | 'limit' | 'photos' | 'invalid' | 'failed') {
    super(reason);
  }
}

// What firestore.rules and storage.rules accept, checked before anything uploads, so a listing the rules
// would refuse never leaves orphaned photos behind. The post form checks the same answers step by step.
const MAX_PHOTOS = 20;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
// lease proof: the photo and document types storage.rules accepts under proofs/ (no SVG or other images)
const PROOF_TYPE = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// The video's type; a file the system didn't label is read from its extension.
function videoType(video: File): string {
  if (video.type) return video.type;
  const ext = (video.name.split('.').pop() || '').toLowerCase();
  return ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4';
}

function ready(S: PostState, video: File | null, proof: File[]): boolean {
  const price = Math.round(Number(S.rent));
  const photos = Object.values(S.photos || {}).reduce((n, list) => n + (list || []).filter((p) => p.startsWith('data:image/')).length, 0);
  return (
    (S.subletType === 'sublet' || S.subletType === 'takeover') &&
    price > 0 &&
    price <= 20_000 &&
    isDay(S.start) &&
    isDay(S.end) &&
    S.start < S.end &&
    photos > 0 &&
    photos <= MAX_PHOTOS &&
    (!video || (/^video\/(mp4|quicktime|webm)$/.test(videoType(video)) && video.size < MAX_VIDEO_BYTES)) &&
    (S.proof !== 'lease' || proof.slice(0, 3).every((f) => PROOF_TYPE.test(f.type) && f.size < MAX_PROOF_BYTES))
  );
}

function fromDoc(id: string, data: DocumentData): ListingDoc {
  const created = data.createdAt as Timestamp | null | undefined;
  // a listing still saving has no server time yet; anything else that isn't a Timestamp reads as now
  const ms = created && typeof created.toMillis === 'function' ? created.toMillis() : Date.now();
  return { ...(data as ListingDoc), code: id, createdAtMs: ms };
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
  if (!ready(S, video, proof)) throw new PublishError('invalid');

  // live listings only: one whose last day has passed no longer counts (it shows nowhere)
  const mine = await getDocs(query(collection(db, 'listings'), where('ownerId', '==', user.uid), where('status', '==', 'active')));
  const today = localDay();
  if (mine.docs.filter((d) => !hasEnded(d.get('end'), today)).length >= MAX_ACTIVE) throw new PublishError('limit');

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

  // lease proof: private files (the host and the Rentlet team only, storage.rules), uploaded before the
  // listing goes live so a failed upload never leaves a live listing behind a "Couldn't publish"
  const proofFiles: string[] = [];
  if (S.proof === 'lease') {
    for (const [i, file] of proof.slice(0, 3).entries()) {
      const ext = file.type === 'application/pdf' ? 'pdf' : (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
      const path = `proofs/${user.uid}/${code}-${i + 1}.${ext}`;
      await uploadBytes(ref(storage, path), file, { contentType: file.type });
      proofFiles.push(path);
    }
  }

  let videoUrl: string | null = null;
  if (video) {
    const ext = (video.name.split('.').pop() || 'mp4').toLowerCase();
    const r = ref(storage, `videos/${user.uid}/${code}.${ext}`);
    await uploadBytes(r, video, { contentType: videoType(video) });
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
  // Answers the host skipped stay empty (null, or [] for the lists); the same field names and shapes as before.
  // Rents are whole dollars; no original rent is 0, so the room page shows no "was" price.
  const price = Math.round(Number(S.rent) || 0);
  form.rent = price;
  form.orig = Number(S.orig) > 0 ? Math.round(Number(S.orig)) : 0;
  const multi: Partial<PostForm['multi']> = S.multi ?? {};
  form.multi = { fees: multi.fees ?? [], amen: multi.amen ?? [], habits: multi.habits ?? [], items: multi.items ?? [] };
  form.prefs = S.prefs ?? {};
  // refundable only means something with a deposit, and furniture terms only with furniture
  if (form.dep !== 'amount') (form as { refund: boolean | null }).refund = null;
  if (form.furn !== 'full' && form.furn !== 'part') form.terms = null;
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
    price,
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
  // lease proof: a host-only note of the files uploaded above (the listing doc must exist first for this rule)
  if (proofFiles.length) {
    try {
      await setDoc(doc(db, 'listings', code, 'private', 'proof'), { kind: 'lease', files: proofFiles, sentAt: serverTimestamp() });
    } catch {
      /* the files are already in Storage under the listing's code; the listing itself is live */
    }
  }
  return code;
}

// Every active listing that hasn't ended, newest first, kept live. A listing that can't be shown (one
// malformed document) is left out, so it never breaks the homepage or room page for everyone else.
export function subscribeActive(cb: (list: ListingDoc[]) => void, onError?: () => void): () => void {
  return onSnapshot(
    query(collection(db, 'listings'), where('status', '==', 'active')),
    (snap) =>
      cb(
        liveList(
          snap.docs.map((d) => {
            try {
              return fromDoc(d.id, d.data());
            } catch {
              return null;
            }
          }),
          localDay(),
        ),
      ),
    () => onError?.(),
  );
}

export type Lookup = { state: 'ok'; listing: ListingDoc } | { state: 'removed' | 'missing' | 'error' };

export async function getListing(code: string): Promise<Lookup> {
  try {
    const snap = await getDoc(doc(db, 'listings', code));
    if (!snap.exists()) return { state: 'missing' };
    const listing = fromDoc(snap.id, snap.data());
    if (listing.status !== 'active') return { state: 'removed' };
    // an ended listing still opens (old links keep working; toRoom marks it ended), a broken one doesn't
    return usableListing(listing) ? { state: 'ok', listing } : { state: 'missing' };
  } catch (e) {
    // the rules hide listings that were taken down from everyone but their host
    return (e as { code?: string }).code === 'permission-denied' ? { state: 'removed' } : { state: 'error' };
  }
}

export { toCard, toRoom };
