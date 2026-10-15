import { useMemo } from 'react';
import { ACOUSTIC_INPUT_ID } from '../midi/engine';
import { useMidi } from '../midi/useMidi';
import { useApp } from '../state/store';
import { analyze } from '../theory/analysis';
import type { ChordReadout, KeyContext, SpelledNote } from '../theory/types';

export type ReadoutMode = 'chord' | 'roman' | 'advanced';

interface Props {
  /** Slot pixel size — the rectangle the readout sits inside. Side-drag
   *  changes these. The content is flex-centred in the slot, so growing
   *  one dimension just adds breathing room on both sides of that axis. */
  width: number;
  height: number;
  /** Encoded text pixel-scale: `scale = baseHeight / SLOT_REF_H`. Corner
   *  drag grows slot AND base in lock-step (see ModuleFrame.tsx) so the
   *  centred content visually scales without distortion; side drag leaves
   *  these alone so the content keeps its current pixel size. */
  baseWidth?: number;
  baseHeight?: number;
  mode?: ReadoutMode;
  showIntervals?: boolean;
}

/** Reference slot dims encoded by `baseWidth`/`baseHeight` at scale = 1.
 *  Matches the store's harmonic default (520 × 220) so a fresh module
 *  ships at scale = 1. */
const SLOT_REF_W = 520;
const SLOT_REF_H = 220;

function accidentalToGlyph(acc: string): string {
  switch (acc) {
    case '#': return '♯';
    case 'b': return '♭';
    case '##': return 'x';
    case 'bb': return '♭♭';
    default: return '';
  }
}

