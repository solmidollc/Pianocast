/**
 * Instrument catalog.
 *
 * Each entry binds a user-facing label to a smplr factory + per-instrument
 * behaviour the audio engine needs to respect (sustain pedal, velocity
 * sensitivity, sustained vs decaying tone). The engine reads from this
 * catalog when the user picks a new instrument and never special-cases any
 * particular factory — adding a new instrument is one entry here plus,
 * optionally, an attribution line in About / Credits.
 *
 * Licensing rule (load-bearing — read before adding entries):
 *
 *   Every source must be CC0, CC BY, or explicitly commercial-use OK.
 *   No CC-BY-NC, no "personal use only" sample sets. Salamander is CC BY
 *   and gets its mandatory credit in the About dialog; VCSL and FreePats
 *   are CC0 and need none (we credit them anyway because it's polite).
 *
 *   When in doubt, leave the entry out. The jRhodes Rhodes set is the
 *   canonical trap — beautiful samples, but CC-BY-NC, so it stays off the
 *   menu unless / until we license a commercial Rhodes pack.
 */

import {
  ElectricPiano,
  Sampler,
  SplendidGrandPiano,
  Versilian,
  type ElectricPiano as ElectricPianoInstance,
  type Sampler as SamplerInstance,
  type SmplrGroup,
  type SmplrPreset,
  type SmplrRegion,
  type SplendidGrandPiano as SplendidGrandPianoInstance,
  type Versilian as VersilianInstance,
} from 'smplr';

export type InstrumentId =
  | 'concert-grand'
  | 'concert-grand-hq'
  | 'harpsichord'
  | 'electric-piano'
  | 'pipe-organ';

/** Family is used by the UI to group icons / labels and by the engine for
 *  things like "default tone tilt for this family." */
export type InstrumentFamily = 'piano' | 'harpsichord' | 'epiano' | 'organ';

/**
 * The runtime sampler handle. All five instrument factories implement the
 * common `Smplr` interface (start / stop / setCC / setDetune / dispose +
 * output channel + ready promise), so the engine can drive any of them
 * through the same code path.
 */
export type SmplrInstrument =
  | SplendidGrandPianoInstance
  | VersilianInstance
  | ElectricPianoInstance
  | SamplerInstance;

export interface InstrumentLoadOptions {
  destination: AudioNode;
  onLoadProgress?: (frac: number) => void;
}

export interface InstrumentDef {
  id: InstrumentId;
  label: string;
  family: InstrumentFamily;
  /** Should the engine honour CC64 (sustain pedal) for this instrument? */
  honorsSustain: boolean;
  /** Does this instrument's level / timbre respond to velocity? */
  velocitySensitive: boolean;
  /** 'natural' = note decays naturally, eventually silent (piano, harpsichord,
   *  epiano). 'sustained' = note holds at full volume while key is down and
   *  releases cleanly when lifted (organ). The engine uses this to decide
   *  whether key-up should hard-cut or rely on the sample's release tail. */
  toneDecay: 'natural' | 'sustained';
  /**
   * Damper-release character.
   *
   * Three sub-values together describe how a key-up release sounds across
   * the keyboard:
   *
   *   - `baseReleaseSec` is the mid-register release time. Mapped to smplr's
   *     per-note `ampRelease`. ~0.3 s gives the underlying release / damper
   *     sample (Salamander records a real damper-on-string thud) enough
   *     room to play through naturally; the earlier 0.12 s fix was too
   *     short and truncated those samples, which is what made it sound
   *     clipped and synthetic.
   *
   *   - `lowReleaseMul` / `highReleaseMul` scale the release by register.
   *     Real pianos damp slowly in the bass (long heavy strings, big
   *     dampers) and quickly in the treble (short strings, small dampers).
   *     A single global value sounds wrong at one end. The engine linearly
   *     interpolates between these from MIDI 21 (A0) up to `noDamperAboveMidi`.
   *
   *   - `noDamperAboveMidi` is the cutoff above which the sample's NATURAL
   *     release plays — real grands lose their dampers around F6 and those
   *     strings ring out regardless. Above this MIDI number the engine
   *     omits `ampRelease` entirely; below it, the per-note value is the
   *     instrument's curve times the user's "Release" feel multiplier.
   *
   * Undefined `baseReleaseSec` means the instrument has its own release
   * behaviour and the engine doesn't touch it (harpsichord, organ).
   */
  baseReleaseSec?: number;
  /** Register scaling at MIDI 21 (A0). Multiplies `baseReleaseSec`. */
  lowReleaseMul?: number;
  /** Register scaling at `noDamperAboveMidi - 1`. Multiplies `baseReleaseSec`. */
  highReleaseMul?: number;
  noDamperAboveMidi?: number;
  /**
   * Velocity-layer boundaries (inclusive max-velocity of each layer except
   * the last). For Salamander Slender, smplr exposes 5 layers
   *   PPP [1..40]  PP [41..67]  MP [68..84]  MF [85..100]  FF [101..127]
   * so the boundaries are [40, 67, 84, 100]. Within ±crossfadeWidth of any
   * boundary the engine fires TWIN voices (one in each adjacent layer)
   * with equal-power gains, eliminating the audible step a single-voice
   * sampler would produce when crossing the boundary. Undefined means
   * "single-layer instrument or layer set we haven't characterised" — the
   * engine falls back to one voice.
   */
  velocityLayers?: number[];
  /** Half-width of the crossfade zone around each velocity-layer
   *  boundary, in MIDI velocity units. Default 5. */
  crossfadeWidth?: number;
  /** Optional one-line attribution shown in About / Credits when this
   *  instrument has been loaded at least once during the session.
   *  CC BY sources MUST set this. CC0 sources may set it as courtesy. */
  attribution: string | null;
  /** Short tooltip in the picker. */
  hint: string;
  /** True when the instrument is bundled / cheap to load. False means a
   *  large on-demand fetch — the UI surfaces this. */
  bundled: boolean;
  /**
   * Build the smplr instance. The engine wires the resulting `output` into
   * the tone-shaping chain; the factory is responsible only for fetching
   * its own samples.
   */
  create(ctx: AudioContext, opts: InstrumentLoadOptions): SmplrInstrument;
}

