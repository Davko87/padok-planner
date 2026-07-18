import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { calculateBoundsDimensionsMeters } from '../lib/geoUtils.js';
import { useAuth } from '../context/AuthContext.jsx';
import { LoginModal, RegisterModal, DeleteAccountModal } from '../components/AuthModals.jsx';

function HomePage() {
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  
  // Kontenery dla Globusu 3D (globe.gl) oraz Mapy Satelitarnej (Leaflet)
  const globeContainerRef = useRef(null);
  const globeInstanceRef = useRef(null);
  const paddockMapContainerRef = useRef(null);
  const paddockMapInstanceRef = useRef(null);

  // Warstwy i markery wielokąta w trybie kadrowania (Polygon Lasso)
  const polygonLayerRef = useRef(null);
  const polylineLayerRef = useRef(null);
  const vertexMarkersRef = useRef([]);
  const tileLayerRef = useRef(null);

  // Wyszukiwarka na całej kuli ziemskiej w stylu Google Maps
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isGlobeReady, setIsGlobeReady] = useState(false);

  // Stan lotu kamery i wybrany punkt na Ziemi
  const [isFlying, setIsFlying] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [isCustomFramingMode, setIsCustomFramingMode] = useState(false);
  
  // Rysowanie wielokąta punkt po punkcie: [[lat, lng], ...] oraz czy obwód został zamknięty
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [isPolygonClosed, setIsPolygonClosed] = useState(false);

  const [showCustomBoundsModal, setShowCustomBoundsModal] = useState(false);
  const [confirmedBounds, setConfirmedBounds] = useState(null);
  const [customEventName, setCustomEventName] = useState('');
  const [isSavingCustomEvent, setIsSavingCustomEvent] = useState(false);
  
  // Warstwa mapy: 'satellite-streets' (Google Hybryda z nazwami ulic) | 'satellite' (Esri HD) | 'street' (OSM)
  const [mapLayerType, setMapLayerType] = useState('satellite-streets');

  // Funkcja pomocnicza do czyszczenia i elastycznego wyszukiwania adresów (z tolerancją na przecinki, numery i spacje)
  const fetchGeocodingResults = async (queryText) => {
    const cleaned = queryText.replace(/\s+/g, ' ').trim();
    if (cleaned.length < 3) return [];

    try {
      // 1. Próba wyszukiwania dokładnego (z przecinkami lub bez)
      let resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleaned)}&addressdetails=1&limit=5`,
        { headers: { 'Accept-Language': 'pl,en;q=0.9' } }
      );
      let data = resp.ok ? await resp.json() : [];

      // 2. Jeśli brak wyników, a zapytanie ma numer lub przecinek (np. "Lipowa 148, Poznań" -> "Lipowa, Poznań" lub "Poznań Lipowa")
      if (data.length === 0 && (cleaned.includes(',') || /\d+/.test(cleaned))) {
        const withoutNumbers = cleaned.replace(/\d+[a-zA-Z]?/g, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
        if (withoutNumbers.length >= 3 && withoutNumbers !== cleaned) {
          resp = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(withoutNumbers)}&addressdetails=1&limit=5`,
            { headers: { 'Accept-Language': 'pl,en;q=0.9' } }
          );
          if (resp.ok) {
            data = await resp.json();
          }
        }
      }

      return data.map((item, idx) => {
        const addr = item.address || {};
        const road = addr.road || addr.pedestrian || addr.street || addr.suburb || '';
        const houseNumber = addr.house_number || '';
        const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
        const state = addr.state || addr.country || '';

        let mainName = item.display_name.split(',')[0];
        if (road) {
          mainName = houseNumber ? `${road} ${houseNumber}` : road;
        }

        let subName = [city, state].filter(Boolean).join(', ');
        if (!subName) {
          subName = item.display_name.split(',').slice(1, 3).join(', ').trim();
        }

        return {
          id: `osm-${item.place_id || idx}-${Date.now()}`,
          name: mainName,
          city: subName,
          coords: [parseFloat(item.lon), parseFloat(item.lat)],
          w: 250,
          h: 180,
          bbox: `${parseFloat(item.lon)-0.003},${parseFloat(item.lat)-0.002},${parseFloat(item.lon)+0.003},${parseFloat(item.lat)+0.002}`,
          isCustomAddress: true
        };
      });
    } catch (err) {
      console.warn('Błąd geokodowania Nominatim:', err);
      return [];
    }
  };

  // Wyszukiwanie w czasie rzeczywistym z debounce
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 3) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingOnline(true);
      const results = await fetchGeocodingResults(searchQuery);
      setSearchResults(results);
      setIsSearchingOnline(false);
    }, 450);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Obsługa naciśnięcia klawisza Enter w wyszukiwarce
  const handleSearchEnter = async () => {
    if (!searchQuery.trim()) return;
    setShowDropdown(false);

    setIsSearchingOnline(true);
    try {
      const results = await fetchGeocodingResults(searchQuery);
      if (results && results.length > 0) {
        triggerCinematicZoomToTrack(results[0]);
      } else {
        alert('Nie znaleziono takiego adresu lub miasta na Ziemi. Spróbuj wpisać nazwę samej ulicy lub miasta.');
      }
    } catch (err) {
      console.error('Błąd wyszukiwania Enter:', err);
      alert('Wystąpił błąd podczas wyszukiwania na kuli ziemskiej.');
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

    if (track.isCustomAddress) {
      setMapLayerType('satellite-streets');
    } else {
      setMapLayerType('satellite');
    }

    const [lng, lat] = track.coords;

    if (globeInstanceRef.current && typeof globeInstanceRef.current.pointOfView === 'function') {
      globeInstanceRef.current.pointOfView({ lat, lng, altitude: 0.12 }, 1200);
    }

    setTimeout(() => {
      setIsFlying(false);
      setHasArrived(true);
    }, 1250);
  };

  // 1. CZYSTA, ULTRA-REALISTYCZNA KULA ZIEMSKA 8K W KOSMOSIE (Bez żadnych znaczników i torów)
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
        // Podmiana na fotorealistyczne tekstury Ultra HD (8K Blue Marble + Topografia + Woda)
        .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
        .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
        .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
        .atmosphereColor('#38bdf8')
        .atmosphereAltitude(0.20)
        // Całkowity brak czerwonych pinezek i torów - czysta Ziemia z kosmosu
        .pointsData([])
        .onGlobeClick(({ lat, lng }) => {
          const customEarthSpot = {
            id: `earth-${lat.toFixed(4)}-${lng.toFixed(4)}`,
            name: `Obszar: ${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
            city: 'Wybrany punkt na Ziemi',
            coords: [lng, lat],
            w: 250,
            h: 180,
            bbox: `${lng-0.003},${lat-0.002},${lng+0.003},${lat+0.002}`,
            isCustomAddress: true,
            isGlobeClick: true
          };
          triggerCinematicZoomToTrack(customEarthSpot);
        });

      globe.controls().autoRotate = true;
      globe.controls().autoRotateSpeed = 0.4;
      globe.pointOfView({ lat: 51.5, lng: 18.0, altitude: 2.2 }, 1000);

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

  // 2. NAPRAWA PRZEŁĄCZNIKÓW WARSTW MAPY (Silnik tworzony tylko raz przy wylądowaniu na Ziemi)
  useEffect(() => {
    if (!hasArrived || !selectedTrack) {
      if (paddockMapInstanceRef.current) {
        paddockMapInstanceRef.current.remove();
        paddockMapInstanceRef.current = null;
        tileLayerRef.current = null;
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
        zoom: selectedTrack.isGlobeClick ? 14 : (selectedTrack.isCustomAddress ? 18 : 17),
        zoomControl: false,
        attributionControl: false,
      });

      // Zabezpieczenie rozmiaru kontenera, żeby uniknąć szarego ekranu po wylądowaniu
      setTimeout(() => {
        if (paddockMapInstanceRef.current) {
          paddockMapInstanceRef.current.invalidateSize();
        }
      }, 200);

      paddockMapInstanceRef.current = map;

      const getLayerUrl = (type) => {
        if (type === 'street') {
          return { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', maxNativeZoom: 19 };
        } else if (type === 'satellite-streets') {
          return { url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', maxNativeZoom: 20 };
        }
        return { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 17 };
      };

      const layerConfig = getLayerUrl(mapLayerType);
      const layer = L.tileLayer(layerConfig.url, {
        maxNativeZoom: layerConfig.maxNativeZoom,
        maxZoom: 22,
      }).addTo(map);
      tileLayerRef.current = layer;

      L.control.zoom({ position: 'top-right' }).addTo(map);

      // Główny znacznik w centrum lądowania
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

      // Obsługa kliknięć na mapie podczas rysowania wielokąta (Polygon Lasso)
      map.on('click', (e) => {
        // Kliknięcie zostanie obsłużone w dedykowanym stanie/efekcie rysowania wielokąta
      });

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
        tileLayerRef.current = null;
      }
    };
  }, [hasArrived, selectedTrack]);

  // Płynna zmiana warstwy kafelków po kliknięciu przycisków (bez niszczenia mapy ani zawieszania)
  useEffect(() => {
    const map = paddockMapInstanceRef.current;
    const L = window.L;
    if (!map || !L || !tileLayerRef.current) return;

    map.removeLayer(tileLayerRef.current);

    let url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    let maxNativeZoom = 17;

    if (mapLayerType === 'street') {
      url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      maxNativeZoom = 19;
    } else if (mapLayerType === 'satellite-streets') {
      url = 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
      maxNativeZoom = 20;
    }

    const newLayer = L.tileLayer(url, {
      maxNativeZoom,
      maxZoom: 22,
    }).addTo(map);

    tileLayerRef.current = newLayer;
  }, [mapLayerType]);

  // 3. RYSOWANIE WIELOKĄTA PUNKT PO PUNKCIE Z ZAMKNIĘCIEM NA PIERWSZEJ KROPCE (POLYGON LASSO)
  const startPolygonFraming = () => {
    setIsCustomFramingMode(true);
    setPolygonPoints([]);
    setIsPolygonClosed(false);
  };

  // Nasłuch kliknięć na mapie do wstawiania kolejnych rogów wielokąta
  useEffect(() => {
    const map = paddockMapInstanceRef.current;
    if (!map || !isCustomFramingMode || isPolygonClosed) return;

    const handleMapClick = (e) => {
      setPolygonPoints(prev => [...prev, [e.latlng.lat, e.latlng.lng]]);
    };

    map.on('click', handleMapClick);
    return () => map.off('click', handleMapClick);
  }, [isCustomFramingMode, isPolygonClosed]);

  // Rysowanie obwodu wielokąta, linii oraz punktów startowych i narożnych w Leaflet
  useEffect(() => {
    const map = paddockMapInstanceRef.current;
    const L = window.L;
    if (!map || !L || !isCustomFramingMode) {
      if (polygonLayerRef.current) { polygonLayerRef.current.remove(); polygonLayerRef.current = null; }
      if (polylineLayerRef.current) { polylineLayerRef.current.remove(); polylineLayerRef.current = null; }
      vertexMarkersRef.current.forEach(m => m.remove());
      vertexMarkersRef.current = [];
      return;
    }

    // Usuń stare kształty przed narysowaniem aktualnego stanu
    if (polygonLayerRef.current) polygonLayerRef.current.remove();
    if (polylineLayerRef.current) polylineLayerRef.current.remove();
    vertexMarkersRef.current.forEach(m => m.remove());
    vertexMarkersRef.current = [];

    if (polygonPoints.length === 0) return;

    if (isPolygonClosed && polygonPoints.length >= 3) {
      // Zamknięty wielokąt gotowy pod padok
      const poly = L.polygon(polygonPoints, {
        color: '#10b981',
        weight: 3.5,
        dashArray: '8, 6',
        fillColor: '#10b981',
        fillOpacity: 0.35,
      }).addTo(map);
      polygonLayerRef.current = poly;
    } else if (polygonPoints.length >= 2) {
      // Otwarta przerywana linia w trakcie rysowania
      const line = L.polyline(polygonPoints, {
        color: '#38bdf8',
        weight: 3,
        dashArray: '6, 6',
      }).addTo(map);
      polylineLayerRef.current = line;
    }

    // Rysowanie znaczników dla każdego punktu
    polygonPoints.forEach((pt, idx) => {
      const isStartPoint = idx === 0;
      let markerHtml = '';

      if (isStartPoint && !isPolygonClosed && polygonPoints.length >= 3) {
        // Specjalny pulsujący przycisk startowy do zamknięcia pętli
        markerHtml = `
          <div style="position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer;" title="Kliknij tutaj, aby zamknąć obwód padoku!">
            <div style="position: absolute; width: 44px; height: 44px; background: rgba(16,185,129,0.4); border-radius: 50%; animation: pulse 1s infinite;"></div>
            <div style="width: 28px; height: 28px; background: #10b981; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 0 15px rgba(16,185,129,1); display: flex; align-items: center; justify-content: center; color: black; font-weight: 900; font-size: 13px;">1</div>
          </div>
        `;
      } else {
        markerHtml = `
          <div style="width: 24px; height: 24px; background: ${isStartPoint ? '#10b981' : '#38bdf8'}; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 10px rgba(0,0,0,0.8); cursor: move; display: flex; align-items: center; justify-content: center; color: #040611; font-weight: 800; font-size: 11px;">
            ${idx + 1}
          </div>
        `;
      }

      const icon = L.divIcon({
        className: 'custom-lasso-marker',
        html: markerHtml,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      const marker = L.marker(pt, { draggable: true, icon }).addTo(map);

      // Kliknięcie w punkt nr 1 zamyka figurę, jeśli narysowano minimum 3 rogi!
      if (isStartPoint && !isPolygonClosed) {
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (polygonPoints.length >= 3) {
            setIsPolygonClosed(true);
          } else {
            alert('Wielokąt musi mieć przynajmniej 3 punkty, aby można było zamknąć granice!');
          }
        });
      }

      // Przeciąganie dowolnego rogu aktualizuje kształt na żywo
      marker.on('drag', (e) => {
        const newLatLng = e.target.getLatLng();
        setPolygonPoints(prev => {
          const updated = [...prev];
          updated[idx] = [newLatLng.lat, newLatLng.lng];
          return updated;
        });
      });

      vertexMarkersRef.current.push(marker);
    });

  }, [isCustomFramingMode, polygonPoints, isPolygonClosed]);

  // Obsługa zatwierdzenia wykadrowanego wielokąta na Ziemi
  const handleConfirmCustomBounds = () => {
    if (!selectedTrack) return;
    const map = paddockMapInstanceRef.current;

    let boundsObj;
    if (isCustomFramingMode && isPolygonClosed && polygonPoints.length >= 3) {
      const lats = polygonPoints.map(p => p[0]);
      const lngs = polygonPoints.map(p => p[1]);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      boundsObj = {
        sw: [minLng, minLat],
        ne: [maxLng, maxLat],
        center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
        zoom: map ? map.getZoom() : 18,
        polygonVertices: polygonPoints,
      };
    } else if (map) {
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

  // 5. ZAPIS W 0 SEKUND (LIMIT 2.5s) ORAZ TŁO ULTRA HD DO PLANNERA (2048x2048 px BEZ PIKSELOZY)
  const handleSaveCustomEventAndOpen = async () => {
    if (!confirmedBounds || isSavingCustomEvent) return;

    try {
      setIsSavingCustomEvent(true);
      const dimensions = calculateBoundsDimensionsMeters(confirmedBounds);
      const bboxStr = `${confirmedBounds.sw[0]},${confirmedBounds.sw[1]},${confirmedBounds.ne[0]},${confirmedBounds.ne[1]}`;
      
      // Rozdzielczość Ultra HD 2048x2048 (4-krotnie wyższa rozdzielczość w celu wyeliminowania pikselozy na płótnie!)
      const esriStaticUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bboxStr}&bboxSR=4326&size=2048,2048&imageSR=4326&format=png&f=image`;

      const eventData = {
        name: customEventName.trim() || 'Własny Padok na Ziemi',
        imageUrl: esriStaticUrl,
        widthMeters: dimensions.widthMeters || 250,
        heightMeters: dimensions.heightMeters || 180,
        bounds: confirmedBounds,
        polygonVertices: confirmedBounds.polygonVertices || null,
        createdAt: Date.now(),
      };

      let newId;
      try {
        const savePromise = addDoc(collection(db, 'events'), { ...eventData, createdAt: serverTimestamp() });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 2500));
        const docRef = await Promise.race([savePromise, timeoutPromise]);
        newId = docRef.id;
      } catch (err) {
        console.warn('Chmura Firestore niedostępna lub wolna -> natychmiastowy zapis Offline:', err);
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
      {/* Panel Logowania / Rejestracji w prawym górnym rogu */}
      <div className="absolute top-5 right-5 z-40 flex items-center gap-2 pointer-events-auto">
        {currentUser ? (
          <div className="glass-panel-strong px-3.5 py-1.5 rounded-xl border-white/20 flex items-center gap-3 shadow-glass">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-white tracking-wide">
                {currentUser.nick}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={logout}
                className="text-[11px] text-white/60 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-lg border border-white/10 transition-all active:scale-95"
                title="Wyloguj się"
              >
                Wyloguj
              </button>
              <button
                onClick={() => setIsDeleteModalOpen(true)}
                className="text-[11px] text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1 rounded-lg border border-red-500/20 transition-all active:scale-95"
                title="Usuń konto"
              >
                Usuń konto
              </button>
            </div>
          </div>
        ) : (
          <div className="glass-panel-strong p-1.5 rounded-xl border-white/20 flex items-center gap-1.5 shadow-glass">
            <button
              onClick={() => setIsLoginModalOpen(true)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-95"
            >
              Zaloguj
            </button>
            <button
              onClick={() => setIsRegisterModalOpen(true)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white transition-all shadow-md"
            >
              Zarejestruj
            </button>
          </div>
        )}
      </div>

      {/* 1. Fotorealistyczna Ziemia 3D 8K (Czysta Kula Ziemska z kosmosu bez znaczników) */}
      {!hasArrived && (
        <div className="absolute inset-0 z-0 w-full h-full bg-[#040611] flex items-center justify-center">
          <div ref={globeContainerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
          {!isGlobeReady && (
            <div className="absolute z-10 flex flex-col items-center gap-3 bg-black/60 backdrop-blur-md px-6 py-4 rounded-2xl border border-indigo-500/40">
              <div className="w-8 h-8 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-indigo-300 font-mono font-bold">🌌 Ładowanie Ziemi Ultra HD z kosmosu...</p>
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
          <div className="absolute top-20 right-5 z-30 flex bg-black/75 backdrop-blur-md p-1 rounded-xl border border-white/20 shadow-lg gap-1">
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

      {/* Górny / Lewy Szklany Panel Wyszukiwarki na Całą Ziemię w stylu Google Maps */}
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

          {/* Wyszukiwarka z tolerancją na przecinki, numery i Enter */}
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
              placeholder="🔍 Wpisz np. Lipowa 12, Poznań lub miasto i naciśnij Enter..."
              className="w-full bg-black/60 border border-white/20 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-white/50 focus:outline-none focus:border-indigo-400 transition-all font-medium pr-24 shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                }}
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

          {/* Lista sugestii / Wyników wyszukiwania (wyświetlana TYLKO po wpisaniu min. 3 liter) */}
          {showDropdown && searchResults.length > 0 && (
            <div className="mt-3 max-h-[38vh] overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
              <div className="text-[10px] font-bold text-white/60 tracking-wider uppercase px-1 py-0.5 flex justify-between">
                <span>Wyniki na kuli ziemskiej:</span>
                {isSearchingOnline && <span className="text-indigo-400 animate-pulse">Szukanie w świecie...</span>}
              </div>

              {searchResults.map((track) => (
                <button
                  key={track.id}
                  onClick={() => triggerCinematicZoomToTrack(track)}
                  className="w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between group bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/25"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors truncate">
                      🏡 {track.name}
                    </p>
                    <p className="text-[10px] text-white/50 font-mono truncate">
                      {track.city}
                    </p>
                  </div>
                  <div className="w-6 h-6 rounded-lg bg-white/10 group-hover:bg-indigo-500/30 flex items-center justify-center text-white/70 group-hover:text-white shrink-0 transition-all">
                    🚀
                  </div>
                </button>
              ))}
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
                Zejście z kosmosu nad wybrany adres...
              </h4>
              <p className="text-xs text-indigo-300/90 font-mono">
                {selectedTrack ? selectedTrack.name : 'Przybliżanie satelitarne...'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Dolny Panel Akcji po wylądowaniu na Ziemi */}
      {hasArrived && selectedTrack && !showCustomBoundsModal && !isCustomFramingMode && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 w-[95vw] max-w-4xl pointer-events-auto animate-slide-up">
          <div className="glass-panel-strong px-6 py-4 md:px-8 md:py-5 rounded-3xl border-indigo-400/40 shadow-[0_16px_50px_rgba(0,0,0,0.85)] backdrop-blur-2xl bg-slate-950/85 flex flex-col md:flex-row items-center justify-between gap-5">
            {/* Sekcja tekstowa - szeroka, czytelna, bez obcinania liter do 'J..' i bez brzydkiego zawijania słów */}
            <div className="text-center md:text-left min-w-0 flex-1">
              <div className="flex items-center justify-center md:justify-start gap-2 mb-1.5 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Cel na Ziemi osiągnięty
                </span>
                {selectedTrack?.city && (
                  <span className="text-xs text-indigo-300/80 font-medium px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-400/20">
                    📍 {selectedTrack.city}
                  </span>
                )}
              </div>
              <h3 className="text-lg md:text-xl font-extrabold text-white tracking-tight leading-snug mb-1 break-words">
                {selectedTrack.name}
              </h3>
              <p className="text-xs md:text-sm text-white/70 font-mono">
                Możesz swobodnie przesuwać i przybliżać mapę, aby wybrać dokładne miejsce pod padok.
              </p>
            </div>

            {/* Sekcja przycisków - symetryczna, szeroka i wyraźna */}
            <div className="flex items-center justify-center gap-3 shrink-0 w-full md:w-auto flex-wrap sm:flex-nowrap">
              <button
                onClick={() => {
                  setHasArrived(false);
                  if (globeInstanceRef.current && typeof globeInstanceRef.current.pointOfView === 'function') {
                    globeInstanceRef.current.pointOfView({ lat: 51.5, lng: 18.0, altitude: 2.2 }, 1000);
                  }
                }}
                title="Wróć do widoku kuli ziemskiej w kosmosie"
                className="glass-button px-4 py-3 rounded-xl text-xs sm:text-sm font-semibold text-white/90 hover:text-white hover:bg-white/15 transition-all flex items-center gap-2"
              >
                <span>🌍</span>
                <span>Globus</span>
              </button>

              <button
                onClick={startPolygonFraming}
                title="Narysuj wielokątną granicę padoku w terenie (Polygon Lasso)"
                className="glass-button px-4 py-3 rounded-xl text-xs sm:text-sm font-bold text-emerald-300 hover:text-emerald-200 border-emerald-400/40 hover:border-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.2)]"
              >
                <span>📐</span>
                <span>Kadruj obszar</span>
              </button>

              <button
                onClick={() => {
                  if (!selectedTrack.isCustomAddress) {
                    navigate(`/planner/${selectedTrack.id}`);
                  } else {
                    handleConfirmCustomBounds();
                  }
                }}
                className="glass-button-primary px-6 py-3 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(99,102,241,0.5)] hover:scale-105 transition-all shrink-0"
              >
                <span>Zaplanuj Padok</span>
                <span className="text-base">🚀</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Panel i baner podczas rysowania wielokąta (Polygon Lasso) */}
      {hasArrived && isCustomFramingMode && (
        <>
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[450] pointer-events-auto bg-black/90 backdrop-blur-md px-6 py-3.5 rounded-2xl border border-emerald-400/70 shadow-[0_0_30px_rgba(16,185,129,0.35)] flex flex-col sm:flex-row items-center gap-3 animate-fade-in max-w-2xl text-center">
            {polygonPoints.length === 0 && (
              <span className="text-xs font-extrabold text-emerald-300 flex items-center gap-2">
                <span>✏️ KLIKNIJ W DOWOLNYM MIEJSCU NA MAPIE, ABY POSTAWIĆ PIERWSZY PUNKT GRANICY</span>
              </span>
            )}
            {polygonPoints.length > 0 && !isPolygonClosed && (
              <span className="text-xs font-extrabold text-emerald-300 flex items-center gap-2">
                <span>📍 Klikaj kolejne punkty wzdłuż placu ({polygonPoints.length} punkty). Aby zamknąć kadr, kliknij z powrotem w <b>KROPKĘ NR 1</b>!</span>
              </span>
            )}
            {isPolygonClosed && (
              <span className="text-xs font-extrabold text-emerald-300 flex items-center gap-2">
                <span>✔ OBWÓD ZAMKNIĘTY! Gotowe do zatwierdzenia lub dalszego przeciągania rogów.</span>
              </span>
            )}

            <div className="flex items-center gap-2 shrink-0">
              {polygonPoints.length > 0 && !isPolygonClosed && (
                <button
                  onClick={() => setPolygonPoints(prev => prev.slice(0, -1))}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-lg transition-all shadow"
                >
                  🗑️ Cofnij punkt
                </button>
              )}
              {polygonPoints.length > 0 && (
                <button
                  onClick={() => { setPolygonPoints([]); setIsPolygonClosed(false); }}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs rounded-lg transition-all"
                >
                  🔁 Od nowa
                </button>
              )}
            </div>
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 pointer-events-auto animate-slide-up">
            <button
              onClick={() => setIsCustomFramingMode(false)}
              className="glass-button py-3 px-5 text-xs text-white/80"
            >
              Anuluj
            </button>
            {isPolygonClosed && polygonPoints.length >= 3 && (
              <button
                onClick={handleConfirmCustomBounds}
                className="glass-button-primary px-7 py-3 text-xs sm:text-sm font-bold flex items-center gap-2 shadow-xl border border-emerald-400"
              >
                <span>Zatwierdź ten kształt pod Padok</span>
                <span>✔</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* Modal Potwierdzenia i Zapisywania Niestandardowego Kadru (Haversine + Ultra HD) */}
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
              🏎️ Potwierdź Strefę Padoku (Ultra HD)
            </h3>
            <p className="text-xs text-white/60 mb-5">
              Wymiary fizyczne wyciętego obszaru obliczone automatycznie wzorem Haversine'a na podstawie narysowanego kształtu.
            </p>

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
              <div className="flex justify-between text-white/60">
                <span>Liczba rogów:</span>
                <span className="text-emerald-300">{confirmedBounds.polygonVertices ? confirmedBounds.polygonVertices.length : 4} punktów</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-white/10 text-[10px] text-white/50">
                <span>Jakość eksportu:</span>
                <span className="text-emerald-400 font-bold">Ultra HD (2048×2048 px)</span>
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
                {isSavingCustomEvent ? 'Zapisywanie...' : 'Otwórz Planner 🚀'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale logowania i rejestracji */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onSwitchToRegister={() => setIsRegisterModalOpen(true)}
      />
      <RegisterModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        onSwitchToLogin={() => setIsLoginModalOpen(true)}
      />
      <DeleteAccountModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
      />
    </div>
  );
}

export default HomePage;
