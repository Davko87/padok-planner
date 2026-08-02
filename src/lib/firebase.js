import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

// AUTO-RECOVERY: Zabezpieczenie przed uszkodzeniem bazy po "Clear site data"
if (!localStorage.getItem('idb_wiped_v2')) {
  try {
    indexedDB.deleteDatabase('firestore/[DEFAULT]/padok-planner-app/main');
    indexedDB.deleteDatabase('firebaseLocalStorageDb');
    localStorage.setItem('idb_wiped_v2', 'true');
    console.log('IndexedDB caches automatically cleared to fix potential corruption.');
  } catch (e) {
    console.warn('Błąd podczas czyszczenia IndexedDB:', e);
  }
}


const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAwgat3c67bYievuKO6qE_2UiZ4KkhVSDc',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'padok-planner-app.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'padok-planner-app',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'padok-planner-app.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '931636987182',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:931636987182:web:8ca9f91114e86477dfa6bf',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// CRITICAL: Firestore with persistent offline cache
// This ensures the app works on racetracks without internet!
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// NOTE: Firebase Storage removed (unavailable on Spark plan).
// Map images are loaded directly from Google Static Maps URL
// and cached by the PWA service worker for offline use.

export { app, db, auth };

