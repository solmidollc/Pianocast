/**
 * Audio engine.
 *
 * The MIDI engine fans raw note / pedal events into here synchronously, off
 * the rAF coalescing path; this module owns:
 *
 *   - The AudioContext (`latencyHint: 'interactive'`, lazy-init on first
 *     call, auto-resume on the first window pointerdown / keydown).
 *   - The active smplr instrument (Concert Grand by default; switchable to
 *     Harpsichord / Electric Piano / Pipe Organ from the panel).
 *   - The tone-shaping chain — input bus → tone tilt → master gain ↔ reverb
 *     wet send → stereo width → context.destination.
 *   - The sustain pedal, implemented AT THE ENGINE LAYER. We don't rely on
 *     smplr's CC64 plumbing because plugins handle it inconsistently; the
 *     engine tracks `sustainDown` itself and defers `stop()` calls when
 *     pedal-down + the active instrument honours sustain. Pedal-up flushes
 *     the deferred releases.
 *
 * Live render path (60 fps visuals) is never touched by anything here.
 */

import {
  Reverb,
  type Reverb as ReverbInstance,
} from 'smplr';
import { midiEngine, type RawMidiEvent } from '../midi/engine';
import {
  INSTRUMENTS,
  getInstrumentDef,
  type InstrumentDef,
  type InstrumentId,
  type SmplrInstrument,
  allAttributions,
} from './instruments';
import { StereoWidth } from './stereoWidth';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export type ReverbType = 'room' | 'hall' | 'plate';

export interface PianoEngineSnapshot {
  enabled: boolean;
  volume: number;
  /** Wet send to the reverb bus, 0..1. */
  reverbAmount: number;
  reverbType: ReverbType;
  /** Multiplier on the chosen reverb's decay (0.4..1.6). */
  reverbSize: number;
  /** Tone tilt: -1 = darker, +1 = brighter, 0 = neutral. */
  toneTilt: number;
  /** Stereo width: 0 = mono, 1 = identity, 2 = wide. */
  stereoWidth: number;
  /** Reference frequency for A4. 440 = concert pitch. */
  tuningHz: number;
  /** Velocity-response exponent. <1 = softer-biased, >1 = need force for ff. */
  velocityCurve: number;
  /**
   * User-tunable damper-release multiplier. 1.0 = the instrument's
   * catalogue defaults (already register-scaled). Lower = snappier
   * staccato, higher = more lingering decay. The actual ampRelease passed
   * to a voice is `instrumentCurve(midi) × releaseFeel`. Iterative dial-
   * by-ear setting — the spec explicitly calls out that this is a feel
   * adjustment, not a "correct" number.
   */
  releaseFeel: number;
  /** Output sink id (HTMLMediaElement style). null = system default. */
  sinkId: string | null;
  /** Currently selected instrument. */
  instrumentId: InstrumentId;
  status: LoadStatus;
  /** Round-trip latency estimate (base + output), ms. */
  latencyMs: number;
  /** Did the user gesture-unlock the context yet? */
  contextRunning: boolean;
}

// ---------------------------------------------------------------------------
// Re-exports for UI / attribution consumers
// ---------------------------------------------------------------------------

export { INSTRUMENTS, allAttributions };
export type { InstrumentDef, InstrumentId } from './instruments';

export const SALAMANDER_ATTRIBUTION =
  'Concert Grand sound: Salamander Grand Piano by Alexander Holm, licensed under CC BY 3.0.';

// ---------------------------------------------------------------------------
// Reverb presets — type / size → underlying Dattorro params
// ---------------------------------------------------------------------------

interface ReverbPreset {
  preDelay: number;
  decay: number;
  damping: number;
  bandwidth: number;
}

/**
 * Hand-tuned parameter sets that aim for the perceptual character of each
 * algorithm family. Dattorro doesn't perfectly simulate any of them (it's
 * one algorithm, not three), but tweaking decay / damping / preDelay gets
 * close enough that the names mean the right thing to the player.
 */
