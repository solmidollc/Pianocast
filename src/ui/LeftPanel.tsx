import { useState } from 'react';
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
    reorderLayers,
    canvasWidth,
    canvasHeight,
  } = useApp();

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const sorted = [...modules].sort((a, b) => b.z - a.z);

  return (
    <aside className="w-64 border-r border-white/5 bg-ink-900 flex flex-col">
      <Section title="Layers">
        <div className="px-3 mb-2 text-[10px] text-ink-500">Top = front · Drag to reorder</div>
        <ul className="space-y-px" aria-label="Scene layers, front to back">
          {sorted.map((m, index) => {
            const active = m.id === selectedId;
            const moveTo = (targetIndex: number) => {
              const ids = sorted.map((layer) => layer.id);
              ids.splice(index, 1);
              ids.splice(targetIndex, 0, m.id);
              reorderLayers(ids);
            };
            return (
              <li key={m.id}
                draggable
                data-layer-id={m.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', m.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggedId(m.id);
                }}
                onDragOver={(e) => {
                  if (!draggedId || draggedId === m.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDropTarget({ id: m.id, after: e.clientY > rect.top + rect.height / 2 });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const source = draggedId;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > rect.top + rect.height / 2;
                  if (source && source !== m.id) {
                    const ids = sorted.map((layer) => layer.id).filter((id) => id !== source);
                    ids.splice(ids.indexOf(m.id) + (after ? 1 : 0), 0, source);
                    reorderLayers(ids);
                  }
                  setDraggedId(null);
                  setDropTarget(null);
                }}
                onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}
                className={`relative flex items-center px-2 py-2 text-xs rounded transition-colors ${active ? 'bg-accent/15 text-ink-50' : 'text-ink-200 hover:bg-white/4'} ${draggedId === m.id ? 'opacity-40' : ''}`}
              >
                {dropTarget?.id === m.id && (
                  <div className={`pointer-events-none absolute inset-x-0 h-0.5 bg-accent ${dropTarget.after ? 'bottom-0' : 'top-0'}`} />
                )}
                <span aria-hidden className="mr-2 text-ink-500 cursor-grab touch-none select-none"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDraggedId(m.id);
                  }}
                  onPointerMove={(e) => {
                    if (draggedId !== m.id) return;
                    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-layer-id]');
                    const id = target?.dataset.layerId;
                    if (!target || !id || id === m.id) { setDropTarget(null); return; }
                    const rect = target.getBoundingClientRect();
                    setDropTarget({ id, after: e.clientY > rect.top + rect.height / 2 });
                  }}
                  onPointerUp={(e) => {
                    if (draggedId === m.id) {
                      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-layer-id]');
                      const id = target?.dataset.layerId;
                      if (target && id && id !== m.id) {
                        const rect = target.getBoundingClientRect();
                        const ids = sorted.map((layer) => layer.id).filter((id) => id !== m.id);
                        ids.splice(ids.indexOf(id) + (e.clientY > rect.top + rect.height / 2 ? 1 : 0), 0, m.id);
                        reorderLayers(ids);
                      }
                    }
                    setDraggedId(null);
                    setDropTarget(null);
                  }}
                  onPointerCancel={() => { setDraggedId(null); setDropTarget(null); }}
                >⠿</span>
                <button type="button" onClick={() => select(m.id)}
                  className="flex-1 text-left min-w-0 truncate"
                  title="Select layer. Alt+Up/Down to reorder; Alt+Home/End for front/back."
                  onKeyDown={(e) => {
                    if (!e.altKey) return;
                    const target = e.key === 'ArrowUp' ? Math.max(0, index - 1)
                      : e.key === 'ArrowDown' ? Math.min(sorted.length - 1, index + 1)
                      : e.key === 'Home' ? 0 : e.key === 'End' ? sorted.length - 1 : null;
                    if (target !== null) { e.preventDefault(); moveTo(target); }
                  }}>
                  {MODULE_LABEL[m.kind]}
                </button>
                {active && (
                  <>
                    <button type="button" aria-label="Bring layer to front" title="Bring to front"
                      disabled={index === 0} onClick={() => moveTo(0)}
                      className="px-1 text-ink-400 hover:text-ink-100 disabled:opacity-30">↑</button>
                    <button type="button" aria-label="Send layer to back" title="Send to back"
                      disabled={index === sorted.length - 1} onClick={() => moveTo(sorted.length - 1)}
                      className="px-1 text-ink-400 hover:text-ink-100 disabled:opacity-30">↓</button>
                  </>
                )}
                <button type="button" onClick={() => toggleVisible(m.id)}
                  aria-label={`${m.visible ? 'Hide' : 'Show'} ${MODULE_LABEL[m.kind]}`}
                  className={`mx-2 w-3.5 h-3.5 shrink-0 rounded-sm border ${m.visible ? 'bg-accent border-accent' : 'border-ink-400'}`}
                  title={m.visible ? 'Hide' : 'Show'} />
                <button type="button" onClick={() => removeModule(m.id)}
                  aria-label={`Remove ${MODULE_LABEL[m.kind]}`}
                  className="text-ink-500 hover:text-ink-100 text-base leading-none"
                  title="Remove">×</button>
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
