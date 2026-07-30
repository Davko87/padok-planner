import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { findCleanSpotForNode, findMagneticSnapPosition } from '../lib/geoUtils.js';
import TeamCatalog from '../components/TeamCatalog.jsx';
import PaddockCanvas from '../components/PaddockCanvas.jsx';
import DuplicateTeamModal from '../components/DuplicateTeamModal.jsx';

function PlannerPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [eventData, setEventData] = useState(null);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [errorEvent, setErrorEvent] = useState(null);

  const [placedTeams, setPlacedTeams] = useState([]);
  const [guideLines, setGuideLines] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [allowCollisions, setAllowCollisions] = useState(false);
  const [enableMagnet, setEnableMagnet] = useState(true);
  const [scalePx, setScalePx] = useState(null);
  const [isLeftHudCollapsed, setIsLeftHudCollapsed] = useState(false);
  const getViewportCenterRef = useRef(null);
  const canvasRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);

  // Stan weryfikacji powielenia (duplikatu) zespołu na padoku przed dodaniem
  const [pendingDuplicateNode, setPendingDuplicateNode] = useState(null);

  // ZADANIE 7: Tryb Offline i Zapis Padoku (stan zapisu i ref do odróżnienia inicjalizacji)
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'pending' | 'error'
  const hasLoadedInitialTeams = useRef(false);
  const [toastMessage, setToastMessage] = useState('');

  // Wymuszenie ponownego wczytania padoku (wyczyszczenie stanu) gdy użytkownik się zaloguje/wyloguje
  useEffect(() => {
    hasLoadedInitialTeams.current = false;
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!eventId) return;

    if (eventId.startsWith('local-')) {
      const localJson = localStorage.getItem('local-event-' + eventId);
      if (localJson) {
        try {
          const parsed = JSON.parse(localJson);
          setEventData(parsed);
          setPlacedTeams(parsed.teams || []);
          hasLoadedInitialTeams.current = true;
          setIsLoadingEvent(false);
          return;
        } catch (e) {}
      }
    }

    // Słownik wszystkich dostępnych torów i presetów bez klucza (Esri/ArcGIS)
    const PRESET_TRACKS = {
      'demo': { name: 'Tor Poznań — Padok Demo', w: 250, h: 180, bbox: '16.7942,52.4170,16.7982,52.4200' },
      'tor-poznan': { name: 'Tor Poznań — Padok Główny', w: 250, h: 180, bbox: '16.7942,52.4170,16.7982,52.4200' },
      'silesia-ring': { name: 'Silesia Ring — Padok Główny', w: 300, h: 200, bbox: '18.0930,50.5310,18.0990,50.5350' },
      'tor-modlin': { name: 'Tor Modlin — Padok Sportowy', w: 200, h: 150, bbox: '20.6690,52.4630,20.6730,52.4660' },
      'tor-lodz': { name: 'Tor Łódź — Ośrodek Doskonalenia', w: 180, h: 120, bbox: '19.5820,51.8740,19.5870,51.8770' },
      'tor-jastrzab': { name: 'Autodrom Jastrząb — Padok', w: 220, h: 160, bbox: '20.9470,51.2460,20.9520,51.2490' },
      'tor-krakow': { name: 'Moto Park Kraków — Padok', w: 160, h: 110, bbox: '20.0810,50.0410,20.0850,50.0440' },
      'nurburgring': { name: 'Nürburgring GP — Grand Prix Paddock', w: 350, h: 250, bbox: '6.9420,50.3320,6.9490,50.3360' },
      'spa': { name: 'Circuit de Spa-Francorchamps — F1 Paddock', w: 400, h: 250, bbox: '5.9700,50.4350,5.9770,50.4390' },
      'monza': { name: 'Autodromo Nazionale Monza — Paddock', w: 380, h: 240, bbox: '9.2840,45.6170,9.2910,45.6210' },
      'silverstone': { name: 'Silverstone Circuit — Wing Paddock', w: 420, h: 260, bbox: '-1.0210,52.0720,-1.0130,52.0760' },
    };

    const trackPreset = PRESET_TRACKS[eventId] || (eventId.startsWith('track-') ? {
      name: `Tor Wyścigowy (${eventId})`,
      w: 280,
      h: 190,
      bbox: '16.7942,52.4170,16.7982,52.4200'
    } : null);

    // Jeśli to tor z naszej bazy lub preset — od razu ładujemy go synchronicznie! (Brak blokady na ładowaniu!)
    if (trackPreset) {
      const [minLng, minLat, maxLng, maxLat] = trackPreset.bbox.split(',').map(Number);
      setEventData({
        id: eventId,
        name: trackPreset.name,
        widthMeters: trackPreset.w,
        heightMeters: trackPreset.h,
        bounds: {
          center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
          zoom: 17
        }
      });
      setIsLoadingEvent(false);
      if (!hasLoadedInitialTeams.current) {
        hasLoadedInitialTeams.current = true;
      }
    }

    // Bezpiecznik: w razie braku odpowiedzi z chmury po 1.5 sekundy zawsze zdejmujemy ekran ładowania
    const timeoutId = setTimeout(() => {
      setIsLoadingEvent((prev) => {
        if (prev && !eventData) {
          // Jeśli po 1.5s nadal nic nie pobrano z Firestore, ustaw domyślny tor z mapą satelitarną
          const fallbackPreset = PRESET_TRACKS['tor-poznan'];
          const [minLng, minLat, maxLng, maxLat] = fallbackPreset.bbox.split(',').map(Number);
          setEventData({
            id: eventId,
            name: `Padok Toru (${eventId})`,
            widthMeters: 250,
            heightMeters: 180,
            bounds: {
              center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
              zoom: 17
            }
          });
          return false;
        }
        return false;
      });
    }, 1500);

    // W tle wciąż nasłuchujemy na ewentualne zapisane zespoły w chmurze Firestore
    const docRef = doc(db, 'events', eventId);
    const unsubscribeEvent = onSnapshot(
      docRef,
      (docSnap) => {
        clearTimeout(timeoutId);
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() };
          setEventData((prev) => ({
            ...prev,
            ...data
          }));
          
          // Jeśli gość (nie zalogowany), ładujemy układy publiczne z głównego eventu
          if (!currentUser && !hasLoadedInitialTeams.current) {
            setPlacedTeams(data.teams || []);
            setGuideLines(data.guideLines || []);
            setMeasurements(data.measurements || []);
            hasLoadedInitialTeams.current = true;
          }
          setErrorEvent(null);
        } else if (!trackPreset) {
          // Jeśli nie było w presetach ani w Firestore, ustaw domyślne parametry zamiast błędu
          const fallbackPreset = PRESET_TRACKS['tor-poznan'];
          const [minLng, minLat, maxLng, maxLat] = fallbackPreset.bbox.split(',').map(Number);
          setEventData({
            id: eventId,
            name: `Nowy Padok: ${eventId}`,
            widthMeters: 250,
            heightMeters: 180,
            bounds: {
              center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
              zoom: 17
            }
          });
        }
        setIsLoadingEvent(false);
      },
      (err) => {
        clearTimeout(timeoutId);
        console.error('Błąd pobierania eventu z Firestore:', err);
        // Jeśli błąd sieci na GitHub Pages, zdejmij loading i pozwól na działanie na lokalnym presecie
        setIsLoadingEvent(false);
      }
    );

    let unsubscribeLayout = null;
    if (currentUser && !eventId.startsWith('local-')) {
      const layoutRef = doc(db, 'events', eventId, 'layouts', currentUser.uid);
      unsubscribeLayout = onSnapshot(layoutRef, (layoutSnap) => {
        if (layoutSnap.exists()) {
          const layoutData = layoutSnap.data();
          if (!hasLoadedInitialTeams.current) {
            setPlacedTeams(layoutData.teams || []);
            setGuideLines(layoutData.guideLines || []);
            setMeasurements(layoutData.measurements || []);
            hasLoadedInitialTeams.current = true;
          }
        } else {
          // Brak własnego układu na serwerze - pusta, czysta karta na start!
          // Upewniamy się, że to odpowiedź z serwera, a nie pusty cache!
          if (!hasLoadedInitialTeams.current && !layoutSnap.metadata.fromCache) {
            setPlacedTeams([]);
            setGuideLines([]);
            setMeasurements([]);
            hasLoadedInitialTeams.current = true;
          }
        }
      });
    }

    return () => {
      clearTimeout(timeoutId);
      unsubscribeEvent();
      if (unsubscribeLayout) unsubscribeLayout();
    };
  }, [eventId, currentUser?.uid]);

  // ZADANIE 7: Ręczny zapis układu po kliknięciu przycisku "Zapisz układ"
  const handleSavePaddock = async () => {
    if (!eventId || eventId === 'demo') {
      setSaveStatus('saved');
      return;
    }
    if (eventId.startsWith('local-')) {
      try {
        setSaveStatus('saving');
        const current = JSON.parse(localStorage.getItem('local-event-' + eventId) || '{}');
        const updated = { ...current, teams: placedTeams, guideLines, measurements, updatedAt: Date.now() };
        localStorage.setItem('local-event-' + eventId, JSON.stringify(updated));
        setSaveStatus('saved');
      } catch (e) {
        setSaveStatus('error');
      }
      return;
    }
    try {
      setSaveStatus('saving');
      const data = {
        teams: placedTeams,
        guideLines,
        measurements,
        updatedAt: serverTimestamp(),
      };

      const writePromise = currentUser
        ? setDoc(doc(db, 'events', eventId, 'layouts', currentUser.uid), data)
        : updateDoc(doc(db, 'events', eventId), data);

      // Nie czekamy (await) na pełną synchronizację, bo przy słabym internecie
      // Firebase kolejkuje to w cache i promise może wisieć. Zamiast tego łapiemy ewentualny błąd w tle.
      writePromise.catch((err) => {
        console.error('Błąd zapisu w tle do Firestore:', err);
        setSaveStatus('error');
      });

      setSaveStatus('saved');
      setToastMessage('Projekt został pomyślnie zapisany!');
      setTimeout(() => setToastMessage(''), 3500);
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
    if (eventId.startsWith('local-')) {
      setSaveStatus('pending');
      const timer = setTimeout(() => {
        try {
          setSaveStatus('saving');
          const current = JSON.parse(localStorage.getItem('local-event-' + eventId) || '{}');
          const updated = { ...current, teams: placedTeams, guideLines, measurements, updatedAt: Date.now() };
          localStorage.setItem('local-event-' + eventId, JSON.stringify(updated));
          setSaveStatus('saved');
        } catch (e) {
          setSaveStatus('error');
        }
      }, 500);
      return () => clearTimeout(timer);
    }

    setSaveStatus('pending');
    const timer = setTimeout(() => {
      try {
        setSaveStatus('saving');
        const data = {
          teams: placedTeams,
          guideLines,
          measurements,
          updatedAt: serverTimestamp(),
        };

        const writePromise = currentUser
          ? setDoc(doc(db, 'events', eventId, 'layouts', currentUser.uid), data)
          : updateDoc(doc(db, 'events', eventId), data);
        
        writePromise.catch((err) => {
          console.error('Błąd automatycznego zapisu układu w tle:', err);
          setSaveStatus('error');
        });

        setSaveStatus('saved');
      } catch (err) {
        console.error('Błąd automatycznego zapisu układu:', err);
        setSaveStatus('error');
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [placedTeams, guideLines, measurements, eventId]);

  // Obsługa kliknięcia "+" w katalogu teamów -> dodaje na wolne miejsce w pobliżu środka sceny
  const handleSelectTeamFromCatalog = (teamTemplate) => {
    if (!eventData) return;

    const widthMeters = teamTemplate.width || teamTemplate.widthMeters || 10;
    const heightMeters = teamTemplate.length || teamTemplate.heightMeters || 15;

    // Umieść na środku fizycznego toru
    const physicalWidth = eventData.widthMeters || 250;
    const physicalHeight = eventData.heightMeters || 180;
    const imgW = 1024;
    const ppm = imgW / physicalWidth;

    let targetX = (physicalWidth * ppm) / 2;
    let targetY = (physicalHeight * ppm) / 2;

    if (getViewportCenterRef.current) {
      const center = getViewportCenterRef.current();
      if (center && typeof center.x === 'number' && !isNaN(center.x)) {
        targetX = center.x;
        targetY = center.y;
      }
    }

    let newTeamNode = {
      id: 'team_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      templateId: teamTemplate.id || 'custom',
      name: teamTemplate.name || 'Zespól Wyścigowy',
      color: teamTemplate.color || '#3b82f6',
      widthMeters,
      heightMeters,
      x: targetX - (widthMeters * ppm) / 2,
      y: targetY - (heightMeters * ppm) / 2,
      rotation: 0,
      elements: teamTemplate.elements || [],
      isLocked: teamTemplate.isLocked !== undefined ? teamTemplate.isLocked : true,
    };

    const isDuplicate = placedTeams.some(
      (t) => t.templateId === newTeamNode.templateId || (t.name && newTeamNode.name && t.name.trim().toLowerCase() === newTeamNode.name.trim().toLowerCase())
    );
    if (isDuplicate) {
      setPendingDuplicateNode({ template: teamTemplate, isFromCatalog: true, ppm });
      return;
    }

    if (!allowCollisions) {
      newTeamNode = findCleanSpotForNode(newTeamNode, placedTeams, ppm);
    }
    if (enableMagnet) {
      const snapped = findMagneticSnapPosition(newTeamNode, placedTeams, ppm, 4.0);
      if (snapped) {
        newTeamNode = { ...newTeamNode, x: snapped.x, y: snapped.y, rotation: snapped.rotation !== undefined ? snapped.rotation : newTeamNode.rotation };
      }
    }

    const updated = [...placedTeams, newTeamNode];
    setPlacedTeams(updated);
    setSelectedTeamId(newTeamNode.id);
  };

  const handleConfirmDuplicate = () => {
    if (!pendingDuplicateNode) return;
    if (pendingDuplicateNode.isFromCatalog) {
      const { template, ppm } = pendingDuplicateNode;
      const widthMeters = template.width || template.widthMeters || 10;
      const heightMeters = template.length || template.heightMeters || 15;
      const physicalWidth = eventData?.widthMeters || 250;
      const physicalHeight = eventData?.heightMeters || 180;
      const currentPpm = ppm || 1024 / physicalWidth;

      let targetX = (physicalWidth * currentPpm) / 2;
      let targetY = (physicalHeight * currentPpm) / 2;

      if (getViewportCenterRef.current) {
        const center = getViewportCenterRef.current();
        if (center && typeof center.x === 'number' && !isNaN(center.x)) {
          targetX = center.x;
          targetY = center.y;
        }
      }

      let newTeamNode = {
        id: 'team_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        templateId: template.id || 'custom',
        name: template.name || 'Zespól Wyścigowy',
        color: template.color || '#3b82f6',
        widthMeters,
        heightMeters,
        x: targetX - (widthMeters * currentPpm) / 2,
        y: targetY - (heightMeters * currentPpm) / 2,
        rotation: 0,
        elements: template.elements || [],
        isLocked: template.isLocked !== undefined ? template.isLocked : true,
      };

      if (!allowCollisions) {
        newTeamNode = findCleanSpotForNode(newTeamNode, placedTeams, currentPpm);
      }
      if (enableMagnet) {
        const snapped = findMagneticSnapPosition(newTeamNode, placedTeams, currentPpm, 4.0);
        if (snapped) {
          newTeamNode = { ...newTeamNode, x: snapped.x, y: snapped.y, rotation: snapped.rotation !== undefined ? snapped.rotation : newTeamNode.rotation };
        }
      }

      setPlacedTeams((prev) => [...prev, newTeamNode]);
      setSelectedTeamId(newTeamNode.id);
    } else if (pendingDuplicateNode.node) {
      setPlacedTeams((prev) => [...prev, pendingDuplicateNode.node]);
      setSelectedTeamId(pendingDuplicateNode.node.id);
    }
    setPendingDuplicateNode(null);
  };

  const handleUpdateTemplate = (updatedTemplate) => {
    setPlacedTeams((prev) =>
      prev.map((t) => {
        if (t.templateId === updatedTemplate.id) {
          return {
            ...t,
            name: updatedTemplate.name || t.name,
            widthMeters: updatedTemplate.width || t.widthMeters,
            heightMeters: updatedTemplate.length || t.heightMeters,
            color: updatedTemplate.color || t.color,
            elements: updatedTemplate.elements || t.elements,
            isLocked: updatedTemplate.isLocked !== undefined ? updatedTemplate.isLocked : t.isLocked,
          };
        }
        return t;
      })
    );
  };

  const handleExportJPG = async () => {
    if (!canvasRef.current || isExporting) return;
    setIsExporting(true);
    try {
      const dataUrl = await canvasRef.current.exportAsImage();
      if (!dataUrl) {
        alert('Nie udało się wygenerować obrazu padoku.');
        setIsExporting(false);
        return;
      }
      const link = document.createElement('a');
      link.download = `padok_${eventData?.name || eventId}.jpg`;
      const img = new window.Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        link.href = c.toDataURL('image/jpeg', 0.92);
        link.click();
        setIsExporting(false);
      };
      img.onerror = () => {
        alert('Błąd konwersji do JPG.');
        setIsExporting(false);
      };
      img.src = dataUrl;
    } catch (err) {
      console.error('Błąd eksportu JPG:', err);
      alert('Wystąpił błąd podczas pobierania JPG.');
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    if (!canvasRef.current || isExporting) return;
    setIsExporting(true);
    try {
      const dataUrl = await canvasRef.current.exportAsImage();
      if (!dataUrl) {
        alert('Nie udało się wygenerować obrazu padoku dla PDF.');
        setIsExporting(false);
        return;
      }
      const { jsPDF } = await import('jspdf');
      const img = new window.Image();
      img.onload = () => {
        const imgW = img.width;
        const imgH = img.height;
        const orientation = imgW > imgH ? 'landscape' : 'portrait';
        const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const margin = 8;
        const maxW = pageW - margin * 2;
        const maxH = pageH - margin * 2;
        const scale = Math.min(maxW / imgW, maxH / imgH);
        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const offsetX = (pageW - drawW) / 2;
        const offsetY = (pageH - drawH) / 2;
        pdf.addImage(dataUrl, 'PNG', offsetX, offsetY, drawW, drawH);
        pdf.save(`padok_${eventData?.name || eventId}.pdf`);
        setIsExporting(false);
      };
      img.onerror = () => {
        alert('Błąd generowania PDF.');
        setIsExporting(false);
      };
      img.src = dataUrl;
    } catch (err) {
      console.error('Błąd eksportu PDF:', err);
      alert('Wystąpił błąd podczas tworzenia pliku PDF.');
      setIsExporting(false);
    }
  };

  const handleUpdateTeams = (newTeams) => {
    // Sprawdzamy czy układ elementów w zespole uległ zmianie (np. przez D-Pad na płótnie)
    // Jeśli tak, aktualizujemy szablon w katalogu (teams_templates)
    newTeams.forEach(newTeam => {
      const oldTeam = placedTeams.find(t => t.id === newTeam.id);
      if (oldTeam && oldTeam.templateId) {
        const oldElementsStr = JSON.stringify(oldTeam.elements || []);
        const newElementsStr = JSON.stringify(newTeam.elements || []);
        if (oldElementsStr !== newElementsStr) {
          try {
            updateDoc(doc(db, 'teams_templates', newTeam.templateId), {
              elements: newTeam.elements,
              updatedAt: serverTimestamp()
            }).catch(console.error);
          } catch (e) {
            console.error('Błąd przy aktualizacji szablonu', e);
          }
        }
      }
    });
    setPlacedTeams(newTeams);
  };

  return (
    <div className="relative h-full w-full flex items-center justify-center overflow-hidden bg-slate-950">
      {/* Centralna Scena PaddockCanvas (Zadania 5 i 6) */}
      <PaddockCanvas
        ref={canvasRef}
        eventData={eventData}
        placedTeams={placedTeams}
        onUpdateTeams={handleUpdateTeams}
        guideLines={guideLines}
        onUpdateGuideLines={setGuideLines}
        measurements={measurements}
        onUpdateMeasurements={setMeasurements}
        selectedTeamId={selectedTeamId}
        onSelectTeam={setSelectedTeamId}
        allowCollisions={allowCollisions}
        onToggleCollisions={() => setAllowCollisions((v) => !v)}
        enableMagnet={enableMagnet}
        onToggleMagnet={() => setEnableMagnet((v) => !v)}
        getViewportCenterRef={getViewportCenterRef}
        onScaleReport={setScalePx}
        onRequestDuplicateConfirm={(node) => setPendingDuplicateNode({ node, isFromCatalog: false })}
      />

      {/* ZADANIE: Górny panel szklany przeniesiony na lewą stronę w pionie (Pionowy Panel HUD po lewej) */}
      <header className={`absolute top-4 left-4 z-40 transition-all duration-500 ease-out pointer-events-none ${isLeftHudCollapsed ? 'w-12' : 'w-60'}`}>
        <div className="glass-panel flex flex-col gap-0 pointer-events-auto shadow-glass-lg border-white/25 overflow-hidden">
          
          {/* Header z przyciskiem zwijania */}
          <div className="p-3 flex items-center justify-between bg-transparent border-b border-white/10">
            {!isLeftHudCollapsed && (
              <span className="text-xs font-bold text-white/80 tracking-wider">HUD</span>
            )}
            <button
              onClick={() => setIsLeftHudCollapsed(!isLeftHudCollapsed)}
              className="p-1.5 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors mx-auto"
              title={isLeftHudCollapsed ? 'Rozwiń HUD' : 'Zwiń HUD'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-4 h-4 transition-transform duration-300 ${isLeftHudCollapsed ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Rozwinięta zawartość */}
          <div className={`grid transition-all duration-500 ease-in-out ${isLeftHudCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
            <div className="overflow-hidden">
              <div className="flex flex-col gap-4 p-4 min-w-[240px]">
          {/* Przycisk Powrót na Globus */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-white/70 hover:text-white transition-colors duration-200 text-xs font-medium w-full pb-3 border-b border-white/15 shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            <span>Powrót na Globus</span>
          </button>

          {/* Nazwa i wymiary toru w pionowym układzie */}
          <div className="flex flex-col gap-1 text-left">
            <h2 className="text-sm font-bold text-white tracking-wide leading-snug break-words">
              {isLoadingEvent ? 'Ładowanie eventu...' : eventData ? eventData.name : eventId}
            </h2>
            {eventData && (
              <p className="text-[11px] font-mono text-emerald-300">
                Tor: {Math.round(eventData.widthMeters)} × {Math.round(eventData.heightMeters || eventData.widthMeters)} m
              </p>
            )}

            {/* Przeniesiona Skala i Ilość Teamów (zgodnie ze zdjęciem) */}
            <div className="mt-2 flex flex-col gap-1 text-[11px] font-mono bg-[#060a13]/40 p-2.5 rounded-xl border border-white/15 shadow-inner">
              <div className="flex items-center justify-between text-emerald-300/95">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span>Skala:</span>
                </span>
                <span className="font-bold">{scalePx ? `${scalePx.toFixed(2)} px/m` : '---'}</span>
              </div>
              <div className="flex items-center justify-between text-indigo-300/95">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                  <span>Teamów:</span>
                </span>
                <span className="font-bold">{placedTeams.length} szt.</span>
              </div>
            </div>
          </div>

          {/* Przycisk Usuń zaznaczony zespół */}
          {selectedTeamId && (
            <button
              onClick={() => {
                setPlacedTeams(placedTeams.filter((t) => t.id !== selectedTeamId));
                setSelectedTeamId(null);
              }}
              className="w-full py-2 px-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-xs flex items-center justify-center gap-1.5 transition-all shadow"
              title="Usuń zaznaczony zespół z toru"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
              </svg>
              <span>Usuń zaznaczony</span>
            </button>
          )}

          {/* Przycisk Ręcznego Zapisu */}
          <button
            onClick={handleSavePaddock}
            disabled={saveStatus === 'saving'}
            className="glass-button-primary w-full py-2.5 text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50"
            title="Zapisz obecny układ padoku w bazie (działa również offline)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            <span>Zapisz układ</span>
          </button>

          {/* Wskaźnik stanu zapisu w chmurze / lokalnie */}
          <div className="flex items-center justify-center gap-2 text-[11px] font-mono px-3 py-2 rounded-xl border transition-all duration-300 bg-[#060a13]/40 border-white/20 text-center">
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

          {/* EKSPORT PADOKU: Tylko na dole lewego górnego panelu szklanego */}
          <div className="flex items-center gap-2 pt-2 border-t border-white/15">
            <button
              onClick={handleExportJPG}
              disabled={isExporting}
              className="flex-1 py-2 px-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow active:scale-95 disabled:opacity-50"
              title="Pobierz zdjęcie padoku jako plik JPG"
            >
              <span>📸 JPG</span>
            </button>

            <button
              onClick={handleExportPDF}
              disabled={isExporting}
              className="flex-1 py-2 px-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow active:scale-95 disabled:opacity-50"
              title="Pobierz dokument padoku jako plik PDF"
            >
              <span>📄 PDF</span>
            </button>
          </div>
              </div>
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
      <TeamCatalog onSelectTeam={handleSelectTeamFromCatalog} onUpdateTemplate={handleUpdateTemplate} />

      {/* Modal powiadomienia o ponownym dodaniu istniejącego już zespołu */}
      <DuplicateTeamModal
        isOpen={!!pendingDuplicateNode}
        onClose={() => setPendingDuplicateNode(null)}
        onConfirm={handleConfirmDuplicate}
        teamName={pendingDuplicateNode?.template?.name || pendingDuplicateNode?.node?.name || 'Zespól Wyścigowy'}
      />

      {/* Toast z powiadomieniem (np. o zapisie) */}
      {toastMessage && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="bg-emerald-500/90 text-white px-5 py-2.5 rounded-full text-sm font-semibold tracking-wide shadow-glass-strong border border-emerald-400/50 flex items-center gap-2 backdrop-blur-md">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            {toastMessage}
          </div>
        </div>
      )}
    </div>
  );
}

export default PlannerPage;
