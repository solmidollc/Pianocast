import { useSyncExternalStore, useState, useEffect, useRef } from 'react';
import { calibration, nameOfNote } from '../acoustic/calibration';

export function AcousticCalibration({ listening }: { listening: boolean }) {
  const state = useSyncExternalStore(calibration.subscribe, calibration.getSnapshot);
  const [name, setName] = useState('My piano');
  const [base, setBase] = useState(60);
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const active = state.step !== 'idle';
  useEffect(() => {
    if (!active) return;
    opener.current = document.activeElement as HTMLElement;
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && calibration.getSnapshot().storage !== 'Saving…') { event.preventDefault(); event.stopPropagation(); calibration.cancel(); }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select') ?? []);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      // Do not let scene shortcuts, delete, or undo run behind the wizard.
      event.stopPropagation();
    };
    dialog.current?.addEventListener('keydown', key);
    const node = dialog.current;
    return () => { node?.removeEventListener('keydown', key); opener.current?.focus(); };
  }, [active]);
  const start = () => { calibration.configure(name, base); dialog.current?.focus(); calibration.capture(); };
  const result = state.draft?.validation;
  const baseline = result ? Math.round(100 * result.baseline / result.frames) : 0;
  const calibrated = result ? Math.round(100 * result.calibrated / result.frames) : 0;
  const target = calibration.target();
  return <>
    <div className="border-t border-white/10 pt-3 space-y-2 text-xs">
      <button type="button" disabled={!listening} onClick={() => calibration.begin()} className="rounded border border-white/10 px-3 py-2 w-full disabled:opacity-40">{state.profile ? 'Recalibrate my piano' : 'Calibrate my piano'}</button>
      {state.profile && <label className="flex gap-2 items-center"><input type="checkbox" checked={state.enabled} onChange={e => calibration.enable(e.target.checked)}/>Use {state.profile.name} · {nameOfNote(state.profile.notes[0].midi)}–{nameOfNote(state.profile.notes[11].midi)}</label>}
      {state.storage && <p role="status" className="text-ink-400">{state.storage}</p>}
    </div>
    {active && <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/70" style={{zIndex:200}}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Calibrate my piano" className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-white/10 bg-ink-900 p-6 shadow-xl space-y-4 outline-none text-ink-100">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Calibrate my piano</h2><button disabled={saving} type="button" aria-label="Close calibration" onClick={() => calibration.cancel()} className="p-2">×</button></div>
        {state.step === 'prepare' ? <>
          <p className="text-sm text-ink-400">An optional one-octave experiment. Record 12 notes, then play a short test to compare recognition. Use the same microphone position, with no pedal.</p>
          <label className="block text-sm">Piano profile<input aria-label="Piano profile name" maxLength={80} value={name} onChange={e => setName(e.target.value)} className="block w-full mt-1 p-2 bg-ink-800 rounded"/></label>
          <label className="flex items-center justify-between text-sm">Octave<select aria-label="Calibration octave" value={base} onChange={e => setBase(Number(e.target.value))} className="bg-ink-800 p-2 rounded"><option value={48}>C3–B3</option><option value={60}>C4–B4 · Middle C</option><option value={72}>C5–B5</option></select></label>
          <p className="text-xs text-ink-400">First, stay quiet for two seconds so we can measure room noise. Only sound fingerprints are saved on this device; no recordings are uploaded.</p>
          <button type="button" className="w-full bg-accent text-white rounded p-3" onClick={start}>Check the room</button>
        </> : state.step === 'review' ? <>
          <h3 className="font-semibold">Your comparison</h3>
          <div className="grid grid-cols-2 gap-3 text-center"><div className="rounded bg-ink-800 p-4"><div className="text-2xl">{baseline}%</div><div className="text-xs text-ink-400">Original detector</div></div><div className="rounded bg-ink-800 p-4"><div className="text-2xl">{calibrated}%</div><div className="text-xs text-ink-400">With piano profile</div></div></div>
          <p className="text-sm">{calibrated > baseline ? 'The profile recognized more of this test correctly.' : calibrated === baseline ? 'No improvement measured in this test.' : 'The profile performed worse in this test. Keep the original detector for now.'}</p>
          <p className="text-xs text-ink-400">Correct pitch readings during six fresh note recordings. This small test doesn’t establish accuracy across your piano. The original detector is used outside the calibrated octave.</p>
          <button type="button" disabled={saving} onClick={async () => { setSaving(true); try { await calibration.save(); } finally { setSaving(false); } }} className="w-full bg-accent text-white rounded p-3">{saving ? 'Saving…' : state.profile ? 'Replace saved profile' : 'Save piano profile'}</button>
          <p className="text-xs text-ink-400">Saving leaves the profile off. Enable it in Acoustic Piano settings when you want to try it.</p>
        </> : <>
          <div aria-live="polite" className="text-center space-y-2">
            <p className="text-xs uppercase tracking-widest text-ink-400">{state.step === 'noise' ? 'Room check' : state.step === 'notes' ? `Note ${state.index + 1} of 12` : `Fresh test · ${state.index + 1} of 6`}</p>
            <h3 className="text-3xl font-semibold">{state.step === 'noise' ? 'Stay quiet' : `Play ${nameOfNote(target)}`}</h3>
          </div>
          {state.step !== 'noise' && <div role="img" aria-label={`Keyboard showing ${nameOfNote(target)}`} className="relative h-28 flex rounded overflow-hidden border border-white/10 bg-white">
            {[0,2,4,5,7,9,11].map((pc) => <div key={pc} className="flex-1 border-r border-black/20 text-black flex items-end justify-center pb-2 text-xs" style={{background:target % 12 === pc ? '#8d80fa' : undefined}}>{nameOfNote(state.base + pc)}</div>)}
            {[{pc:1,x:1},{pc:3,x:2},{pc:6,x:4},{pc:8,x:5},{pc:10,x:6}].map(({pc,x}) => <div key={pc} className="absolute top-0 h-16 rounded-b" style={{left:`${x / 7 * 100 - 4}%`,width:'8%',background:target % 12 === pc ? '#8d80fa' : '#17181d'}}/>)}
          </div>}
          <p className="text-sm text-ink-400">{state.step === 'noise' ? 'Measuring background sound for two seconds.' : state.recording ? 'Play the highlighted note and let it ring for about one second.' : 'Release the previous note. Click Record note, then play the highlighted key without the pedal.'}</p>
          <progress aria-label="Calibration recording progress" max={1} value={state.progress} className="w-full"/>
          {state.message && <p role="status" className="text-sm text-ink-400">{state.message}</p>}
          {!state.recording && <button type="button" className="w-full rounded p-3 bg-accent text-white" onClick={() => { dialog.current?.focus(); calibration.capture(); }}>{state.step === 'noise' ? 'Retry room check' : state.message ? 'Retry note' : 'Record note'}</button>}
          {state.step === 'check' && <p className="text-xs text-ink-400">These new recordings are used only for comparison, not to train the profile.</p>}
        </>}
        <button type="button" disabled={saving} onClick={() => calibration.cancel()} className="text-sm text-ink-400">{state.step === 'review' ? 'Discard experiment' : 'Cancel calibration'}</button>
      </div>
    </div>}
  </>;
}
