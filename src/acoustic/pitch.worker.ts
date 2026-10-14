import { detectPianoNote } from './pitch';
self.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number; gate: number }>) => {
  const { samples, sampleRate, gate } = e.data;
  self.postMessage(detectPianoNote(samples, sampleRate, gate));
};
