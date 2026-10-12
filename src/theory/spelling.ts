import type { Accidental, KeyContext, SpelledNote } from './types';

// Pitch-class index (0=C, 1=C#/Db, ..., 11=B) → preferred sharp/flat names.
const SHARP_NAMES: Array<[SpelledNote['letter'], Accidental]> = [
  ['C', ''], ['C', '#'], ['D', ''], ['D', '#'], ['E', ''], ['F', ''],
  ['F', '#'], ['G', ''], ['G', '#'], ['A', ''], ['A', '#'], ['B', ''],
];
const FLAT_NAMES: Array<[SpelledNote['letter'], Accidental]> = [
  ['C', ''], ['D', 'b'], ['D', ''], ['E', 'b'], ['E', ''], ['F', ''],
  ['G', 'b'], ['G', ''], ['A', 'b'], ['A', ''], ['B', 'b'], ['B', ''],
];

/**
 * Number of sharps (+) or flats (-) in each key signature. We use this to
 * decide whether to default to sharp or flat spellings for accidentals.
 */
const KEY_SIGNATURE: Record<string, number> = {
  // majors
  'C-major': 0, 'G-major': 1, 'D-major': 2, 'A-major': 3, 'E-major': 4,
  'B-major': 5, 'F#-major': 6, 'C#-major': 7,
  'F-major': -1, 'Bb-major': -2, 'Eb-major': -3, 'Ab-major': -4,
  'Db-major': -5, 'Gb-major': -6, 'Cb-major': -7,
  // minors (relative to majors)
  'A-minor': 0, 'E-minor': 1, 'B-minor': 2, 'F#-minor': 3, 'C#-minor': 4,
  'G#-minor': 5, 'D#-minor': 6, 'A#-minor': 7,
  'D-minor': -1, 'G-minor': -2, 'C-minor': -3, 'F-minor': -4,
  'Bb-minor': -5, 'Eb-minor': -6, 'Ab-minor': -7,
};

export function keySignatureCount(key: KeyContext): number {
  const k = `${key.tonic}-${key.mode}`;
  return KEY_SIGNATURE[k] ?? 0;
}

/** Default to sharps for sharp keys (including C major), flats for flat keys. */
export function preferSharps(key: KeyContext): boolean {
  return keySignatureCount(key) >= 0;
}

export function spellMidi(midi: number, key: KeyContext): SpelledNote {
  const pc = ((midi % 12) + 12) % 12;
  const useSharps = preferSharps(key);
  const [letter, accidental] = useSharps ? SHARP_NAMES[pc] : FLAT_NAMES[pc];
  // Scientific pitch: octave numbering where C4 = MIDI 60.
  const octave = Math.floor(midi / 12) - 1;
  const scientific = `${letter}${accidental}${octave}`;
  return { midi, letter, accidental, octave, scientific };
}

const LETTER_ORDER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Re-spell a note with a preferred letter, computing the accidental needed.
 * Used when chord context demands a specific letter (e.g. an A7 chord must
 * spell its third as C#, not Db, regardless of key signature).
 */
export function spellWithLetter(
  midi: number,
  letter: SpelledNote['letter'],
): SpelledNote {
  const pc = ((midi % 12) + 12) % 12;
  const letterPc = LETTER_TO_PC[letter];
  let diff = pc - letterPc;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  let accidental: Accidental = '';
  if (diff === 1) accidental = '#';
  else if (diff === -1) accidental = 'b';
  else if (diff === 2) accidental = '##';
  else if (diff === -2) accidental = 'bb';
  // We compute the octave by anchoring to the chromatic position of the
  // natural letter on the same MIDI octave, then nudging if the spelling
  // crosses an octave boundary (e.g. B# is the next octave's C).
  let octave = Math.floor(midi / 12) - 1;
  const naturalMidi = (octave + 1) * 12 + letterPc;
  if (midi - naturalMidi > 6) octave += 1;
  else if (midi - naturalMidi < -6) octave -= 1;
  const scientific = `${letter}${accidental}${octave}`;
  return { midi, letter, accidental, octave, scientific };
}

export { LETTER_ORDER };

/**
 * Letters that the active key signature already alters, and the alteration
 * each one carries. C major / A minor → empty Map. G major → { F: '#' }.
 * E♭ minor → { B: 'b', E: 'b', A: 'b', D: 'b', G: 'b', C: 'b' }. The notation
 * code subtracts this from each played note's spelled accidental to decide
 * whether to draw a glyph at all (and whether that glyph is a natural).
 *
 * Order of sharps:  F C G D A E B
 * Order of flats:   B E A D G C F
 *
 * Pulled into spelling.ts so both the notation module and any future
 * accidental-aware UI share one source of truth.
 */
const SHARP_ORDER: ReadonlyArray<SpelledNote['letter']> = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: ReadonlyArray<SpelledNote['letter']> = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export function keySignatureAlterations(
  key: KeyContext,
): Map<SpelledNote['letter'], Accidental> {
  const count = keySignatureCount(key);
  const m = new Map<SpelledNote['letter'], Accidental>();
  if (count > 0) {
    for (let i = 0; i < count; i++) m.set(SHARP_ORDER[i], '#');
  } else if (count < 0) {
    for (let i = 0; i < -count; i++) m.set(FLAT_ORDER[i], 'b');
  }
  return m;
}

/**
 * Visible accidental for a played note under the active key signature.
 *
 *   - Returns `null` when the played accidental matches what the key
 *     signature already provides → no glyph drawn.
 *   - Returns `'n'` when the signature alters this letter but the played
 *     note does not → natural sign cancels the signature accidental.
 *   - Returns the actual sharp / flat / double-sharp / double-flat
 *     otherwise.
 *
 * VexFlow accepts these strings directly (`''` is unused because we return
 * `null` when there's nothing to draw).
 */
export function visibleAccidental(
  note: SpelledNote,
  alterations: Map<SpelledNote['letter'], Accidental>,
): '#' | 'b' | 'n' | '##' | 'bb' | null {
  const expected = alterations.get(note.letter) ?? '';
  if (note.accidental === expected) return null;
  if (note.accidental === '') return 'n';
  return note.accidental as '#' | 'b' | '##' | 'bb';
}
