import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Wczytaj z localStorage natychmiast na start
    const storedUser = localStorage.getItem('padok_current_user');
    if (storedUser) {
      try {
        setCurrentUser(JSON.parse(storedUser));
      } catch (e) {
        console.error('Błąd parsowania storedUser:', e);
      }
    }

    // Nasłuchuj zmian w Firebase Auth
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const nick = user.displayName || user.email?.split('@')[0] || 'Użytkownik';
        const userObj = {
          uid: user.uid,
          nick: nick,
          email: user.email,
        };
        setCurrentUser(userObj);
        localStorage.setItem('padok_current_user', JSON.stringify(userObj));
      } else {
        // Jeśli nie w Firebase Auth, sprawdź czy mamy lokalną sesję z Firestore fallback
        const stored = localStorage.getItem('padok_current_user');
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed && parsed.isFallback) {
              setCurrentUser(parsed);
            } else {
              setCurrentUser(null);
              localStorage.removeItem('padok_current_user');
            }
          } catch (e) {
            setCurrentUser(null);
          }
        } else {
          setCurrentUser(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const register = async (nick, password) => {
    const cleanNick = nick.trim();
    const pseudoEmail = `${cleanNick.toLowerCase()}@padok.app`;

    try {
      // 1. Spróbuj zarejestrować przez Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, pseudoEmail, password);
      await updateProfile(userCredential.user, { displayName: cleanNick });

      // Zapisz profil w Firestore
      try {
        await setDoc(doc(db, 'users', cleanNick.toLowerCase()), {
          nick: cleanNick,
          uid: userCredential.user.uid,
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.error('Błąd zapisu profilu Firestore:', e);
      }

      const userObj = {
        uid: userCredential.user.uid,
        nick: cleanNick,
        email: pseudoEmail,
      };
      setCurrentUser(userObj);
      localStorage.setItem('padok_current_user', JSON.stringify(userObj));
      return { success: true, user: userObj };
    } catch (err) {
      console.error('Firebase Auth register error:', err);
      if (err.code === 'auth/email-already-in-use') {
        throw new Error('Użytkownik o takim nicku już istnieje!');
      }
      if (err.code === 'auth/weak-password') {
        throw new Error('Hasło jest za słabe. Użyj minimum 8 znaków w tym przynajmniej jednej cyfry.');
      }

      // Jeśli metoda email/password nie jest włączona w konsoli Firebase (auth/configuration-not-found, auth/operation-not-allowed) lub błąd offline
      const userDocRef = doc(db, 'users', cleanNick.toLowerCase());
      const docSnap = await getDoc(userDocRef).catch(() => null);
      if (docSnap && docSnap.exists()) {
        throw new Error('Użytkownik o takim nicku już istnieje!');
      }
      await setDoc(userDocRef, {
        nick: cleanNick,
        password: password,
        createdAt: serverTimestamp(),
      }).catch((e) => console.warn('Offline/Firestore fallback:', e));

      const fallbackUser = {
        uid: 'user_' + cleanNick.toLowerCase() + '_' + Date.now(),
        nick: cleanNick,
        isFallback: true,
      };
      setCurrentUser(fallbackUser);
      localStorage.setItem('padok_current_user', JSON.stringify(fallbackUser));
      return { success: true, user: fallbackUser };
    }
  };

  const login = async (nick, password) => {
    const cleanNick = nick.trim();
    const pseudoEmail = `${cleanNick.toLowerCase()}@padok.app`;

    try {
      // 1. Spróbuj zalogować przez Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, pseudoEmail, password);
      const loggedNick = userCredential.user.displayName || cleanNick;
      const userObj = {
        uid: userCredential.user.uid,
        nick: loggedNick,
        email: pseudoEmail,
      };
      setCurrentUser(userObj);
      localStorage.setItem('padok_current_user', JSON.stringify(userObj));
      return { success: true, user: userObj };
    } catch (err) {
      console.error('Firebase Auth login error:', err);
      // Sprawdź Firestore fallback (dla auth/configuration-not-found, auth/operation-not-allowed, auth/user-not-found, auth/invalid-credential itp.)
      const userDocRef = doc(db, 'users', cleanNick.toLowerCase());
      const docSnap = await getDoc(userDocRef).catch(() => null);
      if (docSnap && docSnap.exists()) {
        const data = docSnap.data();
        if (data.password === password) {
          const fallbackUser = {
            uid: data.uid || ('user_' + cleanNick.toLowerCase()),
            nick: data.nick || cleanNick,
            isFallback: true,
          };
          setCurrentUser(fallbackUser);
          localStorage.setItem('padok_current_user', JSON.stringify(fallbackUser));
          return { success: true, user: fallbackUser };
        } else {
          throw new Error('Nieprawidłowe hasło!');
        }
      }
      throw new Error('Nieprawidłowy nick lub hasło!');
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error('SignOut error:', e);
    }
    setCurrentUser(null);
    localStorage.removeItem('padok_current_user');
  };

  return (
    <AuthContext.Provider value={{ currentUser, loading, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
