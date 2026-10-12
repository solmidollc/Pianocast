import { useEffect } from 'react';
import { midiEngine } from '../midi/engine';
import { useApp } from '../state/store';
import type { KeyContext, KeyName } from './types';

/**
 * Auto-set the configured key when the user plays a complete scale by itself.
 *
 * Trigger is strict:
 *   - monophonic (no chord at any point in the run)
 *   - strict stepwise motion (each new note is 1 or 2 semitones from the
 *     previous, never zero — repeats reset the buffer)
 *   - covers a full octave and lands back on the start note
 *
 * Recognised scales:
 *   - Ascending major / natural minor / harmonic minor — 8 notes, up only
 *   - Melodic minor — full round trip, 15 notes: raised 6/7 ascending,
 *     natural 6/7 descending
 *
 * Anything else — an out-of-pattern interval, a chord, a held sustain that
 * builds up a chord, or a melodic minor that only goes up — does not trigger.
 * Scalar fragments inside actual playing cannot accidentally re-base the key
 * because the buffer resets the moment two notes sound together or the
 * stepwise constraint breaks.
 *
 * The detector listens to the existing MIDI engine via snapshot diffs. It
 * adds no per-frame cost beyond what the engine already emits.
 */

const MAJOR              = [0, 2, 4, 5, 7, 9, 11, 12];
const NATURAL_MINOR_UP   = [0, 2, 3, 5, 7, 8, 10, 12];
const HARMONIC_MINOR_UP  = [0, 2, 3, 5, 7, 8, 11, 12];
const MELODIC_MINOR_UP   = [0, 2, 3, 5, 7, 9, 11, 12];
const NATURAL_MINOR_DOWN = [12, 10, 8, 7, 5, 3, 2, 0];

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function pcToKeyName(pc: number, mode: 'major' | 'minor'): KeyName {
  // Major: flat side for black keys (Db, Eb, Gb, Ab, Bb).
  // Minor: pick the conventional spelling for each pc that matches our
  //        KeyName type's enumerated set.
  const major: Record<number, KeyName> = {
    0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
    6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B',
  };
  const minor: Record<number, KeyName> = {
    0: 'C', 1: 'C#', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
    6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B',
  };
  return (mode === 'major' ? major : minor)[pc];
}

class ScaleDetector {
  private buffer: number[] = [];
  private prev = new Set<number>();

  ingest(activeMidis: number[]): KeyContext | null {
    const next = new Set(activeMidis);

    // Any chord — including the sustain-pedal-builds-a-chord case — resets
    // the buffer. Per spec, scale detection must never fire during chordal
    // playing.
    if (activeMidis.length > 1) {
      this.buffer = [];
      this.prev = next;
      return null;
    }

    let detection: KeyContext | null = null;
    if (activeMidis.length === 1) {
      const note = activeMidis[0];
      if (!this.prev.has(note)) {
        detection = this.addNote(note);
      }
    }
    this.prev = next;
    return detection;
  }

  private addNote(note: number): KeyContext | null {
    if (this.buffer.length > 0) {
      const last = this.buffer[this.buffer.length - 1];
      const diff = note - last;
      if (Math.abs(diff) > 2 || diff === 0) {
        // Non-stepwise (more than a whole step) or a repeated note. Begin a
        // fresh buffer rooted on this note — the prior run is broken and
        // could never form a scale.
        this.buffer = [note];
        return null;
      }
    }
    this.buffer.push(note);
    if (this.buffer.length > 30) this.buffer = this.buffer.slice(-30);
    return this.tryMatch();
  }

  private tryMatch(): KeyContext | null {
    // Round-trip melodic minor — most specific, longest, so check first.
    if (this.buffer.length >= 15) {
      const r = this.buffer.slice(-15);
      let upOk = true;
      for (let i = 1; i < 8; i++) if (r[i] <= r[i - 1]) { upOk = false; break; }
      let downOk = true;
      for (let i = 8; i < 15; i++) if (r[i] >= r[i - 1]) { downOk = false; break; }
      if (upOk && downOk && r[0] === r[14] && r[7] - r[0] === 12) {
        const upOffsets = r.slice(0, 8).map((n) => n - r[0]);
        const downOffsets = r.slice(7, 15).map((n) => n - r[0]);
        if (
          arraysEqual(upOffsets, MELODIC_MINOR_UP) &&
          arraysEqual(downOffsets, NATURAL_MINOR_DOWN)
        ) {
          const tonic = ((r[0] % 12) + 12) % 12;
          this.buffer = [];
          return { tonic: pcToKeyName(tonic, 'minor'), mode: 'minor' };
        }
      }
    }

    // Eight-note ascending — major / natural / harmonic minor.
    if (this.buffer.length >= 8) {
      const r = this.buffer.slice(-8);
      let ascending = true;
      for (let i = 1; i < 8; i++) if (r[i] <= r[i - 1]) { ascending = false; break; }
      if (ascending && r[7] - r[0] === 12) {
        const offsets = r.map((n) => n - r[0]);
        const tonic = ((r[0] % 12) + 12) % 12;
        if (arraysEqual(offsets, MAJOR)) {
          this.buffer = [];
          return { tonic: pcToKeyName(tonic, 'major'), mode: 'major' };
        }
        if (
          arraysEqual(offsets, NATURAL_MINOR_UP) ||
          arraysEqual(offsets, HARMONIC_MINOR_UP)
        ) {
          this.buffer = [];
          return { tonic: pcToKeyName(tonic, 'minor'), mode: 'minor' };
        }
        // Melodic minor up alone never triggers — per spec it requires the
        // round trip below.
      }
    }

    return null;
  }
}

/**
 * Mounts the scale detector at the top of the renderer tree. Subscribes to
 * the existing MIDI engine; on each snapshot transition it diffs the active
 * notes against the previous, processes any new monophonic note, and applies
 * the detected key to the store. Detector state is per-component-instance.
 */
export function useScaleDetector(): void {
  useEffect(() => {
    const detector = new ScaleDetector();
    const unsubscribe = midiEngine.subscribe(() => {
      const snap = midiEngine.getSnapshot();
      const detection = detector.ingest(snap.active.map((n) => n.midi));
      if (detection) useApp.getState().setKey(detection);
    });
    return () => {
      unsubscribe();
    };
  }, []);
}
