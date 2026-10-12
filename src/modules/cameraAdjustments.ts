/**
 * Per-source camera adjustments — software image processing that stacks on top
 * of whatever hardware the device exposes.
 *
 * Pipeline (all GPU-composited):
 *
 *    <video> or canvas
 *          │
 *          │  CSS  filter: brightness(...) contrast(...) saturate(...) grayscale(...)
 *          │  SVG  filter: url(#cam-adj-{moduleId})
 *          │           └─ <feColorMatrix>      → temperature + tint
 *          │           └─ <feComponentTransfer> → whites / blacks / highlights / shadows
 *          │                                       (table-LUT, one per channel)
 *          ▼
 *      composited frame
 *
 * Chromium compositing rules:
 *   - The CSS filter chain is fully GPU-accelerated.
 *   - SVG <filter> on a media element is also GPU-accelerated as long as
 *     `colorInterpolationFilters="sRGB"` and the filter primitives stay
 *     in the GPU-supported set (feColorMatrix, feComponentTransfer — both
 *     of which are).
 *
 * Live render path is unchanged: the CSS/SVG filters are just attributes
 * on the existing <video> / <canvas>; nothing per-frame on the CPU.
 */

// ---------------------------------------------------------------------------
// Types + defaults
// ---------------------------------------------------------------------------

export interface CameraAdjustments {
  // ---- Hardware (sent via track.applyConstraints) ----
  // `null` means "leave the device on its current setting". Each control is
  // populated lazily — we don't write a constraint until the user moves the
  // slider.
  zoom: number | null;
  exposureCompensation: number | null;
  /** White-balance colour temperature in Kelvin. */
  colorTemperature: number | null;
  focusDistance: number | null;
  hdr: boolean | null;

  // ---- Software (applied via CSS + SVG filter chain) ----
  /** -100..100, multiplicative. 0 = identity. */
  brightness: number;
  /** -100..100, multiplicative. 0 = identity. */
  contrast: number;
  /** -100..100, multiplicative. -100 = greyscale. 0 = identity. */
  saturation: number;
  /** -100..100. Negative = cooler (more blue), positive = warmer (more red). */
  temperature: number;
  /** -100..100. Negative = green push, positive = magenta push. */
  tint: number;
  /** -100..100. Positive = lift whites, negative = crush them. */
  whites: number;
  /** -100..100. Positive = lift blacks, negative = crush them. */
  blacks: number;
  /** -100..100. Positive = brighter highlights, negative = recover. */
  highlights: number;
  /** -100..100. Positive = lifted shadows, negative = crushed. */
  shadows: number;

  /** Effect-preset label currently applied (informational; the underlying
   *  values are still authoritative — applying a preset writes them in,
   *  and the user can still fine-tune afterwards). */
  presetName: string | null;
}

export function defaultAdjustments(): CameraAdjustments {
  return {
    zoom: null,
    exposureCompensation: null,
    colorTemperature: null,
    focusDistance: null,
    hdr: null,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    whites: 0,
    blacks: 0,
    highlights: 0,
    shadows: 0,
    presetName: null,
  };
}

