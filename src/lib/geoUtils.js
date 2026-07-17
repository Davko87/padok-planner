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

    // Jeśli rzuty na którąkolwiek oś się nie przecinają -> brak kolizji
    if (maxA <= minB + 0.5 || maxB <= minA + 0.5) {
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
 * Znajduje pozycję przyciągniętą jak magnes do krawędzi sąsiednich namiotów.
 *
 * @param {object} targetTeam - Aktualnie przesuwany zespół
 * @param {Array<object>} allTeams - Lista wszystkich zespołów na torze
 * @param {number} pixelsPerMeter - Skala px/m
 * @param {number} snapThresholdMeters - Odległość w metrach, w której aktywuje się magnes (domyślnie 3.5m)
 * @returns {object|null} Zwraca { x, y, rotation, snappedToId } lub null, jeśli brakuje bliskich sąsiadów
 */
export function findMagneticSnapPosition(targetTeam, allTeams, pixelsPerMeter, snapThresholdMeters = 3.5) {
  if (!allTeams || allTeams.length === 0 || !pixelsPerMeter) return null;

  const thresholdPx = snapThresholdMeters * pixelsPerMeter;
  const T_w = targetTeam.widthMeters * pixelsPerMeter;
  const T_h = targetTeam.heightMeters * pixelsPerMeter;
  const T_rot = targetTeam.rotation || 0;

  let bestCandidate = null;
  let minDistance = thresholdPx;

  for (const other of allTeams) {
    if (other.id === targetTeam.id) continue;

    const O_x = other.x;
    const O_y = other.y;
    const O_w = other.widthMeters * pixelsPerMeter;
    const O_h = other.heightMeters * pixelsPerMeter;
    const O_rot = other.rotation || 0;

    // Sprawdź czy kąt jest bliski (np. w granicach +- 25 stopni lub ich wielokrotności 90 stopni)
    // Jeśli rotacje są identyczne lub bliskie, przyciągamy wzdłuż osi prostokąta sąsiada
    const rotDiff = Math.abs(((T_rot - O_rot + 180) % 360) - 180);
    const isAngleCompatible = rotDiff <= 25 || Math.abs(rotDiff - 90) <= 25 || Math.abs(rotDiff - 180) <= 25 || Math.abs(rotDiff - 270) <= 25;

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
    const proj_u = dx * u.x + dy * u.y; // pozycja wzdłuż szerokości sąsiada
    const proj_v = dx * v.x + dy * v.y; // pozycja wzdłuż wysokości sąsiada

    // Określ optymalny kąt po przyciągnięciu: jeśli rotDiff bliskie 0, przyciągnij do O_rot
    let targetSnappedRot = T_rot;
    if (rotDiff <= 25) {
      targetSnappedRot = O_rot;
    }

    // Jeśli rotacja po przyciągnięciu jest równa O_rot, możemy precyzyjnie przyciągać do 4 ścian:
    if (Math.abs(((targetSnappedRot - O_rot + 180) % 360) - 180) <= 5) {
      const candidates = [];

      // 1. Ściana PRAWA (Target bezpośrednio po prawej od Other) -> proj_u powinno wynosić O_w
      {
        const cand_u = O_w;
        // Sprawdź wyrównanie wzdłuż wysokości (v): do góry (0), do dołu (O_h - T_h) lub wyśrodkowane ((O_h - T_h)/2) lub bieżące
        const alignTop = 0;
        const alignBot = O_h - T_h;
        const alignMid = (O_h - T_h) / 2;

        let cand_v = proj_v;
        if (Math.abs(proj_v - alignTop) < thresholdPx * 0.7) cand_v = alignTop;
        else if (Math.abs(proj_v - alignBot) < thresholdPx * 0.7) cand_v = alignBot;
        else if (Math.abs(proj_v - alignMid) < thresholdPx * 0.7) cand_v = alignMid;

        candidates.push({ proj_u: cand_u, proj_v: cand_v, rot: O_rot });
      }

      // 2. Ściana LEWA (Target po lewej) -> proj_u powinno wynosić -T_w
      {
        const cand_u = -T_w;
        const alignTop = 0;
        const alignBot = O_h - T_h;
        const alignMid = (O_h - T_h) / 2;

        let cand_v = proj_v;
        if (Math.abs(proj_v - alignTop) < thresholdPx * 0.7) cand_v = alignTop;
        else if (Math.abs(proj_v - alignBot) < thresholdPx * 0.7) cand_v = alignBot;
        else if (Math.abs(proj_v - alignMid) < thresholdPx * 0.7) cand_v = alignMid;

        candidates.push({ proj_u: cand_u, proj_v: cand_v, rot: O_rot });
      }

      // 3. Ściana DOLNA (Target poniżej) -> proj_v powinno wynosić O_h
      {
        const cand_v = O_h;
        const alignLeft = 0;
        const alignRight = O_w - T_w;
        const alignMid = (O_w - T_w) / 2;

        let cand_u = proj_u;
        if (Math.abs(proj_u - alignLeft) < thresholdPx * 0.7) cand_u = alignLeft;
        else if (Math.abs(proj_u - alignRight) < thresholdPx * 0.7) cand_u = alignRight;
        else if (Math.abs(proj_u - alignMid) < thresholdPx * 0.7) cand_u = alignMid;

        candidates.push({ proj_u: cand_u, proj_v: cand_v, rot: O_rot });
      }

      // 4. Ściana GÓRNA (Target powyżej) -> proj_v powinno wynosić -T_h
      {
        const cand_v = -T_h;
        const alignLeft = 0;
        const alignRight = O_w - T_w;
        const alignMid = (O_w - T_w) / 2;

        let cand_u = proj_u;
        if (Math.abs(proj_u - alignLeft) < thresholdPx * 0.7) cand_u = alignLeft;
        else if (Math.abs(proj_u - alignRight) < thresholdPx * 0.7) cand_u = alignRight;
        else if (Math.abs(proj_u - alignMid) < thresholdPx * 0.7) cand_u = alignMid;

        candidates.push({ proj_u: cand_u, proj_v: cand_v, rot: O_rot });
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
  }

  return bestCandidate;
}

