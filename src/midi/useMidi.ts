import { useEffect, useState } from 'react';
import { midiEngine } from './engine';
import type { MidiEngineSnapshot } from './types';

/**
 * Subscribe to the MIDI engine with rAF coalescing.
 *
 * Every MIDI event sets a dirty flag on the engine. We re-read once per frame
 * to drive React updates, so a burst of events (a fast scale, a 10-note chord)
 * triggers a single render rather than ten. This is the key to maintaining
 * 60fps under dense playing.
 */
const EMPTY:MidiEngineSnapshot={active:[],sustain:false,inputId:null};
export function useMidi(enabled=true): MidiEngineSnapshot {
  const [snap, setSnap] = useState<MidiEngineSnapshot>(() => enabled?midiEngine.getSnapshot():EMPTY);
  useEffect(() => {
    if(!enabled)return;
    let raf = 0;
    let pending = false;
    const flush = () => {
      pending = false;
      setSnap(midiEngine.getSnapshot());
    };
    const sub = midiEngine.subscribe(() => {
      if (pending) return;
      pending = true;
      raf = requestAnimationFrame(flush);
    });
    return () => {
      sub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return snap;
}

