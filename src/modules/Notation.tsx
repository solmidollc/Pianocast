import { useEffect, useMemo, useRef } from 'react';
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental as VFAccidental,
  StaveConnector,
} from 'vexflow';
import { useMidi } from '../midi/useMidi';
import { useApp } from '../state/store';
import { analyze } from '../theory/analysis';
import {
  keySignatureCount,
  keySignatureAlterations,
  visibleAccidental,
} from '../theory/spelling';
import type { SpelledNote } from '../theory/types';

/**
 * Two visual layouts of the grand staff:
 *
 *   - 'standard'   The traditional engraver's grand staff with extra
 *                  breathing space between treble and bass. Middle C
 *                  appears on a ledger line just above the bass clef AND
 *                  just below the treble clef — at slightly different
 *                  y positions, which is normal for printed music and
 *                  what most musicians expect to see.
 *
 *   - 'centered'   Compact grand staff with the inter-stave gap tuned so
 *                  middle C sits at EXACTLY the same y position whether
 *                  reached from the treble clef (ledger below E4) or the
 *                  bass clef (ledger above A3). Tighter overall; useful
 *                  for narrow notation slots.
 *
 * Default is 'standard' per the user's preference; centered is opt-in.
 */
export type NotationStyle = 'standard' | 'centered';

interface Props {
  /** Slot pixel size — the rectangle the SVG fills. Side-drag changes one
   *  of these. Drives the SVG's CSS dimensions. */
  width: number;
  height: number;
  /** Encoded staff pixel-scale: `scale = baseHeight / SLOT_REF_H`. Corner
   *  drag scales both `baseWidth` and `baseHeight` (and the slot) by the
   *  same factor — see ModuleFrame.tsx. Defaults match `SLOT_REF_*` so
   *  callers that don't pass them render at scale = 1. */
  baseWidth?: number;
  baseHeight?: number;
  /** Vestigial — the slot now determines the visible range. Kept so the
   *  Properties panel's existing Range control compiles; it has no effect
   *  on layout. (Spec: "the user sets the visible range by dragging the
   *  edges, and the staff stays centered in whatever area they choose.") */
  range?: [number, number];
  /** Ottava displacement so extreme notes sit near the staff instead of on
   *  towering ledger lines. '8va' shows treble notes an octave lower and
   *  draws an `8va` text above; '8vb' raises bass notes an octave and draws
   *  `8vb` below. 'none' = play as written. */
  trebleOttava?: 'none' | '8va';
  bassOttava?: 'none' | '8vb';
  /** Layout style — see NotationStyle. Default 'standard'. */
  style?: NotationStyle;
}

/** Reference slot dims encoded by `baseWidth`/`baseHeight` at scale = 1.
 *  Matches the store's notation default (220 × 320) so a fresh module
 *  ships at scale = 1 and the corner-drag math is well-conditioned. */
const SLOT_REF_W = 220;
const SLOT_REF_H = 320;

// Near-white foreground that reads cleanly on both solid dark and the
// transparent (chroma-key) background option. Matches the existing ink-100
// theme token instead of harsh pure white.
const NOTATION_FG = '#EDEDEF';

/** Width of the chord column — one whole-note head plus any accidentals. */
const CHORD_COL = 56;
/** Right-side trailing breathing room. Just past the chord column; this isn't a measure. */
const TRAIL_PAD = 8;
/** Left-side reserved for the brace glyph, which draws outside the staves. */
const BRACE_PAD = 14;
/**
 * Inter-stave gap per layout style, in pixels.
 *
 *   STANDARD (50)  Traditional engraver's breathing room. Middle C lands
 *                  on a ledger line slightly above the bass and slightly
 *                  below the treble — at different y positions — which
 *                  is how printed sheet music has always looked.
 *
 *   CENTERED (20)  Musically-derived: E4 (treble bottom) down to A3
 *                  (bass top) is exactly 4 diatonic half-spaces, so at
 *                  5 px each that's 20 px and middle C lands at EXACTLY
 *                  the same y from both clefs. Tighter layout overall.
 */
const STANDARD_GAP = 50;
const CENTERED_GAP = 20;
/** Default 5-line stave is 40 px tall at VexFlow's default 10-px line
 *  spacing. */
