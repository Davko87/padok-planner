import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, getDocFromCache, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

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
    const userDocRef = doc(db, 'users', cleanNick);

    try {
      // Najpierw sprawdzamy lokalny cache - jeśli jest w cache, to na 100% zajęty
      const cachedSnap = await getDocFromCache(userDocRef).catch(() => null);
      if (cachedSnap && cachedSnap.exists()) {
        return false; // Zajęty
      }

      // Jeśli nie ma w cache, pytamy serwer z timeoutem
      const getPromise = getDoc(userDocRef);
      // Szybki timeout - jeśli baza wisi, zwracamy null (nie wiemy)
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
      const docSnap = await Promise.race([getPromise, timeoutPromise]);
      return !docSnap.exists();
    } catch (e) {
      return null; // W razie problemów z siecią zwracamy null, żeby nie kłamać że wolny. (zabezpieczenie główne jest w rejestracji Auth)
    }
  };

  const register = async (nick, password) => {
    const cleanNick = nick.trim();
    const cleanId = cleanNick.toLowerCase();
    const pseudoEmail = `${cleanId}@padok.app`;

    // 1. Rejestracja w Firebase Auth (główne i niezawodne źródło przez HTTP)
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, pseudoEmail, password);
      await updateProfile(userCredential.user, { displayName: cleanNick }).catch(() => {});
      
      const userObj = {
        uid: userCredential.user.uid,
        nick: cleanNick,
        email: pseudoEmail,
      };
      
      // 2. Fire-and-forget zapisu do Firestore (działa w tle, aktualizuje lokalny cache)
      setDoc(doc(db, 'users', cleanId), {
        nick: cleanNick,
        password: password,
        createdAt: serverTimestamp(),
      }).catch(e => console.warn('Błąd zapisu w tle Firestore:', e));

      setCurrentUser(userObj);
      localStorage.setItem('padok_current_user', JSON.stringify(userObj));
      return { success: true, user: userObj };
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        throw new Error('Użytkownik o takim nicku już istnieje!');
      }
      console.error('Błąd Firebase Auth:', err);
      
      // Fallback tylko w krytycznym przypadku
      const fallbackUser = {
        uid: 'user_' + cleanId + '_' + Date.now(),
        nick: cleanNick,
        isFallback: true,
      };
      
      // Fire-and-forget do bazy w ramach fallbacku
      setDoc(doc(db, 'users', cleanId), {
        nick: cleanNick,
        password: password,
        createdAt: serverTimestamp(),
      }).catch(() => {});

      setCurrentUser(fallbackUser);
      localStorage.setItem('padok_current_user', JSON.stringify(fallbackUser));
      return { success: true, user: fallbackUser };
    }
  };

  const login = async (nick, password) => {
    const cleanNick = nick.trim();
    const cleanId = cleanNick.toLowerCase();
    const pseudoEmail = `${cleanId}@padok.app`;

    let authError = '';

    // 1. Najpierw Firebase Auth (HTTP, bardziej niezawodne przy problemach z websocketami Firestore)
    try {
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
      if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        throw new Error('Nieprawidłowy nick lub hasło!');
      }
      authError = err.message;
      console.warn('Logowanie Auth się nie powiodło (offline/błąd), fallback do Firestore:', err);
    }

    // 2. Jeśli Auth padło (sieć zablokowana) próbujemy odczytać z lokalnego cache / Firestore
    const userDocRef = doc(db, 'users', cleanId);
    try {
      const getPromise = getDoc(userDocRef);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 2000));
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
      } else {
        throw new Error('Konto nie istnieje!');
      }
    } catch (e) {
      if (e.message === 'Nieprawidłowe hasło!' || e.message === 'Konto nie istnieje!') throw e;
      throw new Error(`Nie udało się zalogować. Auth błąd: ${authError}. Błąd bazy: ${e.message}`);
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
