import { detectPitch } from './pitch';
import { applyProfile, fingerprint, type PianoProfile } from './profile';
let profile: PianoProfile | null = null;
self.onmessage = (e: MessageEvent) => {
  if (e.data.type === 'profile') { profile = e.data.profile; return; }
  const { samples, sampleRate, low, high, gate, capture, captureId, useProfile } = e.data;
  const baseline = detectPitch(samples, sampleRate, low, high, gate);
  const spectrum = capture || profile ? fingerprint(samples) : undefined;
  const calibrated = spectrum ? applyProfile(baseline, spectrum, profile, sampleRate) : baseline;
  self.postMessage({ ...(useProfile ? calibrated : baseline), baseline, calibrated, sampleRate, captureId, ...(capture ? { spectrum } : {}) });
};
