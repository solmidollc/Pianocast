import { describe, expect, it } from 'vitest';
import { detectPitch, NoteTracker } from './pitch';
import { ACOUSTIC_INPUT_ID, MidiEngine } from '../midi/engine';
const rate = 16000;
const tone = (midi: number, cents = 0) => Float32Array.from({ length: 2048 }, (_, i) => {
  const phase = 2 * Math.PI * 440 * 2 ** ((midi - 69 + cents / 100) / 12) * i / rate;
  return .2 * Math.sin(phase) + .12 * Math.sin(phase * 2) + .06 * Math.sin(phase * 3);
});
describe('experimental acoustic pitch', () => {
  it('recognizes all semitones in the advertised range with piano harmonics', () => {
    for (let note = 36; note <= 96; note++) {
      const result = detectPitch(tone(note), rate);
      expect(result.midi, `MIDI ${note}`).toBe(note);
      expect(Math.abs(result.cents)).toBeLessThan(25);
    }
  });
  it('retains note identity with tuning offsets', () => {
    for (const cents of [-20, 20]) {
      const result = detectPitch(tone(69, cents), rate);
      expect(result.midi).toBe(69); expect(Math.abs(result.cents - cents)).toBeLessThan(4);
    }
  });
  it('rejects silence, DC, noise, quiet signals and excluded notes', () => {
    expect(detectPitch(new Float32Array(2048), rate).midi).toBeNull();
    expect(detectPitch(new Float32Array(2048).fill(.5), rate).midi).toBeNull();
    let seed = 42;
    const noise = Float32Array.from({ length: 2048 }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - .5; });
    expect(detectPitch(noise, rate).midi).toBeNull();
    expect(detectPitch(tone(60).map(x => x / 1000), rate).midi).toBeNull();
    expect(detectPitch(tone(40), rate, 48, 84).midi).toBeNull();
  });
  it('confirms attacks, rejects transients and releases on silence', () => {
    const t = new NoteTracker();
    expect(t.update(60, 0)).toBeNull(); expect(t.update(60, 64)).toBe(60);
    expect(t.update(72, 128)).toBe(60); expect(t.update(null, 192)).toBe(60);
    expect(t.update(null, 320)).toBeNull();
    expect(t.update(65, 384)).toBeNull(); expect(t.update(65, 448)).toBe(65);
  });
});
describe('acoustic visual note routing', () => {
  it('clears old hardware notes and sustain on switching, tags acoustic events and never stacks notes', () => {
    const engine = new MidiEngine(); const events: any[] = []; engine.addRawListener(e => events.push(e));
    engine.injectNoteOn(48); engine.injectSustain(true); engine.selectInput(ACOUSTIC_INPUT_ID);
    expect(engine.getSnapshot().active).toEqual([]); expect(engine.getSnapshot().sustain).toBe(false);
    engine.setAcousticNote(60); engine.setAcousticNote(64);
    expect(engine.getSnapshot().active.map(n => n.midi)).toEqual([64]);
    expect(events.slice(-3).map(e => [e.kind, e.source])).toEqual([['noteOn', 'acoustic'], ['noteOff', 'acoustic'], ['noteOn', 'acoustic']]);
    engine.selectInput(null); engine.setAcousticNote(67);
    expect(engine.getSnapshot().active).toEqual([]); expect(engine.getInputId()).toBeNull();
  });
});
