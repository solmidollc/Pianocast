import { Chord, Interval } from 'tonal';
import type {
  ChordReadout,
  HarmonicAnalysis,
  IntervalReadout,
  KeyContext,
  SpelledNote,
} from './types';
import { spellMidi, spellWithLetter, LETTER_ORDER } from './spelling';

const INTERVAL_LONG: Record<string, string> = {
  '1P': 'Unison',
  '2m': 'Minor 2nd',
  '2M': 'Major 2nd',
  '3m': 'Minor 3rd',
  '3M': 'Major 3rd',
  '4P': 'Perfect 4th',
  '4A': 'Augmented 4th',
  '5d': 'Diminished 5th',
  '5P': 'Perfect 5th',
  '5A': 'Augmented 5th',
  '6m': 'Minor 6th',
  '6M': 'Major 6th',
  '7d': 'Diminished 7th',
  '7m': 'Minor 7th',
  '7M': 'Major 7th',
  '8P': 'Octave',
};

function intervalReadout(semis: number): IntervalReadout {
  // Normalize to within one octave for naming.
  const within = ((semis % 12) + 12) % 12;
  const ivl = Interval.get(Interval.fromSemitones(within));
  const name = ivl.name || `${semis}st`;
  const long = INTERVAL_LONG[name] ?? name;
  return { name, long, semitones: semis };
}

/**
 * Lead-sheet suffix lookup, keyed on the chord's sorted interval semitones.
 *
 * tonal's own `parsed.symbol` lands on "CM" for a C major triad and similar
 * conservatory-style names for the rest of the catalog. Working musicians
 * write the bare letter for major, "m" for minor, "maj7" for the major
 * seventh, "dim" for diminished, and so on. This table is the round-trip
 * from interval set → lead-sheet suffix that yields the names a working
 * musician would write.
 */
const LEADSHEET_SUFFIX: Record<string, string> = {
  '0,4,7':           '',
  '0,3,7':           'm',
  '0,4,7,10':        '7',
  '0,4,7,11':        'maj7',
  '0,3,7,10':        'm7',
  '0,5,7':           'sus4',
  '0,2,7':           'sus2',
  '0,4,7,9':         '6',
  '0,3,7,9':         'm6',
  '0,3,6':           'dim',
  '0,4,8':           'aug',
  '0,3,6,10':        'm7b5',
  '0,3,6,9':         'dim7',
  '0,3,7,11':        'm(maj7)',
  '0,5,7,10':        '7sus4',
  '0,2,7,10':        '7sus2',
  // Close-voicing added-tone chords. Distinct from add9 / m(add9), whose
  // 9th sits an octave higher (interval 14 instead of 2). These let
  // "G add 4" = G B C D (intervals 0,4,5,7) come out as "Gadd4" instead of
  // the convoluted Em-something reading tonal's first-pass picker lands on.
  '0,2,4,7':         'add2',
  '0,2,3,7':         'm(add2)',
  '0,4,5,7':         'add4',
  '0,3,5,7':         'm(add4)',
  '0,4,7,14':        'add9',
  '0,3,7,14':        'm(add9)',
  '0,4,7,10,14':     '9',
  '0,4,7,11,14':     'maj9',
  '0,3,7,10,14':     'm9',
  '0,4,7,10,14,17':  '11',
  '0,3,7,10,14,17':  'm11',
  '0,4,7,10,14,21':  '13',
  '0,4,7,11,14,21':  'maj13',
  '0,3,7,10,14,21':  'm13',
  '0,4,7,10,13':     '7b9',
  '0,4,7,10,15':     '7#9',
  '0,4,7,10,14,18':  '7#11',
  '0,4,7,10,14,20':  '7b13',
  '0,4,8,10':        '7#5',
  '0,4,6,10':        '7b5',
  '0,4,8,10,14':     '9#5',
  // Exotics — kept here so the symbol renders cleanly if they ever win the
  // ranker, but their commonness scores below shove them to the back.
  '0,3,8':           'm#5',
  '0,4,6':           'b5',
};