const REVERB_PRESETS: Record<ReverbType, ReverbPreset> = {
  // Tight, intimate, lots of early reflections, warm tail.
  room: { preDelay: 0.005, decay: 0.35, damping: 0.55, bandwidth: 0.85 },
  // Long, lush, sparse early reflections, gentle damping.
  hall: { preDelay: 0.04, decay: 0.78, damping: 0.30, bandwidth: 0.85 },
  // Minimal pre-delay, bright tail, mid-length.
  plate: { preDelay: 0.002, decay: 0.55, damping: 0.18, bandwidth: 0.95 },
};

function reverbDecayFor(type: ReverbType, size: number): number {
  // size 0.4..1.6 scales decay. Clamp the final result to [0, 1].
  return Math.max(0, Math.min(1, REVERB_PRESETS[type].decay * size));
}

// ---------------------------------------------------------------------------
// Velocity-layer crossfade
// ---------------------------------------------------------------------------

/**
 * Equal-power crossfade for the velocity-layer transition.
 *
 * Returns null when the velocity is comfortably inside a single layer; a
 * twin-voice spec otherwise. Each spec field is the MIDI velocity to pass
 * to one of two parallel `instrument.start()` calls — the lower-layer voice
 * stays in the layer ENDING at the boundary, the upper-layer voice stays
 * in the layer STARTING immediately after.
 *
 * Gain control via velocity, not volume: smplr's NoteEvent doesn't carry a
 * per-voice volume parameter, so we shape gains by where we land within
 * each layer's velocity range. Treating the in-layer velocity→amplitude
 * curve as roughly square (`gain ≈ (v/vMax)²`), we use sqrt-mapped velocity
 * values to approximate the equal-power gains `gLow = cos(t·π/2)` and
 * `gHigh = sin(t·π/2)`.
 */
interface CrossfadeSpec {
  vLow: number;
  vHigh: number;
}

