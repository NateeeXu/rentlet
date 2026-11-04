// Saved rooms: users/{uid}/saves/{listingCode} = {savedAt}. Saved requests:
// users/{uid}/savedRequests/{requestId} = {savedAt}. Only the signed-in owner can read or write them
// (firestore.rules). Pages import this module; it sets no globals. The hearts on every page go through
// window.Rentlet.toggleSave (src/rentlet.ts); the profile's Saved section uses these to remove and undo.
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
import { isListingCode, isRequestId } from './lib/profileData';

export interface SavedRoom {
  code: string;
  savedAtMs: number;
}

export interface SavedRequest {
  id: string;
  savedAtMs: number;
}

export class SavesError extends Error {
  constructor(public reason: 'signin' | 'code') {
    super(reason);
  }
}

function uid(): string {
  const user = auth.currentUser;
  if (!user) throw new SavesError('signin');
  return user.uid;
}

function saveRef(code: string) {
  const me = uid();
  if (!isListingCode(code)) throw new SavesError('code');
  return doc(db, 'users', me, 'saves', code);
}

function requestSaveRef(id: string) {
  const me = uid();
  if (!isRequestId(id)) throw new SavesError('code');
  return doc(db, 'users', me, 'savedRequests', id);
}

// savedAtMs restores the original time when a removal is undone.
const savedAt = (savedAtMs?: number) => ({ savedAt: savedAtMs ? Timestamp.fromMillis(savedAtMs) : serverTimestamp() });

// Every saved id in one of the two collections, most recently saved first.
async function list(path: 'saves' | 'savedRequests', valid: (id: string) => boolean) {
  const snap = await getDocs(collection(db, 'users', uid(), path));
  return snap.docs
    .filter((d) => valid(d.id))
    .map((d) => {
      const t = d.get('savedAt') as Timestamp | null | undefined;
      return { id: d.id, savedAtMs: t && typeof t.toMillis === 'function' ? t.toMillis() : 0 };
    })
    .sort((a, b) => b.savedAtMs - a.savedAtMs);
}

// ---------- rooms ----------

export async function isSaved(code: string): Promise<boolean> {
  if (!auth.currentUser || !isListingCode(code)) return false;
  return (await getDoc(saveRef(code))).exists();
}

export async function save(code: string, savedAtMs?: number): Promise<void> {
  await setDoc(saveRef(code), savedAt(savedAtMs));
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
  return (await list('saves', isListingCode)).map((s) => ({ code: s.id, savedAtMs: s.savedAtMs }));
}

// ---------- requests ----------

export async function saveRequest(id: string, savedAtMs?: number): Promise<void> {
  await setDoc(requestSaveRef(id), savedAt(savedAtMs));
}

export async function unsaveRequest(id: string): Promise<void> {
  await deleteDoc(requestSaveRef(id));
}

// Every saved request id, most recently saved first.
export async function listSavedRequests(): Promise<SavedRequest[]> {
  return list('savedRequests', isRequestId);
}
