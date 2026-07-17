import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const PRESET_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#ffffff', // White
  '#334155', // Slate dark
];

function NewTeamModal({ isOpen, onClose, editingTeam = null, onUpdateTemplate = null }) {
  const [name, setName] = useState('');
  const [width, setWidth] = useState('10');
  const [length, setLength] = useState('15');
  const [color, setColor] = useState('#ef4444');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (editingTeam) {
      setName(editingTeam.name || '');
      setWidth(String(editingTeam.width || editingTeam.widthMeters || '10'));
      setLength(String(editingTeam.length || editingTeam.heightMeters || '15'));
      setColor(editingTeam.color || '#ef4444');
    } else if (isOpen) {
      setName('');
      setWidth('10');
      setLength('15');
      setColor('#ef4444');
      setError('');
    }
  }, [editingTeam, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Podaj nazwę teamu.');
      return;
    }
    const parsedWidth = parseFloat(width);
    const parsedLength = parseFloat(length);

    if (isNaN(parsedWidth) || parsedWidth <= 0 || isNaN(parsedLength) || parsedLength <= 0) {
      setError('Szerokość i długość muszą być dodatnimi liczbami.');
      return;
    }

    try {
      setIsSubmitting(true);
      const teamData = {
        name: name.trim(),
        width: parsedWidth,
        length: parsedLength,
        color,
        updatedAt: serverTimestamp(),
      };

      if (editingTeam && editingTeam.id) {
        // Błyskawiczny zapis bez blokowania interfejsu (optymistyczny update + synchro w tle bez czekania 40s)
        updateDoc(doc(db, 'teams_templates', editingTeam.id), teamData).catch((err) =>
          console.error('Błąd synchronizacji updateDoc w tle:', err)
        );
        if (onUpdateTemplate) {
          onUpdateTemplate({ id: editingTeam.id, ...teamData });
        }
      } else {
        // Nowy team - błyskawiczna inicjacja bez czekania na wolny ACK z serwera
        addDoc(collection(db, 'teams_templates'), {
          ...teamData,
          createdAt: serverTimestamp(),
        }).catch((err) => console.error('Błąd synchronizacji addDoc w tle:', err));
      }

      // Natychmiastowe zamknięcie modalu (zapis trwa < 0.1s zamiast 40s)
      setIsSubmitting(false);
      onClose();
    } catch (err) {
      console.error('Błąd podczas zapisywania szablonu teamu:', err);
      setError('Nie udało się zapisać teamu.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
      <div className="glass-panel-strong w-full max-w-md p-6 md:p-8 relative animate-slide-up shadow-2xl border-white/30">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-white/50 hover:text-white transition-colors duration-200 p-1 rounded-lg hover:bg-white/10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        <h3 className="text-2xl font-bold mb-1 text-white flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-indigo-400 inline-block" />
          {editingTeam ? 'Edycja Szablonu Teamu' : 'Nowy Szablon Teamu'}
        </h3>
        <p className="text-white/50 text-sm mb-6">
          {editingTeam
            ? 'Zmień sztywny metraż lub kolor zespołu. Zmiany natychmiast zaktualizują naczepy na torze!'
            : 'Zdefiniuj parametry fizyczne (metraż) i kolor dla zespołu wyścigowego.'}
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-sm flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Nazwa Teamu */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/70 mb-2">
              Nazwa Teamu
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Red Bull Racing, Ferrari..."
              required
              className="glass-input w-full"
            />
          </div>

          {/* Wymiary (w metrach) */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-white/70 mb-2">
                Szerokość [m]
              </label>
              <input
                type="number"
                step="0.5"
                min="1"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                required
                className="glass-input w-full"
                placeholder="10"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-white/70 mb-2">
                Długość [m]
              </label>
              <input
                type="number"
                step="0.5"
                min="1"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                required
                className="glass-input w-full"
                placeholder="15"
              />
            </div>
          </div>

          {/* Kolor */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/70 mb-2">
              Kolor Identyfikator
            </label>
            <div className="flex flex-wrap gap-2.5 mb-3">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setColor(preset)}
                  className={`w-8 h-8 rounded-xl border transition-transform duration-200 ${
                    color === preset ? 'scale-125 border-white shadow-lg ring-2 ring-indigo-400/50' : 'border-white/20 hover:scale-110'
                  }`}
                  style={{ backgroundColor: preset }}
                />
              ))}
            </div>
            <div className="flex items-center gap-3 bg-white/5 p-2 rounded-xl border border-white/10">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0"
              />
              <span className="text-sm font-mono text-white/80 uppercase">{color}</span>
              <span className="text-xs text-white/40 ml-auto">Własny kolor</span>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="glass-button flex-1 py-3 text-sm text-white/70 hover:text-white"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="glass-button-primary flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Zapisywanie...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                  {editingTeam ? 'Zapisz Zmiany' : 'Dodaj Team'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewTeamModal;
