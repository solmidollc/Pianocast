/**
 * Audio input subsystem — plain microphone capture.
 *
 *   getUserMedia → MediaStreamSource → outputGain → outputAnalyser ─┬─► programDest  (Recorder tap)
 *                                                                    └─► monitorGain → ctx.destination (local monitor)
 *
 * Design: raw mic in, one level knob, one meter, one monitor toggle. No
 * noise gate, no noise suppression, no echo cancellation, no highpass —
 * whatever hits the mic is what reaches the recording. The previous
 * design's gate was clipping intermittent audio out of the saved file,
 * which was the opposite of what a "plain" mic should do.
 *
 * Shares the piano engine's AudioContext so both run under one autoresume
 * handler, and so the Recorder can mix piano + mic inside a single
 * context (Chromium silences cross-context MediaStreamAudioSourceNode
 * reads).
 */

export interface AudioInputSnapshot {
  enabled: boolean;
  deviceId: string | null;
  /** 0..2 linear gain applied to the mic signal before capture + monitor. */
  outputLevel: number;
  /** Local monitor on/off. Off by default to avoid speaker feedback. */
  monitorEnabled: boolean;
  /** Lifecycle state. */
  status:
    | { kind: 'idle' }
    | { kind: 'opening' }
    | { kind: 'live' }
    | { kind: 'error'; message: string };
  /** Round-trip latency estimate (base + output), ms. */
  latencyMs: number;
  /** True once the user has resumed the context with a gesture. */
  contextRunning: boolean;
}

class AudioInputEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private srcNode: MediaStreamAudioSourceNode | null = null;
  private outputGain: GainNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private monitorGain: GainNode | null = null;
  /** Recorder / virtual-cam tap. Post-outputGain, so the saved audio
   *  tracks whatever the "Level" slider is set to. */
  private programDest: MediaStreamAudioDestinationNode | null = null;

  private state: AudioInputSnapshot = {
    enabled: false,
    deviceId: null,
    outputLevel: 0.9,
    monitorEnabled: false,
    status: { kind: 'idle' },
    latencyMs: 0,
    contextRunning: false,
  };
  private listeners = new Set<() => void>();
  private static STORAGE_KEY = 'pk.audioInput.v2';

  constructor() {
    this.restore();
  }

  private restore() {
    try {
      const raw =
        typeof localStorage !== 'undefined' && localStorage.getItem(AudioInputEngine.STORAGE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as Partial<AudioInputSnapshot>;
      this.state = {
        ...this.state,
        enabled: j.enabled ?? this.state.enabled,
        deviceId: typeof j.deviceId === 'string' ? j.deviceId : null,
        outputLevel:
          typeof j.outputLevel === 'number' ? j.outputLevel : this.state.outputLevel,
        monitorEnabled: j.monitorEnabled ?? this.state.monitorEnabled,
      };
    } catch { /* fresh state */ }
  }

  private persist() {
    try {
      const { enabled, deviceId, outputLevel, monitorEnabled } = this.state;
      localStorage.setItem(
        AudioInputEngine.STORAGE_KEY,
        JSON.stringify({ enabled, deviceId, outputLevel, monitorEnabled }),
      );
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------
  // Snapshot + subscriptions
  // ---------------------------------------------------------------------

  getSnapshot(): AudioInputSnapshot {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<AudioInputSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
    if (
      'enabled' in patch || 'deviceId' in patch ||
      'outputLevel' in patch || 'monitorEnabled' in patch
    ) {
      this.persist();
    }
  }

  // ---------------------------------------------------------------------
  // Init + teardown
  // ---------------------------------------------------------------------

  /** True when this engine created `this.ctx` (and therefore owns it on
   *  dispose). False when the ctx came from `pianoEngine.getAudioContext()`. */
  private ownsCtx = false;

  /**
   * Lazy-init the audio graph. Idempotent. Shares the piano engine's
   * AudioContext so both ride the same autoresume handler and the
   * Recorder can mix in-context.
   */
  async init(): Promise<void> {
    if (this.ctx) return;
    try {
      const mod = await import('./pianoEngine');
      await mod.pianoEngine.init();
      const shared = mod.pianoEngine.getAudioContext();
      if (shared) {
        this.ctx = shared;
        this.ownsCtx = false;
      }
    } catch {
      /* Falls through to creating our own ctx. */
    }
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.ownsCtx = true;
      } catch {
        this.update({ status: { kind: 'error', message: 'Web Audio is not available' } });
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* needs gesture */ }
    }

    const ctx = this.ctx;
    this.outputGain = ctx.createGain();
    this.outputGain.gain.value = this.state.outputLevel;

    this.outputAnalyser = ctx.createAnalyser();
    this.outputAnalyser.fftSize = 1024;
    this.outputAnalyser.smoothingTimeConstant = 0.6;

    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = this.state.monitorEnabled ? 1 : 0;

    // src → outputGain → outputAnalyser ─┬─► programDest (Recorder)
    //                                     └─► monitorGain → ctx.destination
    this.outputGain.connect(this.outputAnalyser);
    this.outputAnalyser.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);

    this.programDest = ctx.createMediaStreamDestination();
    this.outputAnalyser.connect(this.programDest);
  }

  dispose() {
    this.stopStream();
    if (this.ctx) {
      if (this.ownsCtx) this.ctx.close().catch(() => { /* ignore */ });
      this.ctx = null;
      this.ownsCtx = false;
    }
    this.outputGain = null;
    this.outputAnalyser = null;
    this.monitorGain = null;
    this.programDest = null;
    this.update({ status: { kind: 'idle' }, contextRunning: false, latencyMs: 0 });
  }

  // ---------------------------------------------------------------------
  // Device + stream management
  // ---------------------------------------------------------------------

  /**
   * Open the microphone identified by `deviceId`. Pass `null` to close the
   * current stream.
   *
   * Capture is raw — echoCancellation / noiseSuppression / autoGainControl
   * are all off. The user asked for a "normal microphone with very few
   * parameters"; this is that.
   */
  async setDevice(deviceId: string | null): Promise<void> {
    if (!this.ctx || !this.outputGain) await this.init();
    if (!this.ctx || !this.outputGain) return;

    this.stopStream();
    this.update({ deviceId });

    if (deviceId == null) {
      this.update({ status: { kind: 'idle' } });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.update({ status: { kind: 'error', message: 'No microphone API in this environment' } });
      return;
    }

    this.update({ status: { kind: 'opening' } });
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* needs gesture */ }
    }
    try {
      console.log('[audioInput] requesting', { deviceId, ctxState: this.ctx.state });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      this.stream = stream;
      this.srcNode = this.ctx.createMediaStreamSource(stream);
      this.srcNode.connect(this.outputGain);
      const track = stream.getAudioTracks()[0];
      console.log('[audioInput] getUserMedia resolved', {
        readyState: track?.readyState,
        muted: track?.muted,
        settings: track?.getSettings?.(),
        ctxState: this.ctx.state,
      });
      this.update({
        status: { kind: 'live' },
        latencyMs: (this.ctx.baseLatency + (this.ctx.outputLatency ?? 0)) * 1000,
        contextRunning: this.ctx.state === 'running',
      });
      if (track) {
        track.onended = () => {
          this.stopStream();
          this.update({ status: { kind: 'error', message: 'Microphone disconnected' } });
        };
      }
    } catch (e) {
      console.error('[audioInput] getUserMedia rejected', e);
      const msg = e instanceof Error ? describeError(e) : String(e);
      this.update({ status: { kind: 'error', message: msg } });
    }
  }

  private stopStream() {
    try { this.srcNode?.disconnect(); } catch { /* ignore */ }
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try { t.stop(); } catch { /* ignore */ }
      }
    }
    this.srcNode = null;
    this.stream = null;
  }

  // ---------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------

  async setEnabled(b: boolean): Promise<void> {
    this.update({ enabled: b });
    if (!b) {
      this.stopStream();
      this.update({ status: { kind: 'idle' } });
      return;
    }
    if (!this.ctx) await this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* needs another gesture */ }
      this.update({
        contextRunning: (this.ctx.state as AudioContextState) === 'running',
      });
    }
    if (this.state.deviceId) await this.setDevice(this.state.deviceId);
  }

  setOutputLevel(v: number) {
    const clamped = Math.max(0, Math.min(2, v));
    this.update({ outputLevel: clamped });
    if (!this.outputGain || !this.ctx) return;
    this.outputGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
  }

  setMonitorEnabled(b: boolean) {
    this.update({ monitorEnabled: b });
    if (!this.monitorGain || !this.ctx) return;
    if (b && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => { /* needs gesture */ });
    }
    this.monitorGain.gain.setTargetAtTime(b ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  /**
   * Output-path capture stream for the Recorder. Post output-gain. Returns
   * null before init() — callers should treat the absence as "mic not
   * available right now."
   */
  getProgramStream(): MediaStream | null {
    return this.programDest?.stream ?? null;
  }

  /**
   * Output AudioNode (post output-gain). The Recorder connects this into
   * a MediaStreamAudioDestinationNode in the SHARED AudioContext so the
   * mix stays intra-context — Chromium silences `createMediaStreamSource`
   * on streams from MediaStreamAudioDestinationNodes in another context.
   */
  getProgramNode(): AudioNode | null {
    return this.outputAnalyser;
  }

  // ---------------------------------------------------------------------
  // Live meter reads
  // ---------------------------------------------------------------------

  /** Peak amplitude over the last analyser frame, 0..1. Reads post-gain,
   *  which is the same signal that reaches the recording. */
  peekOutputLevel(): number {
    return peakOf(this.outputAnalyser);
  }
}

function peakOf(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

function describeError(err: Error): string {
  if (err.name === 'NotAllowedError') return 'Microphone permission denied';
  if (err.name === 'NotFoundError') return 'Microphone not found';
  if (err.name === 'NotReadableError') return 'Microphone in use by another app';
  if (err.name === 'OverconstrainedError') return 'Microphone cannot meet constraints';
  return err.message || 'Microphone unavailable';
}

export const audioInput = new AudioInputEngine();