function formatChord(symbol: string): { root: string; rest: string; bass?: string } {
  const slashIdx = symbol.indexOf('/');
  const main = slashIdx >= 0 ? symbol.slice(0, slashIdx) : symbol;
  const bass = slashIdx >= 0 ? symbol.slice(slashIdx + 1) : undefined;
  const m = main.match(/^([A-G])([#b]*)(.*)$/);
  if (!m) return { root: main, rest: '', bass };
  return { root: m[1] + m[2], rest: m[3], bass };
}

/**
 * Replace ASCII accidentals with Unicode glyphs for display. Storage stays in
 * ASCII so tonal can still round-trip the symbol. In a chord suffix the only
 * lowercase 'b' that ever appears is the flat alteration (m7b5 → m7♭5, 7b9 →
 * 7♭9, etc.) so the substitution is safe across the catalog.
 */
function prettyAccidentals(s: string): string {
  return s.replace(/b/g, '♭').replace(/#/g, '♯');
}

// ===========================================================================
// Functional analysis
//
// Roman analysis uses one underlying analyzer. The analyzer returns a
// tagged union — diatonic (the common case), a secondary dominant, a
// secondary leading-tone, a Neapolitan, an augmented sixth, or a borrowed
// chord — and each variant is rendered into Roman glyphs by a
// separate render function.
//
// Detection is layered, most-specific first, so a chord that could be read
// two ways gets the reading a musician would actually write down:
//
//   1. Augmented sixth   — requires the b6 letter AND the #4 letter spelled
//                          in the user's key. That spelling alone
//                          disambiguates It/Fr/Ger from a dominant 7 on bVI
//                          (same pitches, different notation). Detected on
//                          the spelled-note set, not just pitch classes.
//   2. Neapolitan        — bII major triad spelled with the b2 letter.
//   3. Secondary leading-tone — dim / dim7 / m7b5 whose root is the leading
//                          tone of a diatonic non-tonic chord.
//   4. Secondary dominant — dom7 or major triad whose root is a 5th above a
//                          diatonic non-tonic chord AND which is NOT itself
//                          the diatonic chord on that root (so a plain G in
//                          C major stays "V", never "V/I"; G7 in C stays
//                          "V7", never some V7/anything).
//   5. Diatonic + mode mixture — degree from the major / natural-minor scale
//                          (flat accidental preferred for borrowed chords
//                          like bIII / bVI / bVII / iv, sharp as fallback).
//
// Ambiguous-without-resolution cases (Ger+6 vs bVI7, ct°7 vs vii°7/X) the
// prompt called out: we use the user's enharmonic spelling where it
// disambiguates (Ger+6 only matches if the user spelled F♯ in C major, not
// G♭). Where it remains genuinely ambiguous from a single sounding chord,
// we return the more common reading rather than guess at the exotic one.
// ===========================================================================

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor

function pcFromNote(name: string): number {
  const m = name.match(/^([A-G])([#b]*)/);
  if (!m) return 0;
  let pc = LETTER_PC[m[1]];
  for (const ch of m[2]) {
    if (ch === '#') pc = (pc + 1) % 12;
    else if (ch === 'b') pc = (pc - 1 + 12) % 12;
  }
  return pc;
}

interface ChordQuality {
  isMinor: boolean;
  isDim: boolean;
  isHalfDim: boolean;
  isAug: boolean;
  isMaj7: boolean;
  isDom7: boolean;
  isMin7: boolean;
  isDim7: boolean;
  isPlainMajor: boolean;
  isPlainMinor: boolean;
  hasSeventh: boolean;
  raw: string;
}

function parseQuality(symbol: string): ChordQuality {
  const main = symbol.split('/')[0];
  const m = main.match(/^[A-G][#b]*(.*)$/);
  const tail = m ? m[1] : '';
  const isHalfDim = /m7b5|ø/.test(tail);
  const isDim7 = /dim7|°7/.test(tail);
  const isDim = !isDim7 && !isHalfDim && /^dim|°|^o(?!\w)/.test(tail);
  const isAug = /aug|\+/.test(tail);
  const isMaj7 = /maj7|M7|Δ/.test(tail);
  const hasSeventh = isMaj7 || isDim7 || isHalfDim || /(?:^|[^0-9])7/.test(tail);
  const isMin7 = /^m7|^min7/.test(tail) && !isHalfDim && !isMaj7;
  const isMinor =
    /^m(?!aj)/.test(tail) || /^min/.test(tail) || isMin7 || isHalfDim;
  const isDom7 = hasSeventh && !isMaj7 && !isMin7 && !isDim7 && !isHalfDim;
  const isPlainMajor = tail === '' || tail === 'M' || tail === 'maj';
  const isPlainMinor = tail === 'm' || tail === 'min';
  return {
    isMinor, isDim, isHalfDim, isAug, isMaj7, isDom7, isMin7, isDim7,
    isPlainMajor, isPlainMinor, hasSeventh, raw: tail,
  };
}

type DiatonicQuality = 'major' | 'minor' | 'dim';

function diatonicQualityAt(degree: number, mode: 'major' | 'minor'): DiatonicQuality {
  if (mode === 'major') {
    if (degree === 1 || degree === 4 || degree === 5) return 'major';
    if (degree === 2 || degree === 3 || degree === 6) return 'minor';
    return 'dim'; // vii°
  }
  // natural minor
  if (degree === 1 || degree === 4 || degree === 5) return 'minor';
  if (degree === 3 || degree === 6 || degree === 7) return 'major';
  return 'dim'; // ii°
}

export type RomanAnalysis =
  | { kind: 'diatonic'; degree: number; accidental: '' | '#' | 'b'; quality: ChordQuality; inversion: number }
  | { kind: 'sec-dominant'; hasSeventh: boolean; targetDegree: number; targetQuality: DiatonicQuality; targetAccidental: '' | '#' | 'b'; inversion: number }
  | { kind: 'sec-leading-tone'; chordType: 'dim' | 'dim7' | 'halfdim7'; targetDegree: number; targetQuality: DiatonicQuality; targetAccidental: '' | '#' | 'b'; inversion: number }
  | { kind: 'neapolitan'; inversion: number }
  | { kind: 'aug6'; type: 'It' | 'Fr' | 'Ger' }
  | { kind: 'common-tone-dim' };

/**
 * Common-tone diminished 7th — a dim7 chord whose root IS the tonic of the
 * key. In isolation this is the canonical ct°7 case (C°7 in C major
 * embellishes I and shares C as a common tone). Other dim7 readings are
 * resolution-dependent — without voice-leading context the prompt says to
 * return the more common functional reading, which for a non-tonic dim7 root
 * is the secondary leading-tone (handled by detectSecondary below).
 */
function detectCommonToneDim(
  chord: ChordReadout,
  key: KeyContext,
): RomanAnalysis | null {
  const q = parseQuality(chord.symbol);
  if (!q.isDim7) return null;
  const rootPc = pcFromNote(chord.root);
  const tonicPc = pcFromNote(key.tonic);
  if (rootPc !== tonicPc) return null;
  return { kind: 'common-tone-dim' };
}

function detectAugmentedSixth(
  notes: SpelledNote[],
  key: KeyContext,
): RomanAnalysis | null {
  // Detect by PC pattern relative to the key — NOT by spelled-letter shape.
  //
  // The earlier version required both the ♭6 letter AND the ♯4 letter to
  // be present in the spelled-note set; in practice that fails in
  // sharp-side key contexts (C major preferSharps spells A♭ as G♯, so the
  // ♭6 "A" letter is absent and the chord goes undetected). Augmented
  // sixths are an interval-pattern animal — three (It+6) or four (Fr+6,
  // Ger+6) pitch classes at fixed offsets above the key tonic — so detect
  // them at that layer.
  //
  // Ger+6 shares its pitch-classes with a dominant 7 on ♭VI; per spec we
  // default to the augmented-sixth reading. (The chord-symbol mode still
  // labels it ♭VI7 / A♭7 if that's what tonal returns; Roman
  // is the one that switches to the functional label.)
  const tonicPc = pcFromNote(key.tonic);
  const pcs = new Set(notes.map((n) => ((n.midi % 12) + 12) % 12));
  if (pcs.size < 3 || pcs.size > 4) return null;
  const rel = new Set([...pcs].map((pc) => ((pc - tonicPc) % 12 + 12) % 12));
  if (!rel.has(0) || !rel.has(6) || !rel.has(8)) return null;
  if (rel.size === 3) return { kind: 'aug6', type: 'It' };
  if (rel.size === 4) {
    if (rel.has(2)) return { kind: 'aug6', type: 'Fr' };
    if (rel.has(3)) return { kind: 'aug6', type: 'Ger' };
  }
  return null;
}

function detectNeapolitan(
  chord: ChordReadout,
  key: KeyContext,
): RomanAnalysis | null {
  // PC-only match: ♭II is a major triad whose root sits at pc(tonic) + 1.
  //
  // We deliberately do NOT gate on the chord root being spelled with the
  // ♭2 letter (D♭ in C, not C♯). The chord-symbol detector spells black-key
  // roots based on quality, but the user's enharmonic preference shouldn't
  // hide a functional Neapolitan — the same set of pitches has the same
  // functional meaning regardless of how it's spelled on screen. Functional
  // detection is by scale degree, not by letter.
  const tonicPc = pcFromNote(key.tonic);
  const b2Pc = (tonicPc + 1) % 12;
  const rootPc = pcFromNote(chord.root);
  if (rootPc !== b2Pc) return null;
  // A major triad only (Neapolitan is a major-quality chord on ♭2).
  const q = parseQuality(chord.symbol);
  if (!q.isPlainMajor) return null;
  return { kind: 'neapolitan', inversion: chord.inversion };
}

function detectSecondary(
  chord: ChordReadout,
  key: KeyContext,
): RomanAnalysis | null {
  const tonicPc = pcFromNote(key.tonic);
  const rootPc = pcFromNote(chord.root);
  const scale = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  const q = parseQuality(chord.symbol);

  // Don't slap a secondary label on a plain diatonic chord.
  // A chord whose root sits on a scale degree AND whose quality matches the
  // diatonic quality on that degree is not a secondary anything.
  const rootDistance = ((rootPc - tonicPc) % 12 + 12) % 12;
  const rootScaleIdx = scale.indexOf(rootDistance);
  if (rootScaleIdx >= 0) {
    const rootDegree = rootScaleIdx + 1;
    const dq = diatonicQualityAt(rootDegree, key.mode);
    const triadMatchesDiatonic =
      (q.isPlainMajor && dq === 'major') ||
      (q.isPlainMinor && dq === 'minor') ||
      (q.isDim && !q.hasSeventh && dq === 'dim');
    const seventhMatchesDiatonic =
      (q.isMaj7 && dq === 'major') ||
      (q.isMin7 && dq === 'minor') ||
      (q.isHalfDim && dq === 'dim') ||
      // The natural V7 in major is on degree 5.
      (q.isDom7 && key.mode === 'major' && rootDegree === 5) ||
      // The natural V7 in minor (raised leading tone) is also on degree 5.
      (q.isDom7 && key.mode === 'minor' && rootDegree === 5);
    if (triadMatchesDiatonic || seventhMatchesDiatonic) return null;
  }

  // Secondary dominant — major triad or dom7 whose root is a P5 above a
  // diatonic non-tonic chord root.
  if (q.isDom7 || q.isPlainMajor) {
    const targetPc = (rootPc - 7 + 12) % 12;
    if (targetPc === tonicPc) return null; // would resolve to I; that's just V[7]
    const targetDistance = ((targetPc - tonicPc) % 12 + 12) % 12;
    const idx = scale.indexOf(targetDistance);
    if (idx < 0) return null;
    const targetDegree = idx + 1;
    return {
      kind: 'sec-dominant',
      hasSeventh: q.isDom7,
      targetDegree,
      targetQuality: diatonicQualityAt(targetDegree, key.mode),
      targetAccidental: '',
      inversion: chord.inversion,
    };
  }

  // Secondary leading-tone — dim / dim7 / m7b5 whose root is m2 below a
  // diatonic non-tonic chord root.
  if (q.isDim || q.isDim7 || q.isHalfDim) {
    const targetPc = (rootPc + 1) % 12;
    if (targetPc === tonicPc) return null; // that's the diatonic vii°
    const targetDistance = ((targetPc - tonicPc) % 12 + 12) % 12;
    const idx = scale.indexOf(targetDistance);
    if (idx < 0) return null;
    const targetDegree = idx + 1;
    return {
      kind: 'sec-leading-tone',
      chordType: q.isDim7 ? 'dim7' : q.isHalfDim ? 'halfdim7' : 'dim',
      targetDegree,
      targetQuality: diatonicQualityAt(targetDegree, key.mode),
      targetAccidental: '',
      inversion: chord.inversion,
    };
  }

  return null;
}

function analyzeDiatonic(chord: ChordReadout, key: KeyContext): RomanAnalysis {
  const rootPc = pcFromNote(chord.root);
  const tonicPc = pcFromNote(key.tonic);
  const distance = ((rootPc - tonicPc) % 12 + 12) % 12;
  const scale = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  let degree = 1;
  let accidental: '' | '#' | 'b' = '';
  const direct = scale.indexOf(distance);
  if (direct >= 0) {
    degree = direct + 1;
  } else {
    // Flat preferred for borrowed chords from the parallel minor (bIII /
    // bVI / bVII), with sharps as a fallback for chromatic mediants.
    const flat = scale.indexOf((distance + 1) % 12);
    const sharp = scale.indexOf((distance - 1 + 12) % 12);
    if (flat >= 0) {
      degree = flat + 1;
      accidental = 'b';
    } else if (sharp >= 0) {
      degree = sharp + 1;
      accidental = '#';
    }
  }
  return {
    kind: 'diatonic',
    degree,
    accidental,
    quality: parseQuality(chord.symbol),
    inversion: chord.inversion,
  };
}

export function analyzeFunctional(
  chord: ChordReadout,
  notes: SpelledNote[],
  key: KeyContext,
): RomanAnalysis {
  return (
    detectAugmentedSixth(notes, key) ??
    detectCommonToneDim(chord, key) ??
    detectNeapolitan(chord, key) ??
    detectSecondary(chord, key) ??
    analyzeDiatonic(chord, key)
  );
}

// ---------------------------------------------------------------------------
// Renderers — Roman
// ---------------------------------------------------------------------------

const ROMAN_UPPER = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const ROMAN_LOWER = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

function romanForTarget(degree: number, q: DiatonicQuality): string {
  const numeral = (q === 'major' ? ROMAN_UPPER : ROMAN_LOWER)[degree] ?? '';
  return numeral + (q === 'dim' ? '°' : '');
}

function figuredBass(hasSeventh: boolean, inversion: number): string {
  const SUP6 = '⁶', SUP4 = '⁴';
  const SUB5 = '₅', SUB4 = '₄', SUB3 = '₃', SUB2 = '₂';
  if (inversion <= 0) return '';
  if (hasSeventh) {
    if (inversion === 1) return SUP6 + SUB5;
    if (inversion === 2) return SUP4 + SUB3;
    if (inversion === 3) return SUP4 + SUB2;
    return '';
  }
  if (inversion === 1) return SUP6;
  if (inversion === 2) return SUP6 + SUB4;
  return '';
}

/**
 * Seventh-chord inversion figures encode the 7th already (⁶₅ = 1st inv of a
 * seventh chord, ⁴₃ = 2nd inv, ⁴₂ = 3rd inv). A standalone "7" sitting next
 * to those figures is redundant — V⁶₅ already means "V7 in first inversion."
 * Root position is the only place the bare 7 belongs.
 *
 * For maj7 chords we keep the "maj" qualifier in inversions (Imaj⁶₅, not
 * I⁶₅) so the quality of the seventh stays unambiguous, while still dropping
 * the standalone 7 digit per the same rule.
 */
function seventhSuffix(a: { hasSeventh?: boolean; inversion: number }): string {
  if (!a.hasSeventh) return '';
  return a.inversion === 0 ? '7' : '';
}

function accDisplay(acc: '' | '#' | 'b'): string {
  if (acc === '#') return '♯';
  if (acc === 'b') return '♭';
  return '';
}

export function renderRoman(a: RomanAnalysis): string {
  switch (a.kind) {
    case 'diatonic': {
      const q = a.quality;
      const lower = q.isMinor || q.isDim || q.isHalfDim || q.isDim7;
      const numeral = (lower ? ROMAN_LOWER : ROMAN_UPPER)[a.degree] ?? '';
      let suffix = '';
      if (q.isDim7) suffix = '°';
      else if (q.isHalfDim) suffix = 'ø';
      else if (q.isDim) suffix = '°';
      else if (q.isAug) suffix = '+';
      // maj7 keeps the "maj" qualifier in inversions; the standalone "7"
      // drops once a figured bass is present. Other sevenths drop the
      // standalone 7 entirely.
      if (q.isMaj7) {
        suffix += a.inversion === 0 ? 'maj7' : 'maj';
      } else if (q.hasSeventh && a.inversion === 0) {
        suffix += '7';
      }
      return `${accDisplay(a.accidental)}${numeral}${suffix}${figuredBass(q.hasSeventh, a.inversion)}`;
    }
    case 'sec-dominant': {
      const fig = figuredBass(a.hasSeventh, a.inversion);
      const target = romanForTarget(a.targetDegree, a.targetQuality);
      return `V${seventhSuffix(a)}${fig}/${accDisplay(a.targetAccidental)}${target}`;
    }
    case 'sec-leading-tone': {
      let viiBase = 'vii°';
      if (a.chordType === 'halfdim7') viiBase = 'viiø';
      const hasSeventh = a.chordType !== 'dim';
      const seventh = hasSeventh && a.inversion === 0 ? '7' : '';
      const fig = figuredBass(hasSeventh, a.inversion);
      const target = romanForTarget(a.targetDegree, a.targetQuality);
      return `${viiBase}${seventh}${fig}/${accDisplay(a.targetAccidental)}${target}`;
    }
    case 'neapolitan': {
      // Conventional first-inversion voicing → N6 (♭II⁶); we honour the
      // user's actual voicing when they put it somewhere else.
      const fig = a.inversion === 1 ? '⁶' : a.inversion === 2 ? '⁶₄' : '';
      return `♭II${fig}`;
    }
    case 'aug6':
      return `${a.type}+6`;
    case 'common-tone-dim':
      return 'ct°7';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HarmonicReadout({
  width,
  height,
  baseWidth: _baseWidth = SLOT_REF_W,
  baseHeight = SLOT_REF_H,
  mode = 'chord',
  showIntervals = true,
}: Props) {
  const snap = useMidi();
  const key = useApp((s) => s.key);
  const analysis = useMemo(
    () => analyze(snap.active.map((n) => n.midi), key),
    [snap.active, key],
  );

  // Vestigial — _baseWidth is accepted for prop-shape parity with notation
  // but the scale is height-driven (see CenteredScaled).
  void _baseWidth;

  if (analysis.empty) return null;
  const chord = analysis.chord;

  let inner: React.ReactNode = null;

  if (snap.inputId === ACOUSTIC_INPUT_ID) {
    const note = analysis.notes[0];
    inner = <span className="font-display text-5xl font-semibold text-ink-50">{note.letter}{accidentalToGlyph(note.accidental)}<span className="text-ink-400 text-2xl ml-1">{note.octave}</span></span>;
  } else if (mode === 'chord') {
    if (!chord) return null;
    inner = <ChordSymbolDisplay chord={chord} />;
  } else if (mode === 'roman') {
    if (!chord) return null;
    const fa = analyzeFunctional(chord, analysis.notes, key);
    const text = renderRoman(fa);
    inner = (
      <span className="font-display text-5xl font-semibold text-ink-50 leading-none tracking-tight">
        {text}
      </span>
    );
  } else {
    // mode === 'advanced'
    inner = (
      <AdvancedContent
        notes={analysis.notes}
        chord={chord}
        intervals={analysis.intervals}
        showIntervals={showIntervals}
      />
    );
  }

  return (
    <CenteredScaled width={width} height={height} baseHeight={baseHeight}>
      {inner}
    </CenteredScaled>
  );
}

/**
 * Slot-driven, content-centred wrapper that matches the notation module's
 * resize contract:
 *
 *   - The OUTER box is the slot pixel rectangle. Flex-centring places the
 *     content (whatever its natural CSS layout size is) at the slot's
 *     visual centre, both axes.
 *   - The INNER box wraps the content in `transform: scale(s, s)` where
 *     `s = baseHeight / SLOT_REF_H`. CSS transforms don't affect layout,
 *     so the flex-centre still anchors on the unscaled layout box and
 *     `transformOrigin: 'center center'` keeps the scaled visual centred
 *     on the same point — no drift in either axis as `s` changes.
 *   - Side drag: slot grows, base dims unchanged → `s` unchanged →
 *     content stays the same pixel size with more empty space around it.
 *   - Corner drag: slot AND base grow by the same factor (see
 *     ModuleFrame.tsx) → `s` grows by that factor → content visually
 *     zooms while staying centred.
 *
 * `overflow: hidden` clips content if the user side-drags the slot
 * smaller than the (unscaled) content — the alternative would let chord
 * glyphs spill out over neighbouring modules.
 */
function CenteredScaled({
  width,
  height,
  baseHeight,
  children,
}: {
  width: number;
  height: number;
  baseHeight: number;
  children: React.ReactNode;
}) {
  const scale = baseHeight / SLOT_REF_H;
  return (
    <div
      className="text-ink-50"
      style={{
        width,
        height,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ChordSymbolDisplay({ chord }: { chord: ChordReadout }) {
  const formatted = formatChord(chord.symbol);
  return (
    <div className="flex items-baseline gap-1">
      <span className="font-display text-6xl font-semibold text-ink-50 leading-none">
        {prettyAccidentals(formatted.root)}
      </span>
      {formatted.rest && (
        <span className="font-display text-3xl font-light text-ink-200 leading-none">
          {prettyAccidentals(formatted.rest)}
        </span>
      )}
      {formatted.bass && (
        <span className="font-display text-3xl text-ink-300 leading-none ml-1">
          /<span className="text-ink-100">{prettyAccidentals(formatted.bass)}</span>
        </span>
      )}
    </div>
  );
}

function AdvancedContent({
  notes,
  chord,
  intervals,
  showIntervals,
}: {
  notes: ReturnType<typeof analyze>['notes'];
  chord: ChordReadout | null;
  intervals: ReturnType<typeof analyze>['intervals'];
  showIntervals: boolean;
}) {
  // No outer slot-sized div here — CenteredScaled owns the slot and
  // flex-centres this block inside it. We just lay out at our natural
  // size so the CSS scale on the wrapper applies uniformly.
  const formatted = chord ? formatChord(chord.symbol) : null;
  return (
    <div className="flex flex-col text-ink-50">
      <div className="flex items-baseline gap-2 flex-wrap mb-3">
        {notes.map((n, i) => (
          <span
            key={`${n.scientific}-${i}`}
            className="font-display text-2xl text-ink-100 font-medium tabular-nums"
          >
            {n.letter}
            <span className="text-accent-soft">{accidentalToGlyph(n.accidental)}</span>
            <span className="text-ink-400 text-base ml-0.5">{n.octave}</span>
          </span>
        ))}
      </div>

      {formatted && (
        <div className="flex items-baseline gap-2">
          <span className="font-display text-5xl font-semibold text-ink-50 leading-none">
            {formatted.root}
          </span>
          {formatted.rest && (
            <span className="font-display text-3xl font-light text-ink-200 leading-none">
              {formatted.rest}
            </span>
          )}
          {formatted.bass && (
            <span className="font-display text-3xl text-ink-300 leading-none">
              /<span className="text-ink-100">{formatted.bass}</span>
            </span>
          )}
        </div>
      )}

      {chord && chord.inversion > 0 && (
        <div className="text-ink-400 text-xs mt-2 uppercase tracking-wider">
          {chord.inversion === 1 && '1st inversion'}
          {chord.inversion === 2 && '2nd inversion'}
          {chord.inversion === 3 && '3rd inversion'}
          {chord.inversion > 3 && `${chord.inversion}th inversion`}
        </div>
      )}

      {showIntervals && intervals.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {intervals.map((iv, i) => (
            <span key={i} className="text-xs text-ink-300">
              <span className="font-mono text-ink-100">{iv.name}</span>
              <span className="text-ink-400 ml-1">{iv.long}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

