import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Text, Group, Transformer } from 'react-konva';
import useImage from 'use-image';
import DPadControls from './DPadControls.jsx';
import { checkTeamCollidesWithOthers, findCleanSpotForNode, findMagneticSnapPosition } from '../lib/geoUtils.js';

const PaddockCanvas = forwardRef(function PaddockCanvas({
  eventData,
  placedTeams = [],
  onUpdateTeams,
  selectedTeamId,
  onSelectTeam,
  allowCollisions = false,
  onToggleCollisions,
  enableMagnet = false,
  onToggleMagnet,
  getViewportCenterRef,
  onScaleReport,
}, ref) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const trRef = useRef(null);
  const selectedNodeRefs = useRef({});
  const lastValidCoordsRef = useRef({});

  const [collidingTeamIds, setCollidingTeamIds] = useState([]);
  const [collisionToast, setCollisionToast] = useState('');

  // EKSPORT: udostępnij metodę exportAsImage() dla rodzica (PlannerPage)
  useImperativeHandle(ref, () => ({
    exportAsImage: () => {
      const stage = stageRef.current;
      if (!stage) return null;

      // Zapamiętaj aktualny stan kamery i zaznaczenia
      const oldScale = stage.scale();
      const oldPos = stage.position();
      const oldWidth = stage.width();
      const oldHeight = stage.height();

      // Ukryj Transformer (zaznaczenie) na czas eksportu
      if (trRef.current) {
        trRef.current.nodes([]);
        trRef.current.getLayer()?.batchDraw();
      }

      // Ustaw scenę tak, by obejmowała cały obraz tła w skali 1:1
      const exportW = bgImage ? bgImage.width : 1024;
      const exportH = bgImage ? bgImage.height : 1024;
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      stage.width(exportW);
      stage.height(exportH);
      stage.batchDraw();

      // Renderuj do dataURL (PNG w wysokiej jakości)
      const dataUrl = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' });

      // Przywróć oryginalny stan kamery
      stage.scale(oldScale);
      stage.position(oldPos);
      stage.width(oldWidth);
      stage.height(oldHeight);

      // Przywróć Transformer
      if (selectedTeamId && trRef.current && selectedNodeRefs.current[selectedTeamId]) {
        trRef.current.nodes([selectedNodeRefs.current[selectedTeamId]]);
      }
      stage.batchDraw();

      return dataUrl;
    },
  }), [bgImage, selectedTeamId]);

  // Udostępnij metodę do pobierania środka aktualnego widoku (kamery)
  useEffect(() => {
    if (getViewportCenterRef) {
      getViewportCenterRef.current = () => {
        const stage = stageRef.current;
        if (!stage) return null;
        const screenCenter = { x: stage.width() / 2, y: stage.height() / 2 };
        const transform = stage.getAbsoluteTransform().copy();
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
  const [isPanMode, setIsPanMode] = useState(false);

  // Załaduj obraz satelitarny w tle z obsługą automatycznego ponawiania i fallbacks (bez blokady CORS)
  const defaultFallbackUrl = 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/16.7962,52.4185,17,0,0/1024x1024?access_token=' + (import.meta.env.VITE_MAPBOX_TOKEN || '');
  
  const [currentImageUrl, setCurrentImageUrl] = useState(eventData?.imageUrl || defaultFallbackUrl);
  const [useAnonymous, setUseAnonymous] = useState(true);

  // Aktualizuj URL obrazu po zmianie eventData
  useEffect(() => {
    if (eventData?.imageUrl) {
      setCurrentImageUrl(eventData.imageUrl);
      setUseAnonymous(true);
    }
  }, [eventData?.imageUrl]);

  const [bgImage, bgStatus] = useImage(currentImageUrl, useAnonymous ? 'anonymous' : undefined);

  // W razie blokady CORS na serwerze Esri/ArcGIS (bgStatus === 'failed') natychmiast załaduj bez wymogu CORS lub w bezpiecznej rozdzielczości!
  useEffect(() => {
    if (bgStatus === 'failed') {
      if (useAnonymous) {
        console.warn('Serwer obrazów zablokował CORS (anonymous). Ponawianie bez wymogu CORS...');
        setUseAnonymous(false);
      } else if (currentImageUrl.includes('size=2048,2048')) {
        console.warn('Serwer Esri odrzucił rozmiar 2048x2048. Ponawianie w rozdzielczości 1280x1280...');
        setCurrentImageUrl(currentImageUrl.replace('size=2048,2048', 'size=1280,1280'));
      } else if (currentImageUrl !== defaultFallbackUrl) {
        console.warn('Pobieranie obrazu Esri nie powiodło się. Przełączanie na warstwę rezerwową...');
        setCurrentImageUrl(defaultFallbackUrl);
      }
    }
  }, [bgStatus, useAnonymous, currentImageUrl, defaultFallbackUrl]);

  // Oblicz pixelsPerMeter tak, aby szerokość obrazu w pikselach odpowiadała fizycznej szerokości w metrach z Firestore
  const imgWidth = bgImage ? bgImage.width : 1024;
  const imgHeight = bgImage ? bgImage.height : 1024;
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
    if (bgImage && containerRef.current) {
      const containerW = containerRef.current.offsetWidth;
      const containerH = containerRef.current.offsetHeight;

      const scaleW = (containerW * 0.85) / bgImage.width;
      const scaleH = (containerH * 0.85) / bgImage.height;
      const initialScale = Math.max(0.3, Math.min(1.5, Math.min(scaleW, scaleH)));

      setStageScale(initialScale);
      setStagePos({
        x: (containerW - bgImage.width * initialScale) / 2,
        y: (containerH - bgImage.height * initialScale) / 2,
      });
    }
  }, [bgImage]);

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
    setStagePos(newPos);
  }, [stageScale, stagePos]);

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
      const transform = stage.getAbsoluteTransform().copy();
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
        const snapped = findMagneticSnapPosition(newTeamNode, placedTeams, pixelsPerMeter, 0.8);
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

  // Kliknięcie w puste tło odznacza team
  const handleStageClick = (e) => {
    if (e.target === stageRef.current || e.target.name() === 'background-image') {
      onSelectTeam && onSelectTeam(null);
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
      const snapped = findMagneticSnapPosition(candidate, placedTeams, pixelsPerMeter, 0.8);
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
      const snapped = findMagneticSnapPosition(candidate, placedTeams, pixelsPerMeter, 0.8);
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
      const snapped = findMagneticSnapPosition(candidate, placedTeams, pixelsPerMeter, 0.8);
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
    setStagePos(newPos);
  };

  const handleResetCamera = () => {
    if (bgImage && containerRef.current) {
      const containerW = containerRef.current.offsetWidth;
      const containerH = containerRef.current.offsetHeight;
      const scaleW = (containerW * 0.85) / bgImage.width;
      const scaleH = (containerH * 0.85) / bgImage.height;
      const initialScale = Math.max(0.3, Math.min(1.5, Math.min(scaleW, scaleH)));

      setStageScale(initialScale);
      setStagePos({
        x: (containerW - bgImage.width * initialScale) / 2,
        y: (containerH - bgImage.height * initialScale) / 2,
      });
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
      {/* Baner ładowania lub ponawiania pobierania tła satelitarnego */}
      {bgStatus === 'loading' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm pointer-events-none animate-fade-in">
          <div className="glass-panel-strong px-8 py-5 rounded-2xl flex items-center gap-4 border-indigo-400/40 shadow-2xl">
            <div className="w-8 h-8 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <div>
              <h4 className="font-extrabold text-white text-sm sm:text-base">⏳ Pobieranie zrzutu satelitarnego (Ultra HD)...</h4>
              <p className="text-xs text-indigo-300 font-mono">Generowanie tła roboczego z wykadrowanego obszaru</p>
            </div>
          </div>
        </div>
      )}

      {/* react-konva Stage */}
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        scale={{ x: stageScale, y: stageScale }}
        position={stagePos}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onTap={handleStageClick}
        draggable={isPanMode || selectedTeamId === null}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        className="cursor-default active:cursor-grabbing"
      >
        <Layer>
          {/* 1. Obraz Satelitarny (Tło) */}
          {bgImage && (
            <KonvaImage
              name="background-image"
              image={bgImage}
              x={0}
              y={0}
              width={bgImage.width}
              height={bgImage.height}
              shadowColor="#000000"
              shadowBlur={30}
              shadowOpacity={0.7}
            />
          )}

          {/* Ramka granic obszaru toru */}
          {bgImage && (
            <Rect
              x={0}
              y={0}
              width={bgImage.width}
              height={bgImage.height}
              stroke="rgba(255, 255, 255, 0.25)"
              strokeWidth={2 / stageScale}
              listening={false}
            />
          )}

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
                draggable
                onClick={(e) => {
                  e.cancelBubble = true;
                  onSelectTeam && onSelectTeam(team.id);
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  onSelectTeam && onSelectTeam(team.id);
                }}
                onDragStart={(e) => {
                  e.cancelBubble = true;
                  onSelectTeam && onSelectTeam(team.id);
                }}
                onDragMove={(e) => {
                  let candidate = {
                    ...team,
                    x: e.target.x(),
                    y: e.target.y(),
                  };
                  if (enableMagnet) {
                    const snapped = findMagneticSnapPosition(candidate, placedTeams, pixelsPerMeter, 0.8);
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
        </Layer>
      </Stage>

      {/* ZADANIE 6: Szklany Panel D-Pad na dole ekranu (Rozwiązanie "Grubego Palca") */}
      <DPadControls
        selectedTeam={selectedTeamObj}
        onMove={handleDPadMove}
        onRotate={handleDPadRotate}
        onResize={handleDPadResize}
        onDeselect={() => onSelectTeam && onSelectTeam(null)}
        pixelsPerMeter={pixelsPerMeter}
      />

      {/* HUD: Kontrolki kamery i trybów połączone w jeden elegancki, półprzeźroczysty szklany panel (zgodnie ze zdjęciem) */}
      <div className="absolute bottom-6 left-6 z-30 pointer-events-auto">
        <div className="glass-panel p-3 flex items-center gap-3 shadow-glass border-white/20">
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

          {/* Prawa kolumna wewnątrz czarnego szklanego bloku: Tryb Przesuwania, Magnes oraz Nakładanie */}
          <div className="flex flex-col gap-2 justify-center w-52 shrink-0">
            {/* Tryb Panning Toggle */}
            <button
              onClick={() => setIsPanMode(!isPanMode)}
              className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all shadow-md flex items-center justify-center gap-2 ${
                isPanMode
                  ? 'bg-indigo-600 border border-indigo-400 text-white shadow-indigo-500/30'
                  : 'bg-white/10 border border-white/20 text-white/90 hover:bg-white/20 hover:text-white'
              }`}
            >
              <span>{isPanMode ? '✋ Tryb Przesuwania' : '👆 Tryb Zaznaczania'}</span>
            </button>

            {/* Toggle Magnesu */}
            {onToggleMagnet && (
              <button
                onClick={onToggleMagnet}
                className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all shadow-md flex items-center justify-center gap-2 ${
                  enableMagnet
                    ? 'bg-cyan-600 border border-cyan-400 text-white shadow-cyan-500/30'
                    : 'bg-white/10 border border-white/20 text-white/90 hover:bg-white/20 hover:text-white'
                }`}
                title="Przełącz automatyczne przyciąganie namiotów do siebie jak magnes podczas przesuwania"
              >
                <span>{enableMagnet ? '🧲 Magnes: WŁĄCZONY' : '🧲 Magnes: WYŁĄCZONY'}</span>
              </button>
            )}

            {/* Toggle Kolizji */}
            {onToggleCollisions && (
              <button
                onClick={onToggleCollisions}
                className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all shadow-md flex items-center justify-center gap-2 ${
                  allowCollisions
                    ? 'bg-amber-500/80 border border-amber-400 text-white animate-pulse'
                    : 'bg-emerald-600/80 border border-emerald-400 text-white hover:bg-emerald-600'
                }`}
                title="Przełącz wykrywanie i blokowanie kolizji między namiotami"
              >
                <span>{allowCollisions ? '⚠️ Nakładanie: DOZW.' : '🛡️ Nakładanie: BLOKOWANE'}</span>
              </button>
            )}
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

      {/* Informacja o ładowaniu tła */}
      {bgStatus === 'loading' && (
        <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center gap-3 z-20 pointer-events-none">
          <div className="w-10 h-10 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-white/80 font-medium">Ładowanie satelitarnego tła toru ({eventData?.widthMeters || 250}m)...</p>
        </div>
      )}
    </div>
  );
});

export default PaddockCanvas;
