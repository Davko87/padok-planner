import React, { useState } from 'react';

function DPadControls({
  selectedTeam,
  onMove,
  onRotate,
  onResize,
  onDeselect,
  onToggleLock,
  pixelsPerMeter = 10,
}) {
  const [stepMeters, setStepMeters] = useState(1.0);
  const [showPrecision, setShowPrecision] = useState(false);

  if (!selectedTeam) return null;

  const toggleStep = () => setStepMeters((s) => (s === 1.0 ? 0.5 : 1.0));

  // Compact icon button helper
  const IconBtn = ({ onClick, title, children, className = '' }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all active:scale-90 ${className}`}
    >
      {children}
    </button>
  );

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-auto animate-slide-up">
      {/* Precision angle popover */}
      {showPrecision && (
        <div className="mb-2 flex justify-center animate-slide-up">
          <div className="glass-panel-strong px-3 py-2 flex items-center gap-2 border-white/15">
            {[-5, -1, 1, 5].map((deg) => (
              <button
                key={deg}
                onClick={() => onRotate(deg)}
                className="px-2.5 py-1 rounded-lg bg-white/8 hover:bg-white/20 active:bg-emerald-500/30 text-[11px] font-mono font-bold text-white/80 hover:text-white transition-all border border-white/10"
                title={`Obróć o ${deg > 0 ? '+' : ''}${deg}°`}
              >
                {deg > 0 ? '+' : '−'}{Math.abs(deg)}°
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main compact strip */}
      <div className="glass-panel-strong flex items-center gap-1 px-2 py-1.5 border-white/20 shadow-[0_12px_40px_rgba(0,0,0,0.7)]">

        {/* Team info pill */}
        <div className="flex items-center gap-1.5 pl-1 pr-2.5 border-r border-white/10 mr-1">
          <div
            className="w-3 h-3 rounded-md border border-white/30 shrink-0"
            style={{ backgroundColor: selectedTeam.color || '#4f46e5' }}
          />
          <div className="leading-none">
            <span className="text-[11px] font-bold text-white block truncate max-w-[100px]">
              {selectedTeam.name}
            </span>
            <span className="text-[9px] font-mono text-emerald-400">
              {selectedTeam.widthMeters}×{selectedTeam.heightMeters}m · {Math.round(selectedTeam.rotation || 0)}°
            </span>
          </div>
        </div>

        {/* Lock/Unlock toggle */}
        <IconBtn
          onClick={onToggleLock}
          title={selectedTeam.isLocked !== false ? 'Rozgrupuj elementy' : 'Grupuj elementy'}
          className={selectedTeam.isLocked !== false
            ? 'bg-rose-500/20 border border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
            : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
          }
        >
          <span className="text-sm">{selectedTeam.isLocked !== false ? '🔒' : '🔓'}</span>
        </IconBtn>

        {/* Separator */}
        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* Step toggle */}
        <button
          type="button"
          onClick={toggleStep}
          className="px-2 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-[10px] font-mono font-bold text-emerald-300 hover:bg-emerald-500/30 transition-all"
          title="Przełącz krok przesuwania"
        >
          {stepMeters}m
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* Rotation -90° */}
        <IconBtn
          onClick={() => onRotate(-90)}
          title="Obróć −90°"
          className="bg-white/8 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 -scale-x-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </IconBtn>

        {/* D-Pad: compact inline arrows */}
        <div className="flex items-center gap-0.5 bg-black/30 rounded-xl p-0.5 border border-white/8">
          <IconBtn onClick={() => onMove(-stepMeters, 0)} title="← Lewo" className="bg-white/10 hover:bg-emerald-500/30 text-white/80 hover:text-white text-xs">◀</IconBtn>
          <div className="flex flex-col gap-0.5">
            <IconBtn onClick={() => onMove(0, -stepMeters)} title="↑ Góra" className="bg-white/10 hover:bg-emerald-500/30 text-white/80 hover:text-white text-xs">▲</IconBtn>
            <IconBtn onClick={() => onMove(0, stepMeters)} title="↓ Dół" className="bg-white/10 hover:bg-emerald-500/30 text-white/80 hover:text-white text-xs">▼</IconBtn>
          </div>
          <IconBtn onClick={() => onMove(stepMeters, 0)} title="→ Prawo" className="bg-white/10 hover:bg-emerald-500/30 text-white/80 hover:text-white text-xs">▶</IconBtn>
        </div>

        {/* Rotation +90° */}
        <IconBtn
          onClick={() => onRotate(90)}
          title="Obróć +90°"
          className="bg-white/8 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </IconBtn>

        {/* Separator */}
        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* Precision angle toggle */}
        <IconBtn
          onClick={() => setShowPrecision(!showPrecision)}
          title="Precyzyjny kąt ±1°/±5°"
          className={`border text-[10px] font-mono font-bold transition-all ${
            showPrecision
              ? 'bg-indigo-500/25 border-indigo-400/40 text-indigo-300'
              : 'bg-white/8 border-white/10 text-white/50 hover:text-white/80 hover:bg-white/15'
          }`}
        >
          ±°
        </IconBtn>

        {/* Close / Deselect */}
        <IconBtn
          onClick={onDeselect}
          title="Odznacz zespół"
          className="bg-white/5 hover:bg-white/15 text-white/40 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </IconBtn>
      </div>
    </div>
  );
}

export default DPadControls;
