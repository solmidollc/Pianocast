export type MidiNumber = number; // 0-127, 60 = middle C

export interface NoteState {
  midi: MidiNumber;
  velocity: number; // 0-127
  /** Wall-clock ms (performance.now) when the note-on arrived. */
  pressedAt: number;
  /** True while the physical key is held down. */
  held: boolean;
  /** True while the sustain pedal is keeping a released key ringing. */
  sustained: boolean;
}

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
}

export interface MidiEngineSnapshot {
  /** All notes that are currently sounding (held or sustained). */
  active: NoteState[];
  /** Sustain pedal state. */
  sustain: boolean;
  /** Currently selected input device id. */
  inputId: string | null;
}