/**
 * Commonness rank — lower is more common, so it wins the picker.
 *
 * This is the heart of the inversion-naming fix. tonal's `Chord.detect` for
 * the pitches of G/B (B-D-G with B in the bass) returns both "Bm#5" and
 * "G/B". Both are valid spellings of the same pitch set, but a musician
 * writes "G/B" every time, because the G major triad is one of the most
 * common chords in the language and "minor with augmented fifth" is exotic.
 *
 * Ranking by quality first, then root-vs-bass match, then length lets the
 * common reading rise to the top across triads, sevenths, sixths, sus
 * chords, and extensions, while penalising augmented-fifth-on-minor and
 * other rare readings unless nothing simpler fits.
 */
const COMMONNESS_RANK: Record<string, number> = {
  '0,4,7':           0,   // major triad
  '0,3,7':           1,   // minor triad
  '0,4,7,10':        2,   // 7
  '0,4,7,11':        3,   // maj7
  '0,3,7,10':        4,   // m7
  '0,5,7':           5,   // sus4
  '0,2,7':           6,   // sus2
  '0,4,7,9':         7,   // 6
  '0,3,7,9':         8,   // m6
  '0,3,6':           9,   // dim
  '0,4,8':          10,   // aug
  '0,3,6,10':       11,   // m7b5 (half-diminished)
  '0,3,6,9':        12,   // dim7
  '0,3,7,11':       13,   // m(maj7)
  '0,5,7,10':       14,   // 7sus4
  '0,2,7,10':       15,   // 7sus2
  // Added-tone chords rank near triads — these are common pop / folk
  // voicings and a musician would never volunteer "Em7♭something" if the
  // pitch set also reads as "Gadd4". Slightly above 6 / m6 since added-
  // tone is a touch more interpretive than a sixth chord, but well below
  // the exotic alterations.
  '0,2,4,7':         7,   // add2
  '0,2,3,7':         8,   // m(add2)
  '0,4,5,7':         7,   // add4
  '0,3,5,7':         8,   // m(add4)
  '0,4,7,14':       16,   // add9
  '0,3,7,14':       17,   // m(add9)
  '0,4,7,10,14':    18,   // 9
  '0,4,7,11,14':    19,   // maj9
  '0,3,7,10,14':    20,   // m9
  '0,4,7,10,14,17': 21,   // 11
  '0,3,7,10,14,17': 22,   // m11
  '0,4,7,10,14,21': 23,   // 13
  '0,4,7,11,14,21': 24,   // maj13
  '0,3,7,10,14,21': 25,   // m13
  '0,4,7,10,13':    30,   // 7b9
  '0,4,7,10,15':    31,   // 7#9
  '0,4,7,10,14,18': 32,   // 7#11
  '0,4,7,10,14,20': 33,   // 7b13
  '0,4,8,10':       40,   // 7#5
  '0,4,6,10':       41,   // 7b5
  '0,4,8,10,14':    42,   // 9#5
  '0,3,8':          60,   // m#5  — exotic
  '0,4,6':          61,   // b5   — exotic
};

/**
 * Bonus applied when a candidate chord is in root position AND its root IS
 * the played bass note. Subtracted from the candidate's commonness rank, so
 * higher numbers more aggressively prefer "the bass note is the root."
 *
 * Sized to break ties around the half-diminished / minor-sixth collision —
 * Bm7♭5 and Dm6 share the pitch set {B,D,F,A}; tonal returns both. m6 has
 * rank 8, m7♭5 has rank 11, delta = 3, so a bonus of 8 lets the bass-rooted
 * Bm7♭5 win (effective rank 3) while still losing to any genuinely better
 * reading (e.g. plain major triad at rank 0 always beats anything bass-
 * rooted at rank ≤ 8).
 */
const BASS_ROOT_BONUS = 8;

interface SupplementalSpec {
  rootPc: number;
  /** Interval-key from `intervalsKey` (sorted semitone offsets joined by ","). */
  intervalsKey: string;
  /** Lead-sheet suffix corresponding to intervalsKey. */
  suffix: string;
}

