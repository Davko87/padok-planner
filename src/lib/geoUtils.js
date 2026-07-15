/**
 * Oblicza odległość między dwoma punktami geograficznymi na Ziemi w metrach
 * z wykorzystaniem wzoru Haversine'a (Haversine formula).
 *
 * @param {number} lat1 - Szerokość geograficzna pierwszego punktu [stopnie]
 * @param {number} lon1 - Długość geograficzna pierwszego punktu [stopnie]
 * @param {number} lat2 - Szerokość geograficzna drugiego punktu [stopnie]
 * @param {number} lon2 - Długość geograficzna drugiego punktu [stopnie]
 * @returns {number} Odległość w metrach
 */
export function calculateHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Promień Ziemi w metrach
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Oblicza fizyczną szerokość i wysokość w metrach dla obszaru wyznaczonego przez Bounds.
 *
 * @param {{ sw: [number, number], ne: [number, number] }} bounds - { sw: [lng, lat], ne: [lng, lat] }
 * @returns {{ widthMeters: number, heightMeters: number }}
 */
export function calculateBoundsDimensionsMeters(bounds) {
  if (!bounds || !bounds.sw || !bounds.ne) {
    return { widthMeters: 200, heightMeters: 200 };
  }

  const [swLng, swLat] = bounds.sw;
  const [neLng, neLat] = bounds.ne;

  // Szerokość: odległość od SW do SE (ta sama szerokość geograficzna, zmiana długości)
  const widthMeters = calculateHaversineDistanceMeters(swLat, swLng, swLat, neLng);

  // Wysokość: odległość od SW do NW (ta sama długość geograficzna, zmiana szerokości)
  const heightMeters = calculateHaversineDistanceMeters(swLat, swLng, neLat, swLng);

  return {
    widthMeters: Math.round(widthMeters * 10) / 10,
    heightMeters: Math.round(heightMeters * 10) / 10,
  };
}

/**
 * Buduje URL do Google Static Maps API z wyłączonymi etykietami i POI.
 * Jeśli brakuje klucza Google, buduje alternatywny URL Mapbox Static Images API.
 *
 * @param {{ center: [number, number], zoom: number, sw?: [number, number], ne?: [number, number] }} bounds
 * @param {string} googleApiKey
 * @param {string} [mapboxToken]
 * @returns {string} Publiczny URL statycznego obrazu satelitarnego
 */
export function buildStaticMapUrl(bounds, googleApiKey, mapboxToken) {
  const [centerLng, centerLat] = bounds.center || [16.7962, 52.4185];
  const zoom = Math.max(12, Math.min(20, Math.round((bounds.zoom || 17) * 10) / 10));

  if (googleApiKey && googleApiKey.trim()) {
    // Google Static Maps API (png, bez POI, bez etykiet, satelita)
    // style=feature:all|element:labels|visibility:off
    const baseUrl = 'https://maps.googleapis.com/maps/api/staticmap';
    const params = new URLSearchParams({
      center: `${centerLat},${centerLng}`,
      zoom: `${Math.round(zoom)}`,
      size: '640x640',
      scale: '2', // daje wysoką rozdzielczość 1280x1280
      maptype: 'satellite',
      style: 'feature:all|element:labels|visibility:off',
      key: googleApiKey.trim(),
    });
    return `${baseUrl}?${params.toString()}`;
  }

  if (mapboxToken && mapboxToken.trim()) {
    // Fallback: Mapbox Static Images API (satellite-v9 bez etykiet, 1024x1024 high-res)
    // format: https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/{lon},{lat},{zoom},{bearing},{pitch}/{width}x{height}?access_token={token}
    return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${centerLng},${centerLat},${zoom},0,0/1024x1024?access_token=${mapboxToken.trim()}`;
  }

  // Ostateczny, darmowy fallback: Esri World Imagery (ArcGIS REST MapServer)
  // NIE WYMAGA KLUCZA API ANI KARTY BANKOWEJ!
  let minX = centerLng - 0.002;
  let maxX = centerLng + 0.002;
  let minY = centerLat - 0.0015;
  let maxY = centerLat + 0.0015;

  if (bounds.sw && bounds.ne) {
    minX = bounds.sw[0];
    minY = bounds.sw[1];
    maxX = bounds.ne[0];
    maxY = bounds.ne[1];
  }

  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${minX},${minY},${maxX},${maxY}&bboxSR=4326&size=1024,1024&imageSR=4326&format=png&f=image`;
}

