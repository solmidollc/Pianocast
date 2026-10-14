/** In-place radix-2 transform; inverse normalizes its output. Worker only. */
function fft(real: Float64Array, imaginary: Float64Array, inverse = false) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
  }
  for (let span = 2; span <= size; span *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / span;
    const stepRe = Math.cos(angle), stepIm = Math.sin(angle);
    for (let start = 0; start < size; start += span) {
      let wr = 1, wi = 0;
      for (let j = 0; j < span / 2; j++) {
        const left = start + j, right = left + span / 2;
        const re = real[right] * wr - imaginary[right] * wi, im = real[right] * wi + imaginary[right] * wr;
        real[right] = real[left] - re; imaginary[right] = imaginary[left] - im;
        real[left] += re; imaginary[left] += im;
        const next = wr * stepRe - wi * stepIm; wi = wr * stepIm + wi * stepRe; wr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < size; i++) { real[i] /= size; imaginary[i] /= size; }
}

/** FFT-accelerated YIN: enough periods for A0 without quadratic work on the UI. */
export function detectPitch(samples: Float32Array, sampleRate: number, low = 21, high = 108, gate = .004) {
  const length = samples.length;
  const empty = { midi: null as number | null, cents: 0, confidence: 0, rms: 0 };
  if (length < 32 || !Number.isFinite(sampleRate) || sampleRate < 8000) return empty;
  let mean = 0; for (const x of samples) mean += x; mean /= length;
  let size = 1; while (size < length * 2) size *= 2;
  const real = new Float64Array(size), imaginary = new Float64Array(size), energy = new Float64Array(length + 1);
  for (let i = 0; i < length; i++) { real[i] = samples[i] - mean; energy[i + 1] = energy[i] + real[i] ** 2; }
  const rms = Math.sqrt(energy[length] / length); empty.rms = rms;
  if (!Number.isFinite(rms) || rms < gate) return empty;
  fft(real, imaginary);
  for (let i = 0; i < size; i++) { real[i] = real[i] ** 2 + imaginary[i] ** 2; imaginary[i] = 0; }
  fft(real, imaginary, true);
  const max = Math.min(Math.floor(length / 2) - 2, Math.ceil(sampleRate / (440 * 2 ** ((low - .5 - 69) / 12))));
  const difference = new Float64Array(max + 2);
  let total = 0;
  for (let lag = 1; lag <= max + 1; lag++) {
    const value = Math.max(0, (energy[length - lag] + energy[length] - energy[lag] - 2 * real[lag]) / (length - lag));
    total += value; difference[lag] = total ? value * lag / total : 1;
  }
  // Search from the shortest resolvable period, even for a restricted range.
  // Skipping the first period can fold an out-of-range note into a lower octave.
  for (let lag = 2; lag < max; lag++) {
    if (difference[lag] > difference[lag - 1] || difference[lag] > difference[lag + 1]) continue;
    const a = difference[lag - 1], b = difference[lag], c = difference[lag + 1];
    const denominator = 2 * (2 * b - a - c);
    const offset = denominator ? (c - a) / denominator : 0;
    // Upper piano notes have fractional periods (C8 is ~11.5 samples at
    // 48 kHz). Test the interpolated trough, not just integer sample lags,
    // or bright high notes can incorrectly fall to a lower octave.
    const minimum = Math.max(0, b + (c - a) * offset / 4);
    if (b > .4 || minimum >= .15) continue;
    const period = lag + offset;
    const pitch = 69 + 12 * Math.log2(sampleRate / period / 440);
    const midi = Math.round(pitch);
    if (midi < low || midi > high || !Number.isFinite(pitch)) return empty;
    return { midi, cents: Math.round((pitch - midi) * 100), confidence: Math.min(1, 1 - minimum), rms };
  }
  return empty;
}

/** A short window follows upper notes quickly; bass retains a longer window. */
export function detectPianoNote(samples: Float32Array, sampleRate: number, gate = .004) {
  const full = detectPitch(samples, sampleRate, 21, 108, gate);
  if (full.midi === null || full.midi >= 48) {
    const shortLength = 2 ** Math.ceil(Math.log2(sampleRate * .043));
    if (samples.length > shortLength) {
      const recent = detectPitch(samples.subarray(samples.length - shortLength), sampleRate, 48, 108, gate);
      if (recent.midi !== null && recent.confidence >= .9) return recent;
    }
  }
  return full;
}

/** Reject transient candidates and release uncertain notes without chatter. */
export class NoteTracker {
  private candidate: number | null = null;
  private count = 0;
  private lastGood = 0;
  private current: number | null = null;
  update(note: number | null, now: number) {
    if (note !== null) {
      this.lastGood = now;
      this.count = note === this.candidate ? this.count + 1 : 1;
      this.candidate = note;
      if (this.count >= 2) this.current = note;
    } else {
      this.candidate = null; this.count = 0;
      if (now - this.lastGood >= 180) this.current = null;
    }
    return this.current;
  }
}
