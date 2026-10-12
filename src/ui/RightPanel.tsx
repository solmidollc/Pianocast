import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { MODULE_LABEL } from '../scene/ModuleContent';
import { VirtualCameraPanel } from './VirtualCameraPanel';
import { CompanionPanel } from './CompanionPanel';
import { CameraProperties } from './CameraProperties';
import { OverheadProperties } from './OverheadProperties';
import { AudioPanel } from './AudioPanel';
import { AudioInputPanel } from './AudioInputPanel';

/**
 * Right rail.
 *
 * Three accordion-style docks — Audio, Video, Tools — each collapsible and
 * collapsed by default so the rail breathes. Opening one closes the others,
 * which keeps the column short and the focus tight. The contents of each
 * dock are NOT changed; this is purely a structural reorganisation of the
 * controls that already exist elsewhere in the app:
 *
 *   Audio    Instrument + master output  (AudioPanel)
 *            Microphone + monitor/output (AudioInputPanel)
 *
 *   Video    Source-specific controls for the currently selected camera
 *            or overhead module (CameraProperties / OverheadProperties),
 *            plus the Companion-phone pairing flow.
 *
 *   Tools    Contextual Properties for the selected module
 *            (Transform + module-specific controls — Range / Ottava /
 *            Display / Lock group).
 *            Scene controls (resolution display + background).
 *            Virtual Camera output.
 *
 * Auto-open behaviour: when the user selects a module, the relevant dock
 * pops open (Video for camera / overhead, Tools for everything else) so
 * the controls are one click closer. The user can still collapse it.
 */

type DockId = 'audio' | 'video' | 'tools';

export function RightPanel() {
  const {
    modules,
    selectedId,
    updateModule,
    background,
    setBackground,
    canvasWidth,
    canvasHeight,
    unlockGroup,
  } = useApp();
  const m = modules.find((x) => x.id === selectedId) ?? null;

  const [openDock, setOpenDock] = useState<DockId | null>(null);
  const toggleDock = (id: DockId) =>
    setOpenDock((cur) => (cur === id ? null : id));

  // Selection-driven auto-open. Picking a camera / overhead opens Video;
  // any other module opens Tools. Deselect leaves the panel alone.
  const selKind = m?.kind ?? null;
  useEffect(() => {
    if (selKind === 'camera' || selKind === 'overhead' || selKind === 'overheadVisualizer') {
      setOpenDock('video');
    } else if (selKind) {
      setOpenDock('tools');
    }
  }, [selKind, selectedId]);

  return (
    <aside className="w-72 border-l border-white/5 bg-ink-900 flex flex-col overflow-y-auto">
      <Dock
        id="audio"
        title="Audio"
        subtitle="Instrument · Mic · Output"
        open={openDock === 'audio'}
        onToggle={toggleDock}
      >
        <Subsection label="Instrument & Output">
          <AudioPanel />
        </Subsection>
        <Subsection label="Microphone">
          <AudioInputPanel />
        </Subsection>
      </Dock>

      <Dock
        id="video"
        title="Video"
        subtitle="Sources · Adjustments · Crop"
        open={openDock === 'video'}
        onToggle={toggleDock}
      >
        {m?.kind === 'camera' && (
          <Subsection label={`Camera — ${MODULE_LABEL[m.kind]}`}>
            <CameraProperties module={m} />
          </Subsection>
        )}
        {(m?.kind === 'overhead' || m?.kind === 'overheadVisualizer') && (
          <Subsection label={MODULE_LABEL[m.kind]}>
            <OverheadProperties module={m} />
          </Subsection>
        )}
        {m?.kind !== 'camera' && m?.kind !== 'overhead' && m?.kind !== 'overheadVisualizer' && (
          <EmptyHint>
            Select a Camera or Overhead module on the canvas to adjust its
            settings here.
          </EmptyHint>
        )}
        <Subsection label="Companion phone">
          <CompanionPanel />
        </Subsection>
      </Dock>

      <Dock
        id="tools"
        title="Tools"
        subtitle="Properties · Scene · Output"
        open={openDock === 'tools'}
        onToggle={toggleDock}
      >
        <Subsection label="Properties">
          {m ? (
            <ModuleProperties
              module={m}
              onUpdate={(patch) => updateModule(m.id, patch)}
              onUnlockGroup={() => unlockGroup(m.id)}
            />
          ) : (
            <EmptyHint>
              Select a module on the canvas to edit its position, size, and
              module-specific options.
            </EmptyHint>
          )}
        </Subsection>
        <Subsection label="Scene">
          <SceneControls
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            background={background}
            setBackground={setBackground}
          />
        </Subsection>
        <Subsection label="Virtual Camera">
          <VirtualCameraPanel />
        </Subsection>
      </Dock>

      {/* Bottom spacer keeps the docks from stretching when all collapsed. */}
      <div className="flex-1" />
    </aside>
  );
}

