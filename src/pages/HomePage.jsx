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
  
  // Kontenery dla Globusu 3D (globe.gl) oraz Mapy Satelitarnej (Leaflet)
  const globeContainerRef = useRef(null);
  const globeInstanceRef = useRef(null);
  const paddockMapContainerRef = useRef(null);
  const paddockMapInstanceRef = useRef(null);
  const viewfinderRef = useRef(null);

  // Wyszukiwarka na całej kuli ziemskiej
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(TRACK_DATABASE);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isGlobeReady, setIsGlobeReady] = useState(false);

  // Stan lotu kamery i wybrany punkt na Ziemi
  const [isFlying, setIsFlying] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [isCustomFramingMode, setIsCustomFramingMode] = useState(false);
  const [showCustomBoundsModal, setShowCustomBoundsModal] = useState(false);
  const [confirmedBounds, setConfirmedBounds] = useState(null);
  const [customEventName, setCustomEventName] = useState('');
  const [isSavingCustomEvent, setIsSavingCustomEvent] = useState(false);
  
  // Warstwa mapy: 'satellite-streets' (Google Hybryda z nazwami ulic) | 'satellite' (Esri HD) | 'street' (OSM)
  const [mapLayerType, setMapLayerType] = useState('satellite-streets');

  // Wyszukiwanie w czasie rzeczywistym (baza torów + darmowy geocoder OpenStreetMap Nominatim dla CAŁEGO ŚWIATA)
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

    const timer = setTimeout(async () => {
      if (searchQuery.length >= 3) {
        setIsSearchingOnline(true);
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`,
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

  // Obsługa naciśnięcia klawisza Enter w wyszukiwarce lub kliknięcia przycisku Szukaj
  const handleSearchEnter = async () => {
    if (!searchQuery.trim()) return;
    setShowDropdown(false);

    const queryLower = searchQuery.toLowerCase();
    const localMatch = TRACK_DATABASE.find(
      t => t.name.toLowerCase().includes(queryLower) || t.city.toLowerCase().includes(queryLower)
    );

    if (localMatch) {
      triggerCinematicZoomToTrack(localMatch);
      return;
    }

    // Jeśli to nie tor z bazy, odpytaj natychmiast całą Ziemię przez API Nominatim
    setIsSearchingOnline(true);
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`,
        { headers: { 'Accept-Language': 'pl,en;q=0.9' } }
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.length > 0) {
          const item = data[0];
          const osmTrack = {
            id: `osm-${item.place_id || Date.now()}`,
            name: item.display_name.split(',')[0] + (item.display_name.split(',')[1] ? ` (${item.display_name.split(',')[1].trim()})` : ''),
            city: item.display_name.split(',').slice(-2).join(', ').trim(),
            coords: [parseFloat(item.lon), parseFloat(item.lat)],
            w: 250,
            h: 180,
            bbox: `${parseFloat(item.lon)-0.003},${parseFloat(item.lat)-0.002},${parseFloat(item.lon)+0.003},${parseFloat(item.lat)+0.002}`,
            isCustomAddress: true
          };
          triggerCinematicZoomToTrack(osmTrack);
        } else {
          alert('Nie znaleziono takiego miejsca na Ziemi. Spróbuj wpisać nazwę miasta, ulicy lub toru.');
        }
      }
    } catch (err) {
      console.error('Błąd wyszukiwania na Ziemi:', err);
      alert('Wystąpił błąd podczas wyszukiwania adresu na kuli ziemskiej.');
    } finally {
      setIsSearchingOnline(false);
    }
  };

  // Efekt kinowego zejścia z kosmosu (3D Globe) na dany punkt / adres na Ziemi
  const triggerCinematicZoomToTrack = (track) => {
    setShowDropdown(false);
    setSelectedTrack(track);
    setIsFlying(true);
    setHasArrived(false);
    setIsCustomFramingMode(false);
    setShowCustomBoundsModal(false);

    // Domyślnie dla adresów (np. ulic, domów) wybieramy widok satelitarny z nazwami ulic (hybrydowy)
    if (track.isCustomAddress) {
      setMapLayerType('satellite-streets');
    } else {
      setMapLayerType('satellite');
    }

    const [lng, lat] = track.coords;

    // Jeśli globus w 3D jest aktywny, płynnie obróć go i przybliż do punktu docelowego w stylu Google Earth
    if (globeInstanceRef.current && typeof globeInstanceRef.current.pointOfView === 'function') {
      globeInstanceRef.current.pointOfView({ lat, lng, altitude: 0.12 }, 1200);
    }

    setTimeout(() => {
      setIsFlying(false);
      setHasArrived(true);
    }, 1250);
  };

  // Inicjalizacja fotorealistycznej Kuli Ziemskiej 3D w stylu Google Earth (globe.gl + Three.js)
  useEffect(() => {
    if (hasArrived) {
      if (globeInstanceRef.current && typeof globeInstanceRef.current._destructor === 'function') {
        try { globeInstanceRef.current._destructor(); } catch (e) {}
        globeInstanceRef.current = null;
      }
      return;
    }

    const initGlobe = () => {
      if (!globeContainerRef.current || globeInstanceRef.current) return;
      const Globe = window.Globe;
      if (!Globe) return;

      globeContainerRef.current.innerHTML = '';
      const globe = Globe()(globeContainerRef.current)
        .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
        .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
        .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
        .atmosphereColor('#3a228a')
        .atmosphereAltitude(0.22)
        .pointsData(TRACK_DATABASE)
        .pointLat(d => d.coords[1])
        .pointLng(d => d.coords[0])
        .pointColor(() => '#ef4444')
        .pointAltitude(0.06)
        .pointRadius(0.65)
        .pointsMerge(false)
        .pointLabel(d => `
          <div style="background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(99, 102, 241, 0.6); padding: 8px 12px; border-radius: 10px; color: white; font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.6); pointer-events: none;">
            <div style="font-weight: bold; font-size: 13px; color: #38bdf8;">🚀 ${d.name}</div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">${d.city}</div>
            <div style="font-size: 10px; color: #10b981; margin-top: 4px; font-weight: 600;">Kliknij, aby zejść z kosmosu nad padok</div>
          </div>
        `)
        .onPointClick(d => triggerCinematicZoomToTrack(d))
        .onGlobeClick(({ lat, lng }) => {
          const customEarthSpot = {
            id: `earth-${lat.toFixed(4)}-${lng.toFixed(4)}`,
            name: `Obszar: ${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
            city: 'Wybrany punkt na Ziemi',
            coords: [lng, lat],
            w: 250,
            h: 180,
            bbox: `${lng-0.003},${lat-0.002},${lng+0.003},${lat+0.002}`,
            isCustomAddress: true
          };
          triggerCinematicZoomToTrack(customEarthSpot);
        });

      globe.controls().autoRotate = true;
      globe.controls().autoRotateSpeed = 0.5;
      globe.pointOfView({ lat: 51.5, lng: 18.0, altitude: 2.1 }, 1000);

      globeInstanceRef.current = globe;
      setIsGlobeReady(true);

      const handleResize = () => {
        if (globeInstanceRef.current && globeContainerRef.current) {
          globeInstanceRef.current.width(window.innerWidth).height(window.innerHeight);
        }
      };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    };

    if (!window.Globe) {
      if (!document.getElementById('three-js')) {
        const scriptThree = document.createElement('script');
        scriptThree.id = 'three-js';
        scriptThree.src = 'https://unpkg.com/three@0.160.0/build/three.min.js';
        document.head.appendChild(scriptThree);

        scriptThree.onload = () => {
          if (!document.getElementById('globe-gl-js')) {
            const scriptGlobe = document.createElement('script');
            scriptGlobe.id = 'globe-gl-js';
            scriptGlobe.src = 'https://unpkg.com/globe.gl@2.32.0/dist/globe.gl.min.js';
            scriptGlobe.onload = () => initGlobe();
            document.head.appendChild(scriptGlobe);
          } else {
            initGlobe();
          }
        };
      }
    } else {
      initGlobe();
    }

    return () => {
      if (globeInstanceRef.current && typeof globeInstanceRef.current._destructor === 'function') {
        try { globeInstanceRef.current._destructor(); } catch (e) {}
        globeInstanceRef.current = null;
      }
    };
  }, [hasArrived]);

  // Inicjalizacja pełnej, uniwersalnej mapy satelitarnej Leaflet po zejściu na Ziemię (z gwarantowanym przeliczeniem wymiarów)
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
      paddockMapContainerRef.current.innerHTML = '';
      
      const map = L.map(paddockMapContainerRef.current, {
        center: [lat, lng],
        zoom: selectedTrack.isCustomAddress ? 18 : 17,
        zoomControl: false,
        attributionControl: false,
      });

      paddockMapInstanceRef.current = map;

      // Kafelki satelitarne Esri HD z maxNativeZoom: 17
      const satEsriLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 17,
        maxZoom: 22,
      });

      // Kafelki hybrydowe Google (Satelita + Nazwy ulic i numerów domów - idealne dla dokładnych adresów!)
      const satGoogleHybridLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxNativeZoom: 20,
        maxZoom: 22,
      });

      // Kafelki drogowe OpenStreetMap
      const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxNativeZoom: 19,
        maxZoom: 22,
      });

      if (mapLayerType === 'street') {
        streetLayer.addTo(map);
      } else if (mapLayerType === 'satellite-streets') {
        satGoogleHybridLayer.addTo(map);
      } else {
        satEsriLayer.addTo(map);
      }

      // Kontrolki zoomu po prawej stronie
      L.control.zoom({ position: 'top-right' }).addTo(map);

      // Znacznik w centrum lądowania
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

      // Wielokrotne wywołanie invalidateSize gwarantuje, że kontener mapy dokładnie wypełni ekran bez pustego, ciemnego tła
      const forceResize = () => {
        if (paddockMapInstanceRef.current) {
          paddockMapInstanceRef.current.invalidateSize(true);
        }
      };
      setTimeout(forceResize, 50);
      setTimeout(forceResize, 150);
      setTimeout(forceResize, 350);
      setTimeout(forceResize, 600);
    };

    if (!window.L) {
      if (!document.getElementById('leaflet-js')) {
        const script = document.createElement('script');
        script.id = 'leaflet-js';
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => initMap();
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
  }, [hasArrived, selectedTrack, mapLayerType]);

  // Obsługa zatwierdzenia wykadrowanego obszaru na Ziemi
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

  // Zapis wykadrowanego obszaru z dowolnego miejsca na Ziemi do Firestore i przejście do Plannera
  const handleSaveCustomEventAndOpen = async () => {
    if (!confirmedBounds || isSavingCustomEvent) return;

    try {
      setIsSavingCustomEvent(true);
      const dimensions = calculateBoundsDimensionsMeters(confirmedBounds);
      const bboxStr = `${confirmedBounds.sw[0]},${confirmedBounds.sw[1]},${confirmedBounds.ne[0]},${confirmedBounds.ne[1]}`;
      const esriStaticUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bboxStr}&bboxSR=4326&size=1024,1024&imageSR=4326&format=png&f=image`;

      const eventData = {
        name: customEventName.trim() || 'Własny Padok na Ziemi',
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
    <div className="relative h-screen w-full overflow-hidden bg-[#040611] font-sans select-none">
      {/* Fotorealistyczna Ziemia 3D (Google Earth Style - globe.gl) */}
      {!hasArrived && (
        <div className="absolute inset-0 z-0 w-full h-full bg-[#040611] flex items-center justify-center">
          <div ref={globeContainerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
          {!isGlobeReady && (
            <div className="absolute z-10 flex flex-col items-center gap-3 bg-black/60 backdrop-blur-md px-6 py-4 rounded-2xl border border-indigo-500/40">
              <div className="w-8 h-8 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-indigo-300 font-mono font-bold">🌌 Ładowanie Ziemi 3D z kosmosu...</p>
            </div>
          )}
        </div>
      )}

      {/* Interaktywna mapa satelitarna z lotu ptaka (Pan & Zoom na CAŁY ŚWIAT) */}
      {hasArrived && selectedTrack && (
        <div className="absolute inset-0 z-0 w-full h-full bg-slate-950 animate-fade-in">
          <div ref={paddockMapContainerRef} className="absolute inset-0 z-10 w-full h-full cursor-grab active:cursor-grabbing" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/60 pointer-events-none z-20" />

          {/* Przełącznik warstwy mapy: Satelita+Ulice / Satelita Esri / Mapa drogowa */}
          <div className="absolute top-5 right-16 z-30 flex bg-black/75 backdrop-blur-md p-1 rounded-xl border border-white/20 shadow-lg gap-1">
            <button
              onClick={() => setMapLayerType('satellite-streets')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                mapLayerType === 'satellite-streets' ? 'bg-indigo-600 text-white shadow' : 'text-white/70 hover:text-white'
              }`}
              title="Satelita z nazwami ulic i numerami domów (Google Hybryda)"
            >
              🛰️ Satelita + Ulice
            </button>
            <button
              onClick={() => setMapLayerType('satellite')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                mapLayerType === 'satellite' ? 'bg-indigo-600 text-white shadow' : 'text-white/70 hover:text-white'
              }`}
              title="Czysty satelita (Esri HD)"
            >
              🛰️ Czysty Satelita
            </button>
            <button
              onClick={() => setMapLayerType('street')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                mapLayerType === 'street' ? 'bg-indigo-600 text-white shadow' : 'text-white/70 hover:text-white'
              }`}
              title="Mapa drogowa OpenStreetMap"
            >
              🗺️ Mapa Ulic
            </button>
          </div>
        </div>
      )}

      {/* Górny / Lewy Szklany Panel Wyszukiwarki na Całą Ziemię */}
      <div className="absolute top-5 left-5 z-30 w-full max-w-sm sm:max-w-md px-2 pointer-events-auto">
        <div className="glass-panel-strong p-4 rounded-2xl shadow-2xl border-white/25 backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
                <span className="text-base">🌍</span>
              </div>
              <div>
                <h1 className="text-xs sm:text-sm font-extrabold text-white tracking-wide">
                  GLOBUS PADOK PLANNER
                </h1>
                <p className="text-[10px] text-indigo-300/80 font-mono">
                  Google Earth & Satellite Explorer
                </p>
              </div>
            </div>
          </div>

          {/* Wyszukiwarka z obsługą Enter */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowDropdown(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearchEnter();
                }
              }}
              onFocus={() => setShowDropdown(true)}
              placeholder="🔍 Wpisz adres, miasto lub tor i naciśnij Enter..."
              className="w-full bg-black/60 border border-white/20 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-white/50 focus:outline-none focus:border-indigo-400 transition-all font-medium pr-24 shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-20 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-xs p-1"
              >
                ✕
              </button>
            )}
            <button
              onClick={handleSearchEnter}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-[11px] rounded-lg transition-all shadow-md flex items-center gap-1"
            >
              <span>Szukaj</span>
              <span>🚀</span>
            </button>
          </div>

          {/* Lista sugestii / Wyników z całej Ziemi */}
          {(showDropdown || !selectedTrack || !hasArrived) && (
            <div className="mt-3 max-h-[38vh] overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
              <div className="text-[10px] font-bold text-white/60 tracking-wider uppercase px-1 py-0.5 flex justify-between">
                <span>{searchQuery ? 'Wyniki wyszukiwania na Ziemi:' : 'Sławne Tory / Kliknij na Globus:'}</span>
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
                <div className="text-center py-4 text-xs text-white/60 bg-black/30 rounded-xl border border-white/5 p-3">
                  💡 Możesz wpisać dowolne miasto, ulicę lub współrzędne w okienku powyżej i nacisnąć <b>Enter</b>, albo po prostu <b>kliknąć w dowolny punkt na Ziemi 3D</b>!
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Status zejścia kinowego z kosmosu */}
      {isFlying && (
        <div className="absolute inset-0 z-40 bg-black/50 backdrop-blur-[2px] pointer-events-none flex flex-col items-center justify-center animate-fade-in">
          <div className="glass-panel-strong px-8 py-5 rounded-2xl flex items-center gap-4 border-indigo-400/40 shadow-[0_0_50px_rgba(99,102,241,0.4)]">
            <div className="w-9 h-9 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <div className="text-left">
              <h4 className="font-extrabold text-white text-base sm:text-lg tracking-wide">
                Zejście z kosmosu na Ziemię...
              </h4>
              <p className="text-xs text-indigo-300/90 font-mono">
                {selectedTrack ? selectedTrack.name : 'Przybliżanie satelitarne...'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Dolny Panel Akcji po wylądowaniu w dowolnym punkcie Ziemi */}
      {hasArrived && selectedTrack && !showCustomBoundsModal && !isCustomFramingMode && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-lg px-4 pointer-events-auto animate-slide-up">
          <div className="glass-panel-strong p-5 rounded-2xl border-indigo-400/50 shadow-[0_0_40px_rgba(79,46,229,0.35)] flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left min-w-0">
              <span className="inline-block px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold mb-1">
                ✔ CEL NA ZIEMI OSIĄGNIĘTY
              </span>
              <h3 className="text-sm sm:text-base font-extrabold text-white truncate">
                {selectedTrack.name}
              </h3>
              <p className="text-xs text-white/60 font-mono">
                Możesz przesuwać mapę i przybliżać w dowolne miejsce!
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              <button
                onClick={() => {
                  setHasArrived(false);
                  if (globeInstanceRef.current && typeof globeInstanceRef.current.pointOfView === 'function') {
                    globeInstanceRef.current.pointOfView({ lat: 51.5, lng: 18.0, altitude: 2.1 }, 1000);
                  }
                }}
                title="Wróć do widoku kuli ziemskiej w kosmosie"
                className="glass-button px-3.5 py-2.5 text-xs text-white/80 hover:text-white"
              >
                🌍 Globus
              </button>
              <button
                onClick={() => setIsCustomFramingMode(true)}
                title="Dopasuj ręcznie celownik obszaru na interaktywnej mapie"
                className="glass-button px-3.5 py-2.5 text-xs text-white/80 hover:text-white font-bold text-emerald-300 border-emerald-400/40"
              >
                📐 Kadruj obszar
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

      {/* Celownik HUD - kadrowanie DOWOLNEGO obszaru na Ziemi */}
      {hasArrived && isCustomFramingMode && (
        <>
          <div className="absolute inset-0 z-[450] pointer-events-none flex items-center justify-center p-4">
            <div
              ref={viewfinderRef}
              className="w-[85vw] max-w-[480px] h-[60vh] max-h-[520px] border-2 border-emerald-400/80 rounded-3xl bg-emerald-500/10 backdrop-blur-[1px] shadow-[0_0_60px_rgba(16,185,129,0.25)] flex flex-col justify-between p-5 relative animate-fade-in"
            >
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-emerald-300 rounded-tl-2xl -translate-x-1 -translate-y-1" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-emerald-300 rounded-tr-2xl translate-x-1 -translate-y-1" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-emerald-300 rounded-bl-2xl -translate-x-1 translate-y-1" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-emerald-300 rounded-br-2xl translate-x-1 translate-y-1" />

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center opacity-60">
                <div className="w-full h-[1px] bg-emerald-400 absolute" />
                <div className="h-full w-[1px] bg-emerald-400 absolute" />
              </div>

              <div className="self-center bg-black/75 px-3.5 py-1 rounded-full border border-emerald-400/50 text-[11px] font-mono text-emerald-300 shadow">
                🎯 KADROWANIE DOWOLNEGO MIEJSCA NA ZIEMI
              </div>

              <div className="text-center bg-black/75 px-3.5 py-2 rounded-xl border border-white/15 text-xs text-white/90 shadow">
                Przesuń mapę i dopasuj zoom tak, by Twój przyszły padok znalazł się dokładnie w centrum celownika
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
              className="glass-button-primary px-7 py-3 text-xs sm:text-sm font-bold flex items-center gap-2 shadow-xl"
            >
              <span>Zatwierdź ten obszar pod Padok</span>
              <span>✔</span>
            </button>
          </div>
        </>
      )}

      {/* Modal Potwierdzenia i Zapisywania Niestandardowego Kadru (Haversine) */}
      {showCustomBoundsModal && confirmedBounds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in pointer-events-auto">
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
              Wymiary fizyczne wyciętego obszaru obliczone automatycznie wzorem Haversine'a.
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
                <span>Źródło mapy:</span>
                <span className="text-emerald-400">{mapLayerType === 'street' ? 'OpenStreetMap Street' : 'Esri / Google Satellite HD'}</span>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-xs font-semibold text-white/80 mb-2">
                Nazwa Padoku / Wydarzenia na Ziemi:
              </label>
              <input
                type="text"
                value={customEventName}
                onChange={(e) => setCustomEventName(e.target.value)}
                placeholder="np. Warszawa — Strefa Serwisowa"
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
