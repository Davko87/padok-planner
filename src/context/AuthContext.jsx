import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

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

    // Nasłuchuj zmian w Firebase Auth w tle (z timeoutem/nieblokująco)
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

  // Sprawdzanie dostępności nicku na żywo (dla zielonego podświetlenia w formularzu)
  const checkNickAvailable = async (nick) => {
    if (!nick || nick.trim().length < 3) return null;
    const cleanNick = nick.trim().toLowerCase();
    try {
      const getPromise = getDoc(doc(db, 'users', cleanNick));
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
      const docSnap = await Promise.race([getPromise, timeoutPromise]);
      return !docSnap.exists();
    } catch (e) {
      console.warn('Timeout checkNickAvailable:', e);
      return null; // Zwracamy null zamiast true, jeśli błąd sieci, żeby nie kłamać że wolny
    }
  };

  const register = async (nick, password) => {
    const cleanNick = nick.trim();
    const cleanId = cleanNick.toLowerCase();
    const pseudoEmail = `${cleanId}@padok.app`;

    // 1. Sprawdzenie w Firestore czy nick już istnieje (maksymalnie 8 sekund timeoutu)
    const userDocRef = doc(db, 'users', cleanId);
    let docSnap = null;
    try {
      const getPromise = getDoc(userDocRef);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8000));
      docSnap = await Promise.race([getPromise, timeoutPromise]);
    } catch (e) {
      console.warn('Sprawdzanie nicku Firestore offline/timeout -> proceed:', e);
    }

    if (docSnap && docSnap.exists()) {
      throw new Error('Użytkownik o takim nicku już istnieje!');
    }

    // 2. Utworzenie konta w Firestore z await, by upewnić się, że zapis się udał
    try {
      const setPromise = setDoc(userDocRef, {
        nick: cleanNick,
        password: password,
        createdAt: serverTimestamp(),
      });
      const timeoutSet = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_SET')), 8000));
      await Promise.race([setPromise, timeoutSet]);
    } catch (e) {
      console.error('Błąd zapisu Firestore (konto nie zostało trwale zapisane):', e);
      throw new Error('Problem z siecią lub serwerem. Zapis konta nie powiódł się, spróbuj ponownie.');
    }

    // 3. Opcjonalna próba utworzenia w Firebase Auth z timeoutem
    try {
      const authPromise = createUserWithEmailAndPassword(auth, pseudoEmail, password);
      const timeoutAuth = new Promise((_, reject) => setTimeout(() => reject(new Error('AUTH_TIMEOUT')), 5000));
      const userCredential = await Promise.race([authPromise, timeoutAuth]);
      await updateProfile(userCredential.user, { displayName: cleanNick }).catch(() => {});
      
      const userObj = {
        uid: userCredential.user.uid,
        nick: cleanNick,
        email: pseudoEmail,
      };
      setCurrentUser(userObj);
      localStorage.setItem('padok_current_user', JSON.stringify(userObj));
      return { success: true, user: userObj };
    } catch (err) {
      // Jeśli Auth wyłączone w konsoli lub wisiało -> logowanie z konta Firestore
      const fallbackUser = {
        uid: 'user_' + cleanId + '_' + Date.now(),
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
    const cleanId = cleanNick.toLowerCase();
    const pseudoEmail = `${cleanId}@padok.app`;

    // 1. Najpierw sprawdzamy w Firestore z timeoutem (błyskawiczne logowanie po nicku i haśle)
    const userDocRef = doc(db, 'users', cleanId);
    try {
      const getPromise = getDoc(userDocRef);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8000));
      const docSnap = await Promise.race([getPromise, timeoutPromise]);
      if (docSnap && docSnap.exists()) {
        const data = docSnap.data();
        if (data.password === password) {
          const fallbackUser = {
            uid: data.uid || ('user_' + cleanId),
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
    } catch (e) {
      if (e.message === 'Nieprawidłowe hasło!') throw e;
      console.warn('Firestore login check error/timeout:', e);
    }

    // 2. Próba logowania w Firebase Auth jeśli istnieje konto cloud
    try {
      const authPromise = signInWithEmailAndPassword(auth, pseudoEmail, password);
      const timeoutAuth = new Promise((_, reject) => setTimeout(() => reject(new Error('AUTH_TIMEOUT')), 8000));
      const userCredential = await Promise.race([authPromise, timeoutAuth]);
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
      throw new Error('Nieprawidłowy nick lub hasło! (bądź serwer wolniej odpowiada, spróbuj ponownie)');
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

  const deleteAccount = async () => {
    if (!currentUser) return;
    try {
      const cleanId = currentUser.nick.trim().toLowerCase();
      
      // Fire-and-forget dla bazy danych (aby interfejs zareagował od razu, w ułamek sekundy)
      deleteDoc(doc(db, 'users', cleanId)).catch(e => console.warn('Błąd usuwania z DB:', e));
      
      if (auth.currentUser) {
        auth.currentUser.delete().catch(e => console.warn('Błąd usuwania z Firebase Auth:', e));
      }
      
      // Optymistyczne wyczyszczenie sesji - reaguje natychmiast
      setCurrentUser(null);
      localStorage.removeItem('padok_current_user');
    } catch (err) {
      console.error('Błąd usuwania konta:', err);
      setCurrentUser(null);
      localStorage.removeItem('padok_current_user');
    }
  };

  return (
    <AuthContext.Provider value={{ currentUser, loading, register, login, logout, checkNickAvailable, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
