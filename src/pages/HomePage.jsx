import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { calculateBoundsDimensionsMeters } from '../lib/geoUtils.js';

// Pełna baza najpopularniejszych torów wyścigowych w Polsce i Europie
export const TRACK_DATABASE = [
  { id: 'tor-poznan', name: 'Tor Poznań — Padok Główny', city: 'Poznań, Polska', coords: [16.7962, 52.4185], w: 250, h: 180, bbox: '16.7942,52.4170,16.7982,52.4200' },
  { id: 'silesia-ring', name: 'Silesia Ring — Padok Główny', city: 'Kamień Śląski, Polska', coords: [18.0960, 50.5330], w: 300, h: 200, bbox: '18.0930,50.5310,18.0990,50.5350' },
  { id: 'tor-modlin', name: 'Tor Modlin — Padok Sportowy', city: 'Modlin, Polska', coords: [20.6710, 52.4645], w: 200, h: 150, bbox: '20.6690,52.4630,20.6730,52.4660' },
  { id: 'tor-lodz', name: 'Tor Łódź — Ośrodek Doskonalenia', city: 'Stryków, Polska', coords: [19.5845, 51.8755], w: 180, h: 120, bbox: '19.5820,51.8740,19.5870,51.8770' },
  { id: 'tor-jastrzab', name: 'Autodrom Jastrząb — Padok', city: 'Jastrząb, Polska', coords: [20.9495, 51.2475], w: 220, h: 160, bbox: '20.9470,51.2460,20.9520,51.2490' },
  { id: 'tor-krakow', name: 'Moto Park Kraków — Padok', city: 'Kraków, Polska', coords: [20.0830, 50.0425], w: 160, h: 110, bbox: '20.0810,50.0410,20.0850,50.0440' },
  { id: 'nurburgring', name: 'Nürburgring GP — Grand Prix Paddock', city: 'Nürburg, Niemcy', coords: [6.9455, 50.3340], w: 350, h: 250, bbox: '6.9420,50.3320,6.9490,50.3360' },
  { id: 'spa', name: 'Circuit de Spa-Francorchamps — F1 Paddock', city: 'Stavelot, Belgia', coords: [5.9735, 50.4370], w: 400, h: 250, bbox: '5.9700,50.4350,5.9770,50.4390' },
  { id: 'monza', name: 'Autodromo Nazionale Monza — Paddock', city: 'Monza, Włochy', coords: [9.2875, 45.6190], w: 380, h: 240, bbox: '9.2840,45.6170,9.2910,45.6210' },
  { id: 'silverstone', name: 'Silverstone Circuit — Wing Paddock', city: 'Silverstone, Wielka Brytania', coords: [-1.0170, 52.0740], w: 420, h: 260, bbox: '-1.0210,52.0720,-1.0130,52.0760' }
];

