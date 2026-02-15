import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import type { User } from 'firebase/auth';

export type { User };

const firebaseConfig = {
  apiKey: "AIzaSyBntjZpICTGIixBn6-nobkgSFKHgXZGZPE",
  authDomain: "smart-invoice-16f95.firebaseapp.com",
  projectId: "smart-invoice-16f95",
  storageBucket: "smart-invoice-16f95.firebasestorage.app",
  messagingSenderId: "55386000249",
  appId: "1:55386000249:web:a09d628a4e8b299f743da8"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Auth helpers
export const signUp = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password);

export const logIn = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
};

export const logOut = () => signOut(auth);

export const onAuthChange = (callback: (user: User | null) => void) =>
  onAuthStateChanged(auth, callback);

export default app;
