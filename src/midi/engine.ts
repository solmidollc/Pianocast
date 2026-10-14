import type { MidiDeviceInfo, MidiEngineSnapshot, NoteState } from './types';

type Listener = () => void;

/**
 * Raw, per-event MIDI notification — emitted synchronously inside the
 * onmidimessage callback, BEFORE the snapshot is rebuilt. Audio uses this
 * path so each note triggers a sample in microseconds; visuals stay on the
 * coalesced snapshot/rAF path.
 *
 * `timeStamp` is the DOMHighResTimeStamp (performance.now()-aligned ms) from
 * MIDIMessageEvent. Listeners can use it to align scheduling.
 */
export const ACOUSTIC_INPUT_ID = '@acoustic-piano';

export type RawMidiEvent = (
  | { kind: 'noteOn'; midi: number; velocity: number; timeStamp: number }
  | { kind: 'noteOff'; midi: number; timeStamp: number }
  | { kind: 'sustain'; down: boolean; timeStamp: number }
  | { kind: 'allOff'; timeStamp: number }) & { source?: 'acoustic' };

type RawListener = (e: RawMidiEvent) => void;

/**
 * MidiEngine owns the authoritative live note state.
 *
 * Design notes:
 *  - WebMIDI events update a Map<midi, NoteState> synchronously inside the
 *    onmidimessage callback to keep input-to-state latency at sub-ms.
 *  - Renderers subscribe via getSnapshot()/subscribe() and read once per
 *    requestAnimationFrame, so a burst of MIDI events between frames coalesces
 *    into a single render. This keeps 60fps stable under dense playing.
 *  - Sustain pedal (CC64) is tracked separately. When the pedal is down, a
 *    note-off leaves the note in the active set with held=false, sustained=true.
 *  - We never garbage-allocate per event: the snapshot is rebuilt only when
 *    something actually changed, behind a dirty flag.
 */
export class MidiEngine {
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private notes = new Map<number, NoteState>();
  private sustain = false;
  private listeners = new Set<Listener>();
  private rawListeners = new Set<RawListener>();
  private snapshot: MidiEngineSnapshot = { active: [], sustain: false, inputId: null };
  private dirty = true;
  private acoustic = false;

  async init(): Promise<MidiDeviceInfo[]> {
    console.log('[midi] init start, requestMIDIAccess in navigator?', 'requestMIDIAccess' in navigator);
    if (!('requestMIDIAccess' in navigator)) {
      console.warn('[midi] Web MIDI is not available in this environment.');
      return [];
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      console.error('[midi] requestMIDIAccess rejected', err);
      return [];
    }
    console.log('[midi] access acquired. inputs size:', this.access.inputs.size);
    this.access.onstatechange = (e) => {
      console.log('[midi] statechange', (e as MIDIConnectionEvent).port?.name, (e as MIDIConnectionEvent).port?.state);
      this.emit();
    };
    const devices = this.listDevices();
    console.log('[midi] listDevices →', devices);
    if (!this.acoustic && !this.input && devices.length > 0) {
      this.selectInput(devices[0].id);
    }
    return devices;
  }

  listDevices(): MidiDeviceInfo[] {
    if (!this.access) return [];
    const out: MidiDeviceInfo[] = [];
    this.access.inputs.forEach((dev) => {
      out.push({
        id: dev.id,
        name: dev.name ?? 'Unknown',
        manufacturer: dev.manufacturer ?? '',
        state: dev.state === 'connected' ? 'connected' : 'disconnected',
      });
    });
    return out;
  }

  selectInput(id: string | null) {
    this.acoustic = id === ACOUSTIC_INPUT_ID;
    this.emitRaw({ kind: 'allOff', timeStamp: performance.now() });
    this.allNotesOff();
    if (this.input) {
      this.input.onmidimessage = null;
      this.input = null;
    }
    if (!this.access || !id) {
      this.dirty = true;
      this.emit();
      return;
    }
    const dev = this.access.inputs.get(id);
    if (!dev) return;
    this.input = dev;
    dev.onmidimessage = this.onMessage;
    this.dirty = true;
    this.emit();
  }

  getInputId(): string | null {
    return this.acoustic ? ACOUSTIC_INPUT_ID : this.input?.id ?? null;
  }

  /** Recognition is visualization-only and can never accumulate a chord. */
  setAcousticNote(midi: number | null, velocity = 90, retrigger = false) {
    if (!this.acoustic) return;
    const previous = this.notes.keys().next().value;
    if (previous === midi && !retrigger) return;
    if (previous !== undefined) {
      this.emitRaw({ kind: 'noteOff', midi: previous, timeStamp: performance.now(), source: 'acoustic' });
      this.noteOff(previous);
    }
    if (midi !== null) {
      this.emitRaw({ kind: 'noteOn', midi, velocity, timeStamp: performance.now(), source: 'acoustic' });
      this.noteOn(midi, velocity);
    }
  }

