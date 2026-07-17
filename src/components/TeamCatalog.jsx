import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import NewTeamModal from './NewTeamModal.jsx';

function TeamCatalog({ onSelectTeam, onUpdateTemplate }) {
  const [teams, setTeams] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    // Real-time listener for teams_templates
    const q = query(collection(db, 'teams_templates'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetchedTeams = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setTeams(fetchedTeams);
        setIsLoading(false);
      },
      (error) => {
        console.error('Błąd pobierania szablonów teamów:', error);
        // Fallback without ordering if index is missing locally or offline query requires different sorting
        const unsubscribeFallback = onSnapshot(
          collection(db, 'teams_templates'),
          (fallbackSnapshot) => {
            const fallbackTeams = fallbackSnapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
            }));
            setTeams(fallbackTeams);
            setIsLoading(false);
          }
        );
        return () => unsubscribeFallback();
      }
    );

    return () => unsubscribe();
  }, []);

  return (
    <>
      {/* Floating Glass Panel on the right side (responsive / collapsible) */}
      <div
        className={`absolute top-20 right-4 bottom-24 z-40 flex flex-col transition-all duration-500 ease-out ${
          isCollapsed ? 'w-16' : 'w-80 max-w-[calc(100vw-2rem)]'
        }`}
      >
        <div className="glass-panel flex flex-col h-full overflow-hidden shadow-glass-lg border-white/25">
          {/* Header */}
          <div className="p-4 border-b border-white/15 flex items-center justify-between bg-[#0a0f1d]/40">
            {!isCollapsed && (
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-indigo-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M1 4.75C1 3.784 1.784 3 2.75 3h14.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 17.25 17H2.75A1.75 1.75 0 0 1 1 15.25V4.75Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h14.5a.25.25 0 0 0 .25-.25V4.75a.25.25 0 0 0-.25-.25H2.75Z" clipRule="evenodd" />
                </svg>
                <h3 className="font-semibold text-white tracking-wide text-sm">
                  Katalog Teamów
                </h3>
              </div>
            )}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors mx-auto"
              title={isCollapsed ? 'Rozwiń katalog' : 'Zwiń katalog'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-5 h-5 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>

          {/* Collapsed view: Mini-Dock z kolorami teamów i ich skrótami (zamiast nieczytelnego pionowego napisu) */}
          {isCollapsed ? (
            <div className="flex-1 flex flex-col items-center justify-between py-4 overflow-y-auto w-full">
              {/* Lista kolorów teamów (można w nie kliknąć lub przeciągnąć na tor!) */}
              <div className="flex flex-col gap-2.5 items-center w-full px-2 my-2">
                {teams.map((team) => {
                  const abbr = (team.name || 'TM').slice(0, 2).toUpperCase();
                  return (
                    <div
                      key={team.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('team', JSON.stringify(team));
                      }}
                      onClick={() => onSelectTeam && onSelectTeam(team)}
                      style={{ backgroundColor: team.color || '#3b82f6' }}
                      className="group relative w-10 h-10 rounded-xl border border-white/30 flex items-center justify-center text-white font-black text-xs cursor-grab active:cursor-grabbing hover:scale-110 hover:shadow-lg transition-all shrink-0 select-none"
                    >
                      <span className="drop-shadow-md">{abbr}</span>

                      {/* Tooltip ze szczegółami po najechaniu myszką */}
                      <div className="absolute right-full mr-3 px-2.5 py-1.5 rounded-lg bg-[#060a13] border border-white/20 text-white text-xs font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-xl z-50 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color || '#3b82f6' }} />
                        <span>{team.name}</span>
                        <span className="font-mono text-[10px] text-emerald-300">({team.widthMeters}×{team.heightMeters}m)</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Przycisk dodawania nowego teamu na dole zminimalizowanego panelu */}
              <button
                onClick={() => {
                  setEditingTeam(null);
                  setIsModalOpen(true);
                }}
                className="w-10 h-10 rounded-xl bg-indigo-600/80 border border-indigo-400/40 flex items-center justify-center text-white hover:bg-indigo-600 hover:scale-110 transition-all shadow-glass shrink-0 mt-auto"
                title="Dodaj nowy szablon zespołu"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
              </button>
            </div>
          ) : (
            /* Expanded view */
            <>
              {/* Teams List (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-3 text-white/40">
                    <div className="w-6 h-6 border-2 border-indigo-400/40 border-t-indigo-400 rounded-full animate-spin" />
                    <span className="text-xs">Ładowanie szablonów...</span>
                  </div>
                ) : teams.length === 0 ? (
                  <div className="text-center py-12 px-4 rounded-xl border border-dashed border-white/15 bg-[#0a0f1d]/80">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white/20 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                    </svg>
                    <p className="text-sm font-medium text-white/80 mb-1">Brak teamów</p>
                    <p className="text-xs text-white/50">Dodaj pierwszy szablon zespołu poniżej.</p>
                  </div>
                ) : (
                  teams.map((team) => (
                    <div
                      key={team.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('team', JSON.stringify(team));
                      }}
                      onClick={() => onSelectTeam && onSelectTeam(team)}
                      style={{
                        '--team-color': team.color || '#3b82f6',
                      }}
                      className="group relative p-4 rounded-xl bg-[#0e1628]/50 border border-white/20 hover:border-white/35 cursor-grab active:cursor-grabbing transition-all duration-300 transform hover:-translate-y-1 hover:rotate-[0.5deg] hover:shadow-[0_12px_24px_-4px_var(--team-color)] flex items-center justify-between overflow-hidden"
                    >
                      {/* Color glow accent bar on the left */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-1.5 transition-all duration-300 group-hover:w-2"
                        style={{ backgroundColor: team.color || '#3b82f6' }}
                      />

                      <div className="pl-2 flex flex-col gap-1 overflow-hidden">
                        <span className="font-semibold text-white truncate text-sm group-hover:text-indigo-200 transition-colors">
                          {team.name}
                        </span>
                        <div className="flex items-center gap-2 text-xs text-white/60 font-mono">
                          <span className="bg-[#060b17] px-2 py-0.5 rounded-md border border-white/10">
                            {team.width} × {team.length} m
                          </span>
                          <span className="text-[10px] text-white/40 opacity-0 group-hover:opacity-100 transition-opacity">
                            (przeciągnij)
                          </span>
                        </div>
                      </div>

                      {/* Color indicator badge & buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div
                          className="w-5 h-5 rounded-lg border border-white/30 shadow-sm"
                          style={{ backgroundColor: team.color || '#3b82f6' }}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTeam(team);
                            setIsModalOpen(true);
                          }}
                          className="p-1.5 rounded-md bg-white/10 text-white/70 hover:text-white hover:bg-white/20 transition-all text-xs flex items-center justify-center"
                          title="Edytuj metraż / kolor teamu"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTeam && onSelectTeam(team);
                          }}
                          className="p-1.5 px-2 rounded-md bg-indigo-600/80 text-white font-bold hover:bg-indigo-600 transition-all text-xs flex items-center justify-center shadow"
                          title="Umieść na torze"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Bottom bar with button */}
              <div className="p-4 border-t border-white/15 bg-[#060b17]/95">
                <button
                  onClick={() => {
                    setEditingTeam(null);
                    setIsModalOpen(true);
                  }}
                  className="glass-button-primary w-full py-3 text-sm font-semibold flex items-center justify-center gap-2 shadow-glass group"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-4 h-4 transition-transform duration-300 group-hover:rotate-90"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                  <span>Nowy Team</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal dialog */}
      <NewTeamModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingTeam(null);
        }}
        editingTeam={editingTeam}
        onUpdateTemplate={onUpdateTemplate}
      />
    </>
  );
}

export default TeamCatalog;
