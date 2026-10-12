export type Accidental = '' | '#' | 'b' | '##' | 'bb';

export interface SpelledNote {
  midi: number;
  letter: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  accidental: Accidental;
  octave: number;
  /** e.g. "C#4" — what we pass into VexFlow / tonal. */
  scientific: string;
}

export interface IntervalReadout {
  /** e.g. "M3", "P5", "m7". */
  name: string;
  /** Human description, e.g. "Major 3rd". */
  long: string;
  semitones: number;
}

export interface ChordReadout {
  /** Display symbol, e.g. "Cmaj7", "F#m7b5", "Bb/D". */
  symbol: string;
  /** Just the root, e.g. "Cmaj7" → "C". */
  root: string;
  /** Just the quality, e.g. "Cmaj7" → "maj7". */
  quality: string;
  /** If a slash chord, the bass note (e.g. "Cmaj7/E" → "E"). */
  bass: string | null;
  /** 0 = root position, 1 = first inversion, etc. */
  inversion: number;
  /** Numeric pitch classes participating in the chord (0-11). */
  pitchClasses: number[];
}

export interface HarmonicAnalysis {
  notes: SpelledNote[];
  intervals: IntervalReadout[];
  chord: ChordReadout | null;
  /** Empty-input placeholder. */
  empty: boolean;
}

export type KeyName =
  | 'C' | 'G' | 'D' | 'A' | 'E' | 'B' | 'F#' | 'C#'
  | 'F' | 'Bb' | 'Eb' | 'Ab' | 'Db' | 'Gb' | 'Cb';
export type KeyMode = 'major' | 'minor';

export interface KeyContext {
  tonic: KeyName;
  mode: KeyMode;
}
