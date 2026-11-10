// The Verification page's Firebase side (verification.html renders). The code is sent and checked by Cloud Functions
// (functions/src/verify.ts); this page can only read the result.
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import { app, auth, db } from './firebase';
import { canSignIn } from './lib/nu';

declare global {
  interface Window {
    RentletVerify: typeof api;
    RL_verifyReady?: () => void;
  }
}

let functions: Promise<{ fns: Functions; mod: typeof import('firebase/functions') }> | null = null;
function load() {
  functions ??= import('firebase/functions').then((mod) => ({ mod, fns: mod.getFunctions(app, 'us-central1') }));
  return functions;
}

export type Failure = { ok: false; reason: string; seconds?: number };

async function call<T>(name: string, data: unknown): Promise<T | Failure> {
  try {
    const { fns, mod } = await load();
    const res = await mod.httpsCallable(fns, name, { timeout: 30000 })(data);
    return res.data as T;
  } catch (e) {
    const err = e as { message?: string; details?: { reason?: string; seconds?: number } };
    return { ok: false, reason: err.details?.reason ?? 'failed', seconds: err.details?.seconds };
  }
}

const api = {
  // Where this account stands: the tag, the address it was confirmed with, and whether a live listing has lease proof.
  async status(): Promise<{ signedIn: boolean; verified: boolean; email: string; lease: boolean }> {
    await auth.authStateReady();
    const u = auth.currentUser;
    if (!canSignIn(u)) return { signedIn: false, verified: false, email: '', lease: false };
    const [tag, priv, own] = await Promise.all([
      getDoc(doc(db, 'verifications', u!.uid)),
      getDoc(doc(db, 'users', u!.uid, 'private', 'verification')).catch(() => null),
      getDocs(query(collection(db, 'listings'), where('ownerId', '==', u!.uid))).catch(() => null),
    ]);
    const lease = !!own?.docs.some((d) => d.data().status === 'active' && d.data().form?.proof === 'lease');
    return { signedIn: true, verified: tag.exists(), email: String(priv?.data()?.email ?? ''), lease };
  },
  send: (email: string) => call<{ ok: true }>('sendSchoolCode', { email }),
  confirm: (code: string) => call<{ ok: true; email: string }>('verifySchoolCode', { code }),
};

window.RentletVerify = api;
window.RL_verifyReady?.();
