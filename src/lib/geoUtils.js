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

/**
 * Oblicza 4 narożniki obróconego prostokąta w globalnych współrzędnych płótna.
 *
 * @param {{ x: number, y: number, widthPx: number, heightPx: number, rotationDegrees?: number }} rect
 * @returns {Array<{ x: number, y: number }>}
 */
export function getOrientedRectCorners({ x, y, widthPx, heightPx, rotationDegrees = 0 }) {
  const rad = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return [
    { x, y },
    { x: x + widthPx * cos, y: y + widthPx * sin },
    { x: x + widthPx * cos - heightPx * sin, y: y + widthPx * sin + heightPx * cos },
    { x: x - heightPx * sin, y: y + heightPx * cos },
  ];
}

/**
 * Sprawdza kolizję (nakładanie się) dwóch obróconych prostokątów przy pomocy Separating Axis Theorem (SAT).
 * Pozwala na delikatny styk krawędzi (margines 0.5px bez wyzwalania alarmu kolizji).
 *
 * @param {object} rectA
 * @param {object} rectB
 * @returns {boolean}
 */
export function checkOrientedRectsCollide(rectA, rectB) {
  const cornersA = getOrientedRectCorners(rectA);
  const cornersB = getOrientedRectCorners(rectB);

  const getAxes = (corners) => {
    const axes = [];
    for (let i = 0; i < 2; i++) {
      const p1 = corners[i];
      const p2 = corners[(i + 1) % 4];
      const edge = { x: p2.x - p1.x, y: p2.y - p1.y };
      const length = Math.hypot(edge.x, edge.y);
      if (length > 0) {
        axes.push({ x: -edge.y / length, y: edge.x / length });
      }
    }
    return axes;
  };

  const axes = [...getAxes(cornersA), ...getAxes(cornersB)];

  for (const axis of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    for (const p of cornersA) {
      const proj = p.x * axis.x + p.y * axis.y;
      if (proj < minA) minA = proj;
      if (proj > maxA) maxA = proj;
    }

    let minB = Infinity;
    let maxB = -Infinity;
    for (const p of cornersB) {
      const proj = p.x * axis.x + p.y * axis.y;
      if (proj < minB) minB = proj;
      if (proj > maxB) maxB = proj;
    }

    // Jeśli rzuty na którąkolwiek oś się nie przecinają -> brak kolizji (z tolerancją 2.0px na idealny styk)
    if (maxA <= minB + 2.0 || maxB <= minA + 2.0) {
      return false;
    }
  }

  return true;
}

/**
 * Sprawdza czy dany team (targetTeam) nachodzi na którykolwiek inny team z listy allTeams.
 *
 * @param {object} targetTeam
 * @param {Array<object>} allTeams
 * @param {number} pixelsPerMeter
 * @param {string|null} [excludeTeamId]
 * @returns {string|null} ID kolidującego teamu lub null, jeśli miejsce jest wolne
 */
export function checkTeamCollidesWithOthers(targetTeam, allTeams, pixelsPerMeter, excludeTeamId = null) {
  const targetRect = {
    x: targetTeam.x,
    y: targetTeam.y,
    widthPx: targetTeam.widthMeters * pixelsPerMeter,
    heightPx: targetTeam.heightMeters * pixelsPerMeter,
    rotationDegrees: targetTeam.rotation || 0,
  };

  for (const other of allTeams) {
    if (other.id === targetTeam.id || other.id === excludeTeamId) continue;
    const otherRect = {
      x: other.x,
      y: other.y,
      widthPx: other.widthMeters * pixelsPerMeter,
      heightPx: other.heightMeters * pixelsPerMeter,
      rotationDegrees: other.rotation || 0,
    };
    if (checkOrientedRectsCollide(targetRect, otherRect)) {
      return other.id;
    }
  }
  return null;
}

/**
 * Szuka wolnego (bezkolizyjnego) miejsca dla nowego naczepy/namiotu na torze przy użyciu spirali.
 *
 * @param {object} node - Proponowany obiekt teamu (z x, y, widthMeters, heightMeters, rotation)
 * @param {Array<object>} existingTeams - Aktualna lista naczep na torze
 * @param {number} pixelsPerMeter - Skala px/m
 * @returns {object} Zwraca obiekt z nowymi pozycjami x i y bez kolizji
 */
