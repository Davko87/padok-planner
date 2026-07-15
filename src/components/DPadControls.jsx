import React, { useState } from 'react';

function DPadControls({
  selectedTeam,
  onMove,
  onRotate,
  onResize,
  onDeselect,
  pixelsPerMeter = 10,
}) {
  const [stepMeters, setStepMeters] = useState(1.0); // Domyślnie dokładny 1 metr z Zadania 6

  if (!selectedTeam) return null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-3 pointer-events-auto animate-slide-up max-w-[95vw]">
      {/* Nagłówek i szczegóły zaznaczonego teamu */}
      <div className="glass-panel-strong px-5 py-2.5 flex flex-wrap items-center justify-between gap-4 w-full border-indigo-400/30 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <div
            className="w-4 h-4 rounded-md border border-white/40 shadow-sm shrink-0"
            style={{ backgroundColor: selectedTeam.color || '#4f46e5' }}
          />
          <div>
            <h4 className="text-xs font-bold text-white truncate max-w-[160px] md:max-w-[220px]">
              {selectedTeam.name}
            </h4>
            <p className="text-[10px] font-mono text-emerald-300">
              {selectedTeam.widthMeters} × {selectedTeam.heightMeters} m | Kąt: {Math.round(selectedTeam.rotation || 0)}°
            </p>
          </div>
        </div>

        {/* Przełącznik skoku (1.0m / 0.5m) */}
        <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10 text-[11px] font-mono">
          <span className="text-white/50 px-1.5">Skok:</span>
          <button
            type="button"
            onClick={() => setStepMeters(0.5)}
            className={`px-2 py-0.5 rounded-lg transition-all ${
              stepMeters === 0.5 ? 'bg-emerald-500 text-white font-bold' : 'text-white/70 hover:text-white'
            }`}
          >
            0.5m
          </button>
          <button
            type="button"
            onClick={() => setStepMeters(1.0)}
            className={`px-2 py-0.5 rounded-lg transition-all ${
              stepMeters === 1.0 ? 'bg-emerald-500 text-white font-bold' : 'text-white/70 hover:text-white'
            }`}
          >
            1.0m
          </button>
        </div>

        <button
          type="button"
          onClick={onDeselect}
          className="text-white/50 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
          title="Odznacz zespól"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* Główny Panel D-Pad i Obracania (Gruby Palec) */}
      <div className="glass-panel-strong p-3.5 flex items-center justify-center gap-6 border-white/25 shadow-[0_16px_50px_rgba(0,0,0,0.7)]">
        {/* Przycisk obrotu w lewo (-90°) */}
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => onRotate(-90)}
            className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 flex items-center justify-center text-white/90 hover:text-white transition-all shadow-md group"
            title="Obróć o -90°"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 transform -scale-x-100 group-hover:-rotate-45 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
          <span className="text-[10px] text-white/50 font-mono">−90°</span>
        </div>

        {/* Krzyżak D-Pad (Strzałki) */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/40 rounded-2xl border border-white/10 shadow-inner">
          {/* Top Row: empty, UP, empty */}
          <div />
          <button
            type="button"
            onClick={() => onMove(0, -stepMeters)}
            className="w-11 h-11 rounded-xl bg-white/15 hover:bg-emerald-500/40 active:scale-90 border border-white/20 flex items-center justify-center text-white shadow transition-all"
            title={`Przesuń w górę o ${stepMeters}m`}
          >
            ▲
          </button>
          <div />

          {/* Middle Row: LEFT, Center Icon, RIGHT */}
          <button
            type="button"
            onClick={() => onMove(-stepMeters, 0)}
            className="w-11 h-11 rounded-xl bg-white/15 hover:bg-emerald-500/40 active:scale-90 border border-white/20 flex items-center justify-center text-white shadow transition-all"
            title={`Przesuń w lewo o ${stepMeters}m`}
          >
            ◀
          </button>
          <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 font-mono text-[10px] font-bold">
            D-PAD
          </div>
          <button
            type="button"
            onClick={() => onMove(stepMeters, 0)}
            className="w-11 h-11 rounded-xl bg-white/15 hover:bg-emerald-500/40 active:scale-90 border border-white/20 flex items-center justify-center text-white shadow transition-all"
            title={`Przesuń w prawo o ${stepMeters}m`}
          >
            ▶
          </button>

          {/* Bottom Row: empty, DOWN, empty */}
          <div />
          <button
            type="button"
            onClick={() => onMove(0, stepMeters)}
            className="w-11 h-11 rounded-xl bg-white/15 hover:bg-emerald-500/40 active:scale-90 border border-white/20 flex items-center justify-center text-white shadow transition-all"
            title={`Przesuń w dół o ${stepMeters}m`}
          >
            ▼
          </button>
          <div />
        </div>

        {/* Przycisk obrotu w prawo (+90°) */}
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => onRotate(90)}
            className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 flex items-center justify-center text-white/90 hover:text-white transition-all shadow-md group"
            title="Obróć o +90°"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 group-hover:rotate-45 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
          <span className="text-[10px] text-white/50 font-mono">+90°</span>
        </div>

        {/* Szybka korekta wymiarów (Tablet / Gruby Palec) */}
        <div className="hidden sm:flex flex-col gap-1 pl-3 border-l border-white/15">
          <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold text-center mb-0.5">
            Wymiary [±0.5m]
          </span>
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-white/60 w-8">Szer:</span>
            <button
              onClick={() => onResize(-0.5, 0)}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/80"
              title="Zmniejsz szerokość o 0.5m"
            >
              −
            </button>
            <button
              onClick={() => onResize(0.5, 0)}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/80"
              title="Zwiększ szerokość o 0.5m"
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-white/60 w-8">Dłg:</span>
            <button
              onClick={() => onResize(0, -0.5)}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/80"
              title="Zmniejsz długość o 0.5m"
            >
              −
            </button>
            <button
              onClick={() => onResize(0, 0.5)}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/80"
              title="Zwiększ długość o 0.5m"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DPadControls;