const STAVE_HEIGHT = 40;
// GLYPH_HALF (5 px) and EDGE_MARGIN (10 px) previously drove the auto-
// computed vertical bounds. With slot-driven viewBox the user controls
// margins by dragging the edges, so neither constant is needed any more.

const VF_KEY_SIG: Record<string, string> = {
  'C-major': 'C', 'G-major': 'G', 'D-major': 'D', 'A-major': 'A', 'E-major': 'E',
  'B-major': 'B', 'F#-major': 'F#', 'C#-major': 'C#',
  'F-major': 'F', 'Bb-major': 'Bb', 'Eb-major': 'Eb', 'Ab-major': 'Ab',
  'Db-major': 'Db', 'Gb-major': 'Gb', 'Cb-major': 'Cb',
  'A-minor': 'Am', 'E-minor': 'Em', 'B-minor': 'Bm', 'F#-minor': 'F#m',
  'C#-minor': 'C#m', 'G#-minor': 'G#m', 'D#-minor': 'D#m', 'A#-minor': 'A#m',
  'D-minor': 'Dm', 'G-minor': 'Gm', 'C-minor': 'Cm', 'F-minor': 'Fm',
  'Bb-minor': 'Bbm', 'Eb-minor': 'Ebm', 'Ab-minor': 'Abm',
};

function toVexKey(s: SpelledNote): string {
  // VexFlow key format: "c#/4", "bb/3".
  return `${s.letter.toLowerCase()}${s.accidental}/${s.octave}`;
}

// The previous range-driven sizing used whiteStepsFromF5 / whiteStepsFromG2
// to convert MIDI extremes into half-space offsets above / below the
// staves. With slot-driven viewBox the slot itself determines what's
// visible, so those helpers are gone.

function partition(notes: SpelledNote[]): { treble: SpelledNote[]; bass: SpelledNote[] } {
  const treble: SpelledNote[] = [];
  const bass: SpelledNote[] = [];
  for (const n of notes) {
    if (n.midi >= 60) treble.push(n);
    else bass.push(n);
  }
  return { treble, bass };
}

/**
 * Apply an ottava displacement for DISPLAY — returns a SpelledNote whose
 * letter / accidental are identical but octave is shifted. The midi is also
 * shifted so the VexFlow key string ends up an octave away. `8va` lowers
 * the written pitch by an octave (read up); `8vb` raises it.
 */
function applyOttava(n: SpelledNote, shiftOctaves: number): SpelledNote {
  if (shiftOctaves === 0) return n;
  return {
    ...n,
    midi: n.midi + shiftOctaves * 12,
    octave: n.octave + shiftOctaves,
    scientific: `${n.letter}${n.accidental}${n.octave + shiftOctaves}`,
  };
}

