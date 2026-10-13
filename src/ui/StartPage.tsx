export type SessionMode = 'tutorial' | 'performance' | 'live' | 'presentation';
export const MODE_LABELS: Record<SessionMode, string> = {
  presentation: 'Presentation', tutorial: 'Tutorial', performance: 'Performance', live: 'Live Broadcast',
};

export function StartPage({ onSelect }: { onSelect: (mode: SessionMode) => void }) {
  const modes: SessionMode[] = ['tutorial', 'performance', 'live'];
  return (
    <main className="h-full w-full overflow-y-auto bg-ink-950 text-ink-100 font-sans flex items-center justify-center p-6">
      <div className="w-full max-w-4xl py-12">
        <p className="text-accent-soft text-sm font-semibold tracking-wide mb-8">PianoCanva</p>
        <h1 className="text-4xl font-semibold tracking-tight mb-10">Choose your mode</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modes.map((id) => (
            <button key={id} type="button" disabled={id === 'live'} onClick={() => onSelect(id)}
              className="text-left rounded-xl border border-white/10 bg-ink-900 p-6 hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent transition-colors disabled:opacity-50 disabled:hover:border-white/10">
              <span className="block text-xl font-semibold mb-3">{MODE_LABELS[id]}</span>
              {id === 'live' && <span className="text-xs text-ink-300">Coming soon</span>}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}


