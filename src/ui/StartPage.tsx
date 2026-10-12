export type SessionMode = 'tutorial' | 'performance' | 'live';
export const MODE_LABELS: Record<SessionMode, string> = {
  tutorial: 'Tutorial', performance: 'Performance', live: 'Live Broadcast',
};

export function StartPage({ onSelect }: { onSelect: (mode: SessionMode) => void }) {
  const modes: { id: SessionMode; description: string; tool: string }[] = [
    { id: 'tutorial', description: 'Teach a lesson and capture every detail.', tool: 'Recording first' },
    { id: 'performance', description: 'Capture your playing with a clear, focused setup.', tool: 'Recording first' },
    { id: 'live', description: 'Prepare your scene for a live audience.', tool: 'Broadcast first' },
  ];
  return (
    <main className="h-full w-full overflow-y-auto bg-ink-950 text-ink-100 font-sans flex items-center justify-center p-6">
      <div className="w-full max-w-4xl py-12">
        <p className="text-accent-soft text-sm font-semibold tracking-wide mb-8">Pianocast</p>
        <h1 className="text-4xl font-semibold tracking-tight mb-4">What would you like to create?</h1>
        <p className="text-ink-400 mb-10">Choose a mode to bring the tools you need to the top.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modes.map(({ id, description, tool }) => (
            <button key={id} type="button" onClick={() => onSelect(id)}
              className="text-left rounded-xl border border-white/10 bg-ink-900 p-6 hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent transition-colors">
              <span className="block text-xl font-semibold mb-3">{MODE_LABELS[id]}</span>
              <span className="block text-sm text-ink-400 leading-relaxed mb-8">{description}</span>
              <span className="block text-xs text-accent-soft">{tool} <span aria-hidden="true">→</span></span>
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-500 mt-6">You can change modes from the editor.</p>
      </div>
    </main>
  );
}
