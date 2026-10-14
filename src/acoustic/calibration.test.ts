import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./profileStorage', () => ({ loadProfile: vi.fn(async () => null), saveProfile: vi.fn(async () => {}) }));
import { Calibration, type AnalysisFrame } from './calibration';
import { fingerprint, applyProfile, validProfile, type PianoProfile } from './profile';
import { detectPitch } from './pitch';
import { loadProfile, saveProfile } from './profileStorage';
const rate = 16000;
const tone = (note: number, amplitude = .2, cents = 0) => Float32Array.from({ length: 2048 }, (_, i) => {
  const phase = 2 * Math.PI * 440 * 2 ** ((note - 69 + cents / 100) / 12) * i / rate;
  return amplitude * (Math.sin(phase) + .4 * Math.sin(phase * 2) + .2 * Math.sin(phase * 3));
});
function profile(): PianoProfile {
  return { version: 1, deviceId: 'mic', name: 'Test piano', created: 1, sampleRate: rate, noise: .001, validation: null,
    notes: Array.from({ length: 12 }, (_, i) => ({ midi: 60 + i, cents: 0, spectrum: fingerprint(tone(60 + i)) })) };
}
function frame(c: Calibration, note: number | null, calibrated = note): AnalysisFrame {
  const result = { midi: note, confidence: note === null ? 0 : .99, cents: 0, rms: note === null ? .001 : .1 };
  return { captureId: c.request().captureId, baseline: result, calibrated: { ...result, midi: calibrated }, sampleRate: rate, spectrum: note === null ? new Array(1024).fill(0) : fingerprint(tone(note)) };
}
let now = 100;
function collect(c: Calibration, note: number | null, calibrated = note) {
  c.capture(now);
  for (let i = 0; i < (note === null ? 34 : 17); i++) { now += 64; c.ingest(frame(c, note, calibrated), now); }
}
function learn(c: Calibration) { c.begin(); c.configure('My grand', 60); collect(c, null); for (let i = 0; i < 12; i++) collect(c, 60 + i); }
beforeEach(() => { vi.clearAllMocks(); now = 100; });
describe('piano fingerprints', () => {
  it('matches held-out amplitudes without changing correct chromatic notes', () => {
    const p = profile(); expect(validProfile(p, 'mic')).toBe(true);
    for (let note = 60; note < 72; note++) {
      const samples = tone(note, .08); const base = detectPitch(samples, rate);
      expect(applyProfile(base, fingerprint(samples), p, rate).midi).toBe(note);
    }
  });
  it('does not fold untrained octaves or use a different sample rate', () => {
    const p = profile();
    for (const note of [48, 59, 72, 84]) {
      const samples = tone(note); const base = detectPitch(samples, rate);
      expect(applyProfile(base, fingerprint(samples), p, rate)).toEqual(base);
    }
    const base = detectPitch(tone(60), rate);
    expect(applyProfile(base, [], p, 48000)).toEqual(base);
  });
  it('rejects a mismatched fingerprint and applies measured room noise gate', () => {
    const p = profile(), base = detectPitch(tone(60), rate);
    expect(applyProfile(base, fingerprint(tone(66)), p, rate).midi).toBeNull();
    expect(applyProfile({ ...base, rms: .002 }, fingerprint(tone(60)), p, rate).midi).toBeNull();
  });
  it('rejects corrupt and mismatched stored profiles', () => {
    const p = profile(); expect(validProfile(p, 'different mic')).toBe(false);
    expect(validProfile({ ...p, notes: [] }, 'mic')).toBe(false);
    p.notes[0].spectrum[0] = NaN; expect(validProfile(p, 'mic')).toBe(false);
  });
});
describe('guided calibration', () => {
  it('records noise and twelve notes, then compares independent recordings without training on them', async () => {
    const c = new Calibration(); await c.connect('mic'); learn(c);
    expect(c.getSnapshot().step).toBe('check');
    const templates = JSON.stringify(c.getSnapshot().draft!.notes);
    for (let i = 0; i < 6; i++) collect(c, c.target());
    expect(c.getSnapshot().step).toBe('review');
    expect(JSON.stringify(c.getSnapshot().draft!.notes)).toBe(templates);
    const scores = c.getSnapshot().draft!.validation!;
    expect(scores.baseline).toBe(scores.frames); expect(scores.calibrated).toBe(scores.frames);
    await c.save(); expect(saveProfile).toHaveBeenCalledOnce();
    expect(c.getSnapshot().profile?.notes).toHaveLength(12); expect(c.getSnapshot().enabled).toBe(false);
    c.enable(true); expect(c.analysisProfile()?.name).toBe('My grand');
  });
  it('records worse results honestly and leaves profile off after save', async () => {
    const c = new Calibration(); await c.connect('mic'); learn(c);
    for (let i = 0; i < 6; i++) collect(c, c.target(), null);
    const scores = c.getSnapshot().draft!.validation!;
    expect(scores.calibrated).toBe(0); expect(scores.baseline).toBe(scores.frames);
    await c.save(); expect(c.getSnapshot().enabled).toBe(false);
  });
  it('rejects the wrong note, stale captures and timeouts, and preserves an existing profile on cancel', async () => {
    const c = new Calibration(); await c.connect('mic'); learn(c); for (let i = 0; i < 6; i++) collect(c, c.target()); await c.save();
    const saved = c.getSnapshot().profile;
    c.begin(); collect(c, null); c.capture(now); const stale = frame(c, 60);
    now += 64; c.ingest(frame(c, 65), now);
    expect(c.getSnapshot().index).toBe(0); expect(c.getSnapshot().message).toContain('Please play C4');
    c.tick(now + 9000); expect(c.getSnapshot().recording).toBe(false);
    c.capture(now + 10000); c.ingest(stale, now + 11000); expect(c.getSnapshot().progress).toBe(0);
    c.cancel(); expect(c.getSnapshot().profile).toBe(saved); expect(c.getSnapshot().draft).toBeNull();
  });
  it('does not load the previous microphone profile after switching devices', async () => {
    let resolve!: (value: PianoProfile | null) => void;
    vi.mocked(loadProfile).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const c = new Calibration(); const first = c.connect('mic'); await c.connect('other'); resolve(profile()); await first;
    expect(c.getSnapshot().deviceId).toBe('other'); expect(c.getSnapshot().profile).toBeNull();
  });
  it('reports storage failure and keeps the finished profile available in memory', async () => {
    vi.mocked(saveProfile).mockRejectedValueOnce(new Error('Quota exceeded'));
    const c = new Calibration(); await c.connect('mic'); learn(c); for (let i = 0; i < 6; i++) collect(c, c.target()); await c.save();
    expect(c.getSnapshot().profile).not.toBeNull(); expect(c.getSnapshot().storage).toContain('session only');
  });
});