// ===========================================================================
// Dock — top-level collapsible section
// ===========================================================================

function Dock({
  id,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  id: DockId;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: (id: DockId) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-white/5">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className={
          'w-full flex items-center justify-between px-4 py-3 transition-colors ' +
          (open ? 'bg-white/3' : 'hover:bg-white/2')
        }
      >
        <div className="flex flex-col items-start min-w-0">
          <span className="text-[11px] uppercase tracking-[0.18em] text-ink-100 font-medium">
            {title}
          </span>
          {subtitle && (
            <span className="text-[10px] text-ink-500 mt-0.5 truncate">
              {subtitle}
            </span>
          )}
        </div>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="pb-2">
          {children}
        </div>
      )}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{
        transform: `rotate(${open ? 90 : 0}deg)`,
        transition: 'transform 120ms ease',
        flexShrink: 0,
      }}
      aria-hidden
    >
      <path
        d="M3 2 L7 5 L3 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-ink-400"
      />
    </svg>
  );
}

// ===========================================================================
// Subsection — labelled group inside a dock
// ===========================================================================

function Subsection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-3 pb-1 border-t border-white/4 first:border-t-0">
      <div className="px-4 mb-1 text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-2 text-[11px] text-ink-500 leading-relaxed">
      {children}
    </div>
  );
}

// ===========================================================================
// ModuleProperties — contextual selected-module controls
// ===========================================================================
//
// Pulled out of the inline tree so the Tools dock stays readable. Same
// behaviour as before: Transform always, plus whatever the module kind
// adds (Range / Ottava / Display).

