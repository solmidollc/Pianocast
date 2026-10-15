import { useEffect, useState, useSyncExternalStore } from 'react';
import { AcousticInputPanel } from './AcousticInputPanel';
import { acousticInput } from '../acoustic/input';
import { ACOUSTIC_INPUT_ID, midiEngine } from '../midi/engine';
import { useApp } from '../state/store';
import type { KeyName, KeyMode } from '../theory/types';
import type { MidiDeviceInfo } from '../midi/types';
import { recorder, DEFAULT_RECORDING_OPTIONS, recordingBitrate, recordingFormats, canSaveDirectly, type RecordingOptions } from '../recording/recorder';

import { useProjects,saveProject,renameProject } from '../state/projects';
import { templateById } from '../state/templates';
import { useEditsLocked } from '../annotation/connectionLock';
import { MODE_LABELS, type SessionMode } from './StartPage';

const KEYS: KeyName[] = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#',
  'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
];
const MODES: KeyMode[] = ['major', 'minor'];

export function TopBar({ mode, onChangeMode, onFullscreen }: { mode: SessionMode; onChangeMode: () => void; onFullscreen: () => void }) {
  const editingLocked=useEditsLocked();
  const projects=useProjects();
  const project=projects.projects.find(p=>p.id===projects.activeId);
  const [projectMenu,setProjectMenu]=useState(false),[help,setHelp]=useState(false);
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void saveProject();}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
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
      className="title-drag flex flex-wrap items-center min-h-12 py-2 gap-y-2 px-4 border-b border-white/5 bg-ink-900 select-none"
    >
      {/* Reserve space for macOS traffic lights. */}
      {window.pk?.recording && <div className="w-16 shrink-0" />}

      <div className="font-display text-sm font-semibold tracking-tight text-ink-50">
        PianoCanva
      </div>
      <div className="title-no-drag relative ml-3">
       <button type="button" aria-label="Project menu" aria-expanded={projectMenu} onClick={()=>setProjectMenu(!projectMenu)} className="project-editor-name">{project?.name??MODE_LABELS[mode]} <span aria-hidden="true">⌄</span></button>
       {projectMenu&&<div role="dialog" aria-label="Project" className="project-editor-menu">
         <label>Project name<input aria-label="Rename current project" defaultValue={project?.name} maxLength={100} onBlur={e=>{if(project)void renameProject(project.id,e.target.value);}}/></label>
         <span role="status">{projects.status==='error'?projects.error:projects.status==='saving'?'Saving…':'All changes saved on this device'}</span>
         <button onClick={()=>void saveProject()}>Save project <kbd>{/Mac|iPhone|iPad/.test(navigator.platform)?'⌘ + S':'Ctrl + S'}</kbd></button>
         <button disabled={['recording','paused','starting','stopping'].includes(recording.status)} onClick={onChangeMode}>Home / My Projects</button>
         <button onClick={()=>{setHelp(true);setProjectMenu(false);}}>Getting Started</button>
         {project&&templateById(project.templateId)?.future&&<div className="project-future-tools"><strong>Coming later</strong>{templateById(project.templateId).future!.map(tool=><button key={tool} disabled>{tool} · Coming later</button>)}</div>}
       </div>}
      </div>
      {help&&<div className="project-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="Getting Started" className="project-modal project-small-modal"><h2>Getting Started</h2><p>The interactive walkthrough is coming later. It will introduce scenes, cameras, instructional tools, customization, recording and saving inside your workspace.</p><button className="project-primary" onClick={()=>setHelp(false)}>Back to workspace</button></section></div>}
      <div className="title-no-drag flex items-center gap-2 ml-4 pl-4 border-l border-white/10" aria-label="Session tools">
        {mode === 'live' ? <><GoLiveStub primary /><RecordControls /></> : <><RecordControls primary /><GoLiveStub /></>}
      </div>

      <button type="button" onClick={onFullscreen} aria-label="Full screen recording" title="Full screen recording · Exit with Esc" className="title-no-drag ml-3 rounded border border-white/15 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:border-white/30 hover:text-white"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button>
      <div className="flex-1 min-w-3" />

      <div className="title-no-drag flex items-center gap-2">
        <Field label="Key"><fieldset disabled={editingLocked} className="flex items-center gap-1">
          <Select
            value={key.tonic}
            onChange={(v) => setKey({ ...key, tonic: v as KeyName })}
            options={KEYS.map((k) => ({ value: k, label: k }))}
          />
          <Select
            value={key.mode}
            onChange={(v) => setKey({ ...key, mode: v as KeyMode })}
            options={MODES.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))}
          />
        </fieldset></Field>

        <div className="w-px h-5 bg-white/8 mx-1" />

        <Field label="Input">
          <Select
            value={inputId ?? ''}
            onChange={(v) => {
              acousticInput.stop();
              midiEngine.selectInput(v || null);
              setInputId(v || null);
            }}
            options={[
              { value: '', label: 'None' },
              { value: ACOUSTIC_INPUT_ID, label: 'Acoustic Piano (beta)' },
              ...devices.map((d) => ({ value: d.id, label: d.name })),
            ]}
            width={160}
          />
        </Field>
        {inputId === ACOUSTIC_INPUT_ID && <AcousticInputPanel />}

        <div className="w-px h-5 bg-white/8 mx-1" />
        <RecordingSettings />
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
  const isActive = s.status === 'recording' || s.status === 'paused';
  const isBusy = s.status === 'starting' || s.status === 'stopping';
  const label =
    s.status === 'starting' ? 'Starting…' :
    s.status === 'stopping' ? 'Saving…' :
    isActive ? 'Stop' : 'Record';

  return (
    <div className="flex items-center gap-2">
      {isActive&&<button type="button" aria-label={s.status==='paused'?'Resume recording':'Pause recording'} onClick={()=>s.status==='paused'?recorder.resume():recorder.pause()} className="px-2 py-1 rounded border border-white/10 text-xs">{s.status==='paused'?'Resume':'Pause'}</button>}
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
      {s.lastFileName && s.status === 'idle' && (
        <span role="status" className="text-[10px] text-ink-400" title={s.lastFileName}>Saved</span>
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
      style={{ borderColor: 'rgba(255,255,255,.08)', color: '#777987', background: 'transparent' }}
      className="text-[11px] uppercase tracking-[0.14em] font-medium px-3 py-1.5 rounded border cursor-not-allowed"
    >
      Go Live
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
      style={{ width: width ?? (options.length > 2 ? 64 : 92) }}
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
  const locked = ['starting', 'recording', 'paused', 'stopping'].includes(state.status);
  const options = state.options;
  const size = Math.round((recordingBitrate(options) + 320_000) * 60 / 8 / 1_000_000);
  return <div className="relative">
    <button type="button" aria-label="Recording settings" aria-expanded={open} onClick={() => setOpen(!open)} title="Recording settings" className="flex items-center gap-2 rounded border border-white/15 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:border-accent hover:text-white"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m9 3-.6 2.2-2 .9-2-.7-2 3.4 1.6 1.6v2.3L2.4 14l2 3.5 2-.7 2 .9L9 20h4l.6-2.3 2-.9 2 .7 2-3.5-1.6-1.5v-2.3l1.6-1.6-2-3.4-2 .7-2-.9L13 3z"/><circle cx="12" cy="12" r="3"/></svg>Recording settings</button>
    {open && <div role="dialog" aria-label="Recording settings" className="absolute top-10 right-0 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-white/10 bg-ink-900 p-4 shadow-xl">
      <div className="flex justify-between mb-3 text-sm text-white">Recording<button type="button" aria-label="Close recording settings" className="w-8 h-8 rounded hover:bg-white/10 text-lg" onClick={() => setOpen(false)}>×</button></div>
      <div>
      <fieldset disabled={locked} className="space-y-3 disabled:opacity-50">
      {([
        ['quality', 'Quality', [['maximum', 'Maximum'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]],
        ['format', 'Format', [['auto', 'Automatic'], ...recordingFormats().map(f => [f, f.toUpperCase()])]],
        ['fps', 'Frame rate', [['60', '60 FPS'], ['30', '30 FPS']]],
        ['resolution', 'Resolution', [['1080', '1080p'], ['720', '720p']]],
      ] as Array<[keyof RecordingOptions, string, string[][]]>).map(([key, label, choices]) => <label key={key} className="flex items-center justify-between text-xs text-ink-300">{label}<select className="w-36 bg-ink-800 rounded p-1 text-white" value={String(options[key])} onChange={e => recorder.setOptions({ [key]: key === 'fps' || key === 'resolution' ? Number(e.target.value) : e.target.value })}>{choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
      {canSaveDirectly() && <label className="flex justify-between text-xs text-ink-300">Save directly to disk<input type="checkbox" checked={options.directSave} onChange={e => recorder.setOptions({ directSave: e.target.checked })} /></label>}
      <button type="button" onClick={() => recorder.setOptions({ ...DEFAULT_RECORDING_OPTIONS })} className="text-xs text-accent-soft">Reset to default</button>
      </fieldset></div>
      <p className="mt-3 text-[11px] text-ink-400">Approximately {size} MB / minute</p>
      {locked && <p className="mt-2 text-[11px] text-ink-400">Available after recording stops.</p>}
    </div>}
  </div>;
}





