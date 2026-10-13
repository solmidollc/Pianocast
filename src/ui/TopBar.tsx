import { useEffect, useState, useSyncExternalStore } from 'react';
import { midiEngine } from '../midi/engine';
import { useApp } from '../state/store';
import type { KeyName, KeyMode } from '../theory/types';
import type { MidiDeviceInfo } from '../midi/types';
import { recorder, DEFAULT_RECORDING_OPTIONS, recordingBitrate, recordingFormats, canSaveDirectly, type RecordingOptions } from '../recording/recorder';

import { MODE_LABELS, type SessionMode } from './StartPage';

const KEYS: KeyName[] = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#',
  'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
];
const MODES: KeyMode[] = ['major', 'minor'];

export function TopBar({ mode, onChangeMode, onFullscreen }: { mode: SessionMode; onChangeMode: () => void; onFullscreen: () => void }) {
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
        PianoCanva
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

      <button type="button" onClick={onFullscreen} title="Exit with Esc" className="title-no-drag ml-3 text-xs text-ink-400 hover:text-white">Full screen recording</button>
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
            : window.pk?.recording ? 'Record the program output and audio mix to a file' : 'Record the composed scene with piano and enabled microphone audio'
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
      {!window.pk?.recording && s.status === 'idle' && (
        <span className="text-[10px] text-ink-400">Scene video only</span>
      )}
      {s.lastFileName && s.status === 'idle' && (
        <span role="status" className="text-[10px] text-ink-400" title={s.lastFileName}>Saved</span>
      )}
      {s.status === 'error' && (
        <span className="text-[10px] text-rose-300 max-w-[200px] truncate" title={s.error ?? ''}>
          {s.error ?? 'Recording failed'}
        </span>
      )}
      <RecordingSettings />
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


function RecordingSettings() {
  const state = useSyncExternalStore(cb => recorder.subscribe(cb), () => recorder.getSnapshot());
  const [open, setOpen] = useState(false);
  const locked = ['starting', 'recording', 'stopping'].includes(state.status);
  const options = state.options;
  const size = Math.round((recordingBitrate(options) + 320_000) * 60 / 8 / 1_000_000);
  return <div className="relative">
    <button type="button" aria-label="Recording settings" aria-expanded={open} onClick={() => setOpen(!open)} className="text-xs text-ink-400 hover:text-white">Settings</button>
    {open && <div role="dialog" aria-label="Recording settings" className="absolute top-8 left-0 z-50 w-64 rounded-lg border border-white/10 bg-ink-900 p-4 shadow-xl">
      <div className="flex justify-between mb-3 text-sm text-white">Recording<button type="button" aria-label="Close recording settings" onClick={() => setOpen(false)}>×</button></div>
      <details open><summary className="text-xs text-ink-300 mb-3">Advanced</summary>
      <fieldset disabled={locked} className="space-y-3 disabled:opacity-50">
      {([
        ['quality', 'Quality', [['maximum', 'Current / Maximum'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]],
        ['format', 'Format', [['auto', 'Automatic'], ...recordingFormats().map(f => [f, f.toUpperCase()])]],
        ['fps', 'Frame rate', [['60', '60 FPS'], ['30', '30 FPS']]],
        ['resolution', 'Resolution', [['1080', '1080p'], ['720', '720p']]],
      ] as Array<[keyof RecordingOptions, string, string[][]]>).map(([key, label, choices]) => <label key={key} className="flex items-center justify-between text-xs text-ink-300">{label}<select className="bg-ink-800 rounded p-1 text-white" value={String(options[key])} onChange={e => recorder.setOptions({ [key]: key === 'fps' || key === 'resolution' ? Number(e.target.value) : e.target.value })}>{choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
      {canSaveDirectly() && <label className="flex justify-between text-xs text-ink-300">Save directly to disk<input type="checkbox" checked={options.directSave} onChange={e => recorder.setOptions({ directSave: e.target.checked })} /></label>}
      <button type="button" onClick={() => recorder.setOptions({ ...DEFAULT_RECORDING_OPTIONS })} className="text-xs text-accent-soft">Reset to default</button>
      </fieldset></details>
      <p className="mt-3 text-[11px] text-ink-400">Approximately {size} MB / minute</p>
      {locked && <p className="mt-2 text-[11px] text-ink-400">Available after recording stops.</p>}
    </div>}
  </div>;
}
