/** YIN pitch estimation. Only called in the analysis worker. */
export function detectPitch(samples: Float32Array, sampleRate: number, low = 36, high = 96, gate = .004) {
  let mean = 0; for (const x of samples) mean += x;
  mean /= samples.length;
  let energy = 0; for (const x of samples) energy += (x - mean) ** 2;
  const rms = Math.sqrt(energy / samples.length);
  const empty = { midi: null as number | null, cents: 0, confidence: 0, rms };
  if (!Number.isFinite(rms) || rms < gate) return empty;
  const min = Math.max(2, Math.floor(sampleRate / (440 * 2 ** ((high + .5 - 69) / 12))));
  const max = Math.min(Math.floor(samples.length / 2) - 1, Math.ceil(sampleRate / (440 * 2 ** ((low - .5 - 69) / 12))));
  const d = new Float32Array(max + 2);
  const count = samples.length - max - 1;
  let total = 0;
  for (let lag = 1; lag <= max + 1; lag++) {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += (samples[i] - samples[i + lag]) ** 2;
    total += sum;
    d[lag] = total > 0 ? sum * lag / total : 1;
  }
  for (let lag = min; lag < max; lag++) {
    if (d[lag] >= .12) continue;
    while (lag < max && d[lag + 1] < d[lag]) lag++;
    const denominator = 2 * (2 * d[lag] - d[lag - 1] - d[lag + 1]);
    const period = lag + (denominator ? (d[lag + 1] - d[lag - 1]) / denominator : 0);
    const pitch = 69 + 12 * Math.log2(sampleRate / period / 440);
    const midi = Math.round(pitch);
    if (midi < low || midi > high) return empty;
    return { midi, cents: Math.round((pitch - midi) * 100), confidence: 1 - d[lag], rms };
  }
  return empty;
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