function ModuleProperties({
  module: m,
  onUpdate,
  onUnlockGroup,
}: {
  module: NonNullable<ReturnType<typeof useApp.getState>['modules'][number]>;
  onUpdate: (patch: Partial<typeof m>) => void;
  onUnlockGroup: () => void;
}) {
  return (
    <>
      <Row label="Type">
        <span className="text-ink-100">{MODULE_LABEL[m.kind]}</span>
      </Row>
      {m.lockGroup && (
        <Row label="Locked group">
          <button
            onClick={onUnlockGroup}
            className="text-[11px] text-accent-soft hover:text-ink-50"
            title="Break the keyboard ↔ overhead alignment so you can position them independently."
          >
            Unlock
          </button>
        </Row>
      )}

      <SubsectionDivider label="Transform" />
      <NumberRow label="X" value={m.x} onChange={(v) => onUpdate({ x: v })} />
      <NumberRow label="Y" value={m.y} onChange={(v) => onUpdate({ y: v })} />
      <NumberRow
        label="Width"
        value={m.width}
        onChange={(v) => onUpdate({ width: Math.max(80, v) })}
      />
      <NumberRow
        label="Height"
        value={m.height}
        onChange={(v) => onUpdate({ height: Math.max(80, v) })}
      />

      {(m.kind === 'keyboard' || m.kind === 'overheadVisualizer') && (
        <>
          <SubsectionDivider label="Range" />
          <NumberRow
            label="Low MIDI"
            value={(m.options as any).range?.[0] ?? 21}
            onChange={(v) =>
              onUpdate({
                options: { ...m.options, range: [v, (m.options as any).range?.[1] ?? 108] },
              })
            }
          />
          <NumberRow
            label="High MIDI"
            value={(m.options as any).range?.[1] ?? 108}
            onChange={(v) =>
              onUpdate({
                options: { ...m.options, range: [(m.options as any).range?.[0] ?? 21, v] },
              })
            }
          />
        </>
      )}

      {m.kind === 'overheadVisualizer' && (
        <NumberRow label="Visualizer height" value={Number(m.options.keyboardHeight ?? 220)}
          onChange={(value) => onUpdate({ options: { ...m.options, keyboardHeight: Math.max(40, Math.min(m.height - 40, value)) } })} />
      )}

      {m.kind === 'notation' && (
        <>
          <div className="px-4 py-1.5 flex justify-between items-center text-xs">
            <label htmlFor="notation-notehead" className="text-ink-400">Notehead</label>
            <select id="notation-notehead" value={String(m.options.notehead ?? 'whole')}
              onChange={(e) => onUpdate({ options: { ...m.options, notehead: e.target.value } })}
              className="bg-ink-800 text-ink-100 px-2 py-1 rounded">
              <option value="whole">Whole note</option>
              <option value="quarter">Quarter note (no stem)</option>
            </select>
          </div>
          <SubsectionDivider label="Notation mode" />
          <div className="px-4 py-1.5 flex justify-between items-center text-xs">
            <label htmlFor="notation-mode" className="text-ink-400">Mode</label>
            <select id="notation-mode" value={String(m.options.notationMode ?? 'chord')}
              onChange={(e) => onUpdate({ options: { ...m.options, notationMode: e.target.value } })}
              className="bg-ink-800 text-ink-100 px-2 py-1 rounded">
              <option value="chord">Live chord</option>
              <option value="melodic">Melodic</option>
            </select>
          </div>
          {m.options.notationMode === 'melodic' && (
            <div>
              <NumberRow label="Clear after (seconds)" value={Number(m.options.melodyIdleSeconds ?? 3)}
                onChange={(value) => onUpdate({ options: { ...m.options, melodyIdleSeconds: Math.max(0.5, Math.min(300, value)) } })} />
            <div className="px-4 py-2 text-[11px] text-ink-400">
              <p>Notes fill left to right. A full line starts fresh. Widen the staff for more notes.</p>
              <button type="button" className="mt-2 mr-4 text-accent-soft"
                onClick={() => onUpdate({ options: { ...m.options, melodyDemoToken: Number(m.options.melodyDemoToken ?? 0) + 1 } })}>Try example</button>
              <button type="button" className="mt-2 text-accent-soft"
                onClick={() => onUpdate({ options: { ...m.options, melodyResetToken: Number(m.options.melodyResetToken ?? 0) + 1 } })}>Clear melody</button>
            </div>
            </div>
          )}
          <SubsectionDivider label="Style" />
          <div className="px-4 py-1.5 flex items-center justify-between text-xs">
            <span className="text-ink-400">Layout</span>
            <select
              value={(m.options as any).style ?? 'standard'}
              onChange={(e) =>
                onUpdate({
                  options: {
                    ...m.options,
                    style: e.target.value as 'standard' | 'centered',
                  },
                })
              }
              className="bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 hover:border-white/20 focus:border-accent focus:outline-none transition-colors"
            >
              <option value="standard">Standard</option>
              <option value="centered">Centered Middle C</option>
            </select>
          </div>
          <div className="px-4 pb-1 text-[10px] text-ink-500 leading-relaxed">
            Standard uses the traditional engraver's gap between the staves.
            Centered Middle C tightens the gap so middle C lands at the same
            y from both clefs.
          </div>

          <SubsectionDivider label="Range" />
          <NumberRow
            label="Low MIDI"
            value={(m.options as any).range?.[0] ?? 21}
            onChange={(v) =>
              onUpdate({
                options: {
                  ...m.options,
                  range: [
                    Math.max(0, Math.min(127, v)),
                    (m.options as any).range?.[1] ?? 108,
                  ] as [number, number],
                },
              })
            }
          />
          <NumberRow
            label="High MIDI"
            value={(m.options as any).range?.[1] ?? 108}
            onChange={(v) =>
              onUpdate({
                options: {
                  ...m.options,
                  range: [
                    (m.options as any).range?.[0] ?? 21,
                    Math.max(0, Math.min(127, v)),
                  ] as [number, number],
                },
              })
            }
          />
          <div className="px-4 pb-1 text-[10px] text-ink-500 leading-relaxed">
            The staff reserves vertical space for the chosen range. Smaller
            range = smaller module height.
          </div>

          <SubsectionDivider label="Ottava" />
          <Row label="8va (treble)">
            <input
              type="checkbox"
              checked={((m.options as any).trebleOttava ?? 'none') === '8va'}
              onChange={(e) =>
                onUpdate({
                  options: {
                    ...m.options,
                    trebleOttava: e.target.checked ? '8va' : 'none',
                  },
                })
              }
            />
          </Row>
          <Row label="8vb (bass)">
            <input
              type="checkbox"
              checked={((m.options as any).bassOttava ?? 'none') === '8vb'}
              onChange={(e) =>
                onUpdate({
                  options: {
                    ...m.options,
                    bassOttava: e.target.checked ? '8vb' : 'none',
                  },
                })
              }
            />
          </Row>
          <div className="px-4 pb-1 text-[10px] text-ink-500 leading-relaxed">
            Display extreme notes near the staff. 8va shows treble notes one
            octave lower (read up); 8vb shows bass notes one octave higher
            (read down).
          </div>
        </>
      )}

      {m.kind === 'harmonic' && (
        <>
          <SubsectionDivider label="Display" />
          <div className="px-4 py-1.5 flex items-center justify-between text-xs">
            <span className="text-ink-400">Mode</span>
            <select
              value={(m.options as any).mode ?? 'chord'}
              onChange={(e) =>
                onUpdate({
                  options: { ...m.options, mode: e.target.value },
                })
              }
              className="bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 hover:border-white/20 focus:border-accent focus:outline-none transition-colors"
            >
              <option value="chord">Chord symbol</option>
              <option value="roman">Roman numerals</option>
              <option value="nashville">Nashville</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
          {((m.options as any).mode ?? 'chord') === 'advanced' && (
            <Row label="Intervals">
              <input
                type="checkbox"
                checked={(m.options as any).showIntervals ?? true}
                onChange={(e) =>
                  onUpdate({
                    options: { ...m.options, showIntervals: e.target.checked },
                  })
                }
              />
            </Row>
          )}
        </>
      )}
    </>
  );
}

