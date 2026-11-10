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
  writeBatch,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
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
import { AREA_CAPTION, AREA_ORDER, editState, removedFiles, type PrivateLocation } from './lib/listingEdit';
import { asPlace, listingPlace, sameAddress, type ListingPlace, type PickedPlace } from './lib/place';
import { MAX_LIVE, proofFilePaths } from './lib/profileData';
import { lookupPlace, nearbyPlaces } from './place';

// One place for the live-listing cap (src/lib/profileData.ts MAX_LIVE): publish and profile must agree.
// Form fields kept out of the public answers. The street address and website stay private to the host
// (shared only after both sides agree); the building name also goes on the listing, as its room page title.
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

// keepLinks: an edit also counts the photos already on the listing
function ready(S: PostState, video: File | null, proof: File[], keepLinks = false): boolean {
  const price = Math.round(Number(S.rent));
  const isPhoto = (p: string) => p.startsWith('data:image/') || (keepLinks && p.startsWith('https://'));
  const photos = Object.values(S.photos || {}).reduce((n, list) => n + (list || []).filter(isPhoto).length, 0);
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
    // a pin the host moved by hand keeps its spot; only an untouched address point is looked up again
    const again = place.id && !place.origin ? await lookupPlace({ id: place.id }, campusId) : null;
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

// The form's answers as a listing stores them: the public answers, the host-only fields, whole-dollar rents.
function answers(S: PostState) {
  const f: Record<string, string> = {};
  const location: Record<string, string> = {};
  for (const [k, v] of Object.entries(S.f || {})) {
    const value = String(v ?? '').trim();
    if (PRIVATE_FIELDS.includes(k)) location[k] = value;
    else f[k] = value;
  }
  const form: PostForm = JSON.parse(
    JSON.stringify({ ...S, f, photos: undefined, video: undefined, step: undefined, done: undefined, act: undefined, place: undefined, code: undefined }),
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
  // every listing shows at its spot on the map; the street address and website stay host-only
  form.map = true;
  return { form, location, price, campusId };
}

// Places around the spot for the room page's Getting around (fails soft to none).
async function placesNear(spot: ListingPlace['location'], campusId: CampusId) {
  return spot
    ? (await nearbyPlaces(spot.lat, spot.lng, campusId))
        .filter((x) => x.lat != null && x.lng != null)
        .slice(0, 12)
        .map((x) => ({ kind: x.kind, name: x.name.slice(0, 80), lat: x.lat, lng: x.lng, walk: x.walk, meters: x.meters }))
    : [];
}

// The listing's public fields, the same for a new listing and an edited one.
function publicFields(
  S: PostState,
  { form, location, price, campusId }: ReturnType<typeof answers>,
  spot: ListingPlace,
  files: { photos: string[]; captions: string[]; video: string | null },
) {
  return {
    campus: CAMPUS_KEY[campusId],
    campusId,
    kind: S.subletType,
    title: titleOf(form),
    building: (location.building || '').slice(0, 80),
    area: spot.area,
    price,
    start: S.start,
    end: S.end,
    photos: files.photos,
    captions: files.captions,
    video: files.video,
    walk: spot.walk,
    location: spot.location, // null when no place was picked or found
    form,
  };
}

// One publish at a time: a double-tap must not upload a second listing.
let publishing = false;

export async function publishListing(S: PostState, video: File | null, proof: File[], onStep?: (s: PublishStep) => void): Promise<string> {
  if (publishing) throw new PublishError('failed');
  publishing = true;
  try {
  return await publishListingInner(S, video, proof, onStep);
  } finally {
    publishing = false;
  }
}

async function publishListingInner(S: PostState, video: File | null, proof: File[], onStep?: (s: PublishStep) => void): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new PublishError('signin');
  if (!ready(S, video, proof)) throw new PublishError('invalid');

  // live listings only: one whose last day has passed no longer counts (it shows nowhere)
  const mine = await getDocs(query(collection(db, 'listings'), where('ownerId', '==', user.uid), where('status', '==', 'active')));
  const today = localDay();
  if (mine.docs.filter((d) => !hasEnded(d.get('end'), today)).length >= MAX_LIVE) throw new PublishError('limit');

  const code = await freeCode();
  // HERE answers while the photos upload
  const placing = placeFor(S, String(S.f?.addr ?? '').trim(), (S.campusId in CAMPUS_KEY ? S.campusId : 'nu-evn') as CampusId).catch(() => null);

  onStep?.('photos');
  const photos: string[] = [];
  const captions: string[] = [];
  for (const area of AREA_ORDER) {
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
  const saved = answers(S);
  const { location, campusId } = saved;
  const spot = listingPlace(await placing, location.addr || '', campusId);
  const near = await placesNear(spot.location, campusId);

  await setDoc(doc(db, 'listings', code), {
    ownerId: user.uid,
    ownerName: await hostName(user.uid, user.displayName),
    ownerPhoto: user.photoURL ?? '',
    status: 'active',
    code,
    ...publicFields(S, saved, spot, { photos, captions, video: videoUrl }),
    near,
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

// The team's decision on a listing (reviews/{code}, written only by functions/src/review.ts), once per page.
export interface ListingReview { listing: string; listingReason: string; lease: string; leaseReason: string; leaseAtMs: number }
const reviewReads = new Map<string, Promise<ListingReview | null>>();
export function listingReview(code: string): Promise<ListingReview | null> {
  let r = reviewReads.get(code);
  if (!r) {
    r = getDoc(doc(db, 'reviews', code)).then(
      (s) => {
        const d = s.data();
        if (!d) return null;
        const at = d.leaseAt as { toMillis?: () => number } | undefined;
        return { listing: String(d.listing ?? ''), listingReason: String(d.listingReason ?? ''), lease: String(d.lease ?? ''), leaseReason: String(d.leaseReason ?? ''), leaseAtMs: at?.toMillis ? at.toMillis() : 0 };
      },
      () => null,
    );
    reviewReads.set(code, r);
  }
  return r;
}

// Whether a host has confirmed a .edu address (verifications/{uid}, written only by functions/src/verify.ts).
const hostTags = new Map<string, Promise<boolean>>();
export function ownerVerified(uid: string): Promise<boolean> {
  if (!uid) return Promise.resolve(false);
  let tag = hostTags.get(uid);
  if (!tag) {
    tag = getDoc(doc(db, 'verifications', uid)).then((s) => s.exists(), () => false);
    hostTags.set(uid, tag);
  }
  return tag;
}

export async function getListing(code: string): Promise<Lookup> {
  try {
    const snap = await getDoc(doc(db, 'listings', code));
    if (!snap.exists()) return { state: 'missing' };
    const listing = fromDoc(snap.id, snap.data());
    if (listing.status !== 'active') return { state: 'removed' };
    // an ended listing still opens (old links keep working; toRoom marks it ended), a broken one doesn't
    return usableListing(listing) ? { state: 'ok', listing: { ...listing, ownerVerified: await ownerVerified(listing.ownerId) } } : { state: 'missing' };
  } catch (e) {
    // the rules hide listings that were taken down from everyone but their host
    return (e as { code?: string }).code === 'permission-denied' ? { state: 'removed' } : { state: 'error' };
  }
}

export type EditLookup =
  | { state: 'ok'; listing: ListingDoc; location: PrivateLocation; proofFiles: number }
  | { state: 'signin' | 'denied' | 'missing' | 'error' };

// A listing and its host-only details, for its host to edit.
export async function getListingForEdit(code: string): Promise<EditLookup> {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return { state: 'signin' };
  try {
    const snap = await getDoc(doc(db, 'listings', code));
    if (!snap.exists()) return { state: 'missing' };
    if (snap.get('ownerId') !== user.uid) return { state: 'denied' };
    const [loc, proof] = await Promise.all([
      getDoc(doc(db, 'listings', code, 'private', 'location')),
      getDoc(doc(db, 'listings', code, 'private', 'proof')),
    ]);
    const d = loc.data() ?? {};
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    return {
      state: 'ok',
      listing: fromDoc(code, snap.data()),
      location: { address: str(d.address), building: str(d.building), site: str(d.site), zip: typeof d.zip === 'string' ? d.zip : null },
      proofFiles: proofFilePaths(code, user.uid, proof.data()).length,
    };
  } catch (e) {
    // the rules hide a listing that was taken down from everyone but its host
    return { state: (e as { code?: string }).code === 'permission-denied' ? 'denied' : 'error' };
  }
}

// Saves the edited answers. The listing number, host, status and post date stay as they are. New files get
// new names, because storage.rules does not allow overwriting one. The public listing and its host-only
// details change together or not at all; files the listing stops using go once that has worked.
export async function updateListing(code: string, S: PostState, video: File | null, proof: File[], onStep?: (s: PublishStep) => void): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new PublishError('signin');
  if (!ready(S, video, proof, true)) throw new PublishError('invalid');
  const listingRef = doc(db, 'listings', code);
  const snap = await getDoc(listingRef).catch(() => null);
  if (!snap?.exists() || snap.get('ownerId') !== user.uid) throw new PublishError('failed');
  const old = fromDoc(code, snap.data());

  const saved = answers(S);
  const { location, campusId } = saved;
  const placing = placeFor(S, location.addr || '', campusId).catch(() => null);
  const stamp = Date.now().toString(36);
  const uploaded: string[] = [];
  const upload = async (path: string, data: Blob, contentType: string) => {
    const r = ref(storage, path);
    await uploadBytes(r, data, { contentType });
    uploaded.push(path);
    return r;
  };

  const photos: string[] = [];
  const captions: string[] = [];
  let videoUrl: string | null = null;
  try {
    onStep?.('photos');
    for (const area of AREA_ORDER) {
      for (const src of S.photos[area] || []) {
        if (src.startsWith('https://')) photos.push(src);
        else if (src.startsWith('data:image/')) {
          const r = await upload(`listings/${user.uid}/${code}-${stamp}-${photos.length + 1}.jpg`, await compress(src), 'image/jpeg');
          photos.push(await getDownloadURL(r));
        } else continue;
        captions.push(AREA_CAPTION[area]);
      }
    }
    if (!photos.length) throw new PublishError('photos');

    const proofPaths: string[] = [];
    if (S.proof === 'lease') {
      for (const [i, file] of proof.slice(0, 3).entries()) {
        const ext = file.type === 'application/pdf' ? 'pdf' : (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
        const path = `proofs/${user.uid}/${code}-${stamp}-${i + 1}.${ext}`;
        await upload(path, file, file.type);
        proofPaths.push(path);
      }
    }

    if (video) {
      const ext = (video.name.split('.').pop() || 'mp4').toLowerCase();
      const r = await upload(`videos/${user.uid}/${code}.${stamp}.${ext}`, video, videoType(video));
      videoUrl = await getDownloadURL(r);
    } else if (S.video) videoUrl = old.video ?? null;

    onStep?.('saving');
    const spot = listingPlace(await placing, location.addr || '', campusId);
    // the same spot keeps its places: a failed lookup answers with none and must not wipe out a good list
    const samePlace = spot.location?.lat === old.location?.lat && spot.location?.lng === old.location?.lng && campusId === old.campusId;
    const near = samePlace ? (old.near ?? []) : await placesNear(spot.location, campusId);

    const batch = writeBatch(db);
    batch.update(listingRef, { ...publicFields(S, saved, spot, { photos, captions, video: videoUrl }), near, updatedAt: serverTimestamp() });
    batch.set(
      doc(db, 'listings', code, 'private', 'location'),
      { address: location.addr || '', building: location.building || '', site: location.site || '', showOnMap: true, zip: spot.zip },
      { merge: true },
    );
    if (proofPaths.length) {
      const note = doc(db, 'listings', code, 'private', 'proof');
      const had = proofFilePaths(code, user.uid, (await getDoc(note)).data());
      batch.set(note, { kind: 'lease', files: [...had, ...proofPaths], sentAt: serverTimestamp() });
    }
    await batch.commit();
  } catch (e) {
    await Promise.allSettled(uploaded.map((p) => deleteObject(ref(storage, p))));
    throw e instanceof PublishError ? e : new PublishError('failed');
  }
  await Promise.allSettled(removedFiles(old, user.uid, photos, videoUrl).map((p) => deleteObject(ref(storage, p))));
}

// Lease proof added later, from the Verification page, to one of your live listings: up to 3 photos or PDFs go where
// the post form puts them, the private note lists them, and the listing shows "Lease proof sent, not reviewed" until the team decides (reviews/{code}).
export async function addLeaseProof(code: string, files: File[]): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new PublishError('signin');
  const list = files.slice(0, 3);
  if (!list.length || !list.every((f) => PROOF_TYPE.test(f.type) && f.size < MAX_PROOF_BYTES)) throw new PublishError('invalid');
  const listingRef = doc(db, 'listings', code);
  const snap = await getDoc(listingRef);
  if (!snap.exists() || snap.data().ownerId !== user.uid) throw new PublishError('invalid');
  const stamp = Date.now();
  const paths: string[] = [];
  try {
    for (const [i, file] of list.entries()) {
      const ext = file.type === 'application/pdf' ? 'pdf' : (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
      const path = `proofs/${user.uid}/${code}-${stamp}-${i + 1}.${ext}`;
      await uploadBytes(ref(storage, path), file, { contentType: file.type });
      paths.push(path);
    }
    const note = doc(db, 'listings', code, 'private', 'proof');
    const had = proofFilePaths(code, user.uid, (await getDoc(note)).data());
    const batch = writeBatch(db);
    batch.update(listingRef, { 'form.proof': 'lease', updatedAt: serverTimestamp() });
    batch.set(note, { kind: 'lease', files: [...had, ...paths], sentAt: serverTimestamp() });
    await batch.commit();
  } catch (e) {
    await Promise.allSettled(paths.map((p) => deleteObject(ref(storage, p))));
    throw e instanceof PublishError ? e : new PublishError('failed');
  }
}

export { editState, toCard, toRoom };
