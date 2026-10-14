import { detectPitch } from './pitch';
self.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number; low: number; high: number; gate: number }>) => {
  const { samples, sampleRate, low, high, gate } = e.data;
  self.postMessage(detectPitch(samples, sampleRate, low, high, gate));
};
