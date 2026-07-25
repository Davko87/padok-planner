import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Rect, Text, Group, Transformer, Line, Circle } from 'react-konva';
import { Map3D } from '@vis.gl/react-google-maps';
import DPadControls from './DPadControls.jsx';
import { checkTeamCollidesWithOthers, findCleanSpotForNode, findMagneticSnapPosition, findCombinedMagneticSnap } from '../lib/geoUtils.js';

const PaddockCanvas = forwardRef(function PaddockCanvas({
  eventData,
  placedTeams = [],
  onUpdateTeams,
  guideLines = [],
  onUpdateGuideLines,
  measurements = [],
  onUpdateMeasurements,
  selectedTeamId,
  onSelectTeam,
  allowCollisions = false,
  onToggleCollisions,
  enableMagnet = false,
  onToggleMagnet,
  getViewportCenterRef,
  onScaleReport,
  onRequestDuplicateConfirm,
}, ref) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const trRef = useRef(null);
  const selectedNodeRefs = useRef({});
  const lastValidCoordsRef = useRef({});
  const teamsGroupRef = useRef(null);

  const [collidingTeamIds, setCollidingTeamIds] = useState([]);
  const [collisionToast, setCollisionToast] = useState('');

  // Stan obrotu mapy i kamery
  const [mapHeading, setMapHeading] = useState(0);
  const [showCameraControls, setShowCameraControls] = useState(false);
  const [isBottomControlsCollapsed, setIsBottomControlsCollapsed] = useState(false);

  // Dodajemy debouncing na resize (żeby nie psuć wydajności przy szybkim skoku okna)mery)
  useEffect(() => {
    if (getViewportCenterRef) {
      getViewportCenterRef.current = () => {
        const stage = stageRef.current;
        if (!stage) return null;
        const screenCenter = { x: stage.width() / 2, y: stage.height() / 2 };
        const node = teamsGroupRef.current || stage;
        const transform = node.getAbsoluteTransform().copy();
        transform.invert();
        return transform.point(screenCenter);
      };
    }
  });

  // Zapisuj ostatnie prawidłowe (bezkolizyjne) współrzędne dla naczep
  useEffect(() => {
    placedTeams.forEach((t) => {
      if (!lastValidCoordsRef.current[t.id]) {
        lastValidCoordsRef.current[t.id] = { x: t.x, y: t.y, rotation: t.rotation || 0 };
      }
    });
  }, [placedTeams]);

  // Automatyczne ukrywanie komunikatu o kolizji
  useEffect(() => {
    if (collisionToast) {
      const timer = setTimeout(() => setCollisionToast(''), 3500);
      return () => clearTimeout(timer);
    }
  }, [collisionToast]);

  // Wymiary okna canvasu
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Kamera stage (pozycja i zoom)
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [isDrawingLine, setIsDrawingLine] = useState(false);
  const [currentDrawingLine, setCurrentDrawingLine] = useState(null);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [currentMeasureLine, setCurrentMeasureLine] = useState(null);
  const [selectedLine, setSelectedLine] = useState(null); // { id: string, type: 'guide' | 'measure' }

  useEffect(() => {
    if (selectedTeamId !== null) {
      setSelectedLine(null);
    }
  }, [selectedTeamId]);

  // Obsługa klawiszy Delete / Backspace do usuwania zaznaczonej linii
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLine) {
          e.preventDefault();
          if (selectedLine.type === 'guide') {
            onUpdateGuideLines && onUpdateGuideLines((guideLines || []).filter((l) => l.id !== selectedLine.id));
          } else {
            onUpdateMeasurements && onUpdateMeasurements((measurements || []).filter((m) => m.id !== selectedLine.id));
          }
          setSelectedLine(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLine, guideLines, measurements, onUpdateGuideLines, onUpdateMeasurements]);

  // Google Maps używane jako tło interaktywne

  // EKSPORT: udostępnij metodę exportAsImage() z bezpieczną obsługą tainted canvas w razie blokad CORS na serwerach Esri
  useImperativeHandle(ref, () => ({
    exportAsImage: async () => {
      const stage = stageRef.current;
      if (!stage) return null;

      const oldScale = stage.scale();
      const oldPos = stage.position();
      const oldWidth = stage.width();
      const oldHeight = stage.height();

      if (trRef.current) {
        trRef.current.nodes([]);
        trRef.current.getLayer()?.batchDraw();
      }

      const exportW = 1024;
      const exportH = 1024;
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      stage.width(exportW);
      stage.height(exportH);
      stage.batchDraw();

      let finalDataUrl = null;

      try {
        // Z Google Maps w tle (WebGL), toDataURL canvasa i tak wyeksportuje tylko zespoły (tło jest html-em pod canvasem)
        const teamsLayer = stage.findOne('#teams-layer');
        finalDataUrl = teamsLayer ? teamsLayer.toDataURL({ pixelRatio: 2, mimeType: 'image/png' }) : null;
      } catch (err) {
        finalDataUrl = null;
      }

      stage.scale(oldScale);
      stage.position(oldPos);
      stage.width(oldWidth);
      stage.height(oldHeight);

      if (selectedTeamId && trRef.current && selectedNodeRefs.current[selectedTeamId]) {
        trRef.current.nodes([selectedNodeRefs.current[selectedTeamId]]);
      }
      stage.batchDraw();

      return finalDataUrl;
    },
  }), [selectedTeamId]);

  // Oblicz pixelsPerMeter tak, aby szerokość obrazu w pikselach odpowiadała fizycznej szerokości w metrach z Firestore
  const imgWidth = 1024;
  const imgHeight = 1024;
  const physicalWidthMeters = eventData?.widthMeters || 250;
  const pixelsPerMeter = imgWidth / physicalWidthMeters;

  // Przekaż aktualną skalę do nadrzędnego panelu HUD (PlannerPage)
  useEffect(() => {
    if (onScaleReport) {
      onScaleReport(pixelsPerMeter);
    }
  }, [pixelsPerMeter, onScaleReport]);

  // Wykrywaj zmianę rozmiaru okna
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Wyśrodkuj mapę po pierwszym załadowaniu obrazu
  useEffect(() => {
    if (containerRef.current) {
      const containerW = containerRef.current.offsetWidth;
      const containerH = containerRef.current.offsetHeight;

      const scaleW = (containerW * 0.85) / 1024;
      const scaleH = (containerH * 0.85) / 1024;
      const initialScale = Math.max(0.3, Math.min(1.5, Math.min(scaleW, scaleH)));

      setStageScale(initialScale);
      setStagePos({
        x: (containerW - 1024 * initialScale) / 2,
        y: (containerH - 1024 * initialScale) / 2,
      });
    }
  }, [eventData]);

  // ZADANIE 6: Podepnij Transformer z react-konva pod zaznaczony węzeł po zmianie zaznaczenia
  useEffect(() => {
    if (selectedTeamId && trRef.current && selectedNodeRefs.current[selectedTeamId]) {
      trRef.current.nodes([selectedNodeRefs.current[selectedTeamId]]);
      trRef.current.getLayer()?.batchDraw();
    } else if (trRef.current) {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selectedTeamId, placedTeams]);

  // Pomocnicza funkcja blokująca wyjazd mapy poza krawędzie ekranu 
  // lub trzymająca w centrum (jeśli jest mniejsza niż ekran)
  const getClampedStagePos = useCallback((scale, pos) => {
    let x = pos.x;
    let y = pos.y;
    
    const w = dimensions.width || window.innerWidth;
    const h = dimensions.height || window.innerHeight;
    
    const mapW = 1024 * scale;
    const mapH = 1024 * scale;
    
    if (mapW < w) {
      x = (w - mapW) / 2;
    } else {
      x = Math.max(w - mapW, Math.min(0, x));
    }
    
    if (mapH < h) {
      y = (h - mapH) / 2;
    } else {
      y = Math.max(h - mapH, Math.min(0, y));
    }
    
    return { x, y };
  }, [dimensions]);

  // Obsługa przybliżania (Wheel Zoom) prosto w punkt kursora
  const handleWheel = useCallback((e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.15;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.15, Math.min(5, newScale));

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    };

    setStageScale(clampedScale);
    setStagePos(getClampedStagePos(clampedScale, newPos));
  }, [stageScale, stagePos, getClampedStagePos]);

  // Obsługa Drag & Drop szablonu zespołu z bocznego katalogu na canvas
  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const teamDataStr = e.dataTransfer.getData('team');
    if (!teamDataStr) return;

    try {
      const template = JSON.parse(teamDataStr);

      stage.setPointersPositions(e);
      const pointerPos = stage.getPointerPosition();
      const node = teamsGroupRef.current || stage;
      const transform = node.getAbsoluteTransform().copy();
      transform.invert();
      const localPoint = transform.point(pointerPos);

      const widthMeters = template.width || template.widthMeters || 10;
      const heightMeters = template.length || template.heightMeters || 15;

      let newTeamNode = {
        id: 'team_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        templateId: template.id || 'custom',
        name: template.name || 'Zespól Wyścigowy',
        color: template.color || '#3b82f6',
        widthMeters,
        heightMeters,
        x: localPoint.x - (widthMeters * pixelsPerMeter) / 2,
        y: localPoint.y - (heightMeters * pixelsPerMeter) / 2,
        rotation: 0,
      };

      if (!allowCollisions) {
        newTeamNode = findCleanSpotForNode(newTeamNode, placedTeams, pixelsPerMeter);
      }
      if (enableMagnet) {
        const snapped = findCombinedMagneticSnap(newTeamNode, placedTeams, guideLines, pixelsPerMeter, 0.8);
        if (snapped) {
          newTeamNode = { ...newTeamNode, x: snapped.x, y: snapped.y, rotation: snapped.rotation !== undefined ? snapped.rotation : newTeamNode.rotation };
        }
      }

      const isDuplicate = placedTeams.some(
        (t) => t.templateId === newTeamNode.templateId || (t.name && newTeamNode.name && t.name.trim().toLowerCase() === newTeamNode.name.trim().toLowerCase())
      );
      if (isDuplicate && onRequestDuplicateConfirm) {
        onRequestDuplicateConfirm(newTeamNode);
        return;
      }

      const newTeamsList = [...placedTeams, newTeamNode];
      onUpdateTeams && onUpdateTeams(newTeamsList);
      onSelectTeam && onSelectTeam(newTeamNode.id);
    } catch (err) {
      console.error('Błąd podczas upuszczania teamu na canvas:', err);
    }
  };

  // Kliknięcie w puste tło odznacza team i linię
  const handleStageClick = (e) => {
    if (e.target === stageRef.current || e.target.name() === 'background-image') {
      onSelectTeam && onSelectTeam(null);
      setSelectedLine(null);
    }
  };

  // Obsługa rysowania linii krawężnika / pomocniczej lub linii pomiarowej (linijka)
  const handleStageMouseDown = (e) => {
    if (!isDrawingLine && !isMeasuring) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;
    const node = teamsGroupRef.current || stage;
    const transform = node.getAbsoluteTransform().copy();
    transform.invert();
    const pt = transform.point(pointerPos);
    if (isDrawingLine) {
      setCurrentDrawingLine({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    } else if (isMeasuring) {
      setCurrentMeasureLine({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    }
  };

  const handleStageMouseMove = (e) => {
    if ((!isDrawingLine && !isMeasuring) || (!currentDrawingLine && !currentMeasureLine)) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;
    const node = teamsGroupRef.current || stage;
    const transform = node.getAbsoluteTransform().copy();
    transform.invert();
    const pt = transform.point(pointerPos);
    if (isDrawingLine && currentDrawingLine) {
      setCurrentDrawingLine((prev) => (prev ? { ...prev, x2: pt.x, y2: pt.y } : null));
    } else if (isMeasuring && currentMeasureLine) {
      setCurrentMeasureLine((prev) => (prev ? { ...prev, x2: pt.x, y2: pt.y } : null));
    }
  };

  const handleStageMouseUp = (e) => {
    if (isDrawingLine && currentDrawingLine) {
      const dist = Math.hypot(currentDrawingLine.x2 - currentDrawingLine.x1, currentDrawingLine.y2 - currentDrawingLine.y1);
      if (dist > 15) {
        const newLine = {
          id: 'line_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          x1: currentDrawingLine.x1,
          y1: currentDrawingLine.y1,
          x2: currentDrawingLine.x2,
          y2: currentDrawingLine.y2,
        };
        onUpdateGuideLines && onUpdateGuideLines([...(guideLines || []), newLine]);
      }
      setCurrentDrawingLine(null);
    } else if (isMeasuring && currentMeasureLine) {
      const dist = Math.hypot(currentMeasureLine.x2 - currentMeasureLine.x1, currentMeasureLine.y2 - currentMeasureLine.y1);
      if (dist > 5) {
        const newMeasure = {
          id: 'meas_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          x1: currentMeasureLine.x1,
          y1: currentMeasureLine.y1,
          x2: currentMeasureLine.x2,
          y2: currentMeasureLine.y2,
        };
        onUpdateMeasurements && onUpdateMeasurements([...(measurements || []), newMeasure]);
      }
      setCurrentMeasureLine(null);
    }
  };

  // Obsługa przeciągania pojedynczego teamu po canvasie
  const handleTeamDragEnd = (index, e) => {
    const team = placedTeams[index];
    let candidate = {
      ...team,
      x: e.target.x(),
      y: e.target.y(),
    };

    if (enableMagnet) {
      const snapped = findCombinedMagneticSnap(candidate, placedTeams, guideLines, pixelsPerMeter, 0.8);
      if (snapped) {
        candidate = {
          ...candidate,
          x: snapped.x,
          y: snapped.y,
          rotation: snapped.rotation !== undefined ? snapped.rotation : candidate.rotation,
        };
        e.target.x(candidate.x);
        e.target.y(candidate.y);
        if (snapped.rotation !== undefined) {
          e.target.rotation(candidate.rotation);
        }
      }
    }

    const collidedId = checkTeamCollidesWithOthers(candidate, placedTeams, pixelsPerMeter, team.id);

    if (!allowCollisions && collidedId) {
      // BLOKADA: przywróć ostatnią prawidłową pozycję
      const lastValid = lastValidCoordsRef.current[team.id] || { x: team.x, y: team.y, rotation: team.rotation || 0 };
      e.target.x(lastValid.x);
      e.target.y(lastValid.y);
      e.target.rotation(lastValid.rotation || 0);
      setCollidingTeamIds([]);
      setCollisionToast('Kolizja zablokowana! Namioty nie mogą na siebie nachodzić.');
      return;
    }

    setCollidingTeamIds([]);
    lastValidCoordsRef.current[team.id] = { x: candidate.x, y: candidate.y, rotation: candidate.rotation || 0 };

    const updated = [...placedTeams];
    updated[index] = candidate;
    onUpdateTeams && onUpdateTeams(updated);
  };

  // ZADANIE 6 & 8 & 9: Obsługa końca transformacji (obrót z rogów z wykrywaniem kolizji!)
  const handleTransformEnd = () => {
    if (!selectedTeamId || !trRef.current) return;
    const node = selectedNodeRefs.current[selectedTeamId];
    if (!node) return;

    node.scaleX(1);
    node.scaleY(1);

    const target = placedTeams.find((t) => t.id === selectedTeamId);
    if (!target) return;

    let candidate = {
      ...target,
      x: node.x(),
      y: node.y(),
      rotation: Math.round(node.rotation() * 10) / 10,
    };

    if (enableMagnet) {
      const snapped = findCombinedMagneticSnap(candidate, placedTeams, guideLines, pixelsPerMeter, 0.8);
      if (snapped) {
        candidate = {
          ...candidate,
          x: snapped.x,
          y: snapped.y,
          rotation: snapped.rotation !== undefined ? snapped.rotation : candidate.rotation,
        };
        node.x(candidate.x);
        node.y(candidate.y);
        node.rotation(candidate.rotation);
      }
    }

    const collidedId = checkTeamCollidesWithOthers(candidate, placedTeams, pixelsPerMeter, selectedTeamId);
    if (!allowCollisions && collidedId) {
      const lastValid = lastValidCoordsRef.current[selectedTeamId] || { x: target.x, y: target.y, rotation: target.rotation || 0 };
      node.x(lastValid.x);
      node.y(lastValid.y);
      node.rotation(lastValid.rotation || 0);
      setCollidingTeamIds([]);
      setCollisionToast('Obrót zablokowany! Namiot zahacza o inny zespół.');
      return;
    }

    setCollidingTeamIds([]);
    lastValidCoordsRef.current[selectedTeamId] = { x: candidate.x, y: candidate.y, rotation: candidate.rotation || 0 };

    const updated = placedTeams.map((t) => (t.id === selectedTeamId ? candidate : t));
    onUpdateTeams && onUpdateTeams(updated);
  };

  // ZADANIE 6 & 9: Obsługa precyzyjnych przesunięć z D-Pad (z kontrolą kolizji)
  const handleDPadMove = (dxMeters, dyMeters) => {
    if (!selectedTeamId) return;
    const dxPx = dxMeters * pixelsPerMeter;
    const dyPx = dyMeters * pixelsPerMeter;

    const target = placedTeams.find((t) => t.id === selectedTeamId);
    if (!target) return;

    let candidate = {
      ...target,
      x: target.x + dxPx,
      y: target.y + dyPx,
    };

    if (enableMagnet) {
      const snapped = findCombinedMagneticSnap(candidate, placedTeams, guideLines, pixelsPerMeter, 0.8);
      if (snapped) {
        candidate = {
          ...candidate,
          x: snapped.x,
          y: snapped.y,
          rotation: snapped.rotation !== undefined ? snapped.rotation : candidate.rotation,
        };
      }
    }

    const collidedId = checkTeamCollidesWithOthers(candidate, placedTeams, pixelsPerMeter, selectedTeamId);
    if (!allowCollisions && collidedId) {
      setCollisionToast('Przesunięcie zablokowane! Naczepa nachodzi na sąsiedni zespół.');
      return;
    }

    lastValidCoordsRef.current[selectedTeamId] = { x: candidate.x, y: candidate.y, rotation: candidate.rotation || 0 };
    const updated = placedTeams.map((t) => (t.id === selectedTeamId ? candidate : t));
    onUpdateTeams && onUpdateTeams(updated);
  };

  // ZADANIE 6 & 9: Obsługa obrotów z D-Pad (z kontrolą kolizji)
  const handleDPadRotate = (deltaAngle) => {
    if (!selectedTeamId) return;
    const target = placedTeams.find((t) => t.id === selectedTeamId);
    if (!target) return;

    const candidate = {
      ...target,
      rotation: (target.rotation + deltaAngle + 360) % 360,
    };

    const collidedId = checkTeamCollidesWithOthers(candidate, placedTeams, pixelsPerMeter, selectedTeamId);
    if (!allowCollisions && collidedId) {
      setCollisionToast('Obrót zablokowany! Naczepa zahacza o sąsiedni zespół.');
      return;
    }

    lastValidCoordsRef.current[selectedTeamId] = { x: candidate.x, y: candidate.y, rotation: candidate.rotation || 0 };
    const updated = placedTeams.map((t) => (t.id === selectedTeamId ? candidate : t));
    onUpdateTeams && onUpdateTeams(updated);
  };

  // ZADANIE 6: Obsługa szybkiej korekty wymiarów z D-Pad
  const handleDPadResize = (dwMeters, dhMeters) => {
    if (!selectedTeamId) return;
    const updated = placedTeams.map((t) => {
      if (t.id === selectedTeamId) {
        return {
          ...t,
          widthMeters: Math.max(1, Math.round((t.widthMeters + dwMeters) * 2) / 2),
          heightMeters: Math.max(1, Math.round((t.heightMeters + dhMeters) * 2) / 2),
        };
      }
      return t;
    });
    onUpdateTeams && onUpdateTeams(updated);
  };

  // Kontrolki zoom HUD (powiększanie/oddalanie dokładnie względem środka ekranu)
  const handleZoom = (direction) => {
    if (!containerRef.current) return;
    const oldScale = stageScale;
    const scaleBy = 1.25;
    const newScale = direction === 'in' ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.15, Math.min(5, newScale));

    // Środek widocznego ekranu / kontenera mapy
    const center = {
      x: containerRef.current.offsetWidth / 2,
      y: containerRef.current.offsetHeight / 2,
    };

    // Obliczamy jaki punkt na mapie znajduje się na środku ekranu przed zoomem
    const pointTo = {
      x: (center.x - stagePos.x) / oldScale,
      y: (center.y - stagePos.y) / oldScale,
    };

    // Obliczamy nową pozycję mapy tak, by dokładnie ten sam punkt pozostał na środku ekranu po zoomie
    const newPos = {
      x: center.x - pointTo.x * clampedScale,
      y: center.y - pointTo.y * clampedScale,
    };

    setStageScale(clampedScale);
    setStagePos(getClampedStagePos(clampedScale, newPos));
  };

  const handleResetCamera = () => {
    if (containerRef.current) {
      const containerW = containerRef.current.offsetWidth;
      const containerH = containerRef.current.offsetHeight;
      const scaleW = (containerW * 0.85) / 1024;
      const scaleH = (containerH * 0.85) / 1024;
      const initialScale = Math.max(0.3, Math.min(1.5, Math.min(scaleW, scaleH)));

      setStageScale(initialScale);
      setStagePos(getClampedStagePos(initialScale, {
        x: (containerW - 1024 * initialScale) / 2,
        y: (containerH - 1024 * initialScale) / 2,
      }));
    }
  };

  const selectedTeamObj = placedTeams.find((t) => t.id === selectedTeamId) || null;

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="absolute inset-0 w-full h-full bg-slate-950 overflow-hidden select-none"
    >
      {/* Google Maps Tło (Zoom i Pan mapy jest sterowane przez CSS transform dla synchronizacji z Konva) */}
      {eventData?.bounds && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 1024,
            height: 1024,
            transformOrigin: '0 0',
            transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`,
            zIndex: 0,
            pointerEvents: 'none' // blokujemy eventy dla mapy, obsługuje je Konva!
          }}
        >
          <Map3D
            center={{ lat: eventData.bounds.center[1], lng: eventData.bounds.center[0], altitude: eventData.bounds.centerElevation || 0 }}
            range={Math.pow(2, 21 - (eventData.bounds.zoom || 17)) * 25}
            fov={35}
            tilt={0}
            heading={mapHeading}
            mode="SATELLITE"
            defaultLabelsDisabled={false}
          />
        </div>
      )}

      {/* react-konva Stage (Ustawiona w absolutnym pozycjonowaniu nad Google Mapą) */}
      <Stage
        style={{ position: 'absolute', inset: 0, zIndex: 10 }}
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        scale={{ x: stageScale, y: stageScale }}
        position={stagePos}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onTap={handleStageClick}
        draggable={!isDrawingLine && !isMeasuring && selectedTeamId === null}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTouchStart={handleStageMouseDown}
        onTouchMove={handleStageMouseMove}
        onTouchEnd={handleStageMouseUp}
        dragBoundFunc={(pos) => getClampedStagePos(stageScale, pos)}
        onDragMove={(e) => {
          if (e.target === stageRef.current) {
            setStagePos(getClampedStagePos(stageScale, { x: e.target.x(), y: e.target.y() }));
          }
        }}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setStagePos(getClampedStagePos(stageScale, { x: e.target.x(), y: e.target.y() }));
          }
        }}
        className="cursor-default active:cursor-grabbing"
      >
        {/* Warstwa 2: Ramka, Siatka i Zespoły */}
        <Layer id="teams-layer">
          {/* Ramka granic obszaru toru - wyciągnięta przed grupę, by zawsze była prosta i otaczała widok */}
          <Rect
            x={0}
            y={0}
            width={1024}
            height={1024}
            stroke="rgba(255, 255, 255, 0.25)"
            strokeWidth={2 / stageScale}
            listening={false}
          />
          <Group ref={teamsGroupRef} x={512} y={512} offsetX={512} offsetY={512} rotation={-mapHeading}>
            {/* 1.5 Linie pomocnicze / krawężniki (do których przyciągają się namioty) */}
            {(guideLines || []).map((line) => {
              const isSelected = selectedLine && selectedLine.id === line.id && selectedLine.type === 'guide';
              return (
                <Group key={line.id}>
                  {/* Szeroki, niewidoczny obszar do łatwego kliknięcia / zaznaczenia linii */}
                  <Line
                    points={[line.x1, line.y1, line.x2, line.y2]}
                    stroke="rgba(239, 68, 68, 0.4)"
                    strokeWidth={20 / stageScale}
                    opacity={isSelected ? 1 : 0}
                    lineCap="round"
                    cursor="pointer"
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (onSelectTeam) onSelectTeam(null);
                      setSelectedLine({ id: line.id, type: 'guide' });
                    }}
                    onTap={(e) => {
                      e.cancelBubble = true;
                      if (onSelectTeam) onSelectTeam(null);
                      setSelectedLine({ id: line.id, type: 'guide' });
                    }}
                  />
                  {/* Widoczna linia krawężnika */}
                  <Line
                    points={[line.x1, line.y1, line.x2, line.y2]}
                    stroke={isSelected ? '#ef4444' : isDrawingLine ? '#ef4444' : '#f59e0b'}
                    strokeWidth={isSelected ? 4 : isDrawingLine ? 3 : 2}
                    dash={[6, 4]}
                    lineCap="round"
                    listening={false}
                  />
                  {/* Punkty końcowe */}
                  {(isSelected || isDrawingLine) && (
                    <>
                      <Circle x={line.x1} y={line.y1} radius={5} fill={isSelected ? '#ef4444' : '#f59e0b'} listening={false} />
                      <Circle x={line.x2} y={line.y2} radius={5} fill={isSelected ? '#ef4444' : '#f59e0b'} listening={false} />
                    </>
                  )}
                </Group>
              );
            })}

            {/* Podgląd rysowanej aktualnie linii */}
            {currentDrawingLine && (
              <Line
                points={[currentDrawingLine.x1, currentDrawingLine.y1, currentDrawingLine.x2, currentDrawingLine.y2]}
                stroke="#fbbf24"
                strokeWidth={3}
                dash={[6, 4]}
                lineCap="round"
              />
            )}

            {/* 1.6 Linie pomiarowe (linijka odległości) */}
            {(measurements || []).map((m) => {
              const isSelected = selectedLine && selectedLine.id === m.id && selectedLine.type === 'measure';
              const dx = m.x2 - m.x1;
              const dy = m.y2 - m.y1;
              const distPx = Math.hypot(dx, dy);
              if (distPx < 1) return null;
              const distM = (distPx / pixelsPerMeter);
              const distText = distM < 10 ? distM.toFixed(2) + ' m' : distM.toFixed(1) + ' m';
              const midX = (m.x1 + m.x2) / 2;
              const midY = (m.y1 + m.y2) / 2;
              let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
              if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;
              const badgeW = Math.max(54, distText.length * 7.5) / Math.max(0.4, stageScale);
              const badgeH = 22 / Math.max(0.4, stageScale);

              return (
                <Group key={m.id}>
                  {/* Szeroka niewidoczna linia do kliknięcia/zaznaczenia */}
                  <Line
                    points={[m.x1, m.y1, m.x2, m.y2]}
                    stroke="rgba(239, 68, 68, 0.4)"
                    strokeWidth={20 / stageScale}
                    opacity={isSelected ? 1 : 0}
                    lineCap="round"
                    cursor="pointer"
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (onSelectTeam) onSelectTeam(null);
                      setSelectedLine({ id: m.id, type: 'measure' });
                    }}
                    onTap={(e) => {
                      e.cancelBubble = true;
                      if (onSelectTeam) onSelectTeam(null);
                      setSelectedLine({ id: m.id, type: 'measure' });
                    }}
                  />
                  <Line
                    points={[m.x1, m.y1, m.x2, m.y2]}
                    stroke={isSelected ? '#ef4444' : '#38bdf8'}
                    strokeWidth={isSelected ? 4 / Math.max(0.4, stageScale) : 2.5 / Math.max(0.4, stageScale)}
                    dash={[6, 4]}
                    lineCap="round"
                    listening={false}
                  />
                  <Circle x={m.x1} y={m.y1} radius={4 / Math.max(0.4, stageScale)} fill={isSelected ? '#ef4444' : '#38bdf8'} listening={false} />
                  <Circle x={m.x2} y={m.y2} radius={4 / Math.max(0.4, stageScale)} fill={isSelected ? '#ef4444' : '#38bdf8'} listening={false} />
                  <Group x={midX} y={midY} rotation={angleDeg} listening={false}>
                    <Rect
                      x={-badgeW / 2}
                      y={-badgeH / 2}
                      width={badgeW}
                      height={badgeH}
                      fill={isSelected ? '#dc2626' : '#0284c7'}
                      stroke="#ffffff"
                      strokeWidth={1 / Math.max(0.4, stageScale)}
                      cornerRadius={6 / Math.max(0.4, stageScale)}
                      shadowColor="#000000"
                      shadowBlur={4}
                      shadowOpacity={0.5}
                    />
                    <Text
                      text={distText}
                      x={-badgeW / 2}
                      y={-badgeH / 2 + (5 / Math.max(0.4, stageScale))}
                      width={badgeW}
                      align="center"
                      fill="#ffffff"
                      fontSize={11 / Math.max(0.4, stageScale)}
                      fontFamily="monospace"
                      fontStyle="bold"
                    />
                  </Group>
                </Group>
              );
            })}

            {/* Podgląd aktualnie rysowanej linii pomiarowej */}
            {currentMeasureLine && (() => {
              const dx = currentMeasureLine.x2 - currentMeasureLine.x1;
              const dy = currentMeasureLine.y2 - currentMeasureLine.y1;
              const distPx = Math.hypot(dx, dy);
              if (distPx < 1) return null;
              const distM = (distPx / pixelsPerMeter);
              const distText = distM < 10 ? distM.toFixed(2) + ' m' : distM.toFixed(1) + ' m';
              const midX = (currentMeasureLine.x1 + currentMeasureLine.x2) / 2;
              const midY = (currentMeasureLine.y1 + currentMeasureLine.y2) / 2;
              let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
              if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;
              const badgeW = Math.max(54, distText.length * 7.5) / Math.max(0.4, stageScale);
              const badgeH = 22 / Math.max(0.4, stageScale);

              return (
                <Group>
                  <Line
                    points={[currentMeasureLine.x1, currentMeasureLine.y1, currentMeasureLine.x2, currentMeasureLine.y2]}
                    stroke="#38bdf8"
                    strokeWidth={2.5 / Math.max(0.4, stageScale)}
                    dash={[4, 4]}
                    lineCap="round"
                  />
                  <Circle x={currentMeasureLine.x1} y={currentMeasureLine.y1} radius={4 / Math.max(0.4, stageScale)} fill="#38bdf8" />
                  <Circle x={currentMeasureLine.x2} y={currentMeasureLine.y2} radius={4 / Math.max(0.4, stageScale)} fill="#38bdf8" />
                  <Group x={midX} y={midY} rotation={angleDeg}>
                    <Rect
                      x={-badgeW / 2}
                      y={-badgeH / 2}
                      width={badgeW}
                      height={badgeH}
                      fill="#0ea5e9"
                      stroke="#ffffff"
                      strokeWidth={1 / Math.max(0.4, stageScale)}
                      cornerRadius={6 / Math.max(0.4, stageScale)}
                      shadowColor="#000000"
                      shadowBlur={4}
                      shadowOpacity={0.5}
                    />
                    <Text
                      text={distText}
                      x={-badgeW / 2}
                      y={-badgeH / 2 + (5 / Math.max(0.4, stageScale))}
                      width={badgeW}
                      align="center"
                      fill="#ffffff"
                      fontSize={11 / Math.max(0.4, stageScale)}
                      fontFamily="monospace"
                      fontStyle="bold"
                    />
                  </Group>
                </Group>
              );
            })()}

            {/* 2. Zespoły umieszczone na torze (Team Nodes) */}
          {placedTeams.map((team, index) => {
            const isSelected = selectedTeamId === team.id;
            const isColliding = collidingTeamIds.includes(team.id);
            const pxWidth = team.widthMeters * pixelsPerMeter;
            const pxHeight = team.heightMeters * pixelsPerMeter;

            // Skalowanie do szerokości prostokąta (w poziomie, bez łamania słów)
            const nameLen = Math.max(1, (team.name || '').length);
            const dimText = `${team.widthMeters}×${team.heightMeters}m`;
            const dimLen = Math.max(1, dimText.length);

            const maxNameSizeByWidth = (pxWidth - 6) / (nameLen * 0.6);
            const maxDimSizeByWidth = (pxWidth - 4) / (dimLen * 0.58);

            // Nazwa skalowana do wielkości kontenera (bez sztucznego limitu 16px, by rosła z kontenerem!)
            const nameFontSize = Math.max(5, Math.min(pxHeight * 0.28, maxNameSizeByWidth));

            // Wymiary pozostają tak, jak są - czytelne i zgrabne w tej pozycji na dole
            const dimFontSize = Math.max(7, Math.min(13, Math.min(pxHeight * 0.16, maxDimSizeByWidth)));

            const totalTextHeight = nameFontSize + dimFontSize;
            const availableGap = pxHeight - totalTextHeight;
            const topPad = Math.max(3, Math.min(availableGap * 0.35, pxHeight * 0.08));
            const botPad = Math.max(3, Math.min(availableGap * 0.35, pxHeight * 0.08));

            // Widoczność nazwy uzależniona od zooma (stageScale): z daleka nazwa znika, z bliska staje się czytelna
            const apparentNameSize = nameFontSize * stageScale;
            const isNameVisible = apparentNameSize >= 4.5;
            const nameOpacity = Math.min(1, Math.max(0, (apparentNameSize - 4.5) / 3));

            return (
              <Group
                key={team.id}
                ref={(el) => {
                  if (el) selectedNodeRefs.current[team.id] = el;
                }}
                x={team.x}
                y={team.y}
                rotation={team.rotation || 0}
                draggable={!isDrawingLine && !isMeasuring}
                onClick={(e) => {
                  if (isDrawingLine || isMeasuring) return;
                  e.cancelBubble = true;
                  onSelectTeam && onSelectTeam(team.id);
                  setSelectedLine(null);
                }}
                onTap={(e) => {
                  if (isDrawingLine || isMeasuring) return;
                  e.cancelBubble = true;
                  onSelectTeam && onSelectTeam(team.id);
                  setSelectedLine(null);
                }}
                onDragStart={(e) => {
                  e.cancelBubble = true;
                  onSelectTeam && onSelectTeam(team.id);
                  setSelectedLine(null);
                }}
                onDragMove={(e) => {
                  let candidate = {
                    ...team,
                    x: e.target.x(),
                    y: e.target.y(),
                  };
                  if (enableMagnet) {
                    const snapped = findCombinedMagneticSnap(candidate, placedTeams, guideLines, pixelsPerMeter, 0.8);
                    if (snapped) {
                      candidate = {
                        ...candidate,
                        x: snapped.x,
                        y: snapped.y,
                        rotation: snapped.rotation !== undefined ? snapped.rotation : candidate.rotation,
                      };
                      e.target.x(candidate.x);
                      e.target.y(candidate.y);
                      if (snapped.rotation !== undefined) {
                        e.target.rotation(candidate.rotation);
                      }
                    }
                  }
                  const collidedId = checkTeamCollidesWithOthers(candidate, placedTeams, pixelsPerMeter, team.id);
                  if (collidedId) {
                    setCollidingTeamIds([team.id, collidedId]);
                  } else if (collidingTeamIds.length > 0) {
                    setCollidingTeamIds([]);
                  }
                }}
                onDragEnd={(e) => handleTeamDragEnd(index, e)}
              >
                {/* Prostokąt namiotu / strefy teamu */}
                <Rect
                  width={pxWidth}
                  height={pxHeight}
                  fill={isColliding ? '#ef4444EE' : team.color ? `${team.color}DF` : '#4f46e5DF'}
                  stroke={isColliding ? '#ff0000' : isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.4)'}
                  strokeWidth={isColliding ? Math.max(3, 4 / stageScale) : isSelected ? Math.max(2, 3 / stageScale) : Math.max(1, 1.5 / stageScale)}
                  cornerRadius={Math.max(2, 4 * (pixelsPerMeter / 5))}
                  shadowColor={isColliding ? '#ff0000' : isSelected ? '#10B981' : '#000000'}
                  shadowBlur={isColliding ? 24 : isSelected ? 18 : 6}
                  shadowOpacity={isColliding || isSelected ? 0.9 : 0.5}
                />

                {/* Nazwa teamu - w poziomie kontenera, skalowana z jego wielkością i zależna od zooma */}
                <Text
                  text={team.name}
                  x={0}
                  y={topPad}
                  width={pxWidth}
                  align="center"
                  fill="#ffffff"
                  fontSize={nameFontSize}
                  fontFamily="Inter, system-ui, sans-serif"
                  fontStyle="bold"
                  wrap="none"
                  visible={isNameVisible}
                  opacity={nameOpacity}
                  listening={false}
                />

                {/* Wymiary fizyczne w metrach - na dole prostokąta, w tej pozycji jak są */}
                <Text
                  text={dimText}
                  x={0}
                  y={pxHeight - dimFontSize - botPad}
                  width={pxWidth}
                  align="center"
                  fill="rgba(255, 255, 255, 0.9)"
                  fontSize={dimFontSize}
                  fontFamily="monospace"
                  fontStyle="bold"
                  wrap="none"
                  listening={false}
                />
              </Group>
            );
          })}

          {/* ZADANIE 6: react-konva Transformer z obracaniem i skokiem co 0.5m w świecie fizycznym */}
          {/* react-konva Transformer z obracaniem z rogów (wyłączona opcja zmiany wymiarów, sztywny metraż!) */}
          {selectedTeamId && (
            <Transformer
              ref={trRef}
              resizeEnabled={false} // Całkowita blokada skalowania na płótnie!
              rotateEnabled={true}  // Włączony precyzyjny obrót z rogów
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']} // 4 rogi jako uchwyty obrotu
              rotationSnaps={[]} // Swobodny i delikatny obrót co 0.1°-1° w każdej płaszczyźnie bez sztywnego przeskoku 45°
              anchorStroke="#10B981"
              anchorFill="#ffffff"
              anchorSize={Math.max(10, 14 / stageScale)}
              rotateAnchorOffset={30}
              borderStroke="#10B981"
              borderStrokeWidth={Math.max(1.5, 2.5 / stageScale)}
              borderDash={[4, 4]}
              onTransformEnd={handleTransformEnd}
            />
          )}
          </Group>
        </Layer>
      </Stage>

      {/* Pływający HUD do usuwania zaznaczonej linii (pomocniczej lub pomiarowej) */}
      {selectedLine && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900/95 border border-red-500/50 shadow-2xl px-5 py-3 rounded-2xl animate-bounce-in pointer-events-auto">
          <div className="flex items-center gap-2 text-white text-xs font-semibold">
            <span>{selectedLine.type === 'guide' ? '📏 Zaznaczono linię pomocniczą' : '📐 Zaznaczono linię pomiarową'}</span>
          </div>
          <button
            onClick={() => {
              if (selectedLine.type === 'guide') {
                onUpdateGuideLines && onUpdateGuideLines((guideLines || []).filter((l) => l.id !== selectedLine.id));
              } else {
                onUpdateMeasurements && onUpdateMeasurements((measurements || []).filter((m) => m.id !== selectedLine.id));
              }
              setSelectedLine(null);
            }}
            className="py-1.5 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
            title="Usuń zaznaczoną linię"
          >
            🗑️ Usuń zaznaczoną linię
          </button>
          <button
            onClick={() => setSelectedLine(null)}
            className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-all text-sm cursor-pointer"
            title="Anuluj zaznaczenie"
          >
            ✕
          </button>
        </div>
      )}

      {/* ZADANIE 6: Szklany Panel D-Pad na dole ekranu (Rozwiązanie "Grubego Palca") */}
      <DPadControls
        selectedTeam={selectedTeamObj}
        onMove={handleDPadMove}
        onRotate={handleDPadRotate}
        onResize={handleDPadResize}
        onDeselect={() => onSelectTeam && onSelectTeam(null)}
        pixelsPerMeter={pixelsPerMeter}
      />

      {/* HUD: Kontrolki kamery i trybów połączone w jeden elegancki, półprzeźroczysty szklany panel */}
      <div className="absolute bottom-6 left-6 z-30 pointer-events-none">
        <div className={`glass-panel p-2 flex items-stretch gap-2 shadow-glass border-white/20 transition-all duration-500 ease-in-out overflow-hidden pointer-events-auto ${isBottomControlsCollapsed ? 'w-[52px]' : 'w-auto'}`}>
          
          {/* Przycisk zwijania/rozwijania wbudowany w panel */}
          <button
            onClick={() => setIsBottomControlsCollapsed(!isBottomControlsCollapsed)}
            className="w-9 h-auto min-h-[40px] rounded-xl flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all shrink-0"
            title={isBottomControlsCollapsed ? 'Rozwiń narzędzia' : 'Zwiń narzędzia'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 transition-transform duration-500 ${isBottomControlsCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Główny dolny kontener narzędzi */}
          <div className={`flex items-stretch gap-3 transition-all duration-500 origin-left ${isBottomControlsCollapsed ? 'opacity-0 scale-95 w-0 px-0' : 'opacity-100 scale-100 px-2 py-1'}`}>
            {/* Lewa kolumna: przyciski zoomu + - ⌂ */}
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={() => handleZoom('in')}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center text-white font-bold text-lg shadow-sm"
                title="Przybliż (Zoom In)"
              >
                +
              </button>
              <button
                onClick={() => handleZoom('out')}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center text-white font-bold text-lg shadow-sm"
                title="Oddal (Zoom Out)"
              >
                −
              </button>
              <div className="w-full h-[1px] bg-white/15 my-0.5" />
              <button
                onClick={handleResetCamera}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center text-indigo-300 text-xs font-semibold shadow-sm"
                title="Wyśrodkuj kamerę na torze"
              >
                ⌂
              </button>
            </div>

            {/* Pionowy separator */}
            <div className="w-[1px] self-stretch min-h-[100px] bg-white/15 shrink-0" />

            {/* Prawa kolumna: Linie Pomocnicze, Magnes oraz Nakładanie */}
            <div className="flex flex-col gap-2 justify-center w-52 shrink-0">

              {/* Toggle Rysowania Linii Pomocniczych (Krawężników) */}
              <div className="flex gap-1 w-full">
                <button
                  onClick={() => {
                    const nextDrawing = !isDrawingLine;
                    setIsDrawingLine(nextDrawing);
                    if (nextDrawing) {
                      setIsMeasuring(false);
                      if (onSelectTeam) onSelectTeam(null);
                      setSelectedLine(null);
                    }
                  }}
                  className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-semibold transition-all shadow-md flex items-center justify-center gap-1.5 ${
                    isDrawingLine
                      ? 'bg-amber-600 border border-amber-400 text-white shadow-amber-500/30 animate-pulse'
                      : 'bg-white/10 border border-white/20 text-white/90 hover:bg-white/20 hover:text-white'
                  }`}
                  title="Rysuj linię pomocniczą (np. krawężnik/chodnik), do której namioty będą się automatycznie przyciągać i wyrównywać"
                >
                  <span>{isDrawingLine ? '✏️ Rysowanie: WŁ' : '📏 Linia Pomocnicza'}</span>
                </button>
                {guideLines && guideLines.length > 0 && (
                  <button
                    onClick={() => {
                      if (selectedLine && selectedLine.type === 'guide') {
                        onUpdateGuideLines && onUpdateGuideLines((guideLines || []).filter((l) => l.id !== selectedLine.id));
                        setSelectedLine(null);
                      } else {
                        onUpdateGuideLines && onUpdateGuideLines([]);
                        setSelectedLine(null);
                      }
                    }}
                    className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center ${
                      selectedLine && selectedLine.type === 'guide'
                        ? 'bg-red-600 border border-red-400 text-white shadow-red-500/50 animate-pulse'
                        : 'bg-red-500/20 border border-red-500/30 text-red-200 hover:bg-red-500/30'
                    }`}
                    title={selectedLine && selectedLine.type === 'guide' ? "Usuń zaznaczoną linię pomocniczą" : "Usuń wszystkie narysowane linie pomocnicze"}
                  >
                    🗑️
                  </button>
                )}
              </div>

              {/* Toggle Pomiaru Odległości (Linijka) */}
              <div className="flex gap-1 w-full">
                <button
                  onClick={() => {
                    const nextMeasuring = !isMeasuring;
                    setIsMeasuring(nextMeasuring);
                    if (nextMeasuring) {
                      setIsDrawingLine(false);
                      if (onSelectTeam) onSelectTeam(null);
                      setSelectedLine(null);
                    }
                  }}
                  className={`flex-1 py-2 px-2.5 rounded-xl text-xs font-semibold transition-all shadow-md flex items-center justify-center gap-1.5 ${
                    isMeasuring
                      ? 'bg-sky-600 border border-sky-400 text-white shadow-sky-500/30 animate-pulse'
                      : 'bg-white/10 border border-white/20 text-white/90 hover:bg-white/20 hover:text-white'
                  }`}
                  title="Zmierz odległość między dwoma punktami na mapie (np. szerokość drogi wjazdowej lub odległość do namiotu)"
                >
                  <span>{isMeasuring ? '📐 Linijka: WŁ' : '📐 Pomiar (Linijka)'}</span>
                </button>
                {measurements && measurements.length > 0 && (
                  <button
                    onClick={() => {
                      if (selectedLine && selectedLine.type === 'measure') {
                        onUpdateMeasurements && onUpdateMeasurements((measurements || []).filter((m) => m.id !== selectedLine.id));
                        setSelectedLine(null);
                      } else {
                        onUpdateMeasurements && onUpdateMeasurements([]);
                        setSelectedLine(null);
                      }
                    }}
                    className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center ${
                      selectedLine && selectedLine.type === 'measure'
                        ? 'bg-red-600 border border-red-400 text-white shadow-red-500/50 animate-pulse'
                        : 'bg-red-500/20 border border-red-500/30 text-red-200 hover:bg-red-500/30'
                    }`}
                    title={selectedLine && selectedLine.type === 'measure' ? "Usuń zaznaczony pomiar odległości" : "Usuń wszystkie pomiary odległości"}
                  >
                    🗑️
                  </button>
                )}
              </div>

              {/* Toggle Magnesu */}
              {onToggleMagnet && (
                <button
                  onClick={onToggleMagnet}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all shadow-md flex items-center justify-center gap-2 ${enableMagnet
                      ? 'bg-cyan-600 border border-cyan-400 text-white shadow-cyan-500/30'
                      : 'bg-white/10 border border-white/20 text-white/90 hover:bg-white/20 hover:text-white'
                    }`}
                  title="Przełącz automatyczne przyciąganie namiotów do siebie jak magnes podczas przesuwania"
                >
                  <span>{enableMagnet ? '🧲 Magnes: WŁĄCZONY' : '🧲 Magnes: WYŁĄCZONY'}</span>
                </button>
              )}

              {/* Toggle Kamery */}
              <button
                onClick={() => setShowCameraControls(!showCameraControls)}
                className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all shadow-md flex items-center justify-center gap-2 ${showCameraControls
                    ? 'bg-purple-600 border border-purple-400 text-white shadow-purple-500/30'
                    : 'bg-white/10 border border-white/20 text-white/90 hover:bg-white/20 hover:text-white'
                  }`}
                title="Steruj obrotem kamery (Kąt widzenia)"
              >
                <span>🎥 Kamera</span>
              </button>
              
              {/* Toggle Kolizji */}
              {onToggleCollisions && (
                <button
                  onClick={onToggleCollisions}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all shadow-md flex items-center justify-center gap-2 ${allowCollisions
                      ? 'bg-amber-500/80 border border-amber-400 text-white animate-pulse'
                      : 'bg-emerald-600/80 border border-emerald-400 text-white hover:bg-emerald-600'
                    }`}
                  title="Przełącz wykrywanie i blokowanie kolizji między namiotami"
                >
                  <span>{allowCollisions ? '⚠️ Nakładanie: DOZW.' : '🛡️ Nakładanie: BLOKOWANE'}</span>
                </button>
              )}
              {/* Wbudowany suwak obrotu kamery */}
              {showCameraControls && (
                <div className="mt-1 p-3 bg-black/20 rounded-xl border border-white/10 flex flex-col gap-3 animate-fade-in shadow-inner">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-indigo-300 font-semibold uppercase tracking-wider">Obrót</span>
                    <span className="text-white/90 font-mono font-bold bg-white/10 px-1.5 py-0.5 rounded">{Math.round(mapHeading)}°</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="1"
                    value={mapHeading}
                    onChange={(e) => setMapHeading(Number(e.target.value))}
                    className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <button
                    onClick={() => setMapHeading(0)}
                    className="w-full py-1.5 rounded-lg bg-white/5 hover:bg-white/15 border border-transparent hover:border-white/10 text-white/80 hover:text-white text-[10px] font-bold transition-all flex items-center justify-center gap-1.5"
                  >
                    <span>🧭</span> Przywróć północ
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Toast ostrzegający o kolizji */}
      {collisionToast && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-red-600/95 backdrop-blur-md border border-red-400 text-white text-xs sm:text-sm font-bold shadow-2xl flex items-center gap-2.5 animate-bounce">
          <span className="text-lg">🛑</span>
          <span>{collisionToast}</span>
        </div>
      )}

    </div>
  );
});

export default PaddockCanvas;