/**
 * Build supplemental chord candidates by trying every played pitch class as
 * a potential root and matching the resulting interval pattern against the
 * known LEADSHEET_SUFFIX table. tonal's `Chord.detect` is dictionary-bound
 * — it returns nothing for "Gadd4" because tonal doesn't have add4 as a
 * recognised quality — so simple added-tone voicings (G add 4 = G-B-C-D)
 * fall off the candidate list and the picker only sees the exotic
 * Em♭-something tonal happens to return.
 *
 * Supplemental specs bypass tonal entirely. We score them inline in
 * pickChord using COMMONNESS_RANK + the BASS_ROOT_BONUS and, when a
 * supplement wins, build the result directly via `buildSupplementalResult`
 * below. The black-key spelling rule still applies — supplements respect
 * the same minor-like / major-like split as tonal candidates do.
 */
function supplementalSpecs(pcs: number[]): SupplementalSpec[] {
  const set = new Set(pcs);
  const out: SupplementalSpec[] = [];
  for (const rootPc of set) {
    const intervals = [...set]
      .map((pc) => ((pc - rootPc) % 12 + 12) % 12)
      .sort((a, b) => a - b);
    const intervalsKey = intervals.join(',');
    const suffix = LEADSHEET_SUFFIX[intervalsKey];
    if (suffix === undefined) continue;
    out.push({ rootPc, intervalsKey, suffix });
  }
  return out;
}

/**
 * Letter offsets for each semitone interval. Maps the chord's intervals
 * (e.g. 0,2,4,7 = add2) to the conventional diatonic letter spelling. A few
 * intervals (1, 6, 8) sit between two diatonic letters; for those we pick
 * the spelling that matches the quality of the surrounding intervals when
 * we know it. The supplemental specs we currently care about (add2/add4
 * and their minor cousins, plus the sus / sixth / seventh entries that
 * tonal already handles fine) only use the unambiguous mappings.
 */
const INTERVAL_TO_LETTER_STEP: Record<number, number> = {
  0: 0,   // root
  1: 1,   // m2 (defaults to 2nd letter; could be A1 = root letter raised)
  2: 1,   // M2 → 2nd letter
  3: 2,   // m3 → 3rd letter
  4: 2,   // M3 → 3rd letter
  5: 3,   // P4 → 4th letter
  6: 3,   // A4 → 4th letter (treated; b5 case via 7's neighbour handled below)
  7: 4,   // P5 → 5th letter
  8: 5,   // m6 → 6th letter
  9: 5,   // M6 → 6th letter
  10: 6,  // m7 → 7th letter
  11: 6,  // M7 → 7th letter
  14: 8,  // M9 → 2nd letter, next octave (= 7 + 1)
  17: 10, // P11 → 4th letter, next octave
  21: 12, // M13 → 6th letter, next octave
};

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Spell a single chord tone given its semitone offset above the root and
 * the root letter / pc. Picks the letter via `INTERVAL_TO_LETTER_STEP`
 * (diatonic step from the root) and computes the accidental needed to land
 * the letter on the right pc.
 */
function spellChordTone(rootLetter: string, rootPc: number, interval: number): string {
  const rootIdx = LETTERS.indexOf(rootLetter as (typeof LETTERS)[number]);
  const step = INTERVAL_TO_LETTER_STEP[interval] ?? 0;
  const letter = LETTERS[(rootIdx + step) % 7];
  const letterPc = LETTER_PC[letter];
  const targetPc = (rootPc + interval) % 12;
  let diff = ((targetPc - letterPc) % 12 + 12) % 12;
  if (diff > 6) diff -= 12;
  let acc = '';
  if (diff === 1) acc = '#';
  else if (diff === -1) acc = 'b';
  else if (diff === 2) acc = '##';
  else if (diff === -2) acc = 'bb';
  return letter + acc;
}

/**
 * Build the picker's final result from a winning supplemental spec. Mirrors
 * the tonal-path bookkeeping: rule-based root spelling (by quality), chord-
 * tone derivation, inversion / bass.
 */