// ---------------------------------------------------------------------------
// Salamander HQ preset — the locally-bundled 16-velocity-layer pack
// ---------------------------------------------------------------------------
//
// smplr's stock SplendidGrandPiano factory targets the 5-layer "Slender"
// arrangement of the Salamander samples hosted at smpldsnds.github.io. The
// full Salamander Grand Piano V3 release at archive.org ships 16 velocity
// layers per pitched note, sampled every minor third from A0 (MIDI 21) to
// C8 (108) — a richer set that exposes timbre detail the Slender layers
// have to interpolate through.
//
// To play it we sidestep `SplendidGrandPiano` and use smplr's generic
// `Sampler` with a hand-built `SmplrPreset`. The preset declares 16 groups
// (one per velocity layer), each with 30 regions (one per sampled note).
// File-naming convention matches the V3 release: `<NoteName>v<layer>.ogg`
// — `A0v1.ogg`, `D#4v12.ogg`, `C8v16.ogg`. The pitch / key-range / layer
// boundaries are copied verbatim from the official SFZ in the bundle.
//
// The samples live under `/samples/salamander-hq/` (Vite serves the
// `public/` directory at that path), so the engine pays only a local
// disk read on instrument switch — no network, no progress UI.

/** Sampled MIDI notes in the V3 release (every minor third A0..C8). */
const HQ_SAMPLED_MIDIS = [
  21, 24, 27, 30, 33, 36, 39, 42, 45, 48,
  51, 54, 57, 60, 63, 66, 69, 72, 75, 78,
  81, 84, 87, 90, 93, 96, 99, 102, 105, 108,
];

/**
 * File-name stem matching each sampled MIDI above. We rename Salamander's
 * sharp-keyed files from `D#1v1.ogg` to `Ds1v1.ogg` on install — Vite's
 * dev server doesn't reliably resolve `%23`-encoded sharps in static
 * paths, so swapping `#` for `s` sidesteps the issue entirely. The install
 * script in `scripts/install-salamander-hq.sh` performs the rename, and
 * the catalogue speaks in the renamed names.
 *
 * Same length / order as HQ_SAMPLED_MIDIS.
 */
const HQ_NOTE_NAMES = [
  'A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3',
  'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5',
  'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8',
];

/** Per-layer velocity ranges, copied from SalamanderGrandPianoV3.sfz. */
const HQ_LAYER_VEL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [1, 26],   [27, 34],  [35, 36],  [37, 43],  [44, 46],  [47, 50],
  [51, 56],  [57, 64],  [65, 72],  [73, 80],  [81, 88],  [89, 96],
  [97, 104], [105, 112],[113, 120],[121, 127],
];

/** Layer boundaries for the engine's twin-voice crossfade (max-velocity of
 *  each layer except the last). 15 boundaries between 16 layers. */
const HQ_LAYER_BOUNDARIES = HQ_LAYER_VEL_RANGES.slice(0, -1).map(([, hi]) => hi);

