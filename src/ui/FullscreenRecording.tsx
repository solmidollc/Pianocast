import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { recorder } from '../recording/recorder';
import { audioInput } from '../audio/audioInput';

export function FullscreenRecording() {
  const s = useSyncExternalStore(cb => recorder.subscribe(cb), () => recorder.getSnapshot());
  const [level, setLevel] = useState(0);
  const [silent, setSilent] = useState(false);
  const heard = useRef(false);
  const active = s.status === 'recording' || s.status === 'paused';
  useEffect(() => {
    heard.current = false;
    setSilent(false);
    const poll = () => {
      const current = recorder.getSnapshot();
      const peak = current.status === 'recording' ? recorder.getAudioLevel() : audioInput.peekOutputLevel();
      setLevel(peak);
      if (current.status === 'recording') {
        if (peak >= 0.001) { heard.current = true; setSilent(false); }
        if (current.elapsedMs >= 5000 && !heard.current) setSilent(true);
      }
    };
    poll();
    const timer = window.setInterval(poll, 50);
    return () => clearInterval(timer);
  }, [active]);
  const seconds = Math.floor(s.elapsedMs / 1000);
  const duration = Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + (seconds % 60).toString().padStart(2, '0');
  return <div className="absolute bottom-6 inset-x-0 z-50 flex flex-col items-center gap-3 pointer-events-none">
    {silent && s.status==='recording' && <p role="alert" className="rounded-lg bg-black/85 px-4 py-2 text-sm text-amber-300">No audio is being recorded. Check your audio input.</p>}
    {s.error && <p role="alert" className="rounded-lg bg-black/85 px-4 py-2 text-sm text-rose-300">{s.error}</p>}
    <div className="pointer-events-auto flex items-center gap-4 rounded-full bg-black/85 border border-white/10 px-5 py-3">
      <button type="button" disabled={s.status === 'starting' || s.status === 'stopping'}
        onClick={() => active ? recorder.stop() : recorder.start()}
        className={`rounded-full px-5 py-2 text-sm font-medium ${active ? 'bg-rose-600' : 'bg-accent'} text-white`}>
        {active ? 'Stop' : s.status === 'starting' ? 'Starting…' : s.status === 'stopping' ? 'Saving…' : 'Record'}
      </button>
      {active&&<button type="button" aria-label={s.status==='paused'?'Resume recording':'Pause recording'} className="text-sm text-white" onClick={()=>s.status==='paused'?recorder.resume():recorder.pause()}>{s.status==='paused'?'Resume':'Pause'}</button>}
      {s.status==='paused'&&<span role="status" className="text-xs text-white">Paused</span>}
      <span aria-label="Recording duration" className="font-mono tabular-nums text-sm text-white">{duration}</span>
      <div role="meter" aria-label="Recorded audio level" aria-valuemin={-60} aria-valuemax={0}
        aria-valuenow={Math.round(Math.max(-60, 20 * Math.log10(Math.max(level, 0.000001))))}
        className="w-28 h-2 bg-white/15 rounded-full overflow-hidden" title="Audio level">
        <div className={level >= 0.98 ? 'h-full bg-rose-400' : 'h-full bg-emerald-400'}
          style={{ width: Math.max(0, (60 + 20 * Math.log10(Math.max(level, 0.001))) / 60 * 100) + '%' }} />
      </div>
    </div>
  </div>;
}

