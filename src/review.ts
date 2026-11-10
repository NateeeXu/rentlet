// The Rentlet team's review page (review.html): new listings, lease proof, reports and feedback. Reading needs the
// admin claim (firestore.rules, storage.rules); every decision goes through functions/src/review.ts.
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import { getDownloadURL, ref } from 'firebase/storage';
import { app, auth, db, storage } from './firebase';
import { canSignIn } from './lib/nu';
import { proofFilePaths } from './lib/profileData';

declare global {
  interface Window {
    RentletReview: typeof api;
    RL_reviewReady?: () => void;
  }
}

let functions: Promise<{ fns: Functions; mod: typeof import('firebase/functions') }> | null = null;
const load = () => (functions ??= import('firebase/functions').then((mod) => ({ mod, fns: mod.getFunctions(app, 'us-central1') })));

async function call(name: string, data: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reason: string }> {
  try {
    const { fns, mod } = await load();
    const res = await mod.httpsCallable(fns, name, { timeout: 30000 })(data);
    return { ok: true, data: (res.data ?? {}) as Record<string, unknown> };
  } catch (e) {
    return { ok: false, reason: String((e as { message?: string }).message ?? 'failed') };
  }
}

const ms = (t: unknown): number => (t && typeof (t as { toMillis?: () => number }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : 0);
const s = (v: unknown, n = 2000) => (typeof v === 'string' ? v.slice(0, n) : '');

export interface ListingItem {
  code: string;
  name: string;
  title: string;
  area: string;
  price: number;
  start: string;
  end: string;
  photo: string;
  photos: string[];
  host: string;
  ownerId: string;
  status: string;
  atMs: number;
  review: { listing?: string; listingReason?: string; listingAtMs?: number; lease?: string; leaseReason?: string; leaseAtMs?: number };
  proofFiles: string[];
  proofAtMs: number;
}

const api = {
  // 'yes' once the sign-in email is on the team list (the token is refreshed so the rules see the claim)
  async access(): Promise<'signed-out' | 'no' | 'yes'> {
    await auth.authStateReady();
    const u = auth.currentUser;
    if (!canSignIn(u)) return 'signed-out';
    const r = await call('claimAdmin', {});
    if (!r.ok || r.data.admin !== true) return 'no';
    await u!.getIdToken(true);
    return 'yes';
  },

  async queues() {
    const [ls, rv, rp, fb] = await Promise.all([
      getDocs(collection(db, 'listings')),
      getDocs(collection(db, 'reviews')),
      getDocs(query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(200))),
      getDocs(query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(200))),
    ]);
    const reviews = new Map(
      rv.docs.map((d) => {
        const r = d.data();
        return [d.id, { listing: s(r.listing, 20), listingReason: s(r.listingReason, 400), listingAtMs: ms(r.listingAt), lease: s(r.lease, 20), leaseReason: s(r.leaseReason, 400), leaseAtMs: ms(r.leaseAt) }];
      }),
    );
    const listings: ListingItem[] = await Promise.all(
      ls.docs.map(async (d) => {
        const x = d.data();
        const photos = Array.isArray(x.photos) ? x.photos.filter((p: unknown) => typeof p === 'string') : [];
        let proofFiles: string[] = [];
        let proofAtMs = 0;
        if (x.form?.proof === 'lease') {
          const note = await getDoc(doc(db, 'listings', d.id, 'private', 'proof')).catch(() => null);
          proofFiles = proofFilePaths(d.id, s(x.ownerId, 128), note?.data());
          proofAtMs = ms(note?.data()?.sentAt);
        }
        return {
          code: d.id,
          name: s(x.building, 80) || s(x.title, 120) || 'Listing',
          title: s(x.title, 120),
          area: s(x.area, 80),
          price: typeof x.price === 'number' ? x.price : 0,
          start: s(x.start, 10),
          end: s(x.end, 10),
          photo: photos[0] ?? '',
          photos,
          host: s(x.ownerName, 60),
          ownerId: s(x.ownerId, 128),
          status: s(x.status, 20),
          atMs: Math.max(ms(x.updatedAt), ms(x.createdAt)),
          review: reviews.get(d.id) ?? {},
          proofFiles,
          proofAtMs,
        };
      }),
    );
    const reports = rp.docs.map((d) => ({ id: d.id, reason: s(d.data().reason, 1000), details: s(d.data().details, 1000), kind: s(d.data().kind, 30) || 'listing', listingId: s(d.data().listingId, 40), status: s(d.data().status, 20), atMs: ms(d.data().createdAt) }));
    const feedback = fb.docs.map((d) => ({ id: d.id, type: s(d.data().type, 10), text: s(d.data().text), email: s(d.data().email, 254), page: s(d.data().page, 300), signedIn: !!s(d.data().uid), status: s(d.data().status, 20), atMs: ms(d.data().createdAt) }));
    return { listings, reports, feedback };
  },

  // download links for a host's lease proof (storage.rules lets the team read proofs/)
  files: (paths: string[]) => Promise.all(paths.map((p) => getDownloadURL(ref(storage, p)).then((url) => ({ url, pdf: /\.pdf$/i.test(p) }), () => null))),
  listing: (code: string, action: 'approve' | 'hide', reason = '', note = '') => call('reviewListing', { code, action, reason, note }),
  lease: (code: string, action: 'verify' | 'return', reason = '', note = '') => call('reviewLease', { code, action, reason, note }),
  report: (id: string, action: 'hide' | 'dismiss', reason = '', note = '') => call('resolveReport', { id, action, reason, note }),
  feedback: (id: string) => call('resolveFeedback', { id }),
};

window.RentletReview = api;
window.RL_reviewReady?.();
