import type { detectPitch } from './pitch';
export type PitchResult = ReturnType<typeof detectPitch>;
export interface PianoTemplate { midi: number; cents: number; spectrum: number[] }
export interface PianoProfile {
  version: 1; deviceId: string; name: string; created: number; sampleRate: number;
  noise: number; notes: PianoTemplate[];
  validation: { baseline: number; calibrated: number; frames: number } | null;
}
export function normalized(values: ArrayLike<number>): number[] {
  let sum = 0; for (let i = 0; i < values.length; i++) sum += values[i] ** 2;
  const length = Math.sqrt(sum) || 1;
  return Array.from(values, value => value / length);
}
/** Hann-windowed radix-2 FFT magnitude, evaluated only in the worker. */
export function fingerprint(samples: Float32Array): number[] {
  const size = samples.length, real = new Float64Array(size), imaginary = new Float64Array(size);
  let mean = 0; for (const value of samples) mean += value; mean /= size;
  for (let i = 0; i < size; i++) real[i] = (samples[i] - mean) * (.5 - .5 * Math.cos(2 * Math.PI * i / (size - 1)));
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let span = 2; span <= size; span *= 2) {
    for (let start = 0; start < size; start += span) {
      for (let j = 0; j < span / 2; j++) {
        const angle = -2 * Math.PI * j / span, cosine = Math.cos(angle), sine = Math.sin(angle);
        const left = start + j, right = left + span / 2;
        const re = real[right] * cosine - imaginary[right] * sine;
        const im = real[right] * sine + imaginary[right] * cosine;
        real[right] = real[left] - re; imaginary[right] = imaginary[left] - im;
        real[left] += re; imaginary[left] += im;
      }
    }
  }
  // Compress harmonics slightly so the fundamental is not the only feature.
  return normalized(Array.from({ length: size / 2 }, (_, i) => Math.sqrt(Math.hypot(real[i], imaginary[i]))));
}
export function applyProfile(base: PitchResult, spectrum: number[], profile: PianoProfile | null, sampleRate: number): PitchResult {
  if (!profile || profile.sampleRate !== sampleRate || base.midi === null) return base;
  if (base.midi < profile.notes[0].midi || base.midi > profile.notes[profile.notes.length - 1].midi) return base;
  if (base.rms < profile.noise * 3) return { ...base, midi: null, confidence: 0 };
  const pitch = base.midi + base.cents / 100;
  // Stay local to YIN's pitch: a limited profile must never fold an untrained
  // octave into the trained one. Outside this octave, use the original detector.
  const nearby = profile.notes.filter(note => Math.abs(note.midi + note.cents / 100 - pitch) < .7);
  if (!nearby.length) return base;
  const ranked = nearby.map(note => ({ note, score: spectrum.reduce((sum, value, i) => sum + value * (note.spectrum[i] ?? 0), 0) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best.score < .65) return { ...base, midi: null, confidence: 0 };
  if (best.score >= .9 && (ranked.length === 1 || best.score - ranked[1].score > .05)) {
    return { ...base, midi: best.note.midi, cents: Math.round((pitch - best.note.midi) * 100 - best.note.cents) };
  }
  return base;
}
export function validProfile(value: unknown, deviceId: string): value is PianoProfile {
  const p = value as PianoProfile | undefined;
  return !!p && p.version === 1 && p.deviceId === deviceId && typeof p.name === 'string' && p.name.length <= 80 && Number.isFinite(p.created)
    && Number.isFinite(p.sampleRate) && p.sampleRate >= 8000 && p.sampleRate <= 192000 && Number.isFinite(p.noise) && p.noise >= 0 && p.noise <= .03
    && Array.isArray(p.notes) && p.notes.length === 12 && [48, 60, 72].includes(p.notes[0]?.midi) && p.notes.every((n, i) => Number.isInteger(n.midi) && n.midi >= 48 && n.midi <= 83 && (!i || n.midi === p.notes[0].midi + i)
      && Number.isFinite(n.cents) && Math.abs(n.cents) <= 70 && Array.isArray(n.spectrum) && n.spectrum.length === 1024 && n.spectrum.every(v => Number.isFinite(v) && v >= 0 && v <= 1) && Math.abs(n.spectrum.reduce((sum, value) => sum + value * value, 0) - 1) < .01)
    && (p.validation === null || !!p.validation && ['baseline', 'calibrated', 'frames'].every(key => Number.isInteger(p.validation![key as keyof NonNullable<PianoProfile['validation']>]) && p.validation![key as keyof NonNullable<PianoProfile['validation']>] >= 0)
      && p.validation.frames > 0 && p.validation.baseline <= p.validation.frames && p.validation.calibrated <= p.validation.frames);
}