export function isDefaultSoftware(adj: CameraAdjustments): boolean {
  return (
    adj.brightness === 0 &&
    adj.contrast === 0 &&
    adj.saturation === 0 &&
    adj.temperature === 0 &&
    adj.tint === 0 &&
    adj.whites === 0 &&
    adj.blacks === 0 &&
    adj.highlights === 0 &&
    adj.shadows === 0 &&
    adj.presetName === null
  );
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * A short, curated set of looks. Each preset just sets underlying adjustment
 * values; the user can still tweak afterwards. Hardware controls are not
 * touched — presets are software-only so they're reproducible across cameras.
 */
export interface EffectPreset {
  name: string;
  /** Partial<CameraAdjustments> applied on top of `defaultAdjustments()`. */
  apply: Partial<
    Pick<
      CameraAdjustments,
      | 'brightness'
      | 'contrast'
      | 'saturation'
      | 'temperature'
      | 'tint'
      | 'whites'
      | 'blacks'
      | 'highlights'
      | 'shadows'
    >
  >;
}

export const EFFECT_PRESETS: EffectPreset[] = [
  {
    name: 'Black & White',
    apply: { saturation: -100, contrast: 10 },
  },
  {
    name: 'Warm',
    apply: { temperature: 30, tint: 6, highlights: -8, shadows: 6 },
  },
  {
    name: 'Cool',
    apply: { temperature: -22, tint: -4, highlights: -6, shadows: 4 },
  },
  {
    name: 'High Contrast',
    apply: { contrast: 28, blacks: -12, whites: 8, highlights: -12, shadows: 8 },
  },
];

/**
 * Apply a preset by name: reset all software adjustments to default, then
 * overlay the preset's partial set. Hardware fields are preserved.
 */
export function applyPreset(
  adj: CameraAdjustments,
  presetName: string | null,
): CameraAdjustments {
  const defaults = defaultAdjustments();
  // Preserve hardware controls — the preset is a software look.
  const base: CameraAdjustments = {
    ...defaults,
    zoom: adj.zoom,
    exposureCompensation: adj.exposureCompensation,
    colorTemperature: adj.colorTemperature,
    focusDistance: adj.focusDistance,
    hdr: adj.hdr,
    presetName,
  };
  if (presetName === null) return base;
  const preset = EFFECT_PRESETS.find((p) => p.name === presetName);
  if (!preset) return base;
  return { ...base, ...preset.apply, presetName };
}

// ---------------------------------------------------------------------------
// CSS filter (cheap, GPU-composited)
// ---------------------------------------------------------------------------

/**
 * Build the CSS `filter` value for the cheap adjustments. Always combine with
 * `url(#cam-adj-{moduleId})` (built separately via the SVG filter helpers).
 *
 *   brightness  → CSS brightness()  (1.0 = identity)
 *   contrast    → CSS contrast()    (1.0 = identity)
 *   saturation  → CSS saturate()    (1.0 = identity, 0 = grey, ≥ B&W preset)
 *
 * Grayscale isn't separate — saturation=-100 already collapses to grey via
 * CSS saturate(0).
 */
export function cssFilterStringFor(adj: CameraAdjustments): string {
  // Brightness: -100..+100 → 0.5..1.5
  const b = 1 + adj.brightness / 200;
  // Contrast: -100..+100 → 0..2
  const c = 1 + adj.contrast / 100;
  // Saturation: -100..+100 → 0..2
  const s = 1 + adj.saturation / 100;
  return `brightness(${b.toFixed(3)}) contrast(${c.toFixed(3)}) saturate(${Math.max(0, s).toFixed(3)})`;
}

// ---------------------------------------------------------------------------
// SVG filter — temperature / tint + whites / blacks / highlights / shadows
// ---------------------------------------------------------------------------

/**
 * Per-channel scaling for the temperature + tint colour matrix.
 *
 *   temperature: -100 (cool, +B/-R) → +100 (warm, +R/-B)
 *   tint:        -100 (green)       → +100 (magenta)
 *
 * The scalars are deliberately mild (±0.3 at full swing) so the slider is
 * useful across its full range without saturating the channel.
 */
function tempTintGains(
  temperature: number,
  tint: number,
): { rGain: number; gGain: number; bGain: number } {
  const T = temperature / 100;
  const I = tint / 100;
  return {
    rGain: Math.max(0, 1 + T * 0.30 + I * 0.10),
    gGain: Math.max(0, 1 - Math.abs(I) * 0.15 + I * 0.05),
    bGain: Math.max(0, 1 - T * 0.30 + I * 0.10),
  };
}

/** 4×5 colour matrix as the 20-number string SVG expects. */
function tempTintMatrix(adj: CameraAdjustments): string {
  const { rGain, gGain, bGain } = tempTintGains(adj.temperature, adj.tint);
  // Row-major, identity except for the per-channel gains.
  return [
    rGain, 0, 0, 0, 0,
    0, gGain, 0, 0, 0,
    0, 0, bGain, 0, 0,
    0, 0, 0, 1, 0,
  ]
    .map((n) => n.toFixed(4))
    .join(' ');
}

/**
 * Tonal curve mixing four sliders. Inputs and output are in [0, 1].
 *
 * Convention (Lightroom-ish, but milder):
 *   blacks     +: lift bottom of curve / -: crush
 *   whites     +: lift top of curve     / -: pull down
 *   shadows    +: lift lower mid        / -: deepen
 *   highlights +: brighten upper mid    / -: recover
 *
 * The masks (upperMask, lowerMask) confine highlights / shadows to the
 * appropriate halves so they don't fight whites/blacks at the endpoints.
 */
function toneCurve(
  v: number,
  whites: number,
  blacks: number,
  highlights: number,
  shadows: number,
): number {
  const W = whites / 100;
  const B = blacks / 100;
  const H = highlights / 100;
  const S = shadows / 100;

  let y = v;

  // Blacks: shift / crush the low end.
  if (B >= 0) y = B * 0.30 + (1 - B * 0.30) * y;
  else y = y * (1 + B * 0.40);

  // Whites: shift / crush the top end.
  if (W >= 0) y = y + W * 0.30 * (1 - y);
  else y = y * (1 + W * 0.40);

  // Highlights: pull / push the upper half via a quadratic mask.
  const upperMask = Math.max(0, (y - 0.5) * 2);
  y += H * 0.30 * upperMask * upperMask;

  // Shadows: pull / push the lower half via a quadratic mask.
  const lowerMask = Math.max(0, (0.5 - y) * 2);
  y += S * 0.30 * lowerMask * lowerMask;

  return Math.max(0, Math.min(1, y));
}

/** 33-point table — enough resolution that linear interpolation in SVG is
 *  visually smooth across the entire 0..255 input range. */
const TABLE_SIZE = 33;

function buildToneTable(adj: CameraAdjustments): string {
  const out: string[] = [];
  for (let i = 0; i < TABLE_SIZE; i++) {
    const v = i / (TABLE_SIZE - 1);
    out.push(toneCurve(v, adj.whites, adj.blacks, adj.highlights, adj.shadows).toFixed(4));
  }
  return out.join(' ');
}

/**
 * Build the SVG <filter> element id for a module. The same id is used by:
 *   - the SVG filter defs rendered alongside the camera component
 *   - the CSS `filter: url(#cam-adj-{id})` reference on the video / canvas
 *
 * Module ids contain only safe characters in our scheme, but we strip just
 * in case a future change introduces characters that confuse SVG fragment
 * URLs (`#`, spaces, etc.).
 */
export function svgFilterId(moduleId: string): string {
  return `cam-adj-${moduleId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Full CSS filter string for a camera: cheap CSS primitives + SVG filter URL.
 * Apply this to the video / canvas element.
 */
export function cssFilterChain(adj: CameraAdjustments, moduleId: string): string {
  return `${cssFilterStringFor(adj)} url(#${svgFilterId(moduleId)})`;
}

/**
 * Plain-object description of the SVG filter — the React panel renders this
 * as inline SVG so we don't have to dance with raw HTML strings.
 */
export interface SvgFilterSpec {
  id: string;
  colorMatrix: string;
  toneR: string;
  toneG: string;
  toneB: string;
}

export function buildSvgFilterSpec(adj: CameraAdjustments, moduleId: string): SvgFilterSpec {
  // RGB tone tables are identical for now — the per-channel hooks are left
  // open in case a future preset wants channel-asymmetric curves.
  const tone = buildToneTable(adj);
  return {
    id: svgFilterId(moduleId),
    colorMatrix: tempTintMatrix(adj),
    toneR: tone,
    toneG: tone,
    toneB: tone,
  };
}

// ---------------------------------------------------------------------------
// Digital-zoom fallback
// ---------------------------------------------------------------------------

/**
 * Resolve a digital zoom factor. If the device's hardware zoom is in use,
 * we return 1 (no software scale) — applyConstraints({ zoom }) is doing
 * the work optically. Otherwise we map the zoom slider's 1.0..N range to a
 * CSS `transform: scale(...)` factor.
 *
 * Callers compose this with their existing transforms (mirror, keystone).
 */
export function digitalZoomFactor(
  adj: CameraAdjustments,
  hardwareZoomSupported: boolean,
): number {
  if (hardwareZoomSupported) return 1;
  if (adj.zoom == null || adj.zoom <= 1) return 1;
  return adj.zoom;
}
