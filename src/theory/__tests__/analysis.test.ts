import { describe, it, expect } from 'vitest';
import { analyze } from '../analysis';
import { analyzeFunctional, renderRoman } from '../../modules/HarmonicReadout';
import type { KeyContext, KeyName, KeyMode } from '../types';

/**
 * Tests pinning down the chord-symbol + Roman-numeral regressions called
 * out in the consolidated fix prompt. These exist as guardrails so future
 * picker or detector changes can't silently re-break:
 *
 *   - Half-diminished sevenths must beat their minor-sixth enharmonic
 *     re-spelling when the bass IS the half-dim root (B-D-F-A bass=B
 *     → Bm7♭5, not Dm6/B).
 *
 *   - Neapolitan must match by scale degree / pitch class — regardless of
 *     whether the chord root is spelled D♭ or C♯ — in both C major and
 *     C minor, root position and first inversion.
 *
 *   - Added-tone chords (G add 4 = G-B-C-D) must come out as Gadd4, not
 *     an Em-something convolution.
 */

const key = (tonic: KeyName, mode: KeyMode): KeyContext => ({ tonic, mode });

describe('chord detector', () => {
  it('names the half-diminished 7th when the bass is its root (B-D-F-A in C major)', () => {
    // Bm7♭5 — pitch set {B, D, F, A}, B in the bass.
    const a = analyze([59, 62, 65, 69], key('C', 'major'));
    expect(a.chord?.symbol).toBe('Bm7b5');
    expect(a.chord?.root).toBe('B');
    expect(a.chord?.inversion).toBe(0);
  });

  it('keeps the m7♭5 reading when the bass is its root in a flat key too', () => {
    // Dm7♭5 in C minor — pitch set {D, F, Ab, C}, D in the bass.
    const a = analyze([62, 65, 68, 72], key('C', 'minor'));
    expect(a.chord?.symbol).toBe('Dm7b5');
    expect(a.chord?.root).toBe('D');
    expect(a.chord?.inversion).toBe(0);
  });

  it('recognises G add 4 (G-B-C-D) as Gadd4, not an Em-flat-anything', () => {
    // G4 (MIDI 67), B4 (71), C5 (72), D5 (74).
    const a = analyze([67, 71, 72, 74], key('C', 'major'));
    expect(a.chord?.symbol).toBe('Gadd4');
    expect(a.chord?.root).toBe('G');
    expect(a.chord?.quality).toBe('add4');
  });

  it('recognises G add 2 (G-A-B-D) as Gadd2', () => {
    const a = analyze([67, 69, 71, 74], key('C', 'major'));
    expect(a.chord?.symbol).toBe('Gadd2');
    expect(a.chord?.quality).toBe('add2');
  });
});

describe('Neapolitan detection (PC-only — spelling-agnostic)', () => {
  // The fix definitively requires matching by scale degree / pitch class so
  // a D♭ vs C♯ spelling can never block detection.

  it('labels D♭-F-A♭ as ♭II in C major', () => {
    const a = analyze([61, 65, 68], key('C', 'major'));
    expect(a.chord).not.toBeNull();
    const fa = analyzeFunctional(a.chord!, a.notes, key('C', 'major'));
    expect(fa.kind).toBe('neapolitan');
    expect(renderRoman(fa)).toBe('♭II');
  });

  it('labels F-A♭-D♭ as N6 (♭II⁶, first inversion) in C major', () => {
    // F4 (65), Ab4 (68), Db5 (73).
    const a = analyze([65, 68, 73], key('C', 'major'));
    expect(a.chord).not.toBeNull();
    expect(a.chord?.inversion).toBe(1);
    const fa = analyzeFunctional(a.chord!, a.notes, key('C', 'major'));
    expect(fa.kind).toBe('neapolitan');
    expect(renderRoman(fa)).toBe('♭II⁶');
  });

  it('labels D♭-F-A♭ as ♭II in C minor', () => {
    const a = analyze([61, 65, 68], key('C', 'minor'));
    expect(a.chord).not.toBeNull();
    const fa = analyzeFunctional(a.chord!, a.notes, key('C', 'minor'));
    expect(fa.kind).toBe('neapolitan');
    expect(renderRoman(fa)).toBe('♭II');
  });

  it('labels F-A♭-D♭ as N6 in C minor', () => {
    const a = analyze([65, 68, 73], key('C', 'minor'));
    expect(a.chord).not.toBeNull();
    expect(a.chord?.inversion).toBe(1);
    const fa = analyzeFunctional(a.chord!, a.notes, key('C', 'minor'));
    expect(fa.kind).toBe('neapolitan');
    expect(renderRoman(fa)).toBe('♭II⁶');
  });
});

describe('Roman numerals — modal borrowing reads through the chord detector', () => {
  it('labels Dm7♭5 in C major as iiø7 (borrowed from C minor)', () => {
    const a = analyze([62, 65, 68, 72], key('C', 'major'));
    expect(a.chord?.symbol).toBe('Dm7b5');
    const fa = analyzeFunctional(a.chord!, a.notes, key('C', 'major'));
    expect(renderRoman(fa)).toBe('iiø7');
  });

  it('labels Fm in C major as iv (borrowed from C minor)', () => {
    // F4 (65), Ab4 (68), C5 (72).
    const a = analyze([65, 68, 72], key('C', 'major'));
    expect(a.chord?.symbol).toBe('Fm');
    const fa = analyzeFunctional(a.chord!, a.notes, key('C', 'major'));
    expect(renderRoman(fa)).toBe('iv');
  });

  it('labels A♭ major in C major as ♭VI', () => {
    // Ab4 (68), C5 (72), Eb5 (75).
    const a = analyze([68, 72, 75], key('C', 'major'));
    expect(a.chord?.symbol).toBe('Ab');
    const fa = analyzeFunctional(a.chord!, a.notes, key('C', 'major'));
    expect(renderRoman(fa)).toBe('♭VI');
  });

  it('labels B♭ major in C major as ♭VII', () => {
    // Bb4 (70), D5 (74), F5 (77).
    const a = analyze([70, 74, 77], key('C', 'major'));
    expect(a.chord?.symbol).toBe('Bb');
    const fa = analyzeFunctional(a.chord!, a.notes, key('C', 'major'));
    expect(renderRoman(fa)).toBe('♭VII');
  });
});
