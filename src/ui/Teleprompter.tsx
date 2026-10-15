import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { recorder } from '../recording/recorder';
import { useTeleprompter } from '../teleprompter/store';
import { useDialogKeyboard } from './useDialogKeyboard';

/** Presenter UI stays outside recording modules and the clean program output. */
export function Teleprompter() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="title-no-drag ml-3 rounded border border-white/15 px-3 py-1.5 text-xs" onClick={() => setOpen(true)}>Teleprompter</button>
    {open && <Reader onClose={() => setOpen(false)} />}
  </>;
}

function Reader({ onClose }: { onClose: () => void }) {
  const { settings, update } = useTeleprompter();
  const recording = useSyncExternalStore(cb => recorder.subscribe(cb), () => recorder.getSnapshot());
  const active = recording.status === 'recording' || recording.status === 'paused';
  const busy = recording.status === 'starting' || recording.status === 'stopping';
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState(!settings.script.trim());
  const viewport = useRef<HTMLDivElement>(null);
  useDialogKeyboard(true, 'Teleprompter', onClose);

  useEffect(() => {
    if (!playing || editing) return;
    let frame = 0, previous: number | undefined, position = viewport.current?.scrollTop ?? 0;
    const tick = (time: number) => {
      const element = viewport.current;
      if (!element) return;
      if (previous !== undefined) position += Math.min(100, time - previous) * settings.speed / 1000;
      previous = time;
      const end = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTop = Math.min(end, position);
      if (position >= end) { setPlaying(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, editing, settings.speed]);

  const reset = () => { setPlaying(false); if (viewport.current) viewport.current.scrollTop = 0; };
  return <div className="project-modal-backdrop" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label="Teleprompter" className="project-modal title-no-drag select-text" style={{ width: 'min(960px, 95vw)', maxHeight: '90vh', overflowY: 'auto' }} onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-4"><h2>Teleprompter</h2><button type="button" aria-label="Close teleprompter" onClick={onClose}>×</button></div>
      <p className="text-xs text-ink-300">Your reading view stays out of the downloaded recording. It saves with this project on this device. When sharing the entire tab, other people can see this panel.</p>
      <div className="flex flex-wrap items-center gap-3 my-3">
        <button type="button" className="project-primary" disabled={editing || !settings.script.trim()} aria-pressed={playing} onClick={() => setPlaying(value => !value)}>{playing ? 'Pause scrolling' : 'Start scrolling'}</button>
        <button type="button" className="project-secondary" onClick={reset}>Back to start</button>
        <button type="button" className="project-secondary" onClick={() => { setPlaying(false); setEditing(value => !value); }}>{editing ? 'Read script' : 'Edit script'}</button>
        <button type="button" className="project-secondary" disabled={busy} onClick={() => { if (active) void recorder.stop(); else void recorder.start(); }}>{busy ? 'Please wait…' : active ? 'Stop recording' : 'Start recording'}</button>
        {active && <button type="button" className="project-secondary" onClick={() => recording.status === 'paused' ? recorder.resume() : recorder.pause()}>{recording.status === 'paused' ? 'Resume recording' : 'Pause recording'}</button>}
        <span role="status" className="text-xs">Recording: {recording.status}</span>
        {recording.error && <p role="alert">{recording.error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
        <label>Scroll speed <input aria-label="Teleprompter scroll speed" type="range" min="5" max="120" value={settings.speed} onChange={event => update({ speed: Number(event.target.value) })} /> {settings.speed} px/s</label>
        <label>Text size <input aria-label="Teleprompter text size" type="range" min="18" max="96" value={settings.fontSize} onChange={event => { setPlaying(false); update({ fontSize: Number(event.target.value) }); }} /> {settings.fontSize}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.mirror} onChange={event => update({ mirror: event.target.checked })} /> Mirror text</label>
      </div>
      {editing ? <label className="block text-sm">Script<textarea aria-label="Teleprompter script" maxLength={50_000} value={settings.script} onChange={event => { reset(); update({ script: event.target.value }); }} className="block w-full mt-2 rounded border border-white/15 bg-ink-800 p-3 text-ink-100" rows={10} /></label> :
        <div ref={viewport} tabIndex={0} role="region" aria-label="Teleprompter reading view" onWheel={() => setPlaying(false)} onPointerDown={() => setPlaying(false)} onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) setPlaying(false); }} style={{ height: 'min(45vh, 360px)', overflowY: 'auto', background: '#101114', color: '#fff', borderRadius: 8 }}>
          <div style={{ padding: '24px 32px 45vh', fontSize: settings.fontSize, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', transform: settings.mirror ? 'scaleX(-1)' : undefined }}>{settings.script || 'Choose Edit script to add your text.'}</div>
        </div>}
      <p role="status" className="text-xs text-ink-300 mt-3">{editing ? 'Edit your script, then choose Read script.' : playing ? 'Scrolling. Pause to read at your own pace.' : 'Scrolling paused. You can also scroll manually.'}</p>
    </section>
  </div>;
}
