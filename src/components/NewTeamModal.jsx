import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useAuth } from '../context/AuthContext.jsx';

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

const genElementId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

function NewTeamModal({ isOpen, onClose, editingTeam = null, onUpdateTemplate = null }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#ef4444');
  const { currentUser } = useAuth();

  const [activeElements, setActiveElements] = useState({
    truck: { enabled: true, width: 2.5, length: 12, hasLift: true, liftLength: 3.3 },
    awning: { enabled: false, width: 4, length: 12 },
    van: { enabled: false, width: 2.2, length: 6 },
    car: { enabled: false, width: 2, length: 4.5 },
    towTruck: { enabled: false, width: 2.2, length: 5 },
  });

  const [tentsEnabled, setTentsEnabled] = useState(false);
  const [tents, setTents] = useState([
    { id: genElementId(), width: 3, length: 3 }
  ]);

  const VEHICLE_TYPES = [
    { type: 'truck', label: 'Ciężarówka (naczepa)', icon: '🚛', defW: 2.5, defL: 12 },
    { type: 'awning', label: 'Markiza (boczna)', icon: '⛺', defW: 4, defL: 12 },
    { type: 'van', label: 'Bus serwisowy', icon: '🚐', defW: 2.2, defL: 6 },
    { type: 'tent', label: 'Namiot wolnostojący', icon: '🎪', defW: 3, defL: 3 },
    { type: 'car', label: 'Samochód osobowy', icon: '🚗', defW: 2, defL: 4.5 },
    { type: 'towTruck', label: 'Laweta', icon: '🛻', defW: 2.2, defL: 5 },
  ];

  useEffect(() => {
    if (editingTeam) {
      setName(editingTeam.name || '');
      setColor(editingTeam.color || '#ef4444');
      
      if (editingTeam.elements && editingTeam.elements.length > 0) {
        const newActive = {
          truck: { enabled: false, width: 2.5, length: 12, hasLift: true, liftLength: 3.3 },
          awning: { enabled: false, width: 4, length: 12 },
          van: { enabled: false, width: 2.2, length: 6 },
          car: { enabled: false, width: 2, length: 4.5 },
          towTruck: { enabled: false, width: 2.2, length: 5 },
        };
        const loadedTents = [];

        editingTeam.elements.forEach(el => {
          if (el.type === 'tent') {
            loadedTents.push({
              id: el.id,
              width: el.width,
              length: el.length,
              offsetX: el.offsetX,
              offsetY: el.offsetY,
              rotation: el.rotation
            });
          } else if (el.type === 'truck') {
            newActive.truck = {
              enabled: true,
              width: el.width,
              length: el.length,
              hasLift: el.hasLift !== undefined ? !!el.hasLift : true,
              liftLength: el.liftLength !== undefined ? el.liftLength : 3.3,
            };
          } else if (newActive[el.type]) {
            newActive[el.type] = { enabled: true, width: el.width, length: el.length };
          }
        });

        setActiveElements(newActive);
        if (loadedTents.length > 0) {
          setTents(loadedTents);
          setTentsEnabled(true);
        } else {
          setTents([{ id: genElementId(), width: 3, length: 3 }]);
          setTentsEnabled(false);
        }
      } else {
        setActiveElements({
          truck: {
            enabled: true,
            width: editingTeam.width || 10,
            length: editingTeam.length || 15,
            hasLift: true,
            liftLength: 3.3
          },
          awning: { enabled: false, width: 4, length: 12 },
          van: { enabled: false, width: 2.2, length: 6 },
          car: { enabled: false, width: 2, length: 4.5 },
          towTruck: { enabled: false, width: 2.2, length: 5 },
        });
        setTents([{ id: genElementId(), width: 3, length: 3 }]);
        setTentsEnabled(false);
      }
    } else if (isOpen) {
      setName('');
      setColor('#ef4444');
      setError('');
      setActiveElements({
        truck: { enabled: true, width: 2.5, length: 12, hasLift: true, liftLength: 3.3 },
        awning: { enabled: false, width: 4, length: 12 },
        van: { enabled: false, width: 2.2, length: 6 },
        car: { enabled: false, width: 2, length: 4.5 },
        towTruck: { enabled: false, width: 2.2, length: 5 },
      });
      setTents([{ id: genElementId(), width: 3, length: 3 }]);
      setTentsEnabled(false);
    }
  }, [editingTeam, isOpen]);

  if (!isOpen) return null;

  const handleAddTent = () => {
    setTents(prev => [...prev, { id: genElementId(), width: 3, length: 3 }]);
    setTentsEnabled(true);
  };

  const handleRemoveTent = (index) => {
    setTents(prev => {
      const updated = prev.filter((_, i) => i !== index);
      if (updated.length === 0) {
        setTentsEnabled(false);
      }
      return updated;
    });
  };

  const handleUpdateTent = (index, field, value) => {
    setTents(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleToggleTents = (checked) => {
    setTentsEnabled(checked);
    if (checked && tents.length === 0) {
      setTents([{ id: genElementId(), width: 3, length: 3 }]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Podaj nazwę teamu.');
      return;
    }

    // Zbieramy aktywne elementy do tablicy
    const teamElements = [];
    let currentOffsetX = 0; 
    
    // Pojazdy i naczepy
    Object.entries(activeElements).forEach(([type, data]) => {
      if (data.enabled) {
        let existingEl = null;
        if (editingTeam && editingTeam.elements) {
          existingEl = editingTeam.elements.find(el => el.type === type);
        }

        const elData = {
          id: existingEl ? existingEl.id : genElementId(),
          type,
          width: parseFloat(data.width) || 2,
          length: parseFloat(data.length) || 2,
          offsetX: existingEl ? existingEl.offsetX : currentOffsetX,
          offsetY: existingEl ? existingEl.offsetY : 0,
          rotation: existingEl ? existingEl.rotation : 0
        };

        if (type === 'truck') {
          elData.hasLift = !!data.hasLift;
          elData.liftLength = data.hasLift ? (parseFloat(data.liftLength) || 0) : 0;
        }

        teamElements.push(elData);
        currentOffsetX += (parseFloat(data.width) || 2) + 1; // 1m odstępu domyślnie
      }
    });

    // Namioty wolnostojące (lista namiotów)
    if (tentsEnabled && tents.length > 0) {
      tents.forEach((tent, idx) => {
        let existingEl = null;
        if (editingTeam && editingTeam.elements) {
          existingEl = editingTeam.elements.find(el => el.id === tent.id);
        }

        teamElements.push({
          id: tent.id || genElementId(),
          type: 'tent',
          name: tent.name || (tents.length > 1 ? `Namiot ${idx + 1}` : 'Namiot'),
          width: parseFloat(tent.width) || 3,
          length: parseFloat(tent.length) || 3,
          offsetX: existingEl ? existingEl.offsetX : currentOffsetX,
          offsetY: existingEl ? existingEl.offsetY : 0,
          rotation: existingEl ? existingEl.rotation : 0
        });
        currentOffsetX += (parseFloat(tent.width) || 3) + 1;
      });
    }

    if (teamElements.length === 0) {
      setError('Musisz wybrać co najmniej jeden element (np. Ciężarówkę lub Namiot).');
      return;
    }

    const totalWidth = currentOffsetX > 0 ? currentOffsetX - 1 : 10;
    const maxLength = Math.max(...teamElements.map(el => {
      if (el.type === 'truck') {
        return (parseFloat(el.length) || 0) + (el.hasLift !== false ? (parseFloat(el.liftLength ?? 3.3) || 0) : 0);
      }
      return parseFloat(el.length) || 0;
    }));

    try {
      setIsSubmitting(true);
      const teamData = {
        name: name.trim(),
        color,
        width: totalWidth,
        length: maxLength,
        elements: teamElements,
        isLocked: true, // Zespoły domyślnie są zablokowane i ruszają się razem!
        updatedAt: serverTimestamp(),
      };

      if (editingTeam && editingTeam.id) {
        if (!currentUser) {
          // Edycja lokalna
          const localTeams = JSON.parse(localStorage.getItem('local_teams_templates') || '[]');
          const idx = localTeams.findIndex(t => t.id === editingTeam.id);
          if (idx !== -1) {
            localTeams[idx] = { ...localTeams[idx], ...teamData, updatedAt: Date.now() };
            localStorage.setItem('local_teams_templates', JSON.stringify(localTeams));
            window.dispatchEvent(new Event('local_teams_templates_updated'));
          }
        } else {
          updateDoc(doc(db, 'profiles', currentUser.uid, 'teams_templates', editingTeam.id), teamData).catch((err) =>
            console.error('Błąd synchronizacji updateDoc w tle:', err)
          );
        }
        
        if (onUpdateTemplate) {
          onUpdateTemplate({ id: editingTeam.id, ...teamData });
        }
      } else {
        if (!currentUser) {
          // Zapis lokalny
          const localTeams = JSON.parse(localStorage.getItem('local_teams_templates') || '[]');
          const newId = 'local-team-' + Date.now();
          localTeams.push({ id: newId, ...teamData, createdAt: Date.now(), updatedAt: Date.now() });
          localStorage.setItem('local_teams_templates', JSON.stringify(localTeams));
          window.dispatchEvent(new Event('local_teams_templates_updated'));
        } else {
          // Nowy team w chmurze
          addDoc(collection(db, 'profiles', currentUser.uid, 'teams_templates'), {
            ...teamData,
            createdAt: serverTimestamp(),
          }).catch((err) => console.error('Błąd synchronizacji addDoc w tle:', err));
        }
      }

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

          {/* Elementy Modułowe */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/70 mb-3">
              Kompozycja Zespołu (Pojazdy i Namioty)
            </label>
            <div className="space-y-3 max-h-[38vh] overflow-y-auto pr-2 custom-scrollbar">
              {VEHICLE_TYPES.map((v) => {
                // Specjalna obsługa listy namiotów wolnostojących
                if (v.type === 'tent') {
                  return (
                    <div
                      key="tents-section"
                      className={`p-3 rounded-lg border transition-all ${
                        tentsEnabled ? 'bg-indigo-900/30 border-indigo-500/50' : 'bg-black/30 border-white/5 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={tentsEnabled}
                          onChange={(e) => handleToggleTents(e.target.checked)}
                          className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 bg-white/10 border-white/20 cursor-pointer"
                        />
                        <span className="text-xl">🎪</span>
                        <div className="flex-1 flex items-center justify-between">
                          <span className={`text-sm font-semibold ${tentsEnabled ? 'text-white' : 'text-white/60'}`}>
                            {tents.length > 1 ? `Namioty wolnostojące (${tents.length})` : 'Namiot wolnostojący'}
                          </span>
                          {tentsEnabled && (
                            <button
                              type="button"
                              onClick={handleAddTent}
                              className="text-indigo-300 hover:text-white bg-indigo-500/20 hover:bg-indigo-500/30 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                            >
                              <span>+ Dodaj</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {tentsEnabled && (
                        <div className="mt-3 space-y-2.5 pl-7">
                          {tents.map((tent, tIdx) => (
                            <div key={tent.id || tIdx} className="bg-black/40 border border-white/10 rounded-lg p-2.5 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
                                  <span>🎪</span> Namiot #{tIdx + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTent(tIdx)}
                                  className="text-white/40 hover:text-red-400 p-1 rounded hover:bg-white/5 transition-colors text-xs flex items-center gap-1"
                                  title="Usuń ten namiot"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                                  </svg>
                                  <span>Usuń</span>
                                </button>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="text-[10px] text-white/50 uppercase">Szerokość (m)</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="1"
                                    value={tent.width}
                                    onChange={(e) => handleUpdateTent(tIdx, 'width', e.target.value)}
                                    className="w-full bg-black/40 border border-white/20 rounded-lg px-2 py-1 text-xs text-white focus:border-indigo-400 focus:outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-white/50 uppercase">Długość (m)</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="1"
                                    value={tent.length}
                                    onChange={(e) => handleUpdateTent(tIdx, 'length', e.target.value)}
                                    className="w-full bg-black/40 border border-white/20 rounded-lg px-2 py-1 text-xs text-white focus:border-indigo-400 focus:outline-none"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}

                          <button
                            type="button"
                            onClick={handleAddTent}
                            className="w-full py-1.5 px-3 rounded-lg border border-dashed border-indigo-400/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                            </svg>
                            <span>+ Dodaj kolejny namiot</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                const isActive = activeElements[v.type]?.enabled;
                return (
                  <div key={v.type} className={`p-3 rounded-lg border transition-all ${isActive ? 'bg-indigo-900/30 border-indigo-500/50' : 'bg-black/30 border-white/5 hover:border-white/20'}`}>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setActiveElements(prev => ({
                          ...prev,
                          [v.type]: { ...prev[v.type], enabled: e.target.checked }
                        }))}
                        className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 bg-white/10 border-white/20 cursor-pointer"
                      />
                      <span className="text-xl">{v.icon}</span>
                      <span className={`text-sm font-semibold flex-1 ${isActive ? 'text-white' : 'text-white/60'}`}>{v.label}</span>
                    </div>

                    {isActive && (
                      <div className="mt-3 grid grid-cols-2 gap-3 pl-7">
                        <div>
                          <label className="text-[10px] text-white/50 uppercase">Szerokość (m)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="1"
                            value={activeElements[v.type].width}
                            onChange={(e) => setActiveElements(prev => ({
                              ...prev,
                              [v.type]: { ...prev[v.type], width: e.target.value }
                            }))}
                            className="w-full bg-black/40 border border-white/20 rounded-lg px-2 py-1 text-xs text-white focus:border-indigo-400 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-white/50 uppercase">Długość (m)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="1"
                            value={activeElements[v.type].length}
                            onChange={(e) => setActiveElements(prev => ({
                              ...prev,
                              [v.type]: { ...prev[v.type], length: e.target.value }
                            }))}
                            className="w-full bg-black/40 border border-white/20 rounded-lg px-2 py-1 text-xs text-white focus:border-indigo-400 focus:outline-none"
                          />
                        </div>

                        {/* Winda dla Ciężarówki */}
                        {v.type === 'truck' && (
                          <div className="col-span-2 bg-indigo-950/60 p-2.5 rounded-lg border border-indigo-500/40 space-y-2 mt-1">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={activeElements.truck.hasLift}
                                onChange={(e) => setActiveElements(prev => ({
                                  ...prev,
                                  truck: { ...prev.truck, hasLift: e.target.checked }
                                }))}
                                className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 bg-white/10 border-white/20 cursor-pointer"
                              />
                              <span className="text-xs font-semibold text-white/90">Winda rozładunkowa / rampa</span>
                            </label>

                            {activeElements.truck.hasLift ? (
                              <div className="pl-6 grid grid-cols-2 gap-3 items-center">
                                <div>
                                  <label className="text-[10px] text-white/50 uppercase">Długość windy (m)</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={activeElements.truck.liftLength}
                                    onChange={(e) => setActiveElements(prev => ({
                                      ...prev,
                                      truck: { ...prev.truck, liftLength: e.target.value }
                                    }))}
                                    className="w-full bg-black/40 border border-white/20 rounded-lg px-2 py-1 text-xs text-white focus:border-indigo-400 focus:outline-none"
                                    placeholder="np. 3.3"
                                  />
                                </div>
                                <div className="text-right">
                                  <div className="text-[10px] text-white/50 uppercase">Całkowita dł.</div>
                                  <div className="text-xs font-bold text-indigo-300">
                                    {(
                                      (parseFloat(activeElements.truck.length) || 0) +
                                      (parseFloat(activeElements.truck.liftLength) || 0)
                                    ).toFixed(1)}m
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="pl-6 text-[11px] text-white/60 flex items-center justify-between">
                                <span>Brak windy (sama naczepa):</span>
                                <span className="text-xs font-bold text-white/90">{(parseFloat(activeElements.truck.length) || 0).toFixed(1)}m</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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
