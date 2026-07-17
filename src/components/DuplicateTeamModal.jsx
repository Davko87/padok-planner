import React from 'react';

function DuplicateTeamModal({ isOpen, onClose, onConfirm, teamName }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in select-none">
      <div className="glass-panel-strong w-full max-w-md p-6 md:p-8 relative animate-slide-up shadow-2xl border-white/30 text-center space-y-6">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-white/50 hover:text-white transition-colors duration-200 p-1 rounded-lg hover:bg-white/10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Warning Icon */}
        <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center mx-auto shadow-glass">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-bold text-white tracking-wide">
            Team już obecny na torze!
          </h3>
          <p className="text-white/70 text-sm leading-relaxed">
            Namiot zespołu <span className="font-semibold text-amber-300">"{teamName || 'Zespól Wyścigowy'}"</span> znajduje się już w Twoim układzie padoku.
          </p>
          <p className="text-white/50 text-xs">
            Czy na pewno chcesz umieścić kolejny namiot tego samego zespołu?
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="glass-button flex-1 py-2.5 text-xs font-semibold text-white/80 hover:text-white transition-all"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="glass-button-primary flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
          >
            <span>Dodaj kolejny</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default DuplicateTeamModal;