export function NotationModule({
  width,
  height,
  baseWidth: _baseWidth = SLOT_REF_W,
  baseHeight = SLOT_REF_H,
  range: _range = [21, 108],
  trebleOttava = 'none',
  bassOttava = 'none',
  style = 'standard',
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const snap = useMidi();
  const key = useApp((s) => s.key);

  const analysis = useMemo(
    () => analyze(snap.active.map((n) => n.midi), key),
    [snap.active, key],
  );

  // Vestigial — _range / _baseWidth are accepted for prop compatibility
  // but no longer drive layout; the slot does (see file header).
  void _range;
  void _baseWidth;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';

    const keySigName = VF_KEY_SIG[`${key.tonic}-${key.mode}`] ?? 'C';

    // Probe: measure where notes would start on the stave (i.e. width of
    // clef + key signature). We compose the actual staves at exactly that
    // width plus a single chord column and a small trailing pad — no
    // multi-beat / full-measure reservation, because there's only ever one
    // chord on stage at a time.
    const probeT = new Stave(0, 0, 500);
    probeT.addClef('treble').addKeySignature(keySigName);
    const probeB = new Stave(0, 0, 500);
    probeB.addClef('bass').addKeySignature(keySigName);
    const headerWidth = Math.max(probeT.getNoteStartX(), probeB.getNoteStartX());

    const staveWidth = headerWidth + CHORD_COL + TRAIL_PAD;
    const naturalStaffWidth = BRACE_PAD + staveWidth;

    // ---- Slot-driven viewBox -------------------------------------------
    //
    // The notation module's resize contract (see ModuleFrame.tsx):
    //   - Side drag:   changes the slot (width OR height). The
    //                  natural-coord viewBox window grows in that axis,
    //                  centred on the staff, revealing more notes (or
    //                  more horizontal breathing room) at the SAME
    //                  pixel size.
    //   - Corner drag: scales slot AND base dims by the same factor.
    //                  `scale = baseHeight / SLOT_REF_H` grows with the
    //                  factor, so the natural viewBox window
    //                  (= slotPx / scale) stays constant — same content
    //                  visible — but the pixel area grows → the staff
    //                  zooms.
    //
    // Aspect: viewBox dims are (slotW / scale, slotH / scale), so their
    // aspect equals the slot's aspect. `preserveAspectRatio="xMidYMid
    // meet"` therefore doesn't letterbox and no axis is squished. No
    // non-uniform stretching anywhere.
    const interStaveGap = style === 'centered' ? CENTERED_GAP : STANDARD_GAP;
    const trebleY = 0;
    const bassY = trebleY + STAVE_HEIGHT + interStaveGap;
    const bassBottomY = bassY + STAVE_HEIGHT;
    // The staff's natural-coord centre — the anchor we keep at the
    // viewBox centre so the staff stays centred no matter how the user
    // drags the slot edges.
    //
    // Vertical: midpoint between the treble top line (trebleY) and the
    // bass bottom line (bassBottomY). This relies on `space_above_staff_ln`
    // and `space_below_staff_ln` being 0 on the staves below — otherwise
    // VexFlow would push the top line down by space_above_staff_ln *
    // spacing_between_lines_px (default 4 * 10 = 40 px) and the actual
    // rendered system would sit ~40 px below where we centre.
    //
    // Horizontal: the brace glyph draws to the LEFT of the staves, within
    // the [0, BRACE_PAD] gutter we reserved. The visible system therefore
    // spans [0, BRACE_PAD + staveWidth] = [0, naturalStaffWidth]; its
    // centre is naturalStaffWidth/2, NOT BRACE_PAD + staveWidth/2 (which
    // would centre just the staff lines and leave the brace hanging off
    // to the left of the slot's centre).
    const staffCenterY = (trebleY + bassBottomY) / 2;
    const staffCenterX = naturalStaffWidth / 2;

    const scale = baseHeight / SLOT_REF_H;
    const viewBoxW = width / scale;
    const viewBoxH = height / scale;
    const viewBoxX = staffCenterX - viewBoxW / 2;
    const viewBoxY = staffCenterY - viewBoxH / 2;

    const renderer = new Renderer(host, Renderer.Backends.SVG);
    // renderer.resize sets the SVG's intrinsic dims so VexFlow's internal
    // coordinate space matches what we'll viewBox below. Use max with the
    // natural staff width to guarantee VexFlow's own internal layout has
    // room for the brace + staves even if the user dragged the slot
    // narrower than the staff's natural width (the SVG itself will be
    // letterboxed-clipped by preserveAspectRatio, but VexFlow shouldn't
    // mis-layout while drawing).
    renderer.resize(Math.max(viewBoxW, naturalStaffWidth), viewBoxH);
    const ctx = renderer.getContext();
    ctx.setFont('Inter', 12);
    ctx.setFillStyle(NOTATION_FG);
    ctx.setStrokeStyle(NOTATION_FG);

    // space_above_staff_ln / space_below_staff_ln default to 4 each (40 px
    // of empty bbox padding above/below the line group) — VexFlow uses
    // them to reserve room for annotations like tempo markers. We don't
    // use those annotations, and the extra padding would shift the top
    // line down by 40 px from the y parameter, throwing off our
    // staff-centred viewBox. Zeroing both makes `trebleY`, `bassY`, and
    // `bassBottomY` describe the actual line positions, so the centring
    // math above is correct.
    const staveOptions = { space_above_staff_ln: 0, space_below_staff_ln: 0 };
    const treble = new Stave(BRACE_PAD, trebleY, staveWidth, staveOptions);
    treble.addClef('treble').addKeySignature(keySigName);
    treble.setContext(ctx).draw();

    const bass = new Stave(BRACE_PAD, bassY, staveWidth, staveOptions);
    bass.addClef('bass').addKeySignature(keySigName);
    bass.setContext(ctx).draw();

    // Brace + connecting lines for the grand staff look.
    new StaveConnector(treble, bass).setType('brace').setContext(ctx).draw();
    new StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
    new StaveConnector(treble, bass).setType('singleRight').setContext(ctx).draw();

    // 8va / 8vb indicator text drawn directly on the SVG. Cheaper than
    // VexFlow's TextBracket since we only need a single static label per
    // stave and we don't need to span a passage of notes.
    if (trebleOttava === '8va') {
      ctx.save();
      ctx.setFont('Inter', 11, 'italic');
      ctx.fillText('8va', BRACE_PAD + headerWidth, trebleY - 4);
      ctx.restore();
    }
    if (bassOttava === '8vb') {
      ctx.save();
      ctx.setFont('Inter', 11, 'italic');
      ctx.fillText('8vb', BRACE_PAD + headerWidth, bassY + STAVE_HEIGHT + 12);
      ctx.restore();
    }

    // Apply ottava to the actual notes for display. The transpose lowers /
    // raises the rendered pitch so high / low notes sit near the staff.
    const displayNotes = analysis.notes.map((n) => {
      if (n.midi >= 60 && trebleOttava === '8va') return applyOttava(n, -1);
      if (n.midi < 60 && bassOttava === '8vb') return applyOttava(n, +1);
      return n;
    });
    const { treble: tn, bass: bn } = partition(displayNotes);

    // Key-signature-aware accidentals: derive each note's visible accidental
    // from the difference between its actual spelling and what the signature
    // covers. Includes naturals to cancel signature sharps / flats.
    const alterations = keySignatureAlterations(key);

    const buildNote = (notes: SpelledNote[], clef: 'treble' | 'bass'): StaveNote | null => {
      // Idle staves are intentionally empty — no whole rest, no measure
      // rest, no placeholder glyph. The clef, key signature and bare lines
      // carry the visual identity until a note actually sounds.
      if (notes.length === 0) return null;
      const keys = notes.map(toVexKey);
      const sn = new StaveNote({ keys, duration: 'w', clef });
      notes.forEach((n, idx) => {
        const acc = visibleAccidental(n, alterations);
        if (acc) sn.addModifier(new VFAccidental(acc), idx);
      });
      return sn;
    };

    const trebleNote = buildNote(tn, 'treble');
    const bassNote = buildNote(bn, 'bass');

    if (trebleNote || bassNote) {
      const voices: Voice[] = [];
      let trebleVoice: Voice | null = null;
      let bassVoice: Voice | null = null;
      if (trebleNote) {
        trebleVoice = new Voice({ num_beats: 4, beat_value: 4 })
          .setStrict(false)
          .addTickables([trebleNote]);
        voices.push(trebleVoice);
      }
      if (bassNote) {
        bassVoice = new Voice({ num_beats: 4, beat_value: 4 })
          .setStrict(false)
          .addTickables([bassNote]);
        voices.push(bassVoice);
      }
      const fmt = new Formatter();
      if (trebleVoice) fmt.joinVoices([trebleVoice]);
      if (bassVoice) fmt.joinVoices([bassVoice]);
      // Format width is just the chord column. We don't reserve full-measure
      // breathing room — this is a live snapshot, one chord at a time.
      fmt.format(voices, CHORD_COL);
      if (trebleVoice) trebleVoice.draw(ctx, treble);
      if (bassVoice) bassVoice.draw(ctx, bass);
    }

    // viewBox is the slot in natural coords (slot pixels / scale),
    // centred on the staff. Y origin is negative whenever the slot is
    // tall enough to reveal notes above the treble top line (C8 et al.) —
    // exactly what SVG viewBox's y-origin allows. The user controls how
    // much margin (i.e. how much ledger room above / below) there is by
    // dragging the top / bottom edges of the slot.
    const svg = host.querySelector('svg');
    if (svg) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute(
        'viewBox',
        `${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}`,
      );
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const el = svg as SVGSVGElement;
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.display = 'block';
    }
  }, [analysis, key.tonic, key.mode, width, height, baseHeight, trebleOttava, bassOttava, style]);

  return <div ref={hostRef} className="w-full h-full notation-host" />;
}

export { keySignatureCount };
