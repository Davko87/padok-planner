import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Text, Group, Transformer } from 'react-konva';
import useImage from 'use-image';
import DPadControls from './DPadControls.jsx';

function PaddockCanvas({
  eventData,
  placedTeams = [],
  onUpdateTeams,
  selectedTeamId,
  onSelectTeam,
}) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const trRef = useRef(null);
  const selectedNodeRefs = useRef({});

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

      const newTeamNode = {
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
    const updated = [...placedTeams];
    updated[index] = {
      ...updated[index],
      x: e.target.x(),
      y: e.target.y(),
    };
    onUpdateTeams && onUpdateTeams(updated);
  };

  // ZADANIE 6: Obsługa końca transformacji za pomocą uchwytów (zapewnia krok co 0.5m w świecie fizycznym)
  const handleTransformEnd = () => {
    if (!selectedTeamId || !trRef.current) return;
    const node = selectedNodeRefs.current[selectedTeamId];
    if (!node) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Resetuj skalę węzła do 1, ponieważ zapisujemy rzeczywiste wymiary fizyczne w metrach
    node.scaleX(1);
    node.scaleY(1);

    const updated = placedTeams.map((t) => {
      if (t.id === selectedTeamId) {
        const currentPxW = t.widthMeters * pixelsPerMeter;
        const currentPxH = t.heightMeters * pixelsPerMeter;
        const newPxW = Math.max(10, currentPxW * scaleX);
        const newPxH = Math.max(10, currentPxH * scaleY);

        // Zaokrąglij do dokładnego kroku co 0.5 metra w świecie fizycznym
        const newWidthMeters = Math.max(1, Math.round((newPxW / pixelsPerMeter) * 2) / 2);
        const newHeightMeters = Math.max(1, Math.round((newPxH / pixelsPerMeter) * 2) / 2);

        return {
          ...t,
          x: node.x(),
          y: node.y(),
          rotation: Math.round(node.rotation()),
          widthMeters: newWidthMeters,
          heightMeters: newHeightMeters,
        };
      }
      return t;
    });

    onUpdateTeams && onUpdateTeams(updated);
  };

  // ZADANIE 6: Obsługa precyzyjnych przesunięć z D-Pad (dokładnie o skok np. 1m w metrach -> pikselach)
  const handleDPadMove = (dxMeters, dyMeters) => {
    if (!selectedTeamId) return;
    const dxPx = dxMeters * pixelsPerMeter;
    const dyPx = dyMeters * pixelsPerMeter;

    const updated = placedTeams.map((t) => {
      if (t.id === selectedTeamId) {
        return {
          ...t,
          x: t.x + dxPx,
          y: t.y + dyPx,
        };
      }
      return t;
    });
    onUpdateTeams && onUpdateTeams(updated);
  };

  // ZADANIE 6: Obsługa obrotów o 90° z D-Pad
  const handleDPadRotate = (deltaAngle) => {
    if (!selectedTeamId) return;
    const updated = placedTeams.map((t) => {
      if (t.id === selectedTeamId) {
        return {
          ...t,
          rotation: (t.rotation + deltaAngle + 360) % 360,
        };
      }
      return t;
    });
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

  // Kontrolki zoom HUD
  const handleZoom = (direction) => {
    const scaleBy = 1.25;
    const newScale = direction === 'in' ? stageScale * scaleBy : stageScale / scaleBy;
    const clampedScale = Math.max(0.15, Math.min(5, newScale));
    setStageScale(clampedScale);
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
            const pxWidth = team.widthMeters * pixelsPerMeter;
            const pxHeight = team.heightMeters * pixelsPerMeter;
            const fontSize = Math.max(10, Math.min(18, Math.min(pxWidth, pxHeight) * 0.25));

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
                onDragEnd={(e) => handleTeamDragEnd(index, e)}
              >
                {/* Prostokąt namiotu / strefy teamu */}
                <Rect
                  width={pxWidth}
                  height={pxHeight}
                  fill={team.color ? `${team.color}DF` : '#4f46e5DF'}
                  stroke={isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.4)'}
                  strokeWidth={isSelected ? Math.max(2, 3 / stageScale) : Math.max(1, 1.5 / stageScale)}
                  cornerRadius={Math.max(2, 4 * (pixelsPerMeter / 5))}
                  shadowColor={isSelected ? '#10B981' : '#000000'}
                  shadowBlur={isSelected ? 18 : 6}
                  shadowOpacity={isSelected ? 0.9 : 0.5}
                />

                {/* Nazwa teamu */}
                <Text
                  text={team.name}
                  x={2}
                  y={pxHeight / 2 - fontSize * 0.9}
                  width={pxWidth - 4}
                  align="center"
                  verticalAlign="middle"
                  fill="#ffffff"
                  fontSize={fontSize}
                  fontFamily="Inter, system-ui, sans-serif"
                  fontStyle="bold"
                  listening={false}
                />

                {/* Wymiary fizyczne w metrach na dole prostokąta */}
                <Text
                  text={`${team.widthMeters}×${team.heightMeters}m`}
                  x={2}
                  y={pxHeight / 2 + fontSize * 0.3}
                  width={pxWidth - 4}
                  align="center"
                  fill="rgba(255, 255, 255, 0.75)"
                  fontSize={Math.max(8, fontSize * 0.7)}
                  fontFamily="monospace"
                  listening={false}
                />
              </Group>
            );
          })}

          {/* ZADANIE 6: react-konva Transformer z obracaniem i skokiem co 0.5m w świecie fizycznym */}
          {selectedTeamId && (
            <Transformer
              ref={trRef}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 10 || newBox.height < 10) {
                  return oldBox;
                }
                return newBox;
              }}
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              anchorStroke="#10B981"
              anchorFill="#ffffff"
              anchorSize={Math.max(8, 10 / stageScale)}
              borderStroke="#10B981"
              borderStrokeWidth={Math.max(1, 2 / stageScale)}
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

      {/* HUD: Kontrolki kamery */}
      <div className="absolute bottom-6 left-6 z-30 flex flex-col gap-2 pointer-events-auto">
        <div className="glass-panel p-2 flex flex-col gap-1.5 shadow-glass border-white/20">
          <button
            onClick={() => handleZoom('in')}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center text-white font-bold text-lg"
            title="Przybliż (Zoom In)"
          >
            +
          </button>
          <button
            onClick={() => handleZoom('out')}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center text-white font-bold text-lg"
            title="Oddal (Zoom Out)"
          >
            −
          </button>
          <div className="w-full h-[1px] bg-white/10 my-0.5" />
          <button
            onClick={handleResetCamera}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center text-indigo-300 text-xs font-semibold"
            title="Wyśrodkuj kamerę na torze"
          >
            ⌂
          </button>
        </div>

        {/* Tryb Panning Toggle */}
        <button
          onClick={() => setIsPanMode(!isPanMode)}
          className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all shadow-glass flex items-center gap-2 ${
            isPanMode
              ? 'bg-indigo-500/80 border border-indigo-400 text-white'
              : 'bg-white/10 backdrop-blur-md border border-white/20 text-white/70 hover:text-white'
          }`}
        >
          <span>{isPanMode ? '✋ Tryb Przesuwania' : '👆 Tryb Zaznaczania'}</span>
        </button>
      </div>

      {/* HUD info o skali */}
      <div className="absolute top-16 right-4 md:right-80 z-30 hidden sm:flex items-center gap-3 glass-panel px-4 py-2 border-white/15 text-xs text-white/70 font-mono">
        <span className="flex items-center gap-1.5 text-emerald-300">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          Skala: {pixelsPerMeter.toFixed(2)} px/m
        </span>
        <span>|</span>
        <span>Teamów na torze: {placedTeams.length}</span>
      </div>

      {/* Informacja o ładowaniu tła */}
      {bgStatus === 'loading' && (
        <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center gap-3 z-20 pointer-events-none">
          <div className="w-10 h-10 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-white/80 font-medium">Ładowanie satelitarnego tła toru ({eventData?.widthMeters || 250}m)...</p>
        </div>
      )}
    </div>
  );
}

export default PaddockCanvas;