/**
 * Compute keyRange for each sampled note by splitting the gap to its
 * neighbours — same shape as smplr's internal `spreadKeyRanges`.
 */
function spreadKeyRanges(midis: number[]): Array<[number, number]> {
  return midis.map((midi, i) => {
    const low = i === 0 ? 0 : Math.floor((midis[i - 1] + midi) / 2) + 1;
    const high = i === midis.length - 1 ? 127 : Math.floor((midi + midis[i + 1]) / 2);
    return [low, high];
  });
}

function buildSalamanderHqPreset(baseUrl: string): SmplrPreset {
  const keyRanges = spreadKeyRanges(HQ_SAMPLED_MIDIS);
  const groups: SmplrGroup[] = HQ_LAYER_VEL_RANGES.map(([lo, hi], layerIdx) => {
    const v = layerIdx + 1; // file suffix v1..v16
    const regions: SmplrRegion[] = HQ_SAMPLED_MIDIS.map((midi, i) => ({
      sample: `${HQ_NOTE_NAMES[i]}v${v}`,
      pitch: midi,
      keyRange: keyRanges[i],
    }));
    return {
      velRange: [lo, hi] as [number, number],
      regions,
    };
  });
  return {
    meta: {
      name: 'Salamander Grand Piano V3',
      description: 'Full 16-layer Salamander, Yamaha C5, sampled by Alexander Holm.',
      license: 'CC BY 3.0',
      source: 'https://archive.org/details/SalamanderGrandPianoV3',
    },
    samples: { baseUrl, formats: ['ogg'] },
    // Match the SFZ's <group>-level amp envelope. The engine overrides
    // ampRelease per-note for the damper-realistic curve already in place.
    defaults: { ampRelease: 1.0 },
    groups,
  };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const INSTRUMENTS: ReadonlyArray<InstrumentDef> = [
  {
    id: 'concert-grand',
    label: 'Concert Grand',
    family: 'piano',
    honorsSustain: true,
    velocitySensitive: true,
    toneDecay: 'natural',
    // Mid-register baseline. Bass strings sit at 1.8× this, treble at 0.6×;
    // see `damperReleaseFor` in the engine. The 0.30 s baseline is roomy
    // enough that Salamander's release samples (the recorded damper-thud)
    // play through cleanly instead of being amplitude-clipped — that
    // truncation was the audible artefact of the earlier 0.12 s fix.
    baseReleaseSec: 0.30,
    lowReleaseMul: 1.8,
    highReleaseMul: 0.6,
    noDamperAboveMidi: 89, // F6 — concert grands lose their dampers around here.
    // smplr's SplendidGrandPiano (Salamander Slender):
    //   PPP[1..40] PP[41..67] MP[68..84] MF[85..100] FF[101..127]
    // Crossfade these boundaries so playing across them is continuous.
    velocityLayers: [40, 67, 84, 100],
    crossfadeWidth: 5,
    attribution:
      'Concert Grand sound: Salamander Grand Piano by Alexander Holm, licensed under CC BY 3.0.',
    hint: 'Salamander Grand (Slender). 3 velocity layers; bundled.',
    bundled: true,
    create: (ctx, opts) =>
      SplendidGrandPiano(ctx, {
        destination: opts.destination,
        onLoadProgress: (p) =>
          opts.onLoadProgress?.(p.total > 0 ? p.loaded / p.total : 0),
      }),
  },
  {
    id: 'concert-grand-hq',
    label: 'Concert Grand (HQ)',
    family: 'piano',
    honorsSustain: true,
    velocitySensitive: true,
    toneDecay: 'natural',
    baseReleaseSec: 0.30,
    lowReleaseMul: 1.8,
    highReleaseMul: 0.6,
    noDamperAboveMidi: 89,
    // 16-layer Salamander has 15 boundaries — see HQ_LAYER_VEL_RANGES.
    // Tighter crossfadeWidth than the 5-layer Slender set because the
    // layers are closer together (some are only 2 velocity units wide),
    // so a wide window would overlap multiple boundaries at once.
    velocityLayers: HQ_LAYER_BOUNDARIES,
    crossfadeWidth: 2,
    attribution:
      'Concert Grand sound: Salamander Grand Piano by Alexander Holm, licensed under CC BY 3.0.',
    hint:
      'Full 16-velocity-layer Salamander V3. Loaded from public/samples/salamander-hq/.',
    // Local-build override: the OGG sample tree is shipped in the public
    // directory so this development copy has it without the user-facing
    // download flow. End-user / production builds keep `bundled: false`
    // and route through the on-demand downloader.
    bundled: true,
    create: (ctx, opts) =>
      Sampler(ctx, {
        preset: buildSalamanderHqPreset('/samples/salamander-hq'),
        destination: opts.destination,
        onLoadProgress: (p) =>
          opts.onLoadProgress?.(p.total > 0 ? p.loaded / p.total : 0),
      }),
  },
  {
    id: 'harpsichord',
    label: 'Harpsichord',
    family: 'harpsichord',
    // Real harpsichords have no damper pedal — the plucked strings ring out
    // to natural decay regardless of finger position. We could simulate a
    // pedal-down "ring until release" but the spec is explicit: no sustain
    // pedal on the harpsichord.
    honorsSustain: false,
    // The mechanism plucks at a constant force; the keyboard's velocity
    // doesn't change the timbre.
    velocitySensitive: false,
    toneDecay: 'natural',
    attribution:
      'Harpsichord samples: Versilian Community Sample Library (VCSL), public domain (CC0).',
    hint: 'VCSL English Harpsichord. CC0; bundled.',
    bundled: true,
    create: (ctx, opts) =>
      Versilian(ctx, {
        instrument: 'Chordophones/Zithers/Harpsichord, English - Normal',
        destination: opts.destination,
        onLoadProgress: (p) =>
          opts.onLoadProgress?.(p.total > 0 ? p.loaded / p.total : 0),
      }),
  },
  {
    id: 'electric-piano',
    label: 'Electric Piano',
    family: 'epiano',
    // Pianet T does have a damper bar; honour the pedal.
    honorsSustain: true,
    velocitySensitive: true,
    toneDecay: 'natural',
    // Pianet release is a touch slower than a grand — the sticky pad lifts
    // off the reed and the bell-like overtones fade into a brief tail. The
    // bass / treble spread is gentler than a grand because the reeds are
    // closer in length across the keyboard than piano strings are.
    baseReleaseSec: 0.32,
    lowReleaseMul: 1.3,
    highReleaseMul: 0.8,
    // The whole Pianet keyboard has dampers; no carve-out.
    noDamperAboveMidi: undefined,
    attribution:
      'Electric piano samples: Versilian Community Sample Library (VCSL), public domain (CC0).',
    hint: 'Hohner Pianet T. CC0; not a Rhodes (jRhodes is CC-BY-NC and intentionally excluded).',
    bundled: true,
    create: (ctx, opts) =>
      ElectricPiano(ctx, {
        instrument: 'PianetT',
        destination: opts.destination,
        onLoadProgress: (p) =>
          opts.onLoadProgress?.(p.total > 0 ? p.loaded / p.total : 0),
      }),
  },
  {
    id: 'pipe-organ',
    label: 'Pipe Organ',
    family: 'organ',
    // Organs have no sustain pedal in this sense — pipes sound while keys
    // are pressed, stop the instant they're released. Foot pedals on real
    // organs are extra notes, not a damper.
    honorsSustain: false,
    // Air pressure stays constant; key force doesn't change volume.
    velocitySensitive: false,
    // Held tone, no decay. Engine should rely on stop() to release cleanly.
    toneDecay: 'sustained',
    attribution:
      'Organ samples: Versilian Community Sample Library (VCSL), public domain (CC0). FreePats Hammond-style drawbar is the planned upgrade once we wire its sample loader.',
    hint: 'VCSL Pipe Organ (Loud). CC0; bundled. Hammond drawbar upgrade is on the roadmap.',
    bundled: true,
    create: (ctx, opts) =>
      Versilian(ctx, {
        instrument: 'Aerophones/Edge-blown Aerophones/Pipe Organ - Loud',
        destination: opts.destination,
        onLoadProgress: (p) =>
          opts.onLoadProgress?.(p.total > 0 ? p.loaded / p.total : 0),
      }),
  },
];

export function getInstrumentDef(id: InstrumentId): InstrumentDef {
  const found = INSTRUMENTS.find((i) => i.id === id);
  if (!found) return INSTRUMENTS[0];
  return found;
}

// ---------------------------------------------------------------------------
// Catalogue-wide attribution
// ---------------------------------------------------------------------------

/**
 * Every distinct attribution string in the catalogue, deduped. The About
 * dialog renders these as a list so a user reading credits sees every
 * source the app could conceivably play, not just the one currently loaded.
 */
export function allAttributions(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const inst of INSTRUMENTS) {
    if (inst.attribution && !seen.has(inst.attribution)) {
      seen.add(inst.attribution);
      out.push(inst.attribution);
    }
  }
  return out;
}
