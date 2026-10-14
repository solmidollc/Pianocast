import { ACOUSTIC_INPUT_ID, midiEngine } from '../midi/engine';
import { NoteTracker } from './pitch';
import captureUrl from './capture.worklet.js?url';

type Snapshot = { status: 'idle' | 'opening' | 'listening' | 'error'; error: string; rms: number; midi: number | null; cents: number };
class AcousticInput {
  private snapshot: Snapshot = { status: 'idle', error: '', rms: 0, midi: null, cents: 0 };
  private listeners = new Set<() => void>();
  private generation = 0;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private capture: AudioWorkletNode | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  low = 36; high = 96; gate = .004;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  private publish(patch: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  stop() {
    this.generation++;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.worker?.terminate(); this.worker = null;
    this.capture?.disconnect(); this.capture = null;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    void this.context?.close().catch(() => {}); this.context = null;
    midiEngine.setAcousticNote(null);
    this.publish({ status: 'idle', rms: 0, midi: null, cents: 0, error: '' });
  }
  async start(deviceId: string) {
    this.stop();
    const generation = this.generation;
    this.publish({ status: 'opening' });
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('This browser does not support Acoustic Piano input. Try a recent Chrome, Edge, or Safari.');
      // Resume during the user gesture, before the permission prompt completes.
      const context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      this.context = context;
      await context.resume();
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      } });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      stream.getAudioTracks().forEach(t => { t.onended = () => { if (generation === this.generation) this.fail('Microphone disconnected. Choose a microphone and start again.'); }; });
      await context.audioWorklet.addModule(captureUrl);
      if (generation !== this.generation) return;
      const worker = new Worker(new URL('./pitch.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      const capture = new AudioWorkletNode(context, 'piano-capture'); this.capture = capture;
      const tracker = new NoteTracker();
      let lastResult = performance.now(), lastPublish = 0, sent = 0;
      let previousRms = 0, lastAttack = 0;
      capture.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (generation !== this.generation) return;
        sent = performance.now();
        worker.postMessage({ samples: e.data, sampleRate: context.sampleRate, low: this.low, high: this.high, gate: this.gate }, [e.data.buffer]);
      };
      worker.onmessage = (e: MessageEvent<{ midi: number | null; rms: number; cents: number; confidence: number }>) => {
        if (generation !== this.generation) return;
        const now = performance.now(); lastResult = now;
        // Never present analysis that was delayed by a busy/backgrounded page.
        const result = now - sent < 300 && context.state === 'running' ? e.data : { midi: null, rms: 0, cents: 0, confidence: 0 };
        const note = tracker.update(result.confidence >= .88 ? result.midi : null, now);
        const repeatAttack = note !== null && note === this.snapshot.midi && result.midi === note && result.rms > Math.max(this.gate * 3, previousRms * 2.2) && now - lastAttack > 250;
        if (note !== this.snapshot.midi || repeatAttack) lastAttack = now;
        midiEngine.setAcousticNote(note, 90, repeatAttack);
        previousRms = result.rms;
        if (now - lastPublish >= 100 || note !== this.snapshot.midi) {
          lastPublish = now; this.publish({ midi: note, rms: result.rms, cents: result.cents });
        }
        capture.port.postMessage('ready');
      };
      worker.onerror = () => { if (generation === this.generation) this.fail('Note detection stopped. Please start listening again.'); };
      capture.onprocessorerror = () => { if (generation === this.generation) this.fail('Microphone processing stopped. Please start listening again.'); };
      // The processor emits silence; connection keeps capture active without monitoring.
      context.createMediaStreamSource(stream).connect(capture); capture.connect(context.destination);
      this.watchdog = setInterval(() => {
        if (midiEngine.getInputId() !== ACOUSTIC_INPUT_ID) { this.stop(); return; }
        if (context.state !== 'running' || performance.now() - lastResult > 500) {
          midiEngine.setAcousticNote(null); this.publish({ midi: null, rms: 0 });
        }
      }, 200);
      this.publish({ status: 'listening' });
    } catch (error) {
      if (generation !== this.generation) return;
      const name = error instanceof DOMException ? error.name : '';
      this.fail(name === 'NotAllowedError' ? 'Microphone access was blocked. Allow microphone access in your browser, then try again.' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'Microphone unavailable. Choose another device and try again.' : error instanceof Error ? error.message : 'Could not start microphone input.');
    }
  }
  private fail(error: string) { this.stop(); this.publish({ status: 'error', error }); }
}
export const acousticInput = new AcousticInput();