export function findCleanSpotForNode(node, existingTeams, pixelsPerMeter) {
  let candidate = { ...node };
  if (!checkTeamCollidesWithOthers(candidate, existingTeams, pixelsPerMeter, candidate.id)) {
    return candidate;
  }

  let step = 0;
  // Przeszkukuj po spirali do 30 prób, przesuwając o kilkadziesiąt pikseli/metrów
  while (checkTeamCollidesWithOthers(candidate, existingTeams, pixelsPerMeter, candidate.id) && step < 35) {
    step++;
    const angle = step * 0.65;
    const radius = (Math.floor(step / 2) + 1) * (Math.min(node.widthMeters, node.heightMeters) * pixelsPerMeter * 0.6);
    candidate.x = node.x + Math.cos(angle) * radius;
    candidate.y = node.y + Math.sin(angle) * radius;
  }
  return candidate;
}

/**
 * Pomocnicza funkcja licząca najkrótszy dystans kątowy (w stopniach 0..180) niezależnie od znaku i przekroczeń 360.
 */
function getShortestAngleDiff(a, b) {
  let diff = Math.abs((a - b) % 360);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * Znajduje pozycję przyciągniętą jak magnes do krawędzi sąsiednich namiotów.
 * Automatycznie synchronizuje obrót (kąt) przesuwanego namiotu z sąsiadem i precyzyjnie wyrównuje krawędzie.
 *
 * @param {object} targetTeam - Aktualnie przesuwany zespół
 * @param {Array<object>} allTeams - Lista wszystkich zespołów na torze
 * @param {number} pixelsPerMeter - Skala px/m
 * @param {number} snapThresholdMeters - Odległość w metrach, w której aktywuje się magnes (domyślnie 0.8m)
 * @returns {object|null} Zwraca { x, y, rotation, snappedToId } lub null, jeśli brakuje bliskich sąsiadów
 */
export function findMagneticSnapPosition(targetTeam, allTeams, pixelsPerMeter, snapThresholdMeters = 0.8) {
  if (!allTeams || allTeams.length === 0 || !pixelsPerMeter) return null;

  const thresholdPx = snapThresholdMeters * pixelsPerMeter;
  const T_w = targetTeam.widthMeters * pixelsPerMeter;
  const T_h = targetTeam.heightMeters * pixelsPerMeter;
  const T_rot = targetTeam.rotation || 0;

  let bestCandidate = null;
  let minDistance = thresholdPx * 1.5;

  for (const other of allTeams) {
    if (other.id === targetTeam.id) continue;

    const O_x = other.x;
    const O_y = other.y;
    const O_w = other.widthMeters * pixelsPerMeter;
    const O_h = other.heightMeters * pixelsPerMeter;
    const O_rot = other.rotation || 0;

    // Szybki odsiew odległości (Bounding sphere / center distance)
    const centerT = { x: targetTeam.x + T_w / 2, y: targetTeam.y + T_h / 2 };
    const centerO = { x: O_x + O_w / 2, y: O_y + O_h / 2 };
    const approxDist = Math.hypot(centerT.x - centerO.x, centerT.y - centerO.y);
    if (approxDist > Math.max(T_w, T_h) + Math.max(O_w, O_h) + thresholdPx) {
      continue;
    }

    // Wersory lokalnego układu współrzędnych sąsiada (O)
    const rad = (O_rot * Math.PI) / 180;
    const u = { x: Math.cos(rad), y: Math.sin(rad) };
    const v = { x: -Math.sin(rad), y: Math.cos(rad) };

    // Rzut aktualnego położenia targetu (T.x, T.y) względem początku sąsiada (O.x, O.y)
    const dx = targetTeam.x - O_x;
    const dy = targetTeam.y - O_y;
    const proj_u = dx * u.x + dy * u.y;
    const proj_v = dx * v.x + dy * v.y;

    // Automatyczna synchronizacja kąta do najbliższej wielokrotności 90 stopni względem O_rot (z bezpiecznym modulo)
    const diff0 = getShortestAngleDiff(T_rot, O_rot);
    const diff90 = getShortestAngleDiff(T_rot, O_rot + 90);
    const diff180 = getShortestAngleDiff(T_rot, O_rot + 180);
    const diff270 = getShortestAngleDiff(T_rot, O_rot + 270);

    let targetSnappedRot = O_rot;
    let isRotated90 = false;
    if (diff0 <= diff90 && diff0 <= diff180 && diff0 <= diff270) {
      targetSnappedRot = O_rot;
      isRotated90 = false;
    } else if (diff90 <= diff180 && diff90 <= diff270) {
      targetSnappedRot = (O_rot + 90) % 360;
      isRotated90 = true;
    } else if (diff180 <= diff270) {
      targetSnappedRot = (O_rot + 180) % 360;
      isRotated90 = false;
    } else {
      targetSnappedRot = (O_rot + 270) % 360;
      isRotated90 = true;
    }

    // Oblicz wymiary przesuwanego namiotu w układzie lokalnym sąsiada
    const T_w_local = isRotated90 ? T_h : T_w;
    const T_h_local = isRotated90 ? T_w : T_h;

    const candidates = [];

    // 1. Ściana PRAWA -> proj_u powinno wynosić O_w
    {
      const cand_u = O_w;
      const alignTop = 0;
      const alignBot = O_h - T_h_local;
      const alignMid = (O_h - T_h_local) / 2;

      let cand_v = proj_v;
      if (Math.abs(proj_v - alignTop) < thresholdPx * 1.5) cand_v = alignTop;
      else if (Math.abs(proj_v - alignBot) < thresholdPx * 1.5) cand_v = alignBot;
      else if (Math.abs(proj_v - alignMid) < thresholdPx * 1.5) cand_v = alignMid;

      candidates.push({ proj_u: cand_u, proj_v: cand_v, rot: targetSnappedRot });
    }

    // 2. Ściana LEWA -> proj_u powinno wynosić -T_w_local
    {
      const cand_u = -T_w_local;
      const alignTop = 0;
      const alignBot = O_h - T_h_local;
      const alignMid = (O_h - T_h_local) / 2;

      let cand_v = proj_v;
      if (Math.abs(proj_v - alignTop) < thresholdPx * 1.5) cand_v = alignTop;
      else if (Math.abs(proj_v - alignBot) < thresholdPx * 1.5) cand_v = alignBot;
      else if (Math.abs(proj_v - alignMid) < thresholdPx * 1.5) cand_v = alignMid;

      candidates.push({ proj_u: cand_u, proj_v: cand_v, rot: targetSnappedRot });
    }

    // 3. Ściana DOLNA -> proj_v powinno wynosić O_h
    {
      const cand_v = O_h;
      const alignLeft = 0;
      const alignRight = O_w - T_w_local;
      const alignMid = (O_w - T_w_local) / 2;

      let cand_u = proj_u;
      if (Math.abs(proj_u - alignLeft) < thresholdPx * 1.5) cand_u = alignLeft;
      else if (Math.abs(proj_u - alignRight) < thresholdPx * 1.5) cand_u = alignRight;
      else if (Math.abs(proj_u - alignMid) < thresholdPx * 1.5) cand_u = alignMid;

      candidates.push({ proj_u: cand_u, proj_v: cand_v, rot: targetSnappedRot });
    }

    // 4. Ściana GÓRNA -> proj_v powinno wynosić -T_h_local
    {
      const cand_v = -T_h_local;
      const alignLeft = 0;
      const alignRight = O_w - T_w_local;
      const alignMid = (O_w - T_w_local) / 2;

      let cand_u = proj_u;
      if (Math.abs(proj_u - alignLeft) < thresholdPx * 1.5) cand_u = alignLeft;
      else if (Math.abs(proj_u - alignRight) < thresholdPx * 1.5) cand_u = alignRight;
      else if (Math.abs(proj_u - alignMid) < thresholdPx * 1.5) cand_u = alignMid;

      candidates.push({ proj_u: cand_u, proj_v: cand_v, rot: targetSnappedRot });
    }

    // Wybierz najbliższego bezkolizyjnego kandydata z tej czwórki
    for (const cand of candidates) {
      const snapX = O_x + cand.proj_u * u.x + cand.proj_v * v.x;
      const snapY = O_y + cand.proj_u * u.y + cand.proj_v * v.y;
      const dist = Math.hypot(snapX - targetTeam.x, snapY - targetTeam.y);

      if (dist < minDistance) {
        const testNode = {
          ...targetTeam,
          x: snapX,
          y: snapY,
          rotation: cand.rot,
        };
        const collision = checkTeamCollidesWithOthers(testNode, allTeams, pixelsPerMeter, targetTeam.id);
        if (!collision || collision === other.id) {
          minDistance = dist;
          bestCandidate = {
            x: snapX,
            y: snapY,
            rotation: cand.rot,
            snappedToId: other.id,
          };
        }
      }
    }
  }

  return bestCandidate;
}