function buildSupplementalResult(
  spec: SupplementalSpec,
  bassPc: number,
): { symbol: string; root: string; quality: string; bass: string | null; inversion: number } {
  const minorLike = isMinorLikeSuffix(spec.suffix);
  const ruleRoot = spellByQuality(spec.rootPc, minorLike);
  const intervals = spec.intervalsKey.split(',').map(Number);
  const chordNotes = intervals.map((iv) => spellChordTone(ruleRoot[0], spec.rootPc, iv));
  let inversion = 0;
  for (let i = 0; i < chordNotes.length; i++) {
    if (pcOfAnyName(chordNotes[i]) === bassPc) {
      inversion = i;
      break;
    }
  }
  const ruleSymbol = `${ruleRoot}${spec.suffix}`;
  const bass = inversion > 0 ? chordNotes[inversion] : null;
  const symbol = bass ? `${ruleSymbol}/${bass}` : ruleSymbol;
  return { symbol, root: ruleRoot, quality: spec.suffix, bass, inversion };
}

/**
 * Pick the most musically plausible chord symbol from tonal's candidates and
 * format it in lead-sheet style. Detection delegates to tonal; the picker
 * adds three layers on top:
 *
 *   - Commonness ranking. We score every candidate by the rarity of its
 *     interval pattern and sort. Major beats m#5; G/B beats Bm#5.
 *
 *   - Bass-rooted bonus. A candidate that's in root position AND whose root
 *     IS the played bass note gets a rank subtraction so the m7♭5 vs m6
 *     coin-flip tilts toward calling the bass the root. Doesn't override
 *     vastly better readings — the bonus is small enough that plain major
 *     (rank 0) still beats every bass-rooted exotic alternative.
 *
 *   - Suffix normalisation. We discard tonal's "CM"/"Cmaj" defaults and emit
 *     the lead-sheet form ("C", "Cm", "Cmaj7", "Cm7b5", …).
 *
 * Ties break on root-position preference (no slash) and then symbol length.
 */
