import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { calculateBoundsDimensionsMeters, buildStaticMapUrl } from '../lib/geoUtils.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';

function HomePage() {
  const navigate = useNavigate();
  const mapContainerRef = useRef(null);
  const geocoderContainerRef = useRef(null);
  const viewfinderRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const [mapboxToken, setMapboxToken] = useState(
    () => import.meta.env.VITE_MAPBOX_TOKEN || localStorage.getItem('PADOK_MAPBOX_TOKEN') || ''
  );
  const [googleApiKey, setGoogleApiKey] = useState(
    () => import.meta.env.VITE_GOOGLE_MAPS_API_KEY || localStorage.getItem('PADOK_GOOGLE_MAPS_KEY') || ''
  );
  const [tokenInput, setTokenInput] = useState('');
  const [googleKeyInput, setGoogleKeyInput] = useState('');
  const [showGoogleKeyInput, setShowGoogleKeyInput] = useState(false);
  const [showAdvancedTokenInput, setShowAdvancedTokenInput] = useState(false);

  const [isFlying, setIsFlying] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);
  const [confirmedBounds, setConfirmedBounds] = useState(null);
  const [eventName, setEventName] = useState('Tor Poznań — Padok A');
  const [isSavingEvent, setIsSavingEvent] = useState(false);

  // Initialize Mapbox Globe
  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current) return;

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      projection: 'globe',
      center: [19.1451, 51.9194], // Poland / Central Europe view from space
      zoom: 1.8,
      pitch: 0,
    });

    mapInstanceRef.current = map;

    map.on('style.load', () => {
      // Atmospheric space glow
      map.setFog({
        range: [0.8, 8],
        color: '#1a1d2d',
        'horizon-blend': 0.1,
        'high-color': '#0d0f18',
        'space-color': '#05070f',
        'star-intensity': 0.8,
      });
    });

    // Add navigation control (zoom buttons)
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    // Initialize Geocoder and attach to custom container
    if (geocoderContainerRef.current) {
      geocoderContainerRef.current.innerHTML = '';
      const geocoder = new MapboxGeocoder({
        accessToken: mapboxToken,
        mapboxgl: mapboxgl,
        marker: false,
        placeholder: 'Wyszukaj tor wyścigowy lub adres (np. Tor Poznań)...',
        flyTo: false, // We trigger custom cinematic flyTo below
      });

      geocoder.addTo(geocoderContainerRef.current);

      geocoder.on('result', (e) => {
        const [lng, lat] = e.result.center;
        triggerCinematicFly([lng, lat]);
      });
    }

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [mapboxToken]);

  const triggerCinematicFly = (centerLngLat) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    setIsFlying(true);
    setHasArrived(false);

    // Earth Zoom In animation
    map.flyTo({
      center: centerLngLat,
      zoom: 18,
      speed: 1.5,
      curve: 1.5,
      essential: true,
      pitch: 20, // slight cinematic tilt
    });

    map.once('moveend', () => {
      setIsFlying(false);
      setHasArrived(true);
    });
  };

  const handleManualExplore = () => {
    // If user clicks quick explore or quick track preset without typing
    triggerCinematicFly([16.7962, 52.4185]); // Tor Poznań coordinates
  };

  const handleConfirmArea = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    let swLngLat, neLngLat;

    if (viewfinderRef.current) {
      const rect = viewfinderRef.current.getBoundingClientRect();
      const sw = map.unproject([rect.left, rect.bottom]);
      const ne = map.unproject([rect.right, rect.top]);
      swLngLat = [sw.lng, sw.lat];
      neLngLat = [ne.lng, ne.lat];
    } else {
      const bounds = map.getBounds();
      swLngLat = [bounds.getWest(), bounds.getSouth()];
      neLngLat = [bounds.getEast(), bounds.getNorth()];
    }

    const boundsObj = {
      sw: swLngLat,
      ne: neLngLat,
      center: [map.getCenter().lng, map.getCenter().lat],
      zoom: map.getZoom(),
    };

    setConfirmedBounds(boundsObj);
  };

  const handleSaveToken = (e) => {
    e.preventDefault();
    if (tokenInput.trim()) {
      localStorage.setItem('PADOK_MAPBOX_TOKEN', tokenInput.trim());
      setMapboxToken(tokenInput.trim());
    }
  };

  const handleSaveGoogleKey = (e) => {
    e.preventDefault();
    if (googleKeyInput.trim()) {
      localStorage.setItem('PADOK_GOOGLE_MAPS_KEY', googleKeyInput.trim());
      setGoogleApiKey(googleKeyInput.trim());
      setShowGoogleKeyInput(false);
    }
  };

  // ZADANIE 4: Oblicz wymiary (Haversine), zbuduj URL tła i zapisz do Firestore
  const handleCreateEventAndProceed = async () => {
    if (!confirmedBounds || isSavingEvent) return;

    try {
      setIsSavingEvent(true);
      const dimensions = calculateBoundsDimensionsMeters(confirmedBounds);
      const imageUrl = buildStaticMapUrl(confirmedBounds, googleApiKey, mapboxToken);

      const eventData = {
        name: eventName.trim() || 'Tor Wyścigowy — Padok',
        imageUrl,
        widthMeters: dimensions.widthMeters,
        heightMeters: dimensions.heightMeters,
        bounds: confirmedBounds,
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'events'), eventData);
      console.log('Zadanie 4: Utworzono event w Firestore o ID:', docRef.id);
      navigate(`/planner/${docRef.id}`);
    } catch (error) {
      console.error('Błąd podczas zapisywania eventu z tłem:', error);
      alert('Nie udało się zapisać danych eventu do bazy Firestore.');
    } finally {
      setIsSavingEvent(false);
    }
  };

  // Obliczone wymiary na żywo dla okna potwierdzenia
  const dimensions = confirmedBounds
    ? calculateBoundsDimensionsMeters(confirmedBounds)
    : { widthMeters: 200, heightMeters: 200 };

  // If Mapbox token is missing, show sleek glass setup dialog
  if (!mapboxToken) {
    return (
      <div className="relative z-50 min-h-screen w-full flex items-center justify-center p-4 overflow-y-auto bg-mesh pointer-events-auto">
        <div className="relative z-50 glass-panel-strong p-8 md:p-11 max-w-xl w-full text-center animate-fade-in shadow-2xl border-white/30 my-6 pointer-events-auto">
          {/* Top Header Icon */}
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center mx-auto mb-5 shadow-[0_0_30px_rgba(16,185,129,0.25)]">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-9 h-9 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/30 text-[11px] font-bold text-emerald-300 uppercase tracking-wider mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Darmowy Tryb Satelitarny (Zero Logowania i Kart)</span>
          </div>

          <h1 className="text-2xl md:text-3xl font-extrabold mb-2 text-white">
            Wybierz Tor Wyścigowy i Zaplanuj Padok
          </h1>
          <p className="text-white/70 text-xs md:text-sm mb-7 leading-relaxed max-w-md mx-auto">
            Planuj rozmieszczenie zespołów wyścigowych na autentycznych zdjęciach satelitarnych wysokiej rozdzielczości (Esri/ArcGIS). Działa natychmiast dla każdego w zespole!
          </p>

          {/* Quick Presets Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <button
              type="button"
              onClick={() => navigate('/planner/demo')}
              className="p-4 rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-left transition-all hover:scale-[1.02] active:scale-98 shadow-lg group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-emerald-300">🟢 Tor Poznań</span>
                  <span className="text-[10px] bg-emerald-400/20 text-emerald-200 px-1.5 py-0.5 rounded font-mono">PL</span>
                </div>
                <p className="text-[11px] font-semibold text-white">Padok Główny</p>
              </div>
              <p className="text-[10px] text-white/50 font-mono mt-2 pt-2 border-t border-white/10">250 × 180 metrów</p>
            </button>

            <button
              type="button"
              onClick={() => navigate('/planner/silesia-ring')}
              className="p-4 rounded-2xl bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/50 text-left transition-all hover:scale-[1.02] active:scale-98 shadow-lg group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-blue-300">🔵 Silesia Ring</span>
                  <span className="text-[10px] bg-blue-400/20 text-blue-200 px-1.5 py-0.5 rounded font-mono">PL</span>
                </div>
                <p className="text-[11px] font-semibold text-white">Padok Główny</p>
              </div>
              <p className="text-[10px] text-white/50 font-mono mt-2 pt-2 border-t border-white/10">300 × 200 metrów</p>
            </button>

            <button
              type="button"
              onClick={() => navigate('/planner/tor-modlin')}
              className="p-4 rounded-2xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/50 text-left transition-all hover:scale-[1.02] active:scale-98 shadow-lg group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-purple-300">🟣 Tor Modlin</span>
                  <span className="text-[10px] bg-purple-400/20 text-purple-200 px-1.5 py-0.5 rounded font-mono">PL</span>
                </div>
                <p className="text-[11px] font-semibold text-white">Padok Sportowy</p>
              </div>
              <p className="text-[10px] text-white/50 font-mono mt-2 pt-2 border-t border-white/10">200 × 150 metrów</p>
            </button>
          </div>

          {/* Collapsible Advanced Mapbox Section */}
          <div className="pt-6 border-t border-white/15 text-left">
            <button
              type="button"
              onClick={() => setShowAdvancedTokenInput(!showAdvancedTokenInput)}
              className="w-full flex items-center justify-between text-xs text-white/60 hover:text-white transition-colors py-1"
            >
              <span className="flex items-center gap-2 font-medium">
                <span>⚙️ Opcje zaawansowane (Własny klucz Mapbox / Kinowy Globus 3D)</span>
              </span>
              <span className="text-indigo-300 text-[11px] underline">
                {showAdvancedTokenInput ? 'Ukryj' : 'Rozwiń'}
              </span>
            </button>

            {showAdvancedTokenInput && (
              <div className="mt-4 p-4 rounded-2xl bg-black/40 border border-white/15 space-y-3.5 animate-fade-in text-xs">
                <p className="text-white/70 leading-relaxed">
                  Jeśli posiadasz własne konto na <a href="https://account.mapbox.com/" target="_blank" rel="noreferrer" className="text-indigo-300 underline hover:text-indigo-200">account.mapbox.com</a> i chcesz włączyć trójwymiarową animację lotu kamery z kosmosu, wklej poniżej swój token <code className="bg-white/10 px-1 rounded">pk.eyJ...</code>:
                </p>
                <form onSubmit={handleSaveToken} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="pk.eyJ1Ijoi..."
                    className="glass-input flex-1 font-mono text-xs py-2.5"
                    required
                  />
                  <button type="submit" className="glass-button-primary py-2.5 px-4 text-xs font-bold shrink-0">
                    Uruchom Globus 3D
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      {/* Full screen Mapbox Container */}
      <div ref={mapContainerRef} className="absolute inset-0 z-0 w-full h-full" />

      {/* Top Bar with Glass Geocoder Search */}
      <header className="absolute top-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-4 flex flex-col items-center gap-3 pointer-events-auto">
        <div ref={geocoderContainerRef} className="w-full shadow-glass-lg" />
        
        {/* Quick presets & mode pills */}
        {!hasArrived && !isFlying && (
          <div className="flex items-center gap-2 animate-fade-in">
            <button
              onClick={handleManualExplore}
              className="px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs text-white/80 hover:text-white hover:bg-white/20 transition-all flex items-center gap-1.5 shadow-sm"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Szybki lot: Tor Poznań
            </button>
          </div>
        )}
      </header>

      {/* Cinematic Flight Status Banner */}
      {isFlying && (
        <div className="absolute inset-0 z-40 bg-black/30 backdrop-blur-[2px] pointer-events-none flex flex-col items-center justify-center animate-fade-in">
          <div className="glass-panel px-8 py-5 flex items-center gap-4 border-indigo-400/30">
            <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <div className="text-left">
              <h4 className="font-bold text-white tracking-wide">Lot na tor wyścigowy...</h4>
              <p className="text-xs text-indigo-200/70">Przybliżanie kamery z poziomu kosmosu</p>
            </div>
          </div>
        </div>
      )}

      {/* Viewfinder HUD (Celownik) & Confirm Button after arrival */}
      {hasArrived && (
        <>
          {/* Center Targeting Box (Pointer-events-none so users can still pan/drag map underneath!) */}
          <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center p-4">
            <div
              ref={viewfinderRef}
              className="w-[85vw] max-w-[460px] h-[62vh] max-h-[540px] border-2 border-emerald-400/80 rounded-3xl bg-emerald-500/10 backdrop-blur-[1px] shadow-[0_0_60px_rgba(16,185,129,0.25)] flex flex-col justify-between p-5 relative animate-fade-in transition-all duration-300"
            >
              {/* Corner HUD Accents */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-emerald-300 rounded-tl-2xl -translate-x-1 -translate-y-1" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-emerald-300 rounded-tr-2xl translate-x-1 -translate-y-1" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-emerald-300 rounded-bl-2xl -translate-x-1 translate-y-1" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-emerald-300 rounded-br-2xl translate-x-1 translate-y-1" />

              {/* Crosshair Center Indicator */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center opacity-60">
                <div className="w-full h-[1px] bg-emerald-400 absolute" />
                <div className="h-full w-[1px] bg-emerald-400 absolute" />
              </div>

              {/* Top HUD Label */}
              <div className="flex items-center justify-between text-[11px] font-mono text-emerald-300/90 tracking-wider uppercase bg-black/40 px-3 py-1.5 rounded-xl border border-emerald-400/30 backdrop-blur-md self-center">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  Strefa Padoku (CELOWNIK)
                </span>
              </div>

              {/* Bottom HUD Instruction */}
              <div className="text-center bg-black/50 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10">
                <p className="text-xs text-white/90 font-medium">
                  Przesuwaj lub przybliżaj mapę, aby wycelować w obszar padoku.
                </p>
                <p className="text-[10px] text-emerald-300/70 font-mono mt-0.5">
                  Kliknij przycisk poniżej, gdy obszar będzie gotowy.
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Action Bar (Pointer-events-auto) */}
          <div className="absolute bottom-8 left-0 right-0 z-30 flex justify-center px-4 pointer-events-auto animate-slide-up">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setHasArrived(false)}
                className="glass-button py-3.5 px-5 text-sm font-medium text-white/80 hover:text-white"
                title="Wróć do wyszukiwania lub oddal mapę"
              >
                Anuluj
              </button>
              <button
                onClick={handleConfirmArea}
                className="glass-button-primary px-8 py-3.5 text-base font-bold shadow-[0_8px_32px_rgba(79,46,229,0.5)] flex items-center gap-2.5 group"
              >
                <span>Zatwierdź ten obszar</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Confirmation Modal (Zadanie 4: Wymiary Haversine + Tło URL) */}
      {confirmedBounds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
          <div className="glass-panel-strong w-full max-w-md p-6 md:p-8 relative animate-slide-up shadow-2xl border-white/30 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setConfirmedBounds(null)}
              className="absolute top-5 right-5 text-white/50 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center mb-4 text-emerald-300">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>

            <h3 className="text-xl font-bold text-white mb-1">
              Podsumowanie i Tło Padoku
            </h3>
            <p className="text-white/60 text-sm mb-5">
              Obliczono fizyczne wymiary obszaru wzorem Haversine'a.
            </p>

            {/* Obliczone Wymiary z Haversine */}
            <div className="bg-black/40 rounded-xl p-4 border border-emerald-400/30 font-mono text-xs text-white/90 mb-5 space-y-2">
              <div className="flex justify-between items-center text-sm font-bold text-emerald-300 pb-1 border-b border-white/10">
                <span>Wymiary Fizyczne:</span>
                <span>{dimensions.widthMeters} × {dimensions.heightMeters} m</span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Szerokość (Wzór Haversine'a):</span>
                <span className="text-white font-semibold">{dimensions.widthMeters} m</span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Długość / Wysokość:</span>
                <span className="text-white font-semibold">{dimensions.heightMeters} m</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-white/10 text-[11px] text-white/50">
                <span>Zastosowany Silnik Tła:</span>
                <span className="text-indigo-300 font-semibold">{googleApiKey ? 'Google Static Maps API' : 'Mapbox Static Images API (Free)'}</span>
              </div>
            </div>

            {/* Opcjonalna konfiguracja klucza Google Static Maps */}
            {!googleApiKey && (
              <div className="mb-5 p-3 rounded-xl bg-indigo-500/10 border border-indigo-400/20 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-indigo-300">💡 Używam Mapbox Static (Darmowe)</span>
                  <button
                    type="button"
                    onClick={() => setShowGoogleKeyInput(!showGoogleKeyInput)}
                    className="text-white/70 underline hover:text-white"
                  >
                    {showGoogleKeyInput ? 'Ukryj' : 'Dodaj klucz Google'}
                  </button>
                </div>
                <p className="text-white/60 text-[11px]">
                  Domyślnie generujemy satelitarne tło z Mapbox API bez etykiet. Jeśli chcesz użyć Google Static Maps, wpisz klucz poniżej:
                </p>
                {showGoogleKeyInput && (
                  <div className="flex gap-2 mt-2.5">
                    <input
                      type="text"
                      value={googleKeyInput}
                      onChange={(e) => setGoogleKeyInput(e.target.value)}
                      placeholder="AIzaSy..."
                      className="glass-input text-xs py-2 flex-1"
                    />
                    <button
                      type="button"
                      onClick={handleSaveGoogleKey}
                      className="glass-button py-2 px-3 text-xs shrink-0"
                    >
                      Zapisz
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mb-6">
              <label className="block text-xs font-semibold uppercase tracking-wider text-white/70 mb-2">
                Nazwa Eventu / Toru
              </label>
              <input
                type="text"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="np. Tor Poznań — Padok A"
                className="glass-input w-full"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setConfirmedBounds(null)}
                disabled={isSavingEvent}
                className="glass-button flex-1 py-3 text-sm text-white/70 hover:text-white disabled:opacity-50"
              >
                Wróć
              </button>
              <button
                onClick={handleCreateEventAndProceed}
                disabled={isSavingEvent}
                className="glass-button-primary flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSavingEvent ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Zapisywanie w Firestore...
                  </>
                ) : (
                  <>
                    <span>Utwórz Padok</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HomePage;
