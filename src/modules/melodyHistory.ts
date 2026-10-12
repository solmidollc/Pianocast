import { useEffect, useRef, useState } from 'react';
import { midiEngine } from '../midi/engine';

export interface MelodyColumn { notes: number[]; timeStamp: number }

/** Bounded pages: a new onset replaces the full page, never overlays it. */
export function appendMelody(page: MelodyColumn[], events: MelodyColumn[], capacity: number): MelodyColumn[] {
  let next = page.slice(-capacity);
  for (const event of events) {
    const last = next[next.length - 1];
    const together = last && event.timeStamp >= last.timeStamp &&
      event.timeStamp - last.timeStamp <= 25 && !last.notes.includes(event.notes[0]);
    if (together) next[next.length - 1] = { ...last, notes: [...last.notes, ...event.notes].sort((a, b) => a - b) };
    else {
      if (next.length >= capacity) next = [];
      next.push(event);
    }
  }
  return next;
}

export function useMelody(capacity: number, resetToken: number, demoToken: number, idleSeconds = 3): MelodyColumn[] {
  const capacityRef = useRef(capacity);
  capacityRef.current = capacity;
  const [page, setPage] = useState<MelodyColumn[]>([]);
  useEffect(() => {
    setPage([]);
    let frame = 0;
    let pending: MelodyColumn[] = [];
    const unsubscribe = midiEngine.addRawListener((event) => {
      if (event.kind !== 'noteOn') return;
      pending.push({ notes: [event.midi], timeStamp: event.timeStamp });
      // Bound pending input while a background tab is not rendering.
      if (pending.length > 128) pending = pending.slice(-128);
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        const events = pending;
        pending = [];
        setPage((current) => appendMelody(current, events, capacityRef.current));
      });
    });
    return () => { unsubscribe(); cancelAnimationFrame(frame); };
  }, [resetToken]);
  useEffect(() => {
    if (!demoToken) return;
    const notes = [60, 62, 64, 65, 67, 69, 71, 72];
    setPage(notes.slice(-capacityRef.current).map((midi, index) => ({ notes: [midi], timeStamp: -10000 + index * 100 })));
  }, [demoToken]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updateCountdown = () => {
      // Only physically held keys pause clearing; pedal sustain is separate.
      const held = midiEngine.getSnapshot().active.some((note) => note.held);
      if (held) {
        clearTimeout(timer);
        timer = undefined;
      } else if (page.length && timer === undefined) {
        timer = setTimeout(() => setPage([]), Math.max(0.5, idleSeconds) * 1000);
      }
    };
    updateCountdown();
    const unsubscribe = midiEngine.subscribe(updateCountdown);
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [page, idleSeconds]);
  return page;
}