export function computeCrossfade(
  velocity: number,
  layers: number[] | undefined,
  width: number,
): CrossfadeSpec | null {
  if (!layers || layers.length === 0) return null;
  for (let i = 0; i < layers.length; i++) {
    const b = layers[i];
    const lo = b - width;
    const hi = b + width;
    if (velocity > lo && velocity <= hi) {
      const t = (velocity - lo) / (2 * width); // 0 just inside layer N, 1 just into N+1
      // Equal-power crossfade in linear-gain units.
      const gLow = Math.cos(t * Math.PI / 2);
      const gHigh = Math.sin(t * Math.PI / 2);
      // Map gains back onto velocity, staying inside each layer's range.
      // Layer N spans (prevBoundary, b]; layer N+1 spans (b, nextBoundary].
      const prev = i === 0 ? 0 : layers[i - 1];
      const next = i + 1 < layers.length ? layers[i + 1] : 127;
      // Within layer N: vLow chosen so its in-layer position reflects gLow.
      // sqrt() because smplr's gain ≈ (v/vMax)², so v ≈ vMax·sqrt(g).
      const vLow = Math.max(
        prev + 1,
        Math.min(b, Math.round(prev + (b - prev) * Math.sqrt(gLow))),
      );
      // Within layer N+1: vHigh chosen so its in-layer position reflects gHigh.
      const vHigh = Math.max(
        b + 1,
        Math.min(next, Math.round(b + 1 + (next - b - 1) * Math.sqrt(gHigh))),
      );
      return { vLow, vHigh };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

class PianoEngine {
  private ctx: AudioContext | null = null;
  private instrument: SmplrInstrument | null = null;
  private instrumentDef: InstrumentDef;

  // --- Audio graph ---
  private masterGain: GainNode | null = null;
  /**
   * Capture tap. Parallel to `ctx.destination` — anything reaching the
   * master also reaches `programDest`, whose `.stream` is a real
   * MediaStream the Recorder (and the future Go Live virtual cam path)
   * can pull from without touching the audible signal. Lazily exposed
   * via `getProgramStream`.
   */
  private programDest: MediaStreamAudioDestinationNode | null = null;
  /** Bus between the sampler and the routing tree. The current instrument
   *  output connects here; switching instruments rewires upstream of this
   *  node so the tone / reverb / width chain doesn't have to be rebuilt. */
  private inputBus: GainNode | null = null;
  /** Two shelving filters in series implement a tilt EQ — boost lows AND
   *  cut highs (or vice versa) as one knob. Easier to dial than a parametric. */
  private toneLow: BiquadFilterNode | null = null;
  private toneHigh: BiquadFilterNode | null = null;
  private reverbSend: GainNode | null = null;
  private reverbReturn: GainNode | null = null;
  private reverb: ReverbInstance | null = null;
  private stereoWidth: StereoWidth | null = null;

  // --- Pedal bookkeeping ---
  //
  // The engine implements CC64 itself rather than forwarding via
  // piano.setCC(64,…). The per-plugin support across smplr's instrument
  // families isn't uniform — some piano factories honour it, some defer,
  // some ignore it — and the bug report said the pedal "doesn't affect the
  // audio." Owning it here makes the behaviour identical across instruments
  // and trivially debuggable.
  private sustainDown = false;
  private sustainedNotes = new Set<number>();
  private rawUnsub: (() => void) | null = null;

  // --- Public state snapshot ---
  private state: PianoEngineSnapshot = {
    enabled: false,
    volume: 0.8,
    reverbAmount: 0.18,
    reverbType: 'room',
    reverbSize: 1.0,
    toneTilt: 0,
    stereoWidth: 1.0,
    tuningHz: 440,
    velocityCurve: 1.0,
    sinkId: null,
    instrumentId: 'concert-grand',
    releaseFeel: 1.0,
    status: { kind: 'idle' },
    latencyMs: 0,
    contextRunning: false,
  };
  private listeners = new Set<() => void>();
  private static STORAGE_KEY = 'pk.audio.v2';
  private static SOUND_OPT_IN_KEY = 'pk.audio.sound-opt-in.v1';

  constructor() {
    // Default to the bundled Concert Grand so even before init() the
    // catalog lookup returns a valid def.
    this.instrumentDef = getInstrumentDef('concert-grand');
    this.restore();
    // Old saved defaults are not an explicit choice to synthesize MIDI sound.
    try { this.state.enabled = localStorage.getItem(PianoEngine.SOUND_OPT_IN_KEY) === 'true'; }
    catch { this.state.enabled = false; }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private restore() {
    try {
      const raw =
        typeof localStorage !== 'undefined' && localStorage.getItem(PianoEngine.STORAGE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as Partial<PianoEngineSnapshot>;
      this.state = {
        ...this.state,
        enabled: j.enabled ?? this.state.enabled,
        volume: typeof j.volume === 'number' ? j.volume : this.state.volume,
        reverbAmount:
          typeof j.reverbAmount === 'number' ? j.reverbAmount : this.state.reverbAmount,
        reverbType: (j.reverbType as ReverbType) ?? this.state.reverbType,
        reverbSize: typeof j.reverbSize === 'number' ? j.reverbSize : this.state.reverbSize,
        toneTilt: typeof j.toneTilt === 'number' ? j.toneTilt : this.state.toneTilt,
        stereoWidth:
          typeof j.stereoWidth === 'number' ? j.stereoWidth : this.state.stereoWidth,
        tuningHz: typeof j.tuningHz === 'number' ? j.tuningHz : this.state.tuningHz,
        velocityCurve:
          typeof j.velocityCurve === 'number' ? j.velocityCurve : this.state.velocityCurve,
        sinkId: typeof j.sinkId === 'string' ? j.sinkId : null,
        instrumentId: (j.instrumentId as InstrumentId) ?? this.state.instrumentId,
        releaseFeel:
          typeof j.releaseFeel === 'number' ? j.releaseFeel : this.state.releaseFeel,
      };
      this.instrumentDef = getInstrumentDef(this.state.instrumentId);
    } catch { /* fresh state */ }
  }

  private persist() {
    try {
      const {
        enabled, volume, reverbAmount, reverbType, reverbSize,
        toneTilt, stereoWidth, tuningHz, velocityCurve, sinkId, instrumentId,
        releaseFeel,
      } = this.state;
      localStorage.setItem(
        PianoEngine.STORAGE_KEY,
        JSON.stringify({
          enabled, volume, reverbAmount, reverbType, reverbSize,
          toneTilt, stereoWidth, tuningHz, velocityCurve, sinkId, instrumentId,
          releaseFeel,
        }),
      );
    } catch { /* localStorage may be unavailable */ }
  }

  // -------------------------------------------------------------------------
  // Snapshot + subscriptions
  // -------------------------------------------------------------------------

  getSnapshot(): PianoEngineSnapshot {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<PianoEngineSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
    // Persisted vs runtime keys. Only persist when a stable setting moved —
    // not for the firehose of loading-progress updates.
    if (
      'enabled' in patch || 'volume' in patch || 'reverbAmount' in patch ||
      'reverbType' in patch || 'reverbSize' in patch || 'toneTilt' in patch ||
      'stereoWidth' in patch || 'tuningHz' in patch || 'velocityCurve' in patch ||
      'sinkId' in patch || 'instrumentId' in patch || 'releaseFeel' in patch
    ) {
      this.persist();
    }
  }

  // -------------------------------------------------------------------------
  // Init + lifecycle
  // -------------------------------------------------------------------------

  /**
   * Expose the running AudioContext so other subsystems (the mic input
   * engine in particular) can share it. Sharing matters because the
   * autoresume gesture-listener installed by `installAutoResume` only
   * resumes THIS context; a second AudioContext created elsewhere would
   * stay suspended forever and its analysers / monitor would be silent.
   */
  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Lazy-init the context + audio graph + initial instrument. Idempotent.
   * The first call is the only one that actually builds anything; later
   * calls fast-return. Safe to invoke before the user gesture — the context
   * starts suspended, and we attach a one-shot pointerdown / keydown
   * listener that resumes it.
   */
  async init(): Promise<void> {
    if (this.ctx) return;

    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      this.update({ status: { kind: 'error', message: 'Web Audio is not available' } });
      return;
    }
    this.installAutoResume();

    // ---- Build the routing graph ----
    //
    //   sampler.output → inputBus → toneLow → toneHigh → mixBus
    //                                                      │
    //                                                      ├── dryGain ──► widthIn
    //                                                      └── reverbSend → reverb → reverbReturn → widthIn
    //   widthIn → StereoWidth → masterGain → ctx.destination
    //
    // The sampler instance reconnects to inputBus on every instrument
    // switch; everything from inputBus down is built once and stays.

    const ctx = this.ctx;
    this.inputBus = ctx.createGain();
    this.inputBus.gain.value = 1;

    this.toneLow = ctx.createBiquadFilter();
    this.toneLow.type = 'lowshelf';
    this.toneLow.frequency.value = 250;
    this.toneLow.gain.value = 0;
    this.inputBus.connect(this.toneLow);

    this.toneHigh = ctx.createBiquadFilter();
    this.toneHigh.type = 'highshelf';
    this.toneHigh.frequency.value = 4000;
    this.toneHigh.gain.value = 0;
    this.toneLow.connect(this.toneHigh);

    const mixBus = ctx.createGain();
    this.toneHigh.connect(mixBus);

    const dryGain = ctx.createGain();
    dryGain.gain.value = 1;
    mixBus.connect(dryGain);

    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = this.state.reverbAmount;
    mixBus.connect(this.reverbSend);

    this.reverb = Reverb(ctx);
    this.reverbSend.connect(this.reverb.input);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 1;
    this.reverb.connect(this.reverbReturn);

    this.stereoWidth = new StereoWidth(ctx, this.state.stereoWidth);
    dryGain.connect(this.stereoWidth.input);
    this.reverbReturn.connect(this.stereoWidth.input);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.state.volume;
    this.stereoWidth.output.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // Recorder / virtual-cam capture tap. Connects in parallel to the
    // audible destination — the master signal is reproduced byte-for-byte
    // into a MediaStream that can be fed to MediaRecorder (Record button)
    // or, later, into the native virtual-camera audio pipeline (Go Live).
    this.programDest = ctx.createMediaStreamDestination();
    this.masterGain.connect(this.programDest);

    // Apply persisted controls up-front so the user sees / hears their
    // saved settings immediately on next load.
    this.applyTone(this.state.toneTilt);
    this.applyReverbParams(this.state.reverbType, this.state.reverbSize);

    // Subscribe to MIDI BEFORE the instrument loads. Early note-ons are
    // gated below on `status === 'ready'` so they're dropped rather than
    // queued — which is the right call for a live keyboard.
    this.rawUnsub = midiEngine.addRawListener(this.handleMidi);

    // Load the persisted (or default) instrument.
    await this.loadInstrument(this.state.instrumentId);

    // Re-apply persisted sink-id now that the context exists.
    if (this.state.sinkId) await this.setSinkId(this.state.sinkId);
  }

  dispose() {
    this.rawUnsub?.();
    this.rawUnsub = null;
    try { this.instrument?.dispose(); } catch { /* idempotent */ }
    this.instrument = null;
    this.sustainedNotes.clear();
    if (this.ctx) {
      this.ctx.close().catch(() => { /* ignore */ });
      this.ctx = null;
    }
    this.masterGain = null;
    this.programDest = null;
    this.inputBus = null;
    this.toneLow = this.toneHigh = null;
    this.reverbSend = this.reverbReturn = null;
    this.reverb = null;
    this.stereoWidth = null;
    this.update({ status: { kind: 'idle' }, contextRunning: false, latencyMs: 0 });
  }

  // -------------------------------------------------------------------------
  // Instrument switching
  // -------------------------------------------------------------------------

  /**
   * Load the named instrument and replace the current one. Async — the
   * caller gets a Promise that resolves when samples are decoded and the
   * sampler is ready to play. While loading, the status is `'loading'`;
   * MIDI events arriving in that window are dropped (silent), but the
   * panel can still show progress.
   */
  async loadInstrument(id: InstrumentId): Promise<void> {
    if (!this.ctx || !this.inputBus) return;
    const def = getInstrumentDef(id);

    // Tear down the old instrument and reset any pedal state — pressing
    // sustain on a piano and then switching to the organ should leave a
    // clean slate, not a phantom held set of notes.
    try { this.instrument?.dispose(); } catch { /* ignore */ }
    this.instrument = null;
    this.sustainedNotes.clear();

    this.instrumentDef = def;
    this.update({ instrumentId: id, status: { kind: 'loading', progress: 0 } });

    try {
      this.instrument = def.create(this.ctx, {
        destination: this.inputBus,
        onLoadProgress: (frac) =>
          this.update({ status: { kind: 'loading', progress: frac } }),
      });
      await this.instrument.ready;
      // Apply persisted tuning to the new instrument.
      this.applyTuning(this.state.tuningHz);
      this.update({
        status: { kind: 'ready' },
        latencyMs: (this.ctx.baseLatency + (this.ctx.outputLatency ?? 0)) * 1000,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.update({ status: { kind: 'error', message: msg } });
    }
  }

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  setEnabled(b: boolean) {
    try { localStorage.setItem(PianoEngine.SOUND_OPT_IN_KEY, String(b)); } catch { /* optional persistence */ }
    this.update({ enabled: b });
    if (!b && this.instrument) {
      try { this.instrument.stop(); } catch { /* ignore */ }
      this.sustainedNotes.clear();
    }
  }

  setVolume(v: number) {
    this.update({ volume: v });
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    }
  }

  setReverbAmount(a: number) {
    this.update({ reverbAmount: a });
    if (this.reverbSend && this.ctx) {
      this.reverbSend.gain.setTargetAtTime(a, this.ctx.currentTime, 0.02);
    }
  }

  setReverbType(t: ReverbType) {
    this.update({ reverbType: t });
    this.applyReverbParams(t, this.state.reverbSize);
  }

  setReverbSize(s: number) {
    this.update({ reverbSize: s });
    this.applyReverbParams(this.state.reverbType, s);
  }

  private applyReverbParams(t: ReverbType, size: number) {
    if (!this.reverb) return;
    const p = REVERB_PRESETS[t];
    const decay = reverbDecayFor(t, size);
    const set = (name: string, value: number) => {
      const param = this.reverb!.getParam(name as 'decay');
      if (!param || !this.ctx) return;
      param.setTargetAtTime(value, this.ctx.currentTime, 0.05);
    };
    set('preDelay', p.preDelay);
    set('damping', p.damping);
    set('bandwidth', p.bandwidth);
    set('decay', decay);
  }

  setToneTilt(t: number) {
    this.update({ toneTilt: t });
    this.applyTone(t);
  }

  private applyTone(t: number) {
    if (!this.toneLow || !this.toneHigh || !this.ctx) return;
    // ±1 maps to ±4 dB on each shelf. Negative tilt = boost lows / cut
    // highs (darker); positive tilt = cut lows / boost highs (brighter).
    const lowGain = -t * 4;
    const highGain = t * 4;
    const now = this.ctx.currentTime;
    this.toneLow.gain.setTargetAtTime(lowGain, now, 0.05);
    this.toneHigh.gain.setTargetAtTime(highGain, now, 0.05);
  }

  setStereoWidth(w: number) {
    this.update({ stereoWidth: w });
    this.stereoWidth?.setWidth(w);
  }

  setTuningHz(hz: number) {
    this.update({ tuningHz: hz });
    this.applyTuning(hz);
  }

  private applyTuning(hz: number) {
    if (!this.instrument) return;
    // Detune in cents relative to A=440. log2(hz/440) octaves × 1200 cents.
    const cents = 1200 * Math.log2(hz / 440);
    try { this.instrument.setDetune(cents); } catch { /* not all plugins support it */ }
  }

  setVelocityCurve(k: number) {
    this.update({ velocityCurve: Math.max(0.5, Math.min(2, k)) });
  }

  setReleaseFeel(f: number) {
    this.update({ releaseFeel: Math.max(0.3, Math.min(2.5, f)) });
  }

  /**
   * Returns the MediaStream that mirrors everything reaching the master
   * output. Lifecycle ties to `init()` / `dispose()`. The Recorder reads
   * this on Start; nothing pulls until then, so the tap costs nothing.
   */
  getProgramStream(): MediaStream | null {
    return this.programDest?.stream ?? null;
  }

  /**
   * Output AudioNode (master gain). The Recorder connects this into a
   * MediaStreamAudioDestinationNode it creates in the SAME shared
   * AudioContext. Routing the mix inside one context sidesteps
   * Chromium's "silence from cross-context MediaStreamAudioSourceNode"
   * bug that bit the Recorder when it created its own context and tried
   * to pull via `createMediaStreamSource(getProgramStream())`.
   */
  getProgramNode(): AudioNode | null {
    return this.masterGain;
  }

  async setSinkId(id: string | null): Promise<void> {
    this.update({ sinkId: id });
    const ctx = this.ctx as
      | (AudioContext & { setSinkId?: (id: string | { type: 'none' }) => Promise<void> })
      | null;
    if (!ctx?.setSinkId) return;
    try { await ctx.setSinkId(id ?? ''); } catch { /* device may have vanished */ }
  }

  // -------------------------------------------------------------------------
  // Damper-release curve
  // -------------------------------------------------------------------------

  /**
   * Compute the `ampRelease` to pass to smplr for a single voice on this
   * instrument at this MIDI pitch, with the user's release-feel multiplier
   * folded in. Returns `undefined` when the instrument has no damper-
   * release model OR the note is in the damperless register — in both
   * cases the engine omits ampRelease from the NoteEvent and the sample's
   * own natural release plays through.
   *
   * Register scaling is linear between `lowReleaseMul` at MIDI 21 and
   * `highReleaseMul` at the (exclusive) damper cutoff. The resulting fade
   * shape is exponential because smplr's release stage is an AudioParam
   * setTargetAtTime — a linear ramp would be the "instant switch off" the
   * spec warns against.
   */
  private ampReleaseFor(midi: number, def: InstrumentDef): number | undefined {
    if (def.baseReleaseSec === undefined) return undefined;
    if (def.noDamperAboveMidi !== undefined && midi >= def.noDamperAboveMidi) return undefined;
    const lowMul = def.lowReleaseMul ?? 1.0;
    const highMul = def.highReleaseMul ?? 1.0;
    const lo = 21;
    const hi = (def.noDamperAboveMidi ?? 108) - 1;
    const t = hi > lo ? Math.max(0, Math.min(1, (midi - lo) / (hi - lo))) : 0;
    const registerMul = lowMul + t * (highMul - lowMul);
    return def.baseReleaseSec * registerMul * this.state.releaseFeel;
  }

  // -------------------------------------------------------------------------
  // MIDI handling — engine-side pedal logic
  // -------------------------------------------------------------------------

  private handleMidi = (e: RawMidiEvent) => {
    if (e.source === 'acoustic') return;
    if (!this.instrument || !this.state.enabled) return;
    if (this.state.status.kind !== 'ready') return;
    const def = this.instrumentDef;

    switch (e.kind) {
      case 'noteOn': {
        // Re-strike during pedal-down: cancel the held release of the
        // previous voice on this MIDI number before starting the new one.
        // Otherwise smplr would stack voices and the pedal-up release
        // would fire on the wrong one. (instrument.stop(midi) stops every
        // voice for that MIDI, including both halves of a crossfade pair.)
        if (this.sustainedNotes.has(e.midi)) {
          this.sustainedNotes.delete(e.midi);
          try { this.instrument.stop(e.midi); } catch { /* ignore */ }
        }
        // Velocity sensitivity is per-instrument; the harpsichord / organ
        // explicitly ignore it. We still pass a sane fixed value so the
        // sampler picks one velocity layer (or its only layer).
        let v: number;
        if (def.velocitySensitive) {
          const norm = e.velocity / 127;
          const shaped = Math.pow(norm, this.state.velocityCurve);
          v = Math.max(1, Math.min(127, Math.round(shaped * 127)));
        } else {
          v = 100;
        }
        // Damper-realistic release. Computed per voice in `ampReleaseFor`:
        //
        //   - Base release from the instrument's catalogue value (~0.3 s
        //     for the Concert Grand — long enough that Salamander's
        //     recorded release samples play through cleanly, which is the
        //     character we want; shorter than that and the underlying
        //     damper-thud got amplitude-clipped and sounded synthetic).
        //
        //   - Register scaling: bass strings damp slower than treble. A
        //     linear interpolation between catalogue low / high
        //     multipliers across the damped range.
        //
        //   - User-tunable "Release" feel multiplier (0.3..2.5) lets the
        //     player dial staccato across the whole keyboard by ear.
        //
        //   - Above F6 on grand pianos (no dampers in real life), returns
        //     undefined and the sample's natural decay plays.
        //
        // Sustain-pedal interaction is unchanged: ampRelease only fires
        // when stop() is actually called. Pedal-down defers stop() (below),
        // so held + pedaled notes ring naturally regardless of release.
        //
        // The release shape is exponential because smplr drives its
        // release stage via AudioParam setTargetAtTime — that's a natural
        // damper-like decay, not the linear / hard cutoff the spec
        // warned against.
        const ampRelease = this.ampReleaseFor(e.midi, def);

        // Velocity-layer crossfade.
        //
        // smplr's SplendidGrandPiano picks ONE Salamander layer per voice
        // based on velocity. A single voice crossing a layer boundary
        // produces an audible timbre step — the bug the spec calls out.
        // We smooth it by firing TWIN voices in the ±crossfadeWidth window
        // around each catalogue-declared boundary, one in the lower layer
        // and one in the upper, with equal-power gains.
        //
        // We control gain via velocity (smplr maps velocity → amplitude
        // monotonically within a layer): each voice's velocity is chosen
        // so its in-layer amplitude approximates the equal-power target.
        // The math isn't perfect — we don't know smplr's exact volume-to-
        // gain curve — but it removes the abrupt sample-switch artefact,
        // which is the audible win.
        //
        // For instruments without `velocityLayers` (harpsichord, organ,
        // single-layer sets) this collapses to a single voice — no
        // behaviour change.
        const xfade = computeCrossfade(v, def.velocityLayers, def.crossfadeWidth ?? 5);
        try {
          if (xfade) {
            this.instrument.start({ note: e.midi, velocity: xfade.vLow, ampRelease });
            this.instrument.start({ note: e.midi, velocity: xfade.vHigh, ampRelease });
          } else {
            this.instrument.start({ note: e.midi, velocity: v, ampRelease });
          }
        } catch { /* never let one bad event break the path */ }
        break;
      }
      case 'noteOff': {
        if (this.sustainDown && def.honorsSustain) {
          // Defer the release. Pedal-up will flush.
          this.sustainedNotes.add(e.midi);
        } else {
          try { this.instrument.stop(e.midi); } catch { /* ignore */ }
        }
        break;
      }
      case 'sustain': {
        this.sustainDown = e.down;
        if (!def.honorsSustain) break;
        if (!e.down) {
          // Pedal up — release every deferred note WITH NATURAL DECAY.
          //
          // Each stop() triggers the voice's release stage with the
          // ampRelease that was set at note-on, so the fade is already
          // exponential and per-note register-scaled. What we add here:
          //
          //   - A tiny time-stagger across the deferred notes. Calling
          //     stop() on a dozen voices all at the same instant produces
          //     a perceptual "thunk" — every fade starts in sync, every
          //     release sample fires in sync, and the ear hears a single
          //     simultaneous event. A real pedal's damper rail doesn't
          //     contact every string at exactly the same micron; the
          //     dampers roll down across a few tens of ms. 5–25 ms of
          //     random jitter recreates that.
          //
          //   - Each stop() is scheduled at AudioContext time (smplr's
          //     StopTarget.time field), not via setTimeout, so the
          //     stagger is sample-accurate and the release samples line
          //     up with the AudioContext clock.
          //
          // Pedal-up only damps notes whose KEYS are no longer held —
          // that's exactly what sustainedNotes tracks (notes that have
          // received noteOff while pedal was down). Keys still physically
          // pressed are NOT in sustainedNotes and are NOT touched, so
          // they keep ringing exactly as a real piano does.
          const now = this.ctx?.currentTime ?? 0;
          let offset = 0;
          for (const midi of this.sustainedNotes) {
            const t = now + offset;
            // 4–24 ms per note; cumulative across the deferred set.
            offset += 0.004 + Math.random() * 0.020;
            try {
              this.instrument.stop({ stopId: midi, time: t });
            } catch {
              // Some older smplr builds reject the object form — fall
              // back to the plain midi-number stop. Loses the stagger
              // for those builds but never breaks the release path.
              try { this.instrument.stop(midi); } catch { /* ignore */ }
            }
          }
          this.sustainedNotes.clear();
        }
        break;
      }
      case 'allOff': {
        try { this.instrument.stop(); } catch { /* ignore */ }
        this.sustainedNotes.clear();
        this.sustainDown = false;
        break;
      }
    }
  };

  // -------------------------------------------------------------------------
  // Auto-resume
  // -------------------------------------------------------------------------

  private installAutoResume() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'running') {
      this.update({ contextRunning: true });
      return;
    }
    const resume = () => {
      ctx.resume()
        .then(() => this.update({ contextRunning: ctx.state === 'running' }))
        .catch(() => { /* another gesture will try again */ });
      window.removeEventListener('pointerdown', resume, true);
      window.removeEventListener('keydown', resume, true);
    };
    window.addEventListener('pointerdown', resume, true);
    window.addEventListener('keydown', resume, true);
  }
}

export const pianoEngine = new PianoEngine();