// ===========================================================================
// SceneControls — global scene + background
// ===========================================================================

function SceneControls({
  canvasWidth,
  canvasHeight,
  background,
  setBackground,
}: {
  canvasWidth: number;
  canvasHeight: number;
  background: ReturnType<typeof useApp.getState>['background'];
  setBackground: ReturnType<typeof useApp.getState>['setBackground'];
}) {
  return (
    <>
      <Row label="Resolution">
        <span className="text-ink-200 tabular-nums">{canvasWidth} × {canvasHeight}</span>
      </Row>
      <div className="px-4 mt-3 text-[10px] uppercase tracking-[0.18em] text-ink-500 mb-2">
        Background
      </div>
      <div className="flex items-center gap-2 px-4">
        <button
          onClick={() => setBackground({ ...background, type: 'solid' })}
          className={`flex-1 text-xs py-1 rounded border ${
            background.type === 'solid'
              ? 'border-accent text-ink-50'
              : 'border-white/10 text-ink-300 hover:border-white/20'
          }`}
        >
          Solid
        </button>
        <button
          onClick={() => setBackground({ ...background, type: 'transparent' })}
          className={`flex-1 text-xs py-1 rounded border ${
            background.type === 'transparent'
              ? 'border-accent text-ink-50'
              : 'border-white/10 text-ink-300 hover:border-white/20'
          }`}
        >
          Transparent
        </button>
      </div>
      {background.type === 'solid' && (
        <div className="px-4 mt-2 flex items-center gap-2">
          <input
            type="color"
            value={background.color}
            onChange={(e) => setBackground({ ...background, color: e.target.value })}
            className="w-7 h-7 rounded bg-transparent border border-white/10"
          />
          <input
            type="text"
            value={background.color}
            onChange={(e) => setBackground({ ...background, color: e.target.value })}
            className="flex-1 bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8"
          />
        </div>
      )}
    </>
  );
}

// ===========================================================================
// Layout primitives
// ===========================================================================

function SubsectionDivider({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-ink-500">
      {label}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-1.5 flex items-center justify-between text-xs">
      <span className="text-ink-400">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="px-4 py-1.5 flex items-center justify-between text-xs">
      <span className="text-ink-400">{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
        className="w-20 bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 text-right tabular-nums"
      />
    </div>
  );
}
