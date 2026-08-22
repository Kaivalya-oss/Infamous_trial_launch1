import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, RecaptchaVerifier, signInWithPopup, signInWithPhoneNumber, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

if (!firebaseConfig.apiKey && !import.meta.env.DEV) {
  throw new Error("Missing Firebase Configuration in Production. Please check environment variables.");
}

let app;
let auth: Auth | any = {};

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (e) {
  console.warn("Firebase initialization failed (likely missing config in dev):", e);
}

export { auth };
export const googleProvider = new GoogleAuthProvider();

export { signInWithPopup, signInWithPhoneNumber, RecaptchaVerifier };
