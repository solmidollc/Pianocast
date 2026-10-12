import { useEffect, useState, useSyncExternalStore } from 'react';
import { midiEngine } from '../midi/engine';
import { useApp } from '../state/store';
import type { KeyName, KeyMode } from '../theory/types';
import type { MidiDeviceInfo } from '../midi/types';
import { recorder } from '../recording/recorder';

import { MODE_LABELS, type SessionMode } from './StartPage';

const KEYS: KeyName[] = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#',
  'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
];
const MODES: KeyMode[] = ['major', 'minor'];

export function TopBar({ mode, onChangeMode }: { mode: SessionMode; onChangeMode: () => void }) {
  const recording = useSyncExternalStore(
    (cb) => recorder.subscribe(cb),
    () => recorder.getSnapshot(),
    () => recorder.getSnapshot(),
  );
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [inputId, setInputId] = useState<string | null>(null);
  const { key, setKey } = useApp();

  useEffect(() => {
    let mounted = true;
    midiEngine.init().then((d) => {
      if (!mounted) return;
      setDevices(d);
      setInputId(midiEngine.getInputId());
    });
    const sub = midiEngine.subscribe(() => {
      setDevices(midiEngine.listDevices());
      setInputId(midiEngine.getInputId());
    });
    return () => {
      mounted = false;
      sub();
    };
  }, []);

  return (
    <div
      className="title-drag flex items-center h-12 px-4 border-b border-white/5 bg-ink-900 select-none"
    >
      {/* Reserve space for macOS traffic lights. */}
      <div style={{ width: 72 }} />

      <div className="font-display text-sm font-semibold tracking-tight text-ink-50">
        Pianocast
      </div>
      <div className="ml-3 text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {MODE_LABELS[mode]}
      </div>
      <button type="button" onClick={onChangeMode}
        className="title-no-drag ml-3 text-xs text-ink-400 hover:text-ink-100"
        disabled={recording.status === 'recording' || recording.status === 'starting' || recording.status === 'stopping'}
        title="Choose a different mode">Change mode</button>
      <div className="title-no-drag flex items-center gap-2 ml-6" aria-label="Session tools">
        {mode === 'live' ? <><GoLiveStub primary /><RecordControls /></> : <><RecordControls primary /><GoLiveStub /></>}
      </div>

      <div className="flex-1" />

      <div className="title-no-drag flex items-center gap-2">
        <Field label="Key">
          <Select
            value={key.tonic}
            onChange={(v) => setKey({ ...key, tonic: v as KeyName })}
            options={KEYS.map((k) => ({ value: k, label: k }))}
          />
          <Select
            value={key.mode}
            onChange={(v) => setKey({ ...key, mode: v as KeyMode })}
            options={MODES.map((m) => ({ value: m, label: m }))}
          />
        </Field>

        <div className="w-px h-5 bg-white/8 mx-1" />

        <Field label="Input">
          <Select
            value={inputId ?? ''}
            onChange={(v) => {
              midiEngine.selectInput(v || null);
              setInputId(v || null);
            }}
            options={[
              { value: '', label: devices.length ? 'None' : 'No devices' },
              ...devices.map((d) => ({ value: d.id, label: d.name })),
            ]}
            width={180}
          />
        </Field>

        <div className="w-px h-5 bg-white/8 mx-1" />


      </div>
    </div>
  );
}

/**
 * Record / Stop button + live elapsed-time chip.
 *
 * The recorder owns its own state machine; we just read snapshots and
 * surface the right affordance:
 *
 *   - idle  → "Record"
 *   - starting / stopping → disabled label
 *   - recording → "Stop" with elapsed mm:ss next to it
 *   - error → flash the message and revert to "Record"
 *
 * Click handlers are intentionally minimal — anything more (saving location
 * dialogs, format choice, etc.) goes through the Recorder class so the
 * future Go Live path can reuse the same wiring.
 */
function RecordControls({ primary = false }: { primary?: boolean }) {
  const s = useSyncExternalStore(
    (cb) => recorder.subscribe(cb),
    () => recorder.getSnapshot(),
    () => recorder.getSnapshot(),
  );
  const isActive = s.status === 'recording';
  const isBusy = s.status === 'starting' || s.status === 'stopping';
  const label =
    s.status === 'starting' ? 'Starting…' :
    s.status === 'stopping' ? 'Saving…' :
    isActive ? 'Stop' : 'Record';

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => (isActive ? recorder.stop() : recorder.start())}
        disabled={isBusy}
        title={
          isActive
            ? 'Stop the recording and save the file'
            : 'Record the program output and audio mix to a file'
        }
        className={
          'text-[11px] uppercase tracking-[0.14em] font-medium px-3 py-1.5 rounded transition-colors border ' +
          (isActive
            ? 'bg-rose-500/15 border-rose-500 text-rose-100 hover:bg-rose-500/25'
            : primary ? 'bg-accent border-accent text-white hover:opacity-90' : 'border-white/10 text-ink-100 hover:border-white/25')
        }
      >
        {isActive && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
            style={{
              background: '#ff5d6c',
              animation: 'pk-rec-blink 1s ease-in-out infinite',
            }}
          />
        )}
        {label}
      </button>
      {isActive && (
        <span className="font-mono text-[11px] tabular-nums text-rose-200 min-w-[44px] text-left">
          {formatElapsed(s.elapsedMs)}
        </span>
      )}
      {s.status === 'error' && (
        <span className="text-[10px] text-rose-300 max-w-[200px] truncate" title={s.error ?? ''}>
          {s.error ?? 'Recording failed'}
        </span>
      )}
      <style>{`
        @keyframes pk-rec-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

/**
 * Go Live — deliberately stubbed.
 *
 * The real path needs a system virtual camera (CMIO extension on macOS,
 * Media Foundation source on Windows) for video plus a virtual audio
 * device for the mix. Those native helpers don't ship yet; the button is
 * here so the seam exists, the user sees where it'll live, and the
 * Recorder's clean capture targets (`pianoEngine.getProgramStream`,
 * `audioInput.getProgramStream`, `RecordingService.getProgramWindow`) are
 * ready for it to plug into.
 */
function GoLiveStub({ primary = false }: { primary?: boolean }) {
  return (
    <button
      type="button"
      disabled
      title="Coming soon — requires native virtual camera + audio device. Recording works today."
      className={'text-[11px] uppercase tracking-[0.14em] font-medium px-3 py-1.5 rounded border cursor-not-allowed ' + (primary ? 'border-accent bg-accent/20 text-accent-soft' : 'border-white/8 text-ink-500')}
    >
      Go Live · Coming soon
    </button>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-ink-400">
        {label}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width?: number;
}
function Select({ value, onChange, options, width }: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width }}
      className="bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 hover:border-white/20 focus:border-accent focus:outline-none transition-colors"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
