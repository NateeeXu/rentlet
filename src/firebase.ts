import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

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
