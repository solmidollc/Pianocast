import { describe, expect, it } from 'vitest';
import { detectPitch, detectPianoNote, NoteTracker } from './pitch';
import { ACOUSTIC_INPUT_ID, MidiEngine } from '../midi/engine';
const rate = 48000;
const tone = (midi: number, cents = 0) => Float32Array.from({ length: 8192 }, (_, i) => {
  const phase = 2 * Math.PI * 440 * 2 ** ((midi - 69 + cents / 100) / 12) * i / rate;
  return .2 * Math.sin(phase) + .12 * Math.sin(phase * 2) + .06 * Math.sin(phase * 3);
});
describe('experimental acoustic pitch', () => {
  it('recognizes all semitones in the advertised range with piano harmonics', () => {
    for (let note = 21; note <= 108; note++) {
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
    const noise = Float32Array.from({ length: 8192 }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - .5; });
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

describe('full piano range across sound variations', () => {
  const voices = [
    { name: 'soft', partials: [1, .15, .05], stretch: 0 },
    { name: 'bright', partials: [1, .7, .4, .2, .1], stretch: .0001 },
    { name: 'missing fundamental', partials: [0, 1, .6, .3], stretch: .00005 },
    { name: 'weak fundamental', partials: [.15, 1, .6, .3, .15], stretch: .00005 },
    { name: 'stretched strings', partials: [1, .4, .2, .1], stretch: .0005 },
  ];
  function piano(note: number, rate: number, partials: number[], stretch: number, cents = 0) {
    const size = 2 ** Math.ceil(Math.log2(rate * .17));
    const frequency = 440 * 2 ** ((note - 69 + cents / 100) / 12);
    return Float32Array.from({ length: size }, (_, i) => {
      const time = i / rate;
      return partials.reduce((sum, amplitude, index) => {
        const n = index + 1, f = frequency * n * Math.sqrt((1 + stretch * n * n) / (1 + stretch));
        return f < rate / 2 ? sum + .12 * amplitude * Math.exp(-time * n * 2) * Math.sin(2 * Math.PI * f * time + index * .23) : sum;
      }, 0);
    });
  }
  for (const voice of voices) it(`recognizes all 88 notes with ${voice.name} harmonics`, () => {
    const failures: string[] = [];
    for (let note = 21; note <= 108; note++) {
      const result = detectPianoNote(piano(note, rate, voice.partials, voice.stretch), rate);
      if (result.midi !== note || result.confidence < .85) failures.push(`${note} -> ${result.midi} (${result.confidence.toFixed(2)})`);
    }
    expect(failures).toEqual([]);
  });
  it('keeps note identity with moderate background noise and rejects noise alone', () => {
    let seed = 7;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - .5; };
    for (const note of [21, 24, 36, 48, 60, 72, 84, 96, 108]) {
      const samples = piano(note, rate, [1,.4,.15], .0001).map(value => value + random() * .008);
      expect(detectPianoNote(samples, rate).midi, `noisy MIDI ${note}`).toBe(note);
    }
    for (let i = 0; i < 4; i++) expect(detectPianoNote(Float32Array.from({ length: 8192 }, () => random() * .2), rate).midi).toBeNull();
  });
  it('follows new upper notes using recent audio rather than the entire bass window', () => {
    const first = piano(60, rate, [1,.4,.15], 0), next = piano(76, rate, [1,.4,.15], 0);
    first.set(next.subarray(next.length - 4096), first.length - 4096);
    expect(detectPianoNote(first, rate).midi).toBe(76);
  });
  it('covers A0–C8 with tuning offsets and common device sample rates', () => {
    const failures: string[] = [];
    for (const sampleRate of [44100, 48000, 96000]) for (const cents of [-30, 30]) for (const note of [21,22,33,48,60,84,96,107,108]) {
      const result = detectPianoNote(piano(note, sampleRate, [1,.4,.15], .0001, cents), sampleRate);
      if (result.midi !== note || result.confidence < .85) failures.push(`${note}@${sampleRate}/${cents} -> ${result.midi}`);
    }
    expect(failures).toEqual([]);
  });
});
