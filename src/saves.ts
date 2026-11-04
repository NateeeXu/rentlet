// Saved rooms: users/{uid}/saves/{listingCode} = {savedAt}. Only the signed-in owner can read or
// write them (firestore.rules). Pages import this module; it sets no globals.
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { isListingCode } from './lib/profileData';

export interface SavedRoom {
  code: string;
  savedAtMs: number;
}

export class SavesError extends Error {
  constructor(public reason: 'signin' | 'code') {
    super(reason);
  }
}

function saveRef(code: string) {
  const user = auth.currentUser;
  if (!user) throw new SavesError('signin');
  if (!isListingCode(code)) throw new SavesError('code');
  return doc(db, 'users', user.uid, 'saves', code);
}

export async function isSaved(code: string): Promise<boolean> {
  if (!auth.currentUser || !isListingCode(code)) return false;
  return (await getDoc(saveRef(code))).exists();
}

// savedAtMs restores the original time when a removal is undone.
export async function save(code: string, savedAtMs?: number): Promise<void> {
  await setDoc(saveRef(code), { savedAt: savedAtMs ? Timestamp.fromMillis(savedAtMs) : serverTimestamp() });
}

export async function unsave(code: string): Promise<void> {
  await deleteDoc(saveRef(code));
}

// Returns whether the room is saved afterwards.
export async function toggleSave(code: string): Promise<boolean> {
  if (await isSaved(code)) {
    await unsave(code);
    return false;
  }
  await save(code);
  return true;
}

// Every saved listing code, most recently saved first.
export async function listSaved(): Promise<SavedRoom[]> {
  const user = auth.currentUser;
  if (!user) throw new SavesError('signin');
  const snap = await getDocs(collection(db, 'users', user.uid, 'saves'));
  return snap.docs
    .filter((d) => isListingCode(d.id))
    .map((d) => {
      const t = d.get('savedAt') as Timestamp | null | undefined;
      return { code: d.id, savedAtMs: t && typeof t.toMillis === 'function' ? t.toMillis() : 0 };
    })
    .sort((a, b) => b.savedAtMs - a.savedAtMs);
}
