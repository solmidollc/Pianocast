import { useEffect, useState, useSyncExternalStore } from 'react';
import { acousticInput } from '../acoustic/input';

const noteName = (midi: number) => `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
export function AcousticInputPanel() {
  const state = useSyncExternalStore(acousticInput.subscribe, acousticInput.getSnapshot);
  const [open, setOpen] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState('');
  const [gate, setGate] = useState(acousticInput.gate);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then(list => { if (mounted) setDevices(list.filter(d => d.kind === 'audioinput')); }).catch(() => {}); };
    refresh(); navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => { mounted = false; navigator.mediaDevices?.removeEventListener('devicechange', refresh); };
  }, [state.status]);
  useEffect(() => () => acousticInput.stop(), []);
  return <div className="relative">
    <button type="button" aria-label="Acoustic Piano settings" aria-expanded={open} onClick={() => setOpen(!open)} className="px-2 py-1 text-xs rounded border border-white/10">{state.status === 'listening' ? '● Listening' : 'Set up'}</button>
    {open && <section role="dialog" aria-label="Acoustic Piano input" className="absolute right-0 top-full mt-2 w-80 p-4 rounded-lg border border-white/10 bg-ink-900 text-ink-100 shadow-xl z-50 space-y-3" style={{maxWidth:'90vw',maxHeight:'calc(100vh - 110px)',overflowY:'auto'}}>
      <div className="flex justify-between items-center"><strong className="text-sm">Acoustic Piano <span className="text-ink-400 font-normal text-xs">Beta</span></strong><button aria-label="Close acoustic settings" onClick={() => setOpen(false)}>×</button></div>
      <p className="text-xs text-ink-400">A0–C8 · Single piano notes.</p>
      <label className="block text-xs">Microphone<select aria-label="Acoustic microphone" className="block w-full mt-1 bg-ink-800 rounded p-2" value={device} disabled={state.status === 'opening' || state.status === 'listening'} onChange={e => setDevice(e.target.value)}><option value="">System default</option>{devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select></label>
      <div className="flex gap-2 items-center text-xs"><span>Input level</span><meter aria-label="Acoustic microphone level" min={0} max={1} value={Math.min(1, state.rms * 5)} className="flex-1"/><span aria-live="off">{state.midi === null ? '—' : noteName(state.midi)}</span></div>
      <details className="text-xs"><summary className="cursor-pointer text-ink-400">Detection settings</summary><div className="space-y-2 mt-2">
        <label className="flex justify-between items-center">Room<select aria-label="Acoustic sensitivity" className="bg-ink-800 p-1 rounded" value={gate} onChange={e => { const value = Number(e.target.value); setGate(value); acousticInput.gate = value; }}><option value={.001}>Quiet</option><option value={.004}>Normal</option><option value={.016}>Noisy</option></select></label>
      </div></details>
      {state.error && <p role="alert" className="text-xs text-red-400">{state.error}</p>}
      <button type="button" className="w-full rounded bg-accent px-3 py-2 text-sm text-white" onClick={() => state.status === 'opening' || state.status === 'listening' ? acousticInput.stop() : void acousticInput.start(device)}>{state.status === 'opening' ? 'Cancel' : state.status === 'listening' ? 'Stop listening' : 'Start listening'}</button>
      <p className="text-xs text-ink-400">Visualization only. Recording audio is controlled separately in Audio.</p>
    </section>}
  </div>;
}