function pickChord(
  pitchClasses: number[],
  bassPc: number,
  preferSharps: boolean,
): { symbol: string; root: string; quality: string; bass: string | null; inversion: number } | null {
  if (pitchClasses.length < 3) return null;
  const sharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flat  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const pcOf = (name: string) => {
    const s = sharp.indexOf(name);
    if (s >= 0) return s;
    return flat.indexOf(name);
  };
  const names = preferSharps ? sharp : flat;
  const noteNames = pitchClasses.map((pc) => names[pc]);
  const candidates = Chord.detect(noteNames, { assumePerfectFifth: true });
  // Supplements bypass tonal (it can't parse "Gadd4" / "Gadd2", which is
  // exactly why the supplements exist). We compare the best supplement's
  // effective rank to the best tonal candidate's at the end and let the
  // smaller win.
  const supplements = supplementalSpecs(pitchClasses);

  type Scored = {
    parsed: ReturnType<typeof Chord.get>;
    bassPart: string | null;
    intervalsKey: string;
    rank: number;
    effRank: number;
    matchesBass: boolean;
    rawLen: number;
  };

  const scored: Scored[] = [];
  // Tonal-candidate loop.
  for (const sym of candidates) {
    const slashIdx = sym.indexOf('/');
    const rootPart = slashIdx >= 0 ? sym.slice(0, slashIdx) : sym;
    const bassPart = slashIdx >= 0 ? sym.slice(slashIdx + 1) : null;
    const parsed = Chord.get(rootPart);
    if (!parsed.tonic) continue;
    const semis = parsed.intervals
      .map((iv) => Interval.semitones(iv) ?? 0)
      .sort((a, b) => a - b);
    const intervalsKey = semis.join(',');
    const rank = COMMONNESS_RANK[intervalsKey] ?? 50;
    const rootPc = pcOf(parsed.tonic);
    const matchesBass = bassPart === null && rootPc === bassPc;
    const effRank = rank - (matchesBass ? BASS_ROOT_BONUS : 0);
    scored.push({ parsed, bassPart, intervalsKey, rank, effRank, matchesBass, rawLen: sym.length });
  }

  // Best supplement (if any) compared to the best tonal candidate.
  let bestSupplement: { spec: SupplementalSpec; effRank: number } | null = null;
  for (const sup of supplements) {
    const supRank = COMMONNESS_RANK[sup.intervalsKey] ?? 50;
    const matchesBass = sup.rootPc === bassPc;
    const supEff = supRank - (matchesBass ? BASS_ROOT_BONUS : 0);
    if (!bestSupplement || supEff < bestSupplement.effRank) {
      bestSupplement = { spec: sup, effRank: supEff };
    }
  }

  if (scored.length === 0 && !bestSupplement) return null;

  scored.sort((a, b) => {
    if (a.effRank !== b.effRank) return a.effRank - b.effRank;
    if (a.matchesBass !== b.matchesBass) return a.matchesBass ? -1 : 1;
    return a.rawLen - b.rawLen;
  });

  // If the supplement beats the best tonal candidate, build the result
  // directly from the spec — skips the tonal-parse path that drops add4 /
  // add2 entirely.
  const bestTonalEff = scored.length > 0 ? scored[0].effRank : Infinity;
  if (bestSupplement && bestSupplement.effRank < bestTonalEff) {
    return buildSupplementalResult(bestSupplement.spec, bassPc);
  }
  if (scored.length === 0) return null;

  const best = scored[0];
  // Suffix: lead-sheet table first, then any lowercase / symbolic alias tonal
  // happens to provide, then the empty string for plain major.
  let suffix = LEADSHEET_SUFFIX[best.intervalsKey];
  if (suffix === undefined) {
    const aliases = best.parsed.aliases ?? [];
    suffix =
      aliases.find((a) => /^[a-z♭♯b#+°ø(]/.test(a)) ??
      aliases.find((a) => a === '') ??
      '';
  }

  // The black-key spelling rule is ROOT-DRIVEN. We pick the spelling for the
  // chord's root from the quality (major → flat, minor → sharp), then derive
  // every other tone — third, fifth, seventh, inversion bass — by re-parsing
  // the rule-respelled symbol via tonal. That way the chord's tones all
  // share one family: D♭ major → D♭, F, A♭ (so 2nd inv = D♭/A♭, NOT
  // D♭/G♯); C♯m → C♯, E, G♯ (so 2nd inv = C♯m/G♯, NOT C♯m/A♭). For a
  // natural-root chord the rule contributes nothing and tonal's own
  // diatonic spelling flows through unchanged (A/C♯, Cm/E♭).
  const minorLike = isMinorLikeSuffix(suffix);
  const tonalRoot = best.parsed.tonic!;
  const ruleRoot = spellByQuality(pcOf(tonalRoot), minorLike);
  const ruleSymbol = `${ruleRoot}${suffix}`;
  const ruleParsed = Chord.get(ruleSymbol);
  const chordNotes = ruleParsed.notes.length > 0 ? ruleParsed.notes : best.parsed.notes;

  // Inversion = position of the played bass within the rule-respelled chord
  // tones. Use pcOfAnyName so non-standard tonal spellings (E#, B#, Cb, Fb)
  // that can appear in sharp-side minor chords (C#m → C#, E, G#; A#m → A#,
  // C#, E#) still resolve to a PC.
  let inversion = 0;
  for (let i = 0; i < chordNotes.length; i++) {
    if (pcOfAnyName(chordNotes[i]) === bassPc) {
      inversion = i;
      break;
    }
  }

  // Bass spelling comes from the rule-respelled chord's note at the
  // inversion index — NOT from independently spelling the bass PC by the
  // quality rule. Root position → no slash.
  const bass = inversion > 0 ? chordNotes[inversion] : null;
  const symbol = bass ? `${ruleSymbol}/${bass}` : ruleSymbol;

  return { symbol, root: ruleRoot, quality: suffix, bass, inversion };
}

/** Sharp / flat black-key spelling depending on chord quality. */
function spellByQuality(pc: number, minorLike: boolean): string {
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const BLACK = new Set([1, 3, 6, 8, 10]);
  if (!BLACK.has(pc)) return SHARP[pc];
  return minorLike ? SHARP[pc] : FLAT[pc];
}

function isMinorLikeSuffix(suffix: string): boolean {
  // Treat any chord with a minor third (or diminished / half-diminished) as
  // minor-like; everything else (plain, dominant, maj7, 6, sus, aug, …) as
  // major-like. The handful of exotics fall on the major-like side.
  if (/^m(?!aj)|^min/.test(suffix)) return true;
  if (/dim|°|ø/.test(suffix)) return true;
  return false;
}

/**
 * Refine note spellings so they agree with the detected chord. E.g. if the
 * chord is Eb7, a held G should be spelled G (not Abb), and a held Db should
 * stay Db (not C#). This walks the chord's letter sequence and assigns letters
 * to held pitch classes preferentially.
 */
function respellForChord(
  notes: SpelledNote[],
  chord: ChordReadout,
  preferSharps: boolean,
): SpelledNote[] {
  // We only re-letter notes whose pitch class is in the chord.
  // pcOfAnyName parses any tonal-produced spelling (including E#, B#, Cb, Fb
  // that crop up when the chord root sits on a black key on the minor side).
  const pcToLetter = new Map<number, SpelledNote['letter']>();
  const parsed = Chord.get(chord.symbol.replace(/\/.*/, ''));
  for (const cn of parsed.notes) {
    const pc = pcOfAnyName(cn);
    if (pc < 0) continue;
    const letter = cn[0] as SpelledNote['letter'];
    if (LETTER_ORDER.includes(letter)) pcToLetter.set(pc, letter);
  }
  return notes.map((n) => {
    const pc = ((n.midi % 12) + 12) % 12;
    const letter = pcToLetter.get(pc);
    if (letter) return spellWithLetter(n.midi, letter);
    return n;
  });
}

function pcOfAnyName(name: string): number {
  const m = name.match(/^([A-G])([#b]*)$/);
  if (!m) return -1;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[m[1]];
  for (const ch of m[2]) {
    if (ch === '#') pc = (pc + 1) % 12;
    else if (ch === 'b') pc = (pc - 1 + 12) % 12;
  }
  return pc;
}

export function analyze(midis: number[], key: KeyContext): HarmonicAnalysis {
  if (midis.length === 0) {
    return { notes: [], intervals: [], chord: null, empty: true };
  }
  const sorted = [...midis].sort((a, b) => a - b);
  let notes = sorted.map((m) => spellMidi(m, key));

  // Intervals: list adjacent intervals from the bass up (most useful for
  // small voicings; for 4+ notes we cap at the first few to avoid clutter).
  const intervals: IntervalReadout[] = [];
  if (sorted.length === 2) {
    intervals.push(intervalReadout(sorted[1] - sorted[0]));
  } else if (sorted.length >= 3) {
    for (let i = 1; i < Math.min(sorted.length, 4); i++) {
      intervals.push(intervalReadout(sorted[i] - sorted[0]));
    }
  }

  const pcSet = new Set<number>();
  for (const m of sorted) pcSet.add(((m % 12) + 12) % 12);
  const pcs = [...pcSet];
  const bassPc = ((sorted[0] % 12) + 12) % 12;
  const preferSharpsForKey = (() => {
    // We re-derive here rather than importing to avoid a cycle.
    return key.tonic.indexOf('b') === -1 && !(key.tonic === 'F' && key.mode === 'major');
  })();
  const chord = pickChord(pcs, bassPc, preferSharpsForKey);
  let chordOut: ChordReadout | null = null;
  if (chord) {
    chordOut = {
      symbol: chord.symbol,
      root: chord.root,
      quality: chord.quality,
      bass: chord.bass,
      inversion: chord.inversion,
      pitchClasses: pcs,
    };
    notes = respellForChord(notes, chordOut, preferSharpsForKey);
  }

  return { notes, intervals, chord: chordOut, empty: false };
}
