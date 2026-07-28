import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { calculateBoundsDimensionsMeters, calculateHaversineDistanceMeters } from '../lib/geoUtils.js';
import { useAuth } from '../context/AuthContext.jsx';
import { LoginModal, RegisterModal, DeleteAccountModal } from '../components/AuthModals.jsx';
import { Map3D, useMap3D, useMapsLibrary } from '@vis.gl/react-google-maps';

function HomePage() {
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Zamiast renderowania hybrydowego, uzywamy Google Maps
  const map = useMap3D();
  const [camera, setCamera] = useState({ center: { lat: 51.5, lng: 18.0, altitude: 5000000 }, range: 5000000, tilt: 0, heading: 0 });
  const placesLibrary = useMapsLibrary('places');
  const markerLibrary = useMapsLibrary('marker');
  const elevationLibrary = useMapsLibrary('elevation');

  const [autocompleteService, setAutocompleteService] = useState(null);
  const [placesService, setPlacesService] = useState(null);
  const [elevationService, setElevationService] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);

  const [hasArrived, setHasArrived] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(null);

  // Custom framing (Lasso)
  const [isCustomFramingMode, setIsCustomFramingMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [isPolygonClosed, setIsPolygonClosed] = useState(false);
  const [showCameraControls, setShowCameraControls] = useState(false);

  const [showCustomBoundsModal, setShowCustomBoundsModal] = useState(false);
  const [confirmedBounds, setConfirmedBounds] = useState(null);
  const [customEventName, setCustomEventName] = useState('');
  const [isSavingCustomEvent, setIsSavingCustomEvent] = useState(false);

  const polygonRef = useRef(null);
  const polylineRef = useRef(null);
  const polyline3DRef = useRef(null);
  const polygon3DRef = useRef(null);
  const markersRef = useRef([]);

  // Inicjalizacja usług Google Places
  useEffect(() => {
    if (!placesLibrary || !map) return;
    setAutocompleteService(new placesLibrary.AutocompleteService());
    setPlacesService(new placesLibrary.PlacesService(document.createElement('div')));
  }, [placesLibrary, map]);

  useEffect(() => {
    if (elevationLibrary) {
      setElevationService(new elevationLibrary.ElevationService());
    }
  }, [elevationLibrary]);

  // Wyszukiwanie Autocomplete
  useEffect(() => {
    if (!autocompleteService || !searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearchingOnline(true);
    autocompleteService.getPlacePredictions({ input: searchQuery }, (predictions, status) => {
      setIsSearchingOnline(false);
      if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
        setSearchResults(predictions.slice(0, 8));
      } else {
        setSearchResults([]);
      }
    });
  }, [searchQuery, autocompleteService]);

  const handlePlaceSelect = (placeId, description) => {
    if (!placesService || !map) return;
    setShowDropdown(false);

    placesService.getDetails({ placeId, fields: ['geometry', 'name', 'formatted_address'] }, (place, status) => {
      if (status === window.google.maps.places.PlacesServiceStatus.OK && place.geometry && place.geometry.location) {
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();

        const trackInfo = {
          id: placeId,
          name: place.name || description.split(',')[0],
          city: place.formatted_address,
          coords: [lng, lat],
        };

        setSelectedTrack(trackInfo);
        setHasArrived(true);
        setIsCustomFramingMode(false);
        setShowCustomBoundsModal(false);

        // Lot kinowy w pełne 3D
        setCamera({
          center: { lat, lng, altitude: 0 },
          range: 800,
          tilt: 55,
          heading: 0
        });
      }
    });
  };

  const handleSearchEnter = () => {
    if (searchResults.length > 0) {
      handlePlaceSelect(searchResults[0].place_id, searchResults[0].description);
    }
  };

  const returnToSpace = () => {
    setHasArrived(false);
    setSelectedTrack(null);
    setPolygonPoints([]);
    setIsPolygonClosed(false);
    setShowCameraControls(false);
    setCamera({ center: { lat: 51.5, lng: 18.0, altitude: 5000000 }, range: 5000000, tilt: 0, heading: 0 });
  };

  // Rysowanie Linii, Poligonów i Pinezek 3D
  useEffect(() => {
    if (!map || !window.google || !window.google.maps.maps3d) return;

    // Usunięcie starych elementów
    markersRef.current.forEach(m => {
      if (m && m.parentNode) m.parentNode.removeChild(m);
    });
    markersRef.current = [];

    if (polyline3DRef.current && polyline3DRef.current.parentNode) {
      polyline3DRef.current.parentNode.removeChild(polyline3DRef.current);
    }
    polyline3DRef.current = null;

    if (polygon3DRef.current && polygon3DRef.current.parentNode) {
      polygon3DRef.current.parentNode.removeChild(polygon3DRef.current);
    }
    polygon3DRef.current = null;

    if (!isCustomFramingMode) return;

    // Rysowanie Linii lub Poligonu 3D
    if (polygonPoints.length > 0) {
      const coords = polygonPoints.map(p => ({ lat: p[0], lng: p[1], altitude: 0 }));
      const altitudeMode = window.google.maps.maps3d.AltitudeMode.CLAMP_TO_GROUND;

      if (isPolygonClosed) {
        polygon3DRef.current = new window.google.maps.maps3d.Polygon3DElement({
          outerCoordinates: coords,
          fillColor: 'rgba(16, 185, 129, 0.35)',
          strokeColor: 'rgba(16, 185, 129, 0.8)',
          strokeWidth: 4,
          altitudeMode
        });
        map.append(polygon3DRef.current);
      } else {
        polyline3DRef.current = new window.google.maps.maps3d.Polyline3DElement({
          coordinates: coords,
          strokeColor: 'rgba(56, 189, 248, 0.8)',
          strokeWidth: 4,
          altitudeMode
        });
        map.append(polyline3DRef.current);
      }
    }

    polygonPoints.forEach((pt, idx) => {
      const isStartPoint = idx === 0;

      const pinDiv = document.createElement('div');
      pinDiv.style.width = '24px';
      pinDiv.style.height = '24px';
      pinDiv.style.background = isStartPoint ? '#10b981' : '#38bdf8';
      pinDiv.style.border = '2px solid white';
      pinDiv.style.borderRadius = '50%';
      pinDiv.style.display = 'flex';
      pinDiv.style.alignItems = 'center';
      pinDiv.style.justifyContent = 'center';
      pinDiv.style.color = '#000';
      pinDiv.style.fontWeight = 'bold';
      pinDiv.style.fontSize = '12px';
      pinDiv.innerText = (idx + 1).toString();
      pinDiv.style.cursor = 'pointer';

      if (isStartPoint && !isPolygonClosed && polygonPoints.length >= 3) {
        pinDiv.style.width = '32px';
        pinDiv.style.height = '32px';
        pinDiv.style.boxShadow = '0 0 15px #10b981';
        pinDiv.addEventListener('click', (e) => {
          e.stopPropagation();
          setIsPolygonClosed(true);
        });
      }

      // Element 3D dla nowej mapy
      const marker = new window.google.maps.maps3d.Marker3DElement({
        position: { lat: pt[0], lng: pt[1], altitude: 0 },
        altitudeMode: window.google.maps.maps3d.AltitudeMode.CLAMP_TO_GROUND
      });
      marker.append(pinDiv);
      map.append(marker);

      markersRef.current.push(marker);
    });
  }, [map, isCustomFramingMode, polygonPoints, isPolygonClosed]);

  // Kliknięcie mapy przy rysowaniu
  useEffect(() => {
    if (!map || !isCustomFramingMode || isPolygonClosed) return;
    const listener = map.addEventListener('gmp-click', (e) => {
      if (e.position) setPolygonPoints(prev => [...prev, [e.position.lat, e.position.lng]]);
    });
    return () => map.removeEventListener('gmp-click', listener);
  }, [map, isCustomFramingMode, isPolygonClosed]);

  const handleConfirmCustomBounds = async () => {
    if (!selectedTrack) return;

    let centerCoords;
    let requiredZoom;
    let polygonVertices = null;
    let maxDim = 0;

    if (isCustomFramingMode && isPolygonClosed && polygonPoints.length >= 3) {
      const lats = polygonPoints.map(p => p[0]);
      const lngs = polygonPoints.map(p => p[1]);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      centerCoords = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
      
      // Obliczamy fizyczną wielkość lasso żeby dobrać odpowiedni zoom
      const physicalW = calculateHaversineDistanceMeters(minLat, minLng, minLat, maxLng);
      const physicalH = calculateHaversineDistanceMeters(minLat, minLng, maxLat, minLng);
      maxDim = Math.max(physicalW, physicalH);
      polygonVertices = polygonPoints;
    } else {
      centerCoords = [camera.center.lng, camera.center.lat];
    }

    // Odpytujemy Google Maps o rzeczywistą wysokość terenu (n.p.m.) w centrum padoku!
    let elevation = 0;
    if (elevationService && window.google) {
      try {
        const response = await elevationService.getElevationForLocations({
          locations: [new window.google.maps.LatLng(centerCoords[1], centerCoords[0])]
        });
        if (response.results && response.results.length > 0) {
          elevation = response.results[0].elevation;
        }
      } catch (e) {
        console.warn("Nie udało się pobrać wysokości terenu. Zakładam poziom morza.", e);
      }
    }

    if (isCustomFramingMode && isPolygonClosed && polygonPoints.length >= 3) {
      const targetMeters = maxDim * 1.1; // 10% marginesu
      const requiredRange = targetMeters / (2 * Math.tan(17.5 * Math.PI / 180));
      // requiredRange to fizyczny dystans od kamery do terenu. 
      // Skoro centrum w PaddockCanvas będzie miało altitude: elevation, 
      // to range zostaje po prostu równy requiredRange.
      requiredZoom = 21 - Math.log2(requiredRange / 25);
    } else {
      // Jeśli użytkownik tylko przybliżył mapę kamerą:
      // camera.range to dystans kamery do POZIOMU MORZA. 
      // Skoro teren ma wysokość "elevation", to prawdziwy dystans do terenu to:
      const rangeToGround = Math.max(10, camera.range - elevation);
      requiredZoom = 21 - Math.log2(rangeToGround / 25);
    }

    // Obliczamy DOKŁADNE wymiary fizyczne dla kwadratowej Mapy3D 1024x1024 (FOV=35)
    // na poziomie TERENU
    const rangeInCanvas = Math.pow(2, 21 - requiredZoom) * 25;
    const trueWidthMeters = 2 * rangeInCanvas * Math.tan(17.5 * Math.PI / 180);

    // Aktualizujemy sztuczne krawędzie, używane tylko awaryjnie w statycznych mapach 2D
    const halfWidth = trueWidthMeters / 2;
    const latDiff = halfWidth / 111320;
    const lngDiff = halfWidth / (111320 * Math.cos(centerCoords[1] * Math.PI / 180));

    const boundsObj = {
      sw: [centerCoords[0] - lngDiff, centerCoords[1] - latDiff],
      ne: [centerCoords[0] + lngDiff, centerCoords[1] + latDiff],
      center: centerCoords,
      centerElevation: elevation, // Zapisujemy wysokość npm terenu!
      zoom: requiredZoom,
      polygonVertices,
      trueWidthMeters 
    };

    setConfirmedBounds(boundsObj);
    setCustomEventName(selectedTrack.name);
    setShowCustomBoundsModal(true);
  };

  const handleSaveCustomEventAndOpen = async () => {
    if (!confirmedBounds || isSavingCustomEvent) return;
    try {
      setIsSavingCustomEvent(true);
      // Nie używamy już przybliżonego algorytmu, lecz dokładnej matematyki z FOV!
      const trueSize = confirmedBounds.trueWidthMeters || 250;

      const eventData = {
        name: customEventName.trim() || 'Własny Padok na Ziemi',
        widthMeters: trueSize,
        heightMeters: trueSize,
        bounds: confirmedBounds,
        polygonVertices: confirmedBounds.polygonVertices || null,
        createdAt: Date.now(),
        // Nie zapisujemy już gigantycznego obrazu Esri (imageUrl)!
        isGoogle3D: true // flaga dla nowego plannera
      };

      let newId;
      try {
        const savePromise = addDoc(collection(db, 'events'), { ...eventData, createdAt: serverTimestamp() });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 2500));
        const docRef = await Promise.race([savePromise, timeoutPromise]);
        newId = docRef.id;
      } catch (err) {
        console.warn('Zapis Offline:', err);
        newId = 'local-' + Date.now();
        localStorage.setItem('local-event-' + newId, JSON.stringify({ id: newId, ...eventData, teams: [] }));
      }
      navigate(`/planner/${newId}`);
    } catch (error) {
      console.error('Błąd zapisu padoku:', error);
      alert('Nie udało się zapisać nowego układu.');
    } finally {
      setIsSavingCustomEvent(false);
    }
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#040611] font-sans select-none">

      <div className="absolute inset-0 z-0">
        <Map3D
          center={camera.center}
          range={camera.range}
          tilt={camera.tilt}
          heading={camera.heading}
          mode="SATELLITE"
          onCameraChanged={(e) => {
            setCamera({
              center: e.detail.center,
              range: e.detail.range,
              tilt: e.detail.tilt,
              heading: e.detail.heading
            });
          }}
          defaultLabelsDisabled={false}
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/60 pointer-events-none z-10" />

      {/* Górny Prawy - Logowanie */}
      <div className="absolute top-5 right-5 z-40 flex items-center gap-2 pointer-events-auto">
        {currentUser ? (
          <div className="glass-panel-strong px-3.5 py-1.5 rounded-xl border-white/20 flex items-center gap-3 shadow-glass">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-white tracking-wide">{currentUser.nick}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={logout} className="text-[11px] text-white/60 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-lg border border-white/10 transition-all active:scale-95">Wyloguj</button>
            </div>
          </div>
        ) : (
          <div className="glass-panel-strong p-1.5 rounded-xl border-white/20 flex items-center gap-1.5 shadow-glass">
            <button onClick={() => setIsLoginModalOpen(true)} className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-95">Zaloguj</button>
            <button onClick={() => setIsRegisterModalOpen(true)} className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white transition-all shadow-md">Zarejestruj</button>
          </div>
        )}
      </div>

      {/* Wyszukiwarka */}
      <div className="absolute top-5 left-5 z-30 w-full max-w-sm sm:max-w-md px-2 pointer-events-auto">
        <div className="glass-panel-strong p-4 rounded-2xl shadow-2xl border-white/25 backdrop-blur-xl bg-black/60">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
              <span className="text-base">🌍</span>
            </div>
            <div>
              <h1 className="text-xs sm:text-sm font-extrabold text-white tracking-wide">GLOBUS PADOK PLANNER (3D)</h1>
              <p className="text-[10px] text-indigo-300/80 font-mono">Powered by Google Maps Photorealistic 3D</p>
            </div>
          </div>

          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowDropdown(true);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchEnter()}
              onFocus={() => setShowDropdown(true)}
              placeholder="🔍 Wpisz nazwę toru, miasto..."
              className="w-full bg-black/60 border border-white/20 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-white/50 focus:outline-none focus:border-indigo-400 transition-all font-medium pr-24 shadow-inner"
            />
            <button
              onClick={handleSearchEnter}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-[11px] rounded-lg transition-all shadow-md flex items-center gap-1"
            >
              <span>Szukaj</span><span>🚀</span>
            </button>
          </div>

          {showDropdown && searchResults.length > 0 && (
            <div className="mt-3 max-h-[38vh] overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
              {searchResults.map((track) => (
                <button
                  key={track.place_id}
                  onClick={() => handlePlaceSelect(track.place_id, track.description)}
                  className="w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between group bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/25 shadow-sm"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors truncate">
                      {track.structured_formatting?.main_text || track.description}
                    </p>
                    <p className="text-[10px] text-white/50 font-mono truncate">
                      {track.structured_formatting?.secondary_text || ''}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Dolny Panel po przylocie */}
      {hasArrived && selectedTrack && !showCustomBoundsModal && !isCustomFramingMode && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 w-[95vw] max-w-4xl pointer-events-auto animate-slide-up">
          <div className="glass-panel-strong px-6 py-4 md:px-8 md:py-5 rounded-3xl border-indigo-400/40 shadow-[0_16px_50px_rgba(0,0,0,0.85)] backdrop-blur-2xl bg-slate-950/85 flex flex-col md:flex-row items-center justify-between gap-5">
            <div className="text-center md:text-left min-w-0 flex-1">
              <h3 className="text-lg md:text-xl font-extrabold text-white tracking-tight leading-snug mb-1 break-words">
                {selectedTrack.name}
              </h3>
              <p className="text-xs md:text-sm text-white/70 font-mono">
                Wciśnij <b>Shift</b> i pociągnij mapę, by obrócić widok 3D! Następnie wykadruj padok.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 shrink-0 w-full md:w-auto flex-wrap sm:flex-nowrap">
              <button onClick={returnToSpace} className="glass-button px-4 py-3 rounded-xl text-xs sm:text-sm font-semibold text-white/90 hover:text-white hover:bg-white/15 transition-all flex items-center gap-2">
                <span>🌍</span><span>Kosmos</span>
              </button>
              <button onClick={() => setShowCameraControls(prev => !prev)} className="glass-button px-4 py-3 rounded-xl text-xs sm:text-sm font-semibold text-white/90 hover:text-white hover:bg-white/15 transition-all flex items-center gap-2">
                <span>🎥</span><span>Kamera</span>
              </button>
              <button onClick={() => setIsCustomFramingMode(true)} className="glass-button px-4 py-3 rounded-xl text-xs sm:text-sm font-bold text-emerald-300 hover:text-emerald-200 border-emerald-400/40 hover:bg-emerald-500/20 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)]">
                <span>📐</span><span>Kadruj Lasso</span>
              </button>
              <button onClick={handleConfirmCustomBounds} className="glass-button-primary px-6 py-3 rounded-xl text-xs sm:text-sm font-extrabold shadow-[0_0_30px_rgba(99,102,241,0.5)]">
                Zaplanuj Padok 🚀
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panel sterowania kamerą (3D) */}
      {showCameraControls && hasArrived && (
        <div className="absolute top-24 right-6 z-50 w-72 bg-[#1a1c23] border border-white/10 rounded-2xl shadow-2xl p-5 pointer-events-auto">
          <button 
            onClick={() => setShowCameraControls(false)}
            className="absolute top-4 right-4 text-white/60 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          
          <div className="space-y-6 mt-4">
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-white/90 w-24">Pochylenie</label>
              <input 
                type="range" 
                min="0" 
                max="67.5" 
                step="0.5" 
                value={camera.tilt || 0}
                onChange={(e) => setCamera(prev => ({ ...prev, tilt: Number(e.target.value) }))}
                className="flex-1 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#a5c0f3]"
              />
            </div>
            
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-white/90 w-24">Nagłówek</label>
              <input 
                type="range" 
                min="0" 
                max="360" 
                step="1" 
                value={camera.heading || 0}
                onChange={(e) => setCamera(prev => ({ ...prev, heading: Number(e.target.value) }))}
                className="flex-1 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#a5c0f3]"
              />
            </div>

            <button 
              onClick={() => setCamera(prev => ({ ...prev, heading: 0, tilt: 0 }))}
              className="w-full pt-4 text-sm text-[#a5c0f3] hover:text-white transition-colors"
            >
              Przywróć kierunek północny
            </button>
          </div>
        </div>
      )}

      {/* Rysowanie Lasso - kontrolki */}
      {hasArrived && isCustomFramingMode && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 pointer-events-auto animate-slide-up bg-black/80 px-6 py-4 rounded-3xl border border-emerald-500/50">
          <div className="text-xs font-bold text-emerald-300 mr-4">
            {isPolygonClosed ? '✔ Obszar zamknięty!' : '📍 Klikaj na mapie, by narysować obszar padoku.'}
          </div>
          <button onClick={() => { setPolygonPoints([]); setIsPolygonClosed(false); setIsCustomFramingMode(false); }} className="glass-button py-2 px-4 text-xs text-white/80">Anuluj</button>
          {polygonPoints.length > 0 && !isPolygonClosed && (
            <button onClick={() => setPolygonPoints(prev => prev.slice(0, -1))} className="bg-rose-600 px-4 py-2 rounded-xl text-xs font-bold text-white">Cofnij</button>
          )}
          {isPolygonClosed && (
            <button onClick={handleConfirmCustomBounds} className="glass-button-primary px-6 py-2 text-xs font-bold">Zatwierdź ✔</button>
          )}
        </div>
      )}

      {/* Modal zapisu */}
      {showCustomBoundsModal && confirmedBounds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md pointer-events-auto">
          <div className="glass-panel-strong w-full max-w-md p-6 sm:p-8 rounded-3xl border-white/30 shadow-2xl relative">
            <h3 className="text-lg font-bold text-white mb-2">🏎️ Potwierdź Strefę Padoku (Google 3D)</h3>
            <p className="text-xs text-white/60 mb-5">Podaj nazwę dla wybranego obszaru.</p>
            <input type="text" value={customEventName} onChange={e => setCustomEventName(e.target.value)} placeholder="Nazwa strefy..." className="glass-input w-full text-xs py-2.5 mb-5" />
            <div className="flex gap-3">
              <button onClick={() => setShowCustomBoundsModal(false)} className="glass-button flex-1 py-3 text-xs">Anuluj</button>
              <button onClick={handleSaveCustomEventAndOpen} className="glass-button-primary flex-1 py-3 text-xs font-bold">{isSavingCustomEvent ? 'Zapisywanie...' : 'Otwórz Planner 🚀'}</button>
            </div>
          </div>
        </div>
      )}

      <LoginModal 
        isOpen={isLoginModalOpen} 
        onClose={() => setIsLoginModalOpen(false)} 
        onSwitchToRegister={() => {
          setIsLoginModalOpen(false);
          setIsRegisterModalOpen(true);
        }} 
      />

      <RegisterModal 
        isOpen={isRegisterModalOpen} 
        onClose={() => setIsRegisterModalOpen(false)} 
        onSwitchToLogin={() => {
          setIsRegisterModalOpen(false);
          setIsLoginModalOpen(true);
        }} 
      />
    </div>
  );
}

export default HomePage;