function HomePage() {
  const navigate = useNavigate();
  const globeCanvasRef = useRef(null);
  const paddockMapContainerRef = useRef(null);
  const paddockMapInstanceRef = useRef(null);
  const viewfinderRef = useRef(null);

  // Wyszukiwarka torów i adresów
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(TRACK_DATABASE);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Stan lotu kamery i wybrany tor
  const [isFlying, setIsFlying] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [isCustomFramingMode, setIsCustomFramingMode] = useState(false);
  const [showCustomBoundsModal, setShowCustomBoundsModal] = useState(false);
  const [confirmedBounds, setConfirmedBounds] = useState(null);
  const [customEventName, setCustomEventName] = useState('');
  const [isSavingCustomEvent, setIsSavingCustomEvent] = useState(false);

  // Zmienne obrotu Globusu 3D w kosmosie
  const globeStateRef = useRef({
    rotX: 0.35,
    rotY: -0.4,
    targetRotX: 0.35,
    targetRotY: -0.4,
    zoom: 1,
    targetZoom: 1,
    isDragging: false,
    lastX: 0,
    lastY: 0,
  });

  // Wyszukiwanie na żywo (lokalna baza torów + darmowe geokodowanie OpenStreetMap Nominatim)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(TRACK_DATABASE);
      return;
    }

    const queryLower = searchQuery.toLowerCase();
    const localMatches = TRACK_DATABASE.filter(
      t => t.name.toLowerCase().includes(queryLower) || t.city.toLowerCase().includes(queryLower)
    );

    setSearchResults(localMatches);

    // Jeśli szukamy czegoś spoza bazy, odpytaj darmowe API Nominatim (OpenStreetMap) po 400ms
    const timer = setTimeout(async () => {
      if (searchQuery.length >= 3) {
        setIsSearchingOnline(true);
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=4`,
            { headers: { 'Accept-Language': 'pl,en;q=0.9' } }
          );
          if (resp.ok) {
            const data = await resp.json();
            const osmResults = data.map((item, idx) => ({
              id: `osm-${item.place_id || idx}`,
              name: item.display_name.split(',')[0] + (item.display_name.split(',')[1] ? ` (${item.display_name.split(',')[1].trim()})` : ''),
              city: item.display_name.split(',').slice(-2).join(', ').trim(),
              coords: [parseFloat(item.lon), parseFloat(item.lat)],
              w: 250,
              h: 180,
              bbox: `${parseFloat(item.lon)-0.003},${parseFloat(item.lat)-0.002},${parseFloat(item.lon)+0.003},${parseFloat(item.lat)+0.002}`,
              isCustomAddress: true
            }));
            setSearchResults(prev => [
              ...prev.filter(p => !p.isCustomAddress),
              ...osmResults
            ]);
          }
        } catch (err) {
          console.warn('Błąd wyszukiwania Nominatim:', err);
        } finally {
          setIsSearchingOnline(false);
        }
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Efekt kinowego zejścia z kosmosu na dany adres toru
  const triggerCinematicZoomToTrack = (track) => {
    setShowDropdown(false);
    setSelectedTrack(track);
    setIsFlying(true);
    setHasArrived(false);
    setIsCustomFramingMode(false);
    setShowCustomBoundsModal(false);

    // Wylicz kąty obrotu sfery tak, by wybrany tor znalazł się dokładnie na środku globusu
    const [lng, lat] = track.coords;
    const targetY = -(lng * Math.PI) / 180 - Math.PI / 2;
    const targetX = (lat * Math.PI) / 180;

    globeStateRef.current.targetRotY = targetY;
    globeStateRef.current.targetRotX = targetX;
    globeStateRef.current.targetZoom = 8; // Kinowe przybliżenie ze sfery w kosmosie

    setTimeout(() => {
      setIsFlying(false);
      setHasArrived(true);
    }, 1200);
  };

  // Renderowanie kinowej Kuli Ziemskiej w kosmosie (60 FPS, Zero Mapboxa, Zero błędów 403)
  useEffect(() => {
    if (hasArrived) return;
    const canvas = globeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    // Generowanie gwiazd w przestrzeni kosmicznej
    const stars = Array.from({ length: 220 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 1.8 + 0.4,
      alpha: Math.random() * 0.8 + 0.2,
      speed: (Math.random() - 0.5) * 0.002,
    }));

    let startTime = performance.now();

    const render = (now) => {
      const elapsed = (now - startTime) * 0.001;
      const width = canvas.width = window.innerWidth;
      const height = canvas.height = window.innerHeight;

      // Płynna interpolacja (lerp) obrotu i przybliżenia
      const state = globeStateRef.current;
      if (!state.isDragging && !isFlying) {
        state.targetRotY += 0.0012; // Delikatny auto-obrót ziemi w kosmosie
      }
      state.rotX += (state.targetRotX - state.rotX) * 0.08;
      state.rotY += (state.targetRotY - state.rotY) * 0.08;
      state.zoom += (state.targetZoom - state.zoom) * 0.08;

      // Czyszczenie tła (kosmiczna głębia wszechświata)
      ctx.fillStyle = '#040611';
      ctx.fillRect(0, 0, width, height);

      // Rysowanie i migotanie gwiazd
      stars.forEach(star => {
        const sx = star.x * width;
        const sy = star.y * height;
        const alpha = Math.min(1, Math.max(0.1, star.alpha + Math.sin(elapsed * 2 + star.x * 10) * 0.3));
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Parametry sfery Ziemi
      const centerX = width / 2;
      const centerY = height / 2;
      const baseRadius = Math.min(width, height) * 0.32 * state.zoom;

      if (baseRadius <= 0) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      // Poświata atmosfery (zewnętrzna aura w kosmosie)
      const atmosGrad = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.85, centerX, centerY, baseRadius * 1.25);
      atmosGrad.addColorStop(0, 'rgba(59, 130, 246, 0.45)');
      atmosGrad.addColorStop(0.6, 'rgba(79, 70, 229, 0.15)');
      atmosGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = atmosGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 1.25, 0, Math.PI * 2);
      ctx.fill();

      // Korpus Ziemi (sfera oceanów z głębokim cieniowaniem 3D)
      const earthGrad = ctx.createRadialGradient(centerX - baseRadius * 0.3, centerY - baseRadius * 0.3, baseRadius * 0.1, centerX, centerY, baseRadius);
      earthGrad.addColorStop(0, '#1e3a8a');
      earthGrad.addColorStop(0.7, '#0f172a');
      earthGrad.addColorStop(1, '#020617');
      ctx.fillStyle = earthGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
      ctx.fill();

      // Siatka kontynentalna i linie długości/szerokości geograficznej Ziemi w 3D
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.18)';
      ctx.lineWidth = 1;

      // Równoleżniki (lat)
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        const radLat = (lat * Math.PI) / 180;
        const rLat = baseRadius * Math.cos(radLat);
        const yOffset = -baseRadius * Math.sin(radLat) * Math.sin(state.rotX);
        const scaleY = Math.abs(Math.cos(state.rotX)) * 0.28;
        ctx.ellipse(centerX, centerY + yOffset, rLat, rLat * scaleY, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Południki (lng)
      for (let lng = 0; lng < 360; lng += 30) {
        ctx.beginPath();
        const radLng = ((lng + state.rotY * (180 / Math.PI)) * Math.PI) / 180;
        const xOffset = baseRadius * Math.sin(radLng);
        const scaleX = Math.abs(Math.cos(radLng)) * 0.28;
        ctx.ellipse(centerX + xOffset, centerY, baseRadius * scaleX, baseRadius, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Rysowanie świecących markerów wszystkich torów wyścigowych na sferze Ziemi
      TRACK_DATABASE.forEach(track => {
        const [tlng, tlat] = track.coords;
        const phi = ((90 - tlat) * Math.PI) / 180;
        const theta = ((tlng + 180) * Math.PI) / 180 + state.rotY;

        // Obliczenia rzutu 3D na sferę
        const x3d = baseRadius * Math.sin(phi) * Math.cos(theta);
        const y3d = baseRadius * Math.cos(phi);
        const z3d = baseRadius * Math.sin(phi) * Math.sin(theta);

        // Rotacja po osi X (nachylenie sfery)
        const cosX = Math.cos(state.rotX);
        const sinX = Math.sin(state.rotX);
        const yRot = y3d * cosX - z3d * sinX;
        const zRot = y3d * sinX + z3d * cosX;

        // Jeśli tor znajduje się po przedniej stronie sfery (zRot > -50), narysuj znacznik na globusie!
        if (zRot > -baseRadius * 0.15) {
          const screenX = centerX + x3d;
          const screenY = centerY - yRot;
          const markerScale = (zRot / baseRadius + 1) * 0.55;

          // Pulsowanie neonowe tarczy
          const pulse = (Math.sin(elapsed * 4) + 1) * 4 + 4;
          ctx.fillStyle = selectedTrack?.id === track.id ? 'rgba(239, 68, 68, 0.35)' : 'rgba(99, 102, 241, 0.3)';
          ctx.beginPath();
          ctx.arc(screenX, screenY, (8 + pulse) * markerScale, 0, Math.PI * 2);
          ctx.fill();

          // Kropka centralna
          ctx.fillStyle = selectedTrack?.id === track.id ? '#ef4444' : '#38bdf8';
          ctx.beginPath();
          ctx.arc(screenX, screenY, 5 * markerScale, 0, Math.PI * 2);
          ctx.fill();

          // Podpis toru
          ctx.font = `bold ${Math.max(10, Math.floor(12 * markerScale))}px sans-serif`;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.fillText(`🚀 ${track.name.split('—')[0].trim()}`, screenX + 10, screenY + 4);
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    // Obsługa myszy do obracania globusu w kosmosie
    const handleMouseDown = (e) => {
      globeStateRef.current.isDragging = true;
      globeStateRef.current.lastX = e.clientX;
      globeStateRef.current.lastY = e.clientY;
    };
    const handleMouseMove = (e) => {
      if (!globeStateRef.current.isDragging) return;
      const dx = e.clientX - globeStateRef.current.lastX;
      const dy = e.clientY - globeStateRef.current.lastY;
      globeStateRef.current.targetRotY += dx * 0.005;
      globeStateRef.current.targetRotX = Math.max(-1.2, Math.min(1.2, globeStateRef.current.targetRotX + dy * 0.005));
      globeStateRef.current.lastX = e.clientX;
      globeStateRef.current.lastY = e.clientY;
    };
    const handleMouseUp = () => {
      globeStateRef.current.isDragging = false;
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [hasArrived, isFlying, selectedTrack]);

  // Inicjalizacja w pełni interaktywnej mapy satelitarnej Esri po wylądowaniu nad torem (Możliwość swobodnego przesuwania kamery i zoomu)
  useEffect(() => {
    if (!hasArrived || !selectedTrack) {
      if (paddockMapInstanceRef.current) {
        paddockMapInstanceRef.current.remove();
        paddockMapInstanceRef.current = null;
      }
      return;
    }

    const initMap = () => {
      if (!paddockMapContainerRef.current || paddockMapInstanceRef.current) return;
      const L = window.L;
      if (!L) return;

      const [lng, lat] = selectedTrack.coords;
      const map = L.map(paddockMapContainerRef.current, {
        center: [lat, lng],
        zoom: selectedTrack.isCustomAddress ? 16 : 17,
        zoomControl: false,
        attributionControl: false,
      });

      paddockMapInstanceRef.current = map;

      // Kafelki satelitarne Esri / ArcGIS World Imagery (100% darmowe, wysoka rozdzielczość, brak blokad CORS i kluczy API)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
      }).addTo(map);

      // Kontrolki zoomu po prawej stronie
      L.control.zoom({ position: 'top-right' }).addTo(map);

      // Pulsacyjny znacznik centrum toru
      const markerHtml = `
        <div style="position: relative; display: flex; align-items: center; justify-content: center;">
          <div style="width: 36px; height: 36px; background: rgba(239, 68, 68, 0.35); border-radius: 50%; border: 2px solid #ef4444; box-shadow: 0 0 15px rgba(239,68,68,0.8);"></div>
          <div style="position: absolute; width: 12px; height: 12px; background: #ef4444; border-radius: 50%;"></div>
        </div>
      `;
      const customIcon = L.divIcon({
        className: 'custom-track-marker',
        html: markerHtml,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      L.marker([lat, lng], { icon: customIcon }).addTo(map);
    };

    if (!window.L) {
      // Automatyczne załadowanie biblioteki i stylów Leaflet z szybkiego CDN unpkg
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      if (!document.getElementById('leaflet-js')) {
        const script = document.createElement('script');
        script.id = 'leaflet-js';
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => {
          initMap();
        };
        document.head.appendChild(script);
      }
    } else {
      initMap();
    }

    return () => {
      if (paddockMapInstanceRef.current) {
        paddockMapInstanceRef.current.remove();
        paddockMapInstanceRef.current = null;
      }
    };
  }, [hasArrived, selectedTrack]);

  // Obsługa zatwierdzenia własnego obszaru z celownika (odczyt z interaktywnej mapy Leaflet)
  const handleConfirmCustomBounds = () => {
    if (!selectedTrack) return;
    const map = paddockMapInstanceRef.current;

    let boundsObj;
    if (map) {
      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const center = map.getCenter();
      boundsObj = {
        sw: [sw.lng, sw.lat],
        ne: [ne.lng, ne.lat],
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
      };
    } else {
      const coords = selectedTrack.coords;
      boundsObj = {
        sw: [coords[0] - 0.003, coords[1] - 0.002],
        ne: [coords[0] + 0.003, coords[1] + 0.002],
        center: coords,
        zoom: 17,
      };
    }

    setConfirmedBounds(boundsObj);
    setCustomEventName(selectedTrack.name);
    setShowCustomBoundsModal(true);
  };

  // Zapis własnego obszaru z celownika do Firestore
  const handleSaveCustomEventAndOpen = async () => {
    if (!confirmedBounds || isSavingCustomEvent) return;

    try {
      setIsSavingCustomEvent(true);
      const dimensions = calculateBoundsDimensionsMeters(confirmedBounds);
      const bboxStr = `${confirmedBounds.sw[0]},${confirmedBounds.sw[1]},${confirmedBounds.ne[0]},${confirmedBounds.ne[1]}`;
      const esriStaticUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bboxStr}&bboxSR=4326&size=1024,1024&imageSR=4326&format=png&f=image`;

      const eventData = {
        name: customEventName.trim() || 'Własny Padok',
        imageUrl: esriStaticUrl,
        widthMeters: dimensions.widthMeters || 250,
        heightMeters: dimensions.heightMeters || 180,
        bounds: confirmedBounds,
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'events'), eventData);
      navigate(`/planner/${docRef.id}`);
    } catch (error) {
      console.error('Błąd zapisu w Firestore:', error);
      alert('Nie udało się zapisać nowego układu.');
    } finally {
      setIsSavingCustomEvent(false);
    }
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-slate-950 font-sans select-none">
      {/* Kula Ziemska 3D w kosmosie (Gdy jesteśmy przed lądowaniem na torze) */}
      {!hasArrived && (
        <canvas
          ref={globeCanvasRef}
          className="absolute inset-0 z-0 w-full h-full cursor-grab active:cursor-grabbing"
        />
      )}

      {/* Interaktywna mapa satelitarna Esri z lotu ptaka (Pełna swoboda ruchu kamery - Pan & Zoom) */}
      {hasArrived && selectedTrack && (
        <div className="absolute inset-0 z-0 bg-slate-950 animate-fade-in">
          <div ref={paddockMapContainerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/60 pointer-events-none z-[400]" />
        </div>
      )}

      {/* Górny / Lewy Szklany Panel Katalogu i Wyszukiwarki Torów */}
      <div className="absolute top-5 left-5 z-30 w-full max-w-sm sm:max-w-md px-2 pointer-events-auto">
        <div className="glass-panel-strong p-4 rounded-2xl shadow-2xl border-white/25 backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
              </div>
              <div>
                <h1 className="text-xs sm:text-sm font-extrabold text-white tracking-wide">
                  GLOBUS PADOK PLANNER
                </h1>
                <p className="text-[10px] text-indigo-300/80 font-mono">
                  Zejście satelitarne 3D z kosmosu
                </p>
              </div>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              placeholder="🔍 Wpisz nazwę toru lub adres (np. Tor Poznań)..."
              className="w-full bg-black/50 border border-white/20 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-white/50 focus:outline-none focus:border-indigo-400 transition-all font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-xs p-1"
              >
                ✕
              </button>
            )}
          </div>

          {/* Rozwijana lista torów (Katalog w bazie + Wyniki) */}
          {(showDropdown || !selectedTrack || !hasArrived) && (
            <div className="mt-3 max-h-[38vh] overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
              <div className="text-[10px] font-bold text-white/60 tracking-wider uppercase px-1 py-0.5 flex justify-between">
                <span>{searchQuery ? 'Wyniki wyszukiwania:' : 'Baza Torów Wyścigowych:'}</span>
                {isSearchingOnline && <span className="text-indigo-400 animate-pulse">Szukanie w świecie...</span>}
              </div>

              {searchResults.map((track) => (
                <button
                  key={track.id}
                  onClick={() => triggerCinematicZoomToTrack(track)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between group ${
                    selectedTrack?.id === track.id && hasArrived
                      ? 'bg-indigo-600/30 border-indigo-400/80 shadow-[0_0_15px_rgba(99,102,241,0.25)]'
                      : 'bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors truncate">
                      {track.name}
                    </p>
                    <p className="text-[10px] text-white/50 font-mono truncate">
                      {track.city} • {track.w}×{track.h}m
                    </p>
                  </div>
                  <div className="w-6 h-6 rounded-lg bg-white/10 group-hover:bg-indigo-500/30 flex items-center justify-center text-white/70 group-hover:text-white shrink-0 transition-all">
                    🚀
                  </div>
                </button>
              ))}

              {searchResults.length === 0 && !isSearchingOnline && (
                <div className="text-center py-4 text-xs text-white/50">
                  Nie znaleziono toru. Wpisz dowolną miejscowość, aby przybliżyć mapę z kosmosu!
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Cinematic Flight Status Banner (Zejście zoomowe z Księżyca) */}
      {isFlying && (
        <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-[2px] pointer-events-none flex flex-col items-center justify-center animate-fade-in">
          <div className="glass-panel-strong px-8 py-5 rounded-2xl flex items-center gap-4 border-indigo-400/40 shadow-[0_0_50px_rgba(99,102,241,0.3)]">
            <div className="w-9 h-9 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <div className="text-left">
              <h4 className="font-extrabold text-white text-base sm:text-lg tracking-wide">
                Zejście z kosmosu na tor...
              </h4>
              <p className="text-xs text-indigo-300/90 font-mono">
                {selectedTrack ? selectedTrack.name : 'Przybliżanie satelitarne...'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Dolny Panel Akcji po wylądowaniu na torze */}
      {hasArrived && selectedTrack && !showCustomBoundsModal && !isCustomFramingMode && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-lg px-4 pointer-events-auto animate-slide-up">
          <div className="glass-panel-strong p-5 rounded-2xl border-indigo-400/50 shadow-[0_0_40px_rgba(79,46,229,0.35)] flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left min-w-0">
              <span className="inline-block px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold mb-1">
                ✔ CEL OSIĄGNIĘTY
              </span>
              <h3 className="text-sm sm:text-base font-extrabold text-white truncate">
                {selectedTrack.name}
              </h3>
              <p className="text-xs text-white/60 font-mono">
                Wymiary padoku: {selectedTrack.w} × {selectedTrack.h} m
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              <button
                onClick={() => {
                  setHasArrived(false);
                  globeStateRef.current.targetZoom = 1;
                }}
                title="Wróć do widoku kuli ziemskiej z kosmosu"
                className="glass-button px-3.5 py-2.5 text-xs text-white/80 hover:text-white"
              >
                🌍 Globus
              </button>
              <button
                onClick={() => setIsCustomFramingMode(true)}
                title="Dopasuj ręcznie celownik obszaru na interaktywnej mapie"
                className="glass-button px-3.5 py-2.5 text-xs text-white/80 hover:text-white"
              >
                📐 Kadruj
              </button>
              <button
                onClick={() => {
                  if (!selectedTrack.isCustomAddress) {
                    navigate(`/planner/${selectedTrack.id}`);
                  } else {
                    handleConfirmCustomBounds();
                  }
                }}
                className="glass-button-primary px-5 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-lg w-full sm:w-auto"
              >
                <span>Zaplanuj Padok</span>
                <span className="text-base">🚀</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Celownik HUD - gdy użytkownik włączy tryb kadrowania i przesuwa interaktywną mapę */}
      {hasArrived && isCustomFramingMode && (
        <>
          <div className="absolute inset-0 z-[450] pointer-events-none flex items-center justify-center p-4">
            <div
              ref={viewfinderRef}
              className="w-[85vw] max-w-[460px] h-[60vh] max-h-[520px] border-2 border-emerald-400/80 rounded-3xl bg-emerald-500/10 backdrop-blur-[1px] shadow-[0_0_60px_rgba(16,185,129,0.25)] flex flex-col justify-between p-5 relative animate-fade-in"
            >
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-emerald-300 rounded-tl-2xl -translate-x-1 -translate-y-1" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-emerald-300 rounded-tr-2xl translate-x-1 -translate-y-1" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-emerald-300 rounded-bl-2xl -translate-x-1 translate-y-1" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-emerald-300 rounded-br-2xl translate-x-1 translate-y-1" />

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center opacity-60">
                <div className="w-full h-[1px] bg-emerald-400 absolute" />
                <div className="h-full w-[1px] bg-emerald-400 absolute" />
              </div>

              <div className="self-center bg-black/60 px-3 py-1 rounded-full border border-emerald-400/40 text-[11px] font-mono text-emerald-300">
                🎯 KADROWANIE OBSZARU PADOKU
              </div>

              <div className="text-center bg-black/60 px-3 py-1.5 rounded-xl border border-white/10 text-xs text-white/90">
                Przesuń mapę tak, by padok był w centrum celownika
              </div>
            </div>
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 pointer-events-auto animate-slide-up">
            <button
              onClick={() => setIsCustomFramingMode(false)}
              className="glass-button py-3 px-5 text-xs text-white/80"
            >
              Anuluj kadrowanie
            </button>
            <button
              onClick={handleConfirmCustomBounds}
              className="glass-button-primary px-7 py-3 text-xs sm:text-sm font-bold flex items-center gap-2"
            >
              <span>Zatwierdź ten kadrowany obszar</span>
              <span>✔</span>
            </button>
          </div>
        </>
      )}

      {/* Modal Zapisywania Niestandardowego Kadru (Zadanie 4 - Haversine) */}
      {showCustomBoundsModal && confirmedBounds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in pointer-events-auto">
          <div className="glass-panel-strong w-full max-w-md p-6 sm:p-8 rounded-3xl border-white/30 shadow-2xl relative animate-slide-up">
            <button
              onClick={() => setShowCustomBoundsModal(false)}
              className="absolute top-5 right-5 text-white/50 hover:text-white text-sm"
            >
              ✕
            </button>

            <h3 className="text-lg font-bold text-white mb-2">
              🏎️ Potwierdź Strefę Padoku
            </h3>
            <p className="text-xs text-white/60 mb-5">
              Wymiary fizyczne obliczone automatycznie wzorem Haversine'a.
            </p>

            {/* Podsumowanie wymiarów */}
            <div className="bg-black/50 rounded-xl p-3.5 border border-emerald-400/30 font-mono text-xs text-white/90 mb-5 space-y-1.5">
              <div className="flex justify-between font-bold text-emerald-300 pb-1 border-b border-white/10">
                <span>Wymiary Obszaru:</span>
                <span>{calculateBoundsDimensionsMeters(confirmedBounds).widthMeters} × {calculateBoundsDimensionsMeters(confirmedBounds).heightMeters} m</span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Szerokość:</span>
                <span>{calculateBoundsDimensionsMeters(confirmedBounds).widthMeters} m</span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Długość:</span>
                <span>{calculateBoundsDimensionsMeters(confirmedBounds).heightMeters} m</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-white/10 text-[10px] text-white/50">
                <span>Darmowe tło satelitarne:</span>
                <span className="text-emerald-400">Esri / ArcGIS High-Res</span>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-xs font-semibold text-white/80 mb-2">
                Nazwa Padoku / Wydarzenia:
              </label>
              <input
                type="text"
                value={customEventName}
                onChange={(e) => setCustomEventName(e.target.value)}
                placeholder="np. Silesia Ring — Strefa VIP"
                className="glass-input w-full text-xs py-2.5"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowCustomBoundsModal(false)}
                disabled={isSavingCustomEvent}
                className="glass-button flex-1 py-3 text-xs"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveCustomEventAndOpen}
                disabled={isSavingCustomEvent}
                className="glass-button-primary flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2"
              >
                {isSavingCustomEvent ? 'Tworzenie...' : 'Otwórz Planner 🚀'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HomePage;