  private onMessage = (e: MIDIMessageEvent) => {
    if (this.acoustic) return;
    const data = e.data;
    if (!data || data.length < 1) return;
    const status = data[0] & 0xf0;
    const d1 = data[1] ?? 0;
    const d2 = data[2] ?? 0;
    const ts = e.timeStamp;
    // Raw fan-out FIRST — audio subscribers want the event before the
    // snapshot rebuild adds (negligible but real) overhead. The visual
    // snapshot rebuild still happens immediately after.
    if (status === 0x90 && d2 > 0) {
      this.emitRaw({ kind: 'noteOn', midi: d1, velocity: d2, timeStamp: ts });
      this.noteOn(d1, d2);
    } else if (status === 0x80 || (status === 0x90 && d2 === 0)) {
      this.emitRaw({ kind: 'noteOff', midi: d1, timeStamp: ts });
      this.noteOff(d1);
    } else if (status === 0xb0) {
      // Control change.
      if (d1 === 64) {
        this.emitRaw({ kind: 'sustain', down: d2 >= 64, timeStamp: ts });
        this.setSustain(d2 >= 64);
      } else if (d1 === 123) {
        this.emitRaw({ kind: 'allOff', timeStamp: ts });
        this.allNotesOff();
      }
    }
  };

  private noteOn(midi: number, velocity: number) {
    const existing = this.notes.get(midi);
    if (existing) {
      existing.held = true;
      existing.sustained = false;
      existing.velocity = velocity;
      existing.pressedAt = performance.now();
    } else {
      this.notes.set(midi, {
        midi,
        velocity,
        pressedAt: performance.now(),
        held: true,
        sustained: false,
      });
    }
    this.dirty = true;
    this.emit();
  }

  private noteOff(midi: number) {
    const n = this.notes.get(midi);
    if (!n) return;
    if (this.sustain) {
      n.held = false;
      n.sustained = true;
    } else {
      this.notes.delete(midi);
    }
    this.dirty = true;
    this.emit();
  }

  private setSustain(down: boolean) {
    if (this.sustain === down) return;
    this.sustain = down;
    if (!down) {
      // Pedal up: release all notes that are only sustaining.
      for (const [midi, n] of this.notes) {
        if (n.sustained && !n.held) this.notes.delete(midi);
      }
    }
    this.dirty = true;
    this.emit();
  }

  private allNotesOff() {
    this.notes.clear();
    this.sustain = false;
    this.dirty = true;
    this.emit();
  }

  /** Returns the current authoritative snapshot. Stable identity until a change. */
  getSnapshot(): MidiEngineSnapshot {
    if (!this.dirty) return this.snapshot;
    const active: NoteState[] = new Array(this.notes.size);
    let i = 0;
    for (const n of this.notes.values()) active[i++] = n;
    active.sort((a, b) => a.midi - b.midi);
    this.snapshot = { active, sustain: this.sustain, inputId: this.getInputId() };
    this.dirty = false;
    return this.snapshot;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Subscribe to raw, un-coalesced MIDI events. Fired synchronously inside
   * the WebMIDI callback, so the listener sees the event in microseconds —
   * specifically meant for audio paths that must not wait for the rAF tick.
   *
   * Listeners MUST be fast and MUST NOT throw — an exception in any one
   * listener could otherwise block visual updates because the snapshot
   * rebuild runs right after.
   */
  addRawListener(fn: RawListener): () => void {
    this.rawListeners.add(fn);
    return () => this.rawListeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private emitRaw(e: RawMidiEvent) {
    for (const l of this.rawListeners) {
      try { l(e); } catch { /* see addRawListener contract */ }
    }
  }

  /**
   * Optional injection helpers also emit the raw event so test code drives
   * the audio engine the same way real MIDI does.
   */
  private injectEmit(e: RawMidiEvent) { this.emitRaw(e); }

  /** Test helper: inject a virtual note. */
  injectNoteOn(midi: number, velocity = 90) {
    this.injectEmit({ kind: 'noteOn', midi, velocity, timeStamp: performance.now() });
    this.noteOn(midi, velocity);
  }
  injectNoteOff(midi: number) {
    this.injectEmit({ kind: 'noteOff', midi, timeStamp: performance.now() });
    this.noteOff(midi);
  }
  injectSustain(down: boolean) {
    this.injectEmit({ kind: 'sustain', down, timeStamp: performance.now() });
    this.setSustain(down);
  }
}

export const midiEngine = new MidiEngine();

