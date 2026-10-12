import { useApp, type ModuleKind } from '../state/store';
import { MODULE_LABEL } from '../scene/ModuleContent';
import { SCENE_PRESETS } from '../state/scenePresets';

const PALETTE: { kind: ModuleKind; description: string }[] = [
  { kind: 'notation', description: 'Grand staff, real-time' },
  { kind: 'harmonic', description: 'Chord + interval analysis' },
  { kind: 'keyboard', description: '88-key visualizer' },
  { kind: 'camera', description: 'System video capture device' },
  { kind: 'overhead', description: 'Companion phone camera' },
];

export function LeftPanel() {
  const {
    modules,
    selectedId,
    select,
    addModule,
    toggleVisible,
    removeModule,
    applyPreset,
    canvasWidth,
    canvasHeight,
  } = useApp();

  const sorted = [...modules].sort((a, b) => b.z - a.z);

  return (
    <aside className="w-64 border-r border-white/5 bg-ink-900 flex flex-col">
      <Section title="Scene">
        <ul className="space-y-px">
          {sorted.map((m) => {
            const active = m.id === selectedId;
            return (
              <li key={m.id}>
                <button
                  onClick={() => select(m.id)}
                  className={`group w-full flex items-center px-3 py-2 text-left text-xs transition-colors ${
                    active
                      ? 'bg-accent/15 text-ink-50'
                      : 'text-ink-200 hover:bg-white/4'
                  }`}
                >
                  <span className="flex-1">{MODULE_LABEL[m.kind]}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVisible(m.id);
                    }}
                    className={`mr-2 w-3.5 h-3.5 rounded-sm border ${
                      m.visible
                        ? 'bg-accent border-accent'
                        : 'border-ink-400'
                    }`}
                    title={m.visible ? 'Hide' : 'Show'}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeModule(m.id);
                    }}
                    className="text-ink-500 hover:text-ink-100 opacity-0 group-hover:opacity-100 transition-opacity text-base leading-none"
                    title="Remove"
                  >
                    ×
                  </button>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Presets">
        <ul className="space-y-1">
          {SCENE_PRESETS.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  // Preset application replaces every module currently on
                  // the canvas; the confirm gives the user one chance to
                  // cancel without losing a hand-tuned layout.
                  if (
                    modules.length === 0 ||
                    window.confirm(`Apply the "${p.label}" preset? This replaces every module on the canvas.`)
                  ) {
                    applyPreset(p.build(canvasWidth, canvasHeight));
                  }
                }}
                className="w-full text-left px-3 py-2 rounded hover:bg-white/4 transition-colors"
              >
                <div className="text-sm text-ink-100">{p.label} preset</div>
                <div className="text-[11px] text-ink-400 mt-0.5 leading-snug">
                  {p.description}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Add Module">
        <ul className="space-y-1">
          {PALETTE.map((p) => (
            <li key={p.kind}>
              <button
                onClick={() => addModule(p.kind)}
                className="w-full text-left px-3 py-2 rounded hover:bg-white/4 transition-colors"
              >
                <div className="text-sm text-ink-100">{MODULE_LABEL[p.kind]}</div>
                <div className="text-[11px] text-ink-400 mt-0.5">{p.description}</div>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <div className="flex-1" />
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-2 pt-4 pb-2">
      <div className="px-3 mb-2 text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {title}
      </div>
      {children}
    </div>
  );
}
