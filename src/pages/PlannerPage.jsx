import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import TeamCatalog from '../components/TeamCatalog.jsx';
import PaddockCanvas from '../components/PaddockCanvas.jsx';

function PlannerPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [eventData, setEventData] = useState(null);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [errorEvent, setErrorEvent] = useState(null);

  // Stan zespołów umieszczonych na płótnie toru
  const [placedTeams, setPlacedTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);

  // ZADANIE 7: Tryb Offline i Zapis Padoku (stan zapisu i ref do odróżnienia inicjalizacji)
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'pending' | 'error'
  const hasLoadedInitialTeams = useRef(false);

  useEffect(() => {
    if (!eventId) return;

    // Nasłuchuj na dane eventu w czasie rzeczywistym i z cache offline
    const docRef = doc(db, 'events', eventId);
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() };
          setEventData(data);
          // Załaduj zespoły z bazy (Zadanie 7) tylko przy pierwszym wejściu / załadowaniu dokumentu
          if (!hasLoadedInitialTeams.current) {
            setPlacedTeams(data.teams || []);
            hasLoadedInitialTeams.current = true;
          }
          setErrorEvent(null);
        } else if (eventId === 'demo') {
          // Fallback dla szybkiego testu / demo
          setEventData({
            id: 'demo',
            name: 'Tor Poznań — Padok Demo',
            widthMeters: 250,
            heightMeters: 180,
            imageUrl: 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/16.7962,52.4185,17,0,0/1024x1024?access_token=' + (import.meta.env.VITE_MAPBOX_TOKEN || ''),
          });
          if (!hasLoadedInitialTeams.current) {
            hasLoadedInitialTeams.current = true;
          }
        } else {
          setErrorEvent('Nie znaleziono eventu o podanym ID.');
        }
        setIsLoadingEvent(false);
      },
      (err) => {
        console.error('Błąd pobierania eventu z Firestore:', err);
        setErrorEvent('Błąd połączenia podczas pobierania danych eventu.');
        setIsLoadingEvent(false);
      }
    );

    return () => unsubscribe();
  }, [eventId]);

  // ZADANIE 7: Ręczny zapis układu po kliknięciu przycisku "Zapisz układ"
  const handleSavePaddock = async () => {
    if (!eventId || eventId === 'demo') {
      setSaveStatus('saved');
      return;
    }
    try {
      setSaveStatus('saving');
      const docRef = doc(db, 'events', eventId);
      await updateDoc(docRef, {
        teams: placedTeams,
        updatedAt: serverTimestamp(),
      });
      setSaveStatus('saved');
    } catch (err) {
      console.error('Błąd ręcznego zapisu układu do Firestore:', err);
      setSaveStatus('error');
    }
  };

  // ZADANIE 7: Automatyczny zapis (debounce 2 sekundy) po zmianie na canvasie lub w D-Padzie
  useEffect(() => {
    if (!hasLoadedInitialTeams.current) return;
    if (!eventId || eventId === 'demo') {
      setSaveStatus('saved');
      return;
    }

    setSaveStatus('pending');
    const timer = setTimeout(async () => {
      try {
        setSaveStatus('saving');
        const docRef = doc(db, 'events', eventId);
        await updateDoc(docRef, {
          teams: placedTeams,
          updatedAt: serverTimestamp(),
        });
        setSaveStatus('saved');
      } catch (err) {
        console.error('Błąd automatycznego zapisu układu:', err);
        setSaveStatus('error');
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [placedTeams, eventId]);

  // Obsługa kliknięcia "+" w katalogu teamów -> dodaje na środek sceny
  const handleSelectTeamFromCatalog = (teamTemplate) => {
    if (!eventData) return;

    const widthMeters = teamTemplate.width || teamTemplate.widthMeters || 10;
    const heightMeters = teamTemplate.length || teamTemplate.heightMeters || 15;

    // Umieść na środku fizycznego toru
    const physicalWidth = eventData.widthMeters || 250;
    const physicalHeight = eventData.heightMeters || 180;
    const imgW = 1024;
    const ppm = imgW / physicalWidth;

    const newTeamNode = {
      id: 'team_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      templateId: teamTemplate.id || 'custom',
      name: teamTemplate.name || 'Zespól Wyścigowy',
      color: teamTemplate.color || '#3b82f6',
      widthMeters,
      heightMeters,
      x: (physicalWidth * ppm) / 2 - (widthMeters * ppm) / 2,
      y: (physicalHeight * ppm) / 2 - (heightMeters * ppm) / 2,
      rotation: 0,
    };

    const updated = [...placedTeams, newTeamNode];
    setPlacedTeams(updated);
    setSelectedTeamId(newTeamNode.id);
  };

  return (
    <div className="relative h-full w-full flex items-center justify-center overflow-hidden bg-slate-950">
      {/* Centralna Scena PaddockCanvas (Zadania 5 i 6) */}
      <PaddockCanvas
        eventData={eventData}
        placedTeams={placedTeams}
        onUpdateTeams={setPlacedTeams}
        selectedTeamId={selectedTeamId}
        onSelectTeam={setSelectedTeamId}
      />

      {/* Top bar (nałożony nad canvasem z Zadaniami 1, 5, 6, 7) */}
      <header className="absolute top-4 left-0 right-0 z-40 p-4 pointer-events-none">
        <div className="glass-panel px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 max-w-6xl mx-auto pointer-events-auto shadow-glass-lg border-white/25">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-white/70 hover:text-white transition-colors duration-200 text-xs font-medium shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Powrót na Globus
          </button>

          <div className="text-center">
            <h2 className="text-sm font-bold text-white tracking-wide truncate max-w-[200px] sm:max-w-md">
              {isLoadingEvent ? 'Ładowanie eventu...' : eventData ? eventData.name : eventId}
            </h2>
            {eventData && (
              <p className="text-[11px] font-mono text-emerald-300">
                Tor: {eventData.widthMeters} × {eventData.heightMeters || eventData.widthMeters} m
              </p>
            )}
          </div>

          {/* Akcje i status zapisu (Zadanie 7) */}
          <div className="flex items-center gap-2.5 shrink-0">
            {selectedTeamId && (
              <button
                onClick={() => {
                  setPlacedTeams(placedTeams.filter((t) => t.id !== selectedTeamId));
                  setSelectedTeamId(null);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-xs flex items-center gap-1 transition-all shadow"
                title="Usuń zaznaczony zespół z toru"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                </svg>
                <span>Usuń</span>
              </button>
            )}

            {/* ZADANIE 7: Przycisk Ręcznego Zapisu */}
            <button
              onClick={handleSavePaddock}
              disabled={saveStatus === 'saving'}
              className="glass-button-primary px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md active:scale-95 disabled:opacity-50"
              title="Zapisz obecny układ padoku w bazie (działa również offline)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
              </svg>
              <span>Zapisz układ</span>
            </button>

            {/* Wskaźnik stanu zapisu w chmurze / lokalnie */}
            <div className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-xl border transition-all duration-300 bg-white/5 border-white/10">
              {saveStatus === 'saving' && (
                <>
                  <span className="w-2 h-2 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
                  <span className="text-indigo-300">Zapisywanie...</span>
                </>
              )}
              {saveStatus === 'pending' && (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                  <span className="text-amber-200/80">Oczekuje na zapis...</span>
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span className="text-emerald-300">Zapisano (Offline Ready)</span>
                </>
              )}
              {saveStatus === 'error' && (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                  <span className="text-red-300">Błąd zapisu</span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Ekran ładowania lub błędu nałożony jeśli potrzeba */}
      {isLoadingEvent && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center gap-4 z-50">
          <div className="w-10 h-10 border-3 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
          <p className="text-sm text-white/60">Pobieranie danych eventu i ładowanie układu padoku...</p>
        </div>
      )}

      {errorEvent && (
        <div className="absolute inset-0 bg-slate-950/95 flex items-center justify-center z-50 p-4">
          <div className="glass-panel-strong p-8 max-w-md text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-red-500/20 text-red-300 flex items-center justify-center mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <p className="text-red-200 font-medium">{errorEvent}</p>
            <button onClick={() => navigate('/')} className="glass-button text-xs w-full">
              Wróć do wyboru na mapie
            </button>
          </div>
        </div>
      )}

      {/* Side panel — Team Catalog */}
      <TeamCatalog onSelectTeam={handleSelectTeamFromCatalog} />
    </div>
  );
}

export default PlannerPage;
