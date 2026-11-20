import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

// Web app config for the rentlet-nu Firebase project. These values only identify the project
// and are meant to ship in client code; access is enforced by firestore.rules and storage.rules.
const firebaseConfig = {
  apiKey: 'AIzaSyCOPfvxcA3Zvbzg_ssW-aTM0rAzqd8SjvM',
  authDomain: 'rentlet-nu.firebaseapp.com',
  projectId: 'rentlet-nu',
  storageBucket: 'rentlet-nu.firebasestorage.app',
  messagingSenderId: '250938855003',
  appId: '1:250938855003:web:6e6f5c287e24bffefb397e',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'en'; // Rentlet is English-only, including Google's sign-in window
export const db = getFirestore(app);
export const storage = getStorage(app);

// Local E2E testing: `VITE_USE_EMULATORS=true npm run dev` (or the Playwright webServer, which sets
// it) points the app at `firebase emulators:start` instead of the real project, so tests never read
// or corrupt real listings, users or auth data. Never set in production builds.
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectStorageEmulator(storage, 'localhost', 9199);
}
