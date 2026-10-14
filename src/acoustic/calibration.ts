import { normalized, type PianoProfile, type PitchResult } from './profile';
import { loadProfile, saveProfile } from './profileStorage';
export const nameOfNote = (midi: number) => `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
const CHECK_ORDER = [7, 0, 4, 1, 9, 2];
type Step = 'idle' | 'prepare' | 'noise' | 'notes' | 'check' | 'review';
interface State {
  step: Step; recording: boolean; progress: number; index: number; base: number; name: string; message: string;
  profile: PianoProfile | null; draft: PianoProfile | null; enabled: boolean; storage: string; deviceId: string;
}
export interface AnalysisFrame { baseline: PitchResult; calibrated: PitchResult; spectrum?: number[]; sampleRate: number; captureId: number }
export class Calibration {
  private state: State = { step: 'idle', recording: false, progress: 0, index: 0, base: 60, name: 'My piano', message: '', profile: null, draft: null, enabled: false, storage: '', deviceId: '' };
  private listeners = new Set<() => void>();
  private loadId = 0;
  private captureId = 0;
  private started = 0;
  private onset = 0;
  private frames: AnalysisFrame[] = [];
  private noise = 0;
  private notes: PianoProfile['notes'] = [];
  private scores = { baseline: 0, calibrated: 0, frames: 0 };
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  async connect(deviceId: string) {
    const id = ++this.loadId;
    this.cancel(); this.publish({ deviceId, profile: null, enabled: false, storage: '' });
    if (!deviceId) { this.publish({ storage: 'Microphone identity unavailable. Profiles can be used for this session only.' }); return; }
    try { const profile = await loadProfile(deviceId); if (id === this.loadId) this.publish({ profile }); }
    catch { if (id === this.loadId) this.publish({ storage: 'Profiles can be used for this session, but could not be loaded from this device.' }); }
  }
  disconnect() { ++this.loadId; this.cancel(); this.publish({ enabled: false }); }
  enable(enabled: boolean) { this.publish({ enabled: enabled && !!this.state.profile }); }
  begin() { this.notes = []; this.noise = 0; this.scores = { baseline: 0, calibrated: 0, frames: 0 }; this.publish({ step: 'prepare', draft: null, index: 0, message: '', recording: false }); }
  configure(name: string, base: number) { if (this.state.step === 'prepare') this.publish({ name: name.trim().slice(0, 80) || 'My piano', base: [48, 60, 72].includes(base) ? base : 60 }); }
  target() { return this.state.base + (this.state.step === 'check' ? CHECK_ORDER[this.state.index] : this.state.index); }
  request() { return { captureId: this.captureId, capture: this.state.recording && (this.state.step === 'noise' || this.state.step === 'notes') }; }
  analysisProfile() { return this.state.step === 'check' ? this.state.draft : this.state.step === 'idle' && this.state.enabled ? this.state.profile : null; }
  capture(now = performance.now()) {
    if (!['prepare', 'noise', 'notes', 'check'].includes(this.state.step) || this.state.recording) return;
    this.captureId++; this.frames = []; this.onset = 0; this.started = now;
    this.publish({ step: this.state.step === 'prepare' ? 'noise' : this.state.step, recording: true, progress: 0, message: '' });
  }
  cancel() { this.captureId++; this.frames = []; this.publish({ step: 'idle', recording: false, draft: null, message: '', progress: 0 }); }
  tick(now = performance.now()) {
    if (this.state.recording && now - this.started > 8000) {
      this.captureId++; this.frames = [];
      this.publish({ recording: false, progress: 0, message: this.state.step === 'noise' ? 'Room check interrupted. Check the microphone and retry.' : 'No usable recording. Play the highlighted note clearly, without the pedal, then retry.' });
    }
  }
  ingest(frame: AnalysisFrame, now = performance.now()) {
    if (!this.state.recording || frame.captureId !== this.captureId) return;
    const { step } = this.state;
    if (step === 'noise') {
      if (!frame.spectrum) return;
      this.frames.push(frame);
      this.publish({ progress: Math.min(1, (now - this.started) / 2000) });
      if (now - this.started < 2000 || this.frames.length < 10) return;
      this.noise = Math.sqrt(this.frames.reduce((sum, f) => sum + f.baseline.rms ** 2, 0) / this.frames.length);
      if (this.noise > .03) { this.publish({ recording: false, message: 'The room is too loud. Reduce background sound and retry the room check.' }); return; }
      this.publish({ recording: false, step: 'notes', index: 0, progress: 0 }); return;
    }
    const pitch = frame.baseline.midi === null ? null : frame.baseline.midi + frame.baseline.cents / 100;
    const voiced = frame.baseline.rms >= Math.max(this.noise * 3, .001) && pitch !== null && frame.baseline.confidence >= .88;
    if (!voiced || step === 'notes' && Math.abs(pitch! - this.target()) > .7) {
      if (step === 'notes') { this.frames = []; this.onset = 0; }
      this.publish({ progress: 0, message: pitch !== null && step === 'notes' ? `Heard ${nameOfNote(frame.baseline.midi!)}. Please play ${nameOfNote(this.target())}.` : '' });
      this.tick(now); return;
    }
    if (!this.onset) this.onset = now;
    this.frames.push(frame);
    this.publish({ progress: Math.min(1, (now - this.onset) / 900), message: '' });
    if (now - this.onset < 900 || this.frames.length < 8) return;
    if (step === 'notes') {
      const usable = this.frames.filter(f => f.spectrum?.length === 1024);
      if (usable.length < 8) return;
      const spectrum = normalized(Array.from({ length: 1024 }, (_, i) => usable.reduce((sum, f) => sum + f.spectrum![i], 0) / usable.length));
      const consistent = usable.filter(f => f.spectrum!.reduce((sum, value, i) => sum + value * spectrum[i], 0) >= .85).length;
      if (consistent < usable.length * .8) {
        this.frames = []; this.publish({ recording: false, progress: 0, message: 'The sound changed too much. Keep the room quiet and record just this note again.' }); return;
      }
      const tuning = usable.map(f => (f.baseline.midi! - this.target()) * 100 + f.baseline.cents).sort((a, b) => a - b);
      this.notes[this.state.index] = { midi: this.target(), cents: tuning[Math.floor(tuning.length / 2)], spectrum };
      if (this.state.index < 11) this.publish({ index: this.state.index + 1, recording: false, progress: 0 });
      else {
        const draft: PianoProfile = { version: 1, deviceId: this.state.deviceId, name: this.state.name, created: Date.now(), sampleRate: frame.sampleRate, noise: this.noise, notes: [...this.notes], validation: null };
        this.publish({ draft, step: 'check', index: 0, recording: false, progress: 0 });
      }
    } else if (step === 'check') {
      const target = this.target();
      this.scores.baseline += this.frames.filter(f => f.baseline.midi === target).length;
      this.scores.calibrated += this.frames.filter(f => f.calibrated.midi === target).length;
      this.scores.frames += this.frames.length;
      if (this.state.index < CHECK_ORDER.length - 1) this.publish({ index: this.state.index + 1, recording: false, progress: 0 });
      else this.publish({ draft: { ...this.state.draft!, validation: { ...this.scores } }, step: 'review', recording: false, progress: 0 });
    }
    this.frames = [];
  }
  async save() {
    const profile = this.state.draft;
    if (this.state.step !== 'review' || !profile) return;
    // Opt-in even if a profile scores better; never silently change detection.
    this.publish({ profile, enabled: false, storage: 'Saving…' });
    try {
      if (!profile.deviceId) throw new Error('No microphone identity');
      await saveProfile(profile);
      if (this.state.profile === profile) this.publish({ storage: 'Saved on this device for this microphone.' });
    } catch { if (this.state.profile === profile) this.publish({ storage: 'Available for this session only. The profile could not be saved on this device.' }); }
    if (this.state.draft === profile) this.cancel();
  }
}
export const calibration = new Calibration();
