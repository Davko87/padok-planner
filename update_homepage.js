const fs = require('fs');

let content = fs.readFileSync('/Users/davko/Projekty/Padok/src/pages/HomePage.jsx', 'utf8');

// Imports
content = content.replace(
  `import { Map, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';`,
  `import { Map3D, useMap3D, useMapsLibrary } from '@vis.gl/react-google-maps';`
);

// Map usage in HomePage
content = content.replace(
  `const map = useMap();`,
  `const map = useMap3D();\n  const [camera, setCamera] = useState({ center: { lat: 51.5, lng: 18.0, altitude: 5000000 }, range: 5000000, tilt: 0, heading: 0 });`
);

// PlacesService initialization
content = content.replace(
  `setPlacesService(new placesLibrary.PlacesService(map));`,
  `setPlacesService(new placesLibrary.PlacesService(document.createElement('div')));`
);

// Camera move
content = content.replace(
  `        // Lot kinowy w pełne 3D
        map.moveCamera({
          center: { lat, lng },
          zoom: 17.5,
          tilt: 55,
          heading: 0
        });`,
  `        // Lot kinowy w pełne 3D
        setCamera({
          center: { lat, lng, altitude: 0 },
          range: 800,
          tilt: 55,
          heading: 0
        });`
);

// Return to space
content = content.replace(
  `    if (map) {
      map.moveCamera({ center: { lat: 51.5, lng: 18.0 }, zoom: 3, tilt: 0, heading: 0 });
    }`,
  `    setCamera({ center: { lat: 51.5, lng: 18.0, altitude: 5000000 }, range: 5000000, tilt: 0, heading: 0 });`
);

// Lasso logic removal (replace with simple Marker3D element appending)
content = content.replace(/  \/\/ Rysowanie Poligonu na Google Maps \(Lasso\)[\s\S]*?(?=  \/\/ Kliknięcie mapy przy rysowaniu)/, `  // Rysowanie Pinezek 3D (Zamiast poligonu)
  useEffect(() => {
    if (!map || !window.google) return;

    // Usunięcie starych markerów
    markersRef.current.forEach(m => {
      if (m && m.parentNode) m.parentNode.removeChild(m);
    });
    markersRef.current = [];

    if (!isCustomFramingMode) return;

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
      });
      marker.append(pinDiv);
      map.append(marker);

      markersRef.current.push(marker);
    });
  }, [map, isCustomFramingMode, polygonPoints, isPolygonClosed]);\n\n`);

content = content.replace(
  `    const listener = map.addListener('click', (e) => {`,
  `    const listener = map.addEventListener('gmp-click', (e) => {`
);

content = content.replace(
  `      setPolygonPoints(prev => [...prev, [e.latLng.lat(), e.latLng.lng()]]);`,
  `      if (e.position) setPolygonPoints(prev => [...prev, [e.position.lat, e.position.lng]]);`
);

content = content.replace(
  `    return () => window.google.maps.event.removeListener(listener);`,
  `    return () => map.removeEventListener('gmp-click', listener);`
);

content = content.replace(
  `zoom: map ? map.getZoom() : 18`,
  `zoom: 18` // We no longer have getZoom() easily, fake it to 18
);

content = content.replace(
  `zoom: map ? map.getZoom() : 17`,
  `zoom: 17`
);

// The Map JSX
content = content.replace(
  `        <Map
          mapId={import.meta.env.VITE_GOOGLE_MAPS_MAP_ID}
          defaultCenter={{ lat: 51.5, lng: 18.0 }}
          defaultZoom={3}
          disableDefaultUI={true}
          gestureHandling="greedy"
          mapTypeId="hybrid"
          renderingType="VECTOR"
        />`,
  `        <Map3D
          center={camera.center}
          range={camera.range}
          tilt={camera.tilt}
          heading={camera.heading}
          onCameraChanged={(e) => {
            setCamera({
              center: e.detail.center,
              range: e.detail.range,
              tilt: e.detail.tilt,
              heading: e.detail.heading
            });
          }}
          defaultLabelsDisabled={false}
        />`
);

fs.writeFileSync('/Users/davko/Projekty/Padok/src/pages/HomePage.jsx', content);
