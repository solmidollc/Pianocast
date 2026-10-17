import { formatTime } from '../editing/model';
import { openVideoEdit } from '../editing/store';
import { GettingStarted } from './GettingStarted';
import { Teleprompter } from './Teleprompter';
import { useDialogKeyboard } from './useDialogKeyboard';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { useScenes } from '../state/sceneLibrary';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AcousticInputPanel } from './AcousticInputPanel';
import { acousticInput } from '../acoustic/input';
import { ACOUSTIC_INPUT_ID, midiEngine } from '../midi/engine';
import { useApp } from '../state/store';
import type { KeyName, KeyMode } from '../theory/types';
import type { MidiDeviceInfo } from '../midi/types';
import { recorder, DEFAULT_RECORDING_OPTIONS, recordingBitrate, recordingFormats, type RecordingOptions } from '../recording/recorder';

import { useProjects,saveProject,renameProject } from '../state/projects';
import { templateById } from '../state/templates';
import { useEditsLocked } from '../annotation/connectionLock';
import { MODE_LABELS, type SessionMode } from './StartPage';

const KEYS: KeyName[] = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#',
  'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
];
const MODES: KeyMode[] = ['major', 'minor'];

export function TopBar({ mode, onChangeMode, onFullscreen, onLivestream, readOnly=false }: { mode: SessionMode; onChangeMode: () => void; onFullscreen: (withScenes?:boolean) => void; onLivestream:()=>void; readOnly?:boolean }) {
  const multipleScenes=useScenes(s=>s.scenes.length>1);
  const editingLocked=useEditsLocked();
  const projects=useProjects();
  const project=projects.projects.find(p=>p.id===projects.activeId);
  const [projectMenu,setProjectMenu]=useState(false),[help,setHelp]=useState(false);
  useDialogKeyboard(help,'Getting Started',()=>setHelp(false));
  useEffect(()=>{if(!projectMenu)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setProjectMenu(false);}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[projectMenu]);
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
      if(midiEngine.getInputId()===ACOUSTIC_INPUT_ID){acousticInput.stop();midiEngine.selectInput(null);}
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
      className="editor-toolbar title-drag flex flex-wrap items-center min-h-12 py-2 gap-y-2 px-4 border-b border-white/5 bg-ink-900 select-none"
    >
      {/* Reserve space for macOS traffic lights. */}
      {window.pk?.recording && <div className="w-16 shrink-0" />}

      <div className="font-display text-sm font-semibold tracking-tight text-ink-50">
        PianoCanva
      </div>
      <div className="title-no-drag relative ml-3">
       <button type="button" aria-label="Project menu" aria-expanded={projectMenu} onClick={()=>setProjectMenu(!projectMenu)} className="project-editor-name">{project?.name??MODE_LABELS[mode]} <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4"/></svg></button>
       {projectMenu&&<div role="dialog" aria-label="Project" className="project-editor-menu">
         <label>Project name<input aria-label="Rename current project" defaultValue={project?.name} maxLength={100} onBlur={e=>{if(project)void renameProject(project.id,e.target.value);}}/></label>
         <span role="status">{projects.status==='error'?projects.error:projects.status==='saving'?'Saving…':'All changes saved on this device'}</span>
         <button onClick={()=>void saveProject()}>Save project <kbd>{/Mac|iPhone|iPad/.test(navigator.platform)?'⌘ + S':'Ctrl + S'}</kbd></button>
         <button disabled={['recording','paused','starting','stopping'].includes(recording.status)} onClick={onChangeMode}>Home and projects</button>
         <button onClick={()=>{setHelp(true);setProjectMenu(false);}}>Getting started</button>
         {project&&templateById(project.templateId)?.future&&<div className="project-future-tools"><strong>Coming later</strong>{templateById(project.templateId).future!.map(tool=><button key={tool} disabled>{tool} · Coming later</button>)}</div>}
       </div>}
      </div>
      {help&&<div className="project-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="Getting Started" className="project-modal project-small-modal"><h2>Getting Started</h2><GettingStarted/><button className="project-primary" onClick={()=>setHelp(false)}>Back to workspace</button></section></div>}
      <Teleprompter />
      <button type="button" className="title-no-drag ml-2 rounded border border-white/15 px-3 py-1.5 text-xs" disabled={['recording','paused','starting','stopping'].includes(recording.status)} onClick={() => void openVideoEdit(undefined, { reviewRecording: true })}>Score Sync</button>
      <div className="title-no-drag flex items-center gap-2 ml-4 pl-4 border-l border-white/10" aria-label="Session tools">
        {mode === 'live' ? <><LivestreamButton primary onClick={onLivestream}/><RecordControls /></> : <><RecordControls primary /><LivestreamButton onClick={onLivestream}/></>}
      </div>

      <button type="button" onClick={()=>onFullscreen(false)} aria-label="Full screen recording" title="Full screen recording · Exit with Esc" className="title-no-drag ml-3 rounded border border-white/15 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:border-white/30 hover:text-white"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button>
      {multipleScenes&&<button type="button" onClick={()=>onFullscreen(true)} aria-label="Full screen with scenes" title="Full screen with scene shortcuts · Exit with Esc" className="title-no-drag ml-2 rounded border border-white/15 bg-ink-800 px-3 py-1.5 text-ink-200"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 3H3v4m13-4h5v4M3 11v4h5m13-4v4h-5"/><rect x="3" y="19" width="4" height="3" rx=".4"/><rect x="10" y="19" width="4" height="3" rx=".4"/><rect x="17" y="19" width="4" height="3" rx=".4"/></svg></button>}

      <div className="flex-1 min-w-3" />

      <div className="editor-toolbar-settings title-no-drag flex items-center gap-2">
        <Field label="Key"><fieldset disabled={editingLocked} className="flex items-center gap-1">
          <Select
            label="Key tonic"
            value={key.tonic}
            onChange={(v) => setKey({ ...key, tonic: v as KeyName })}
            options={KEYS.map((k) => ({ value: k, label: k }))}
          />
          <Select
            label="Key mode"
            value={key.mode}
            onChange={(v) => setKey({ ...key, mode: v as KeyMode })}
            options={MODES.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))}
          />
        </fieldset></Field>

        <div className="w-px h-5 bg-white/8 mx-1" />

        <Field label="MIDI Input">
          <Select
            label="MIDI input"
            value={inputId ?? ''}
            onChange={(v) => {
              acousticInput.stop();
              midiEngine.selectInput(v || null);
              setInputId(v || null);
            }}
            options={[
              { value: '', label: 'None' },
              ...devices.map((d) => ({ value: d.id, label: d.name })),
              { value: ACOUSTIC_INPUT_ID, label: 'Acoustic Piano (Coming Soon)', disabled:true },
            ]}
            width={160}
          />
        </Field>
        {inputId === ACOUSTIC_INPUT_ID && <AcousticInputPanel />}

        <div className="w-px h-5 bg-white/8 mx-1" />
        <RecordingSettings />
        <KeyboardShortcuts compact readOnly={readOnly}/>
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
    s.status === 'stopping' ? 'Preparing review…' :
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
            : window.pk?.recording ? 'Record the program output and audio mix to a file' : 'Record the composed scene and enabled audio'
        }
        className={
          'text-[11px] uppercase tracking-[0.14em] font-medium px-3 py-1.5 rounded transition-colors border ' +
          (isActive
            ? 'bg-rose-500/15 border-rose-500 text-rose-100 hover:bg-rose-500/25'
            : 'bg-red-600 border-red-600 text-white hover:bg-red-500')
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
      {s.lastTakeName && s.status === 'idle' && (
        <button type="button" className="text-xs text-accent-soft" onClick={() => void openVideoEdit(s.lastTakeId ?? undefined, { reviewRecording: true })}>Review take</button>
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
function LivestreamButton({primary=false,onClick}:{primary?:boolean;onClick:()=>void}){return <button type="button" onClick={onClick} title="Show video only for tab sharing · Exit with Esc" className={'livestream-button '+(primary?'is-primary':'')}>Livestream</button>;}

function formatElapsed(ms: number): string {
  return formatTime(ms / 1000);
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
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?:boolean }[];
  width?: number;
}
function Select({ label, value, onChange, options, width }: SelectProps) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: width ?? (options.length > 2 ? 64 : 92) }}
      className="bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 hover:border-white/20 focus:border-accent focus:outline-none transition-colors"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}


function RecordingSettings() {
  const state = useSyncExternalStore(cb => recorder.subscribe(cb), () => recorder.getSnapshot());
  const [open, setOpen] = useState(false);
  useDialogKeyboard(open,'Recording settings',()=>setOpen(false),false);
  const locked = ['starting', 'recording', 'paused', 'stopping'].includes(state.status);
  const options = state.options;
  const size = Math.round((recordingBitrate(options) + 320_000) * 60 / 8 / 1_000_000);
  return <div className="relative">
    <button type="button" aria-label="Recording settings" aria-expanded={open} onClick={() => setOpen(!open)} title="Recording settings" className="flex items-center gap-2 rounded border border-white/15 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:border-accent hover:text-white"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Recording settings</button>
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
      <button type="button" onClick={() => recorder.setOptions({ ...DEFAULT_RECORDING_OPTIONS })} className="text-xs text-accent-soft">Reset to default</button>
      </fieldset></div>
      <p className="mt-3 text-[11px] text-ink-400">Approximately {size} MB / minute</p>
      {locked && <p className="mt-2 text-[11px] text-ink-400">Available after recording stops.</p>}
    </div>}
  </div>;
}





