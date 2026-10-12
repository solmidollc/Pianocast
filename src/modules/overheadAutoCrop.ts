/**
 * Overhead-camera auto-crop. Runs ONCE per camera-attach (off the live 60 fps
 * render path), so we trade latency for accuracy:
 *
 *   1. Settle wait — a freshly connected camera's first frames are bad
 *      (auto-exposure, white balance and focus are all converging). Sample
 *      after ~1.5 s so detection runs on stabilized pixels.
 *   2. Multi-frame capture — grab ~6 frames spaced ~100 ms apart. Each frame
 *      gets independent detection; we keep the highest-scoring keyboard
 *      bbox per frame, then median-aggregate across frames to reject noise.
 *   3. Multi-threshold detection — within a single frame, try the keyboard-
 *      bbox detector at several luma thresholds and the E4/F4 detector at
 *      several black-key thresholds, and score each candidate. This handles
 *      a wide range of room lighting and piano finishes without per-user
 *      calibration.
 *   4. Scoring — geometry (width / height / aspect fraction), interior
 *      density, and contrast against the row just above / below combine
 *      into a 0..1 confidence; we keep the maximum-confidence candidate
 *      per frame.
 *
 * Everything is best-effort. Failures return `null` and the caller falls
 * back to `defaultCropRect()`.
 */

import type { CropRect } from './perspective';

/** Width of the downsampled luma buffer. 320 is enough to resolve individual
 *  black keys on a full 88-key keyboard occupying ~70 % of a 1920-wide frame. */
const ANALYSIS_W = 320;

/** Wait this long after the FIRST decoded frame before sampling, so AE/AWB
 *  has time to settle. Empirically 1.5 s is the knee — shorter and the
 *  exposure is still warming; longer barely improves accuracy. */
const SETTLE_MS = 1500;

/** Capture this many frames for aggregation. Six is enough to median-out
 *  isolated detector misfires without blowing the budget. */
const FRAME_COUNT = 6;

/** Spacing between captured frames. ~100 ms ≈ 6 video frames at 60 fps;
 *  enough that motion / encoder jitter decorrelates between samples. */
const FRAME_SPACING_MS = 100;

/** Luma thresholds (0..255) to try for the white-key bounding-box pass. */
const WHITE_THRESHOLDS = [120, 140, 160, 180, 200];

/** Luma thresholds (0..255) to try for the black-key E4/F4 pass. */
const BLACK_THRESHOLDS = [40, 55, 70, 85];

/** Percentile trim for the bbox edges — robust to specular highlights and
 *  frame-border artifacts that would otherwise extend the rectangle. */
const TRIM_PERCENTILE = 0.10;

export interface AutoCropOptions {
  /** Abort the run cooperatively — useful when the camera detaches mid-detect. */
  signal?: AbortSignal;
  /** 0..1 progress callback so the UI can drive a Calibrating spinner. */
  onProgress?: (fraction: number) => void;
}

interface BBox {
  /** All four values in normalized 0..1 coords of the original frame. */
  leftX: number;
  rightX: number;
  topY: number;
  bottomY: number;
}

interface ScoredBBox {
  bbox: BBox;
  score: number; // 0..1
}

interface ScoredCenter {
  centerX: number;
  score: number; // 0..1
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Async multi-frame, multi-threshold auto-crop. Resolves to a CropRect on
 * success or null on any failure (or abort). Total wall-clock cost ≈
 * SETTLE_MS + FRAME_COUNT × FRAME_SPACING_MS ≈ 2.1 s for the defaults.
 */
export async function autoCrop(
  video: HTMLVideoElement,
  options: AutoCropOptions = {},
): Promise<CropRect | null> {
  const { signal, onProgress } = options;
  const wait = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      };
      if (signal?.aborted) {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  const ensureReady = async () => {
    // Wait up to ~3 s for the first decoded frame to land. autoCrop is
    // wrapped in a stream-ready effect upstream, but the readyState gate
    // here protects against the rare case where the stream attached but
    // the first frame hasn't arrived yet.
    for (let i = 0; i < 60; i++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (
        video.readyState >= video.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) return true;
      await wait(50);
    }
    return false;
  };

  try {
    if (!(await ensureReady())) return null;

    // 1. Settle — let AE/AWB/focus converge before sampling.
    onProgress?.(0.05);
    const settleSteps = 10;
    for (let i = 0; i < settleSteps; i++) {
      await wait(SETTLE_MS / settleSteps);
      onProgress?.(0.05 + (0.3 * (i + 1)) / settleSteps);
    }

    // 2. Capture frames spaced over time. Each capture happens off-thread of
    //    the live render pipeline (canvas + getImageData on a private 320×N).
    const frames: ImageData[] = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      if (signal?.aborted) return null;
      const f = captureFrame(video);
      if (f) frames.push(f);
      onProgress?.(0.35 + (0.35 * (i + 1)) / FRAME_COUNT);
      if (i < FRAME_COUNT - 1) await wait(FRAME_SPACING_MS);
    }
    if (frames.length === 0) return null;

    // 3. Per-frame detection: try every WHITE_THRESHOLDS value, keep the
    //    highest-scoring keyboard bbox for that frame.
    const perFrameBest: ScoredBBox[] = [];
    for (const frame of frames) {
      const best = detectBoundsBest(frame);
      if (best) perFrameBest.push(best);
    }
    onProgress?.(0.85);
    if (perFrameBest.length === 0) return null;

    // 4. Aggregate across frames. Per-coordinate median is robust to a
    //    single bad frame dragging the result. We also need a "representative
    //    frame" for the E4/F4 detection step — use the frame whose bbox is
    //    closest to the median, since that's the cleanest one statistically.
    const medianBbox = medianBBox(perFrameBest.map((s) => s.bbox));
    const repIdx = pickRepresentativeFrame(perFrameBest, medianBbox);
    const repFrame = frames[repIdx] ?? frames[0];

    // 5. E4/F4: try every BLACK_THRESHOLDS, keep highest-scoring centre.
    const centre = detectEFCenterBest(repFrame, medianBbox);
    onProgress?.(0.95);

    // 6. Build the final CropRect with the small top/bottom inset.
    const vH = medianBbox.bottomY - medianBbox.topY;
    const margin = vH * 0.05;
    const topY = Math.min(0.95, medianBbox.topY + margin);
    const bottomY = Math.max(topY + 0.02, medianBbox.bottomY - margin);

    onProgress?.(1);
    return {
      leftX: medianBbox.leftX,
      centerX: centre.centerX,
      rightX: medianBbox.rightX,
      topY,
      bottomY,
      rotation: 0,
    };
  } catch (e) {
    // Including AbortError — caller treats null as "use defaults".
    return null;
  }
}

// ---------------------------------------------------------------------------
// Frame capture
// ---------------------------------------------------------------------------

/**
 * Grab one frame as an ImageData. Returns null if the stream isn't ready.
 * Uses the existing <video> the caller already has playing — we don't open
 * a second consumer of the track.
 */
export function captureFrame(video: HTMLVideoElement): ImageData | null {
  if (
    !video ||
    video.readyState < video.HAVE_CURRENT_DATA ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    return null;
  }
  const aspect = video.videoWidth / video.videoHeight;
  const w = ANALYSIS_W;
  const h = Math.max(1, Math.round(w / aspect));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } catch {
    // CORS / tainted canvas — getImageData throws. Auto-crop is best-effort.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Luma
// ---------------------------------------------------------------------------

/** RGBA → single-channel luma 0..255. */
function toLuma(img: ImageData): Uint8ClampedArray {
  const { data } = img;
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // Rec.709 weights — perceptual enough for a threshold pass.
    out[j] = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) | 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bounding-box detection (white-key band)
// ---------------------------------------------------------------------------

/**
 * Try every WHITE_THRESHOLDS value, keep the highest-scoring bbox. Returns
 * null if no threshold yields a plausible keyboard.
 */
export function detectBoundsBest(img: ImageData): ScoredBBox | null {
  const { width: w, height: h } = img;
  const luma = toLuma(img);
  let best: ScoredBBox | null = null;
  for (const thresh of WHITE_THRESHOLDS) {
    const bbox = findKeyboardBoundsAt(luma, w, h, thresh);
    if (!bbox) continue;
    const score = scoreKeyboardBbox(luma, w, h, bbox, thresh);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { bbox, score };
  }
  return best;
}

/**
 * Threshold-the-luma → percentile-trim bounding box. Internal helper; see
 * detectBoundsBest for the multi-threshold sweep.
 */
function findKeyboardBoundsAt(
  luma: Uint8ClampedArray,
  w: number,
  h: number,
  threshold: number,
): BBox | null {
  const colCount = new Int32Array(w);
  const rowCount = new Int32Array(h);
  let total = 0;
  for (let y = 0; y < h; y++) {
    const off = y * w;
    let rc = 0;
    for (let x = 0; x < w; x++) {
      if (luma[off + x] >= threshold) {
        colCount[x]++;
        rc++;
      }
    }
    rowCount[y] = rc;
    total += rc;
  }
  if (total < w * h * 0.02) return null;

  const cumX: number[] = new Array(w);
  let acc = 0;
  for (let x = 0; x < w; x++) {
    acc += colCount[x];
    cumX[x] = acc;
  }
  const cumY: number[] = new Array(h);
  acc = 0;
  for (let y = 0; y < h; y++) {
    acc += rowCount[y];
    cumY[y] = acc;
  }
  const totalX = cumX[w - 1] || 1;
  const totalY = cumY[h - 1] || 1;
  const lowX = totalX * TRIM_PERCENTILE;
  const highX = totalX * (1 - TRIM_PERCENTILE);
  const lowY = totalY * TRIM_PERCENTILE;
  const highY = totalY * (1 - TRIM_PERCENTILE);

  let left = 0;
  while (left < w - 1 && cumX[left] < lowX) left++;
  let right = w - 1;
  while (right > left && cumX[right] > highX) right--;
  let top = 0;
  while (top < h - 1 && cumY[top] < lowY) top++;
  let bottom = h - 1;
  while (bottom > top && cumY[bottom] > highY) bottom--;

  const leftX = left / w;
  const rightX = right / w;
  const topY = top / h;
  const bottomY = bottom / h;

  // Plausibility: keyboard occupies a wide, short rectangle and isn't empty
  // / inverted.
  if (rightX - leftX < 0.3) return null;
  if (bottomY - topY < 0.04) return null;
  if (bottomY - topY > 0.6) return null;
  if (rightX <= leftX || bottomY <= topY) return null;

  return { leftX, rightX, topY, bottomY };
}

/**
 * Score a candidate keyboard bounding box on a 0..1 scale. Combines:
 *
 *   - interior density   — fraction of inside pixels above threshold.
 *     Real keyboards are dense; backgrounds light up sparsely.
 *   - margin contrast    — interior density vs the row just above / below.
 *     A clean keyboard edge has a sharp falloff; sky-blue or beige walls
 *     do not.
 *   - geometry           — width-fraction and height-fraction soft-gates,
 *     plus a pixel-aspect score (keyboards are aspect ~5..20).
 *
 * Tuned to prefer "clearly a keyboard" candidates and reject "bright wall
 * with a TV in it" candidates.
 */
function scoreKeyboardBbox(
  luma: Uint8ClampedArray,
  w: number,
  h: number,
  bbox: BBox,
  threshold: number,
): number {
  const x0 = Math.max(0, Math.floor(bbox.leftX * w));
  const x1 = Math.min(w - 1, Math.ceil(bbox.rightX * w));
  const y0 = Math.max(0, Math.floor(bbox.topY * h));
  const y1 = Math.min(h - 1, Math.ceil(bbox.bottomY * h));
  const insideW = x1 - x0;
  const insideH = y1 - y0;
  if (insideW < 10 || insideH < 4) return 0;

  // Inside-bright density.
  let insideBright = 0;
  for (let y = y0; y < y1; y++) {
    const off = y * w;
    for (let x = x0; x < x1; x++) {
      if (luma[off + x] >= threshold) insideBright++;
    }
  }
  const insideArea = insideW * insideH;
  const density = insideBright / insideArea;

  // Margin density just above and below (same x-range).
  const marginH = Math.max(2, Math.floor(insideH * 0.3));
  let marginBright = 0;
  let marginArea = 0;
  const mTop0 = Math.max(0, y0 - marginH);
  for (let y = mTop0; y < y0; y++) {
    const off = y * w;
    for (let x = x0; x < x1; x++) {
      if (luma[off + x] >= threshold) marginBright++;
      marginArea++;
    }
  }
  const mBot1 = Math.min(h, y1 + marginH);
  for (let y = y1; y < mBot1; y++) {
    const off = y * w;
    for (let x = x0; x < x1; x++) {
      if (luma[off + x] >= threshold) marginBright++;
      marginArea++;
    }
  }
  const marginDensity = marginArea > 0 ? marginBright / marginArea : 0;

  // Higher is better: density big, marginDensity small, gap wide.
  const contrastRatio = (density + 0.02) / (marginDensity + 0.02);
  const contrastScore = Math.min(1, (contrastRatio - 1) / 4); // saturates at 5×

  // Geometry: width frac sweet spot 0.45..0.95.
  const widthFrac = bbox.rightX - bbox.leftX;
  let widthScore: number;
  if (widthFrac < 0.30) widthScore = 0;
  else if (widthFrac < 0.45) widthScore = (widthFrac - 0.30) / 0.15;
  else if (widthFrac <= 0.95) widthScore = 1;
  else widthScore = Math.max(0, 1 - (widthFrac - 0.95) / 0.05);

  // Geometry: height frac sweet spot 0.05..0.25.
  const heightFrac = bbox.bottomY - bbox.topY;
  let heightScore: number;
  if (heightFrac < 0.04) heightScore = 0;
  else if (heightFrac < 0.05) heightScore = (heightFrac - 0.04) / 0.01;
  else if (heightFrac <= 0.25) heightScore = 1;
  else if (heightFrac <= 0.5) heightScore = 1 - (heightFrac - 0.25) / 0.25;
  else heightScore = 0;

  // Pixel aspect ratio — full 88-key keyboards visible end to end are very
  // wide (aspect 5..20 in our 320×N analysis buffer). Out of range = penalty.
  const pixAspect = insideW / Math.max(insideH, 1);
  let aspectScore: number;
  if (pixAspect < 3) aspectScore = pixAspect / 3;
  else if (pixAspect <= 18) aspectScore = 1;
  else aspectScore = Math.max(0, 1 - (pixAspect - 18) / 12);

  // Density itself contributes — a "keyboard" that's only 20 % bright inside
  // probably isn't one. Sweet spot 0.35..0.75 (above 0.75 it might be a
  // featureless wall).
  let densityScore: number;
  if (density < 0.15) densityScore = density / 0.15;
  else if (density <= 0.75) densityScore = 1;
  else densityScore = Math.max(0, 1 - (density - 0.75) / 0.25);

  return (
    densityScore * 0.25 +
    contrastScore * 0.30 +
    widthScore * 0.20 +
    heightScore * 0.15 +
    aspectScore * 0.10
  );
}

// ---------------------------------------------------------------------------
// E4/F4 centre detection (black-key gap)
// ---------------------------------------------------------------------------

/**
 * Try every BLACK_THRESHOLDS value, keep the highest-scoring E4/F4 column.
 * Falls back to the bbox geometric centre if no threshold finds a clean
 * gap signature — same as before, so downstream always has a usable centreX.
 */
export function detectEFCenterBest(img: ImageData, bbox: BBox): ScoredCenter {
  const fallback: ScoredCenter = {
    centerX: (bbox.leftX + bbox.rightX) / 2,
    score: 0,
  };
  const { width: w, height: h } = img;
  const luma = toLuma(img);
  let best: ScoredCenter | null = null;
  for (const thresh of BLACK_THRESHOLDS) {
    const found = findEFCenterAt(luma, w, h, bbox, thresh);
    if (!found) continue;
    if (!best || found.score > best.score) best = found;
  }
  return best ?? fallback;
}

/**
 * Single-threshold E4/F4 detection. Looks at the upper band of the bbox
 * (where black keys live in an overhead view), extracts black-key column
 * runs, finds the wide gap closest to the bbox centre — that's the E4/F4
 * split (the only no-black-key gap in the middle of the keyboard wider
 * than within-group gaps).
 */
function findEFCenterAt(
  luma: Uint8ClampedArray,
  w: number,
  h: number,
  bbox: BBox,
  threshold: number,
): ScoredCenter | null {
  const x0 = Math.max(0, Math.floor(bbox.leftX * w));
  const x1 = Math.min(w - 1, Math.ceil(bbox.rightX * w));
  const y0 = Math.max(0, Math.floor(bbox.topY * h));
  const y1 = Math.min(h - 1, Math.ceil(bbox.bottomY * h));
  if (x1 - x0 < 20 || y1 - y0 < 4) return null;

  const blackBandTop = y0;
  const blackBandBottom = y0 + Math.max(2, Math.floor((y1 - y0) * 0.35));
  const bandW = x1 - x0 + 1;
  const bandH = blackBandBottom - blackBandTop + 1;
  const blackCount = new Int32Array(bandW);
  for (let y = blackBandTop; y <= blackBandBottom; y++) {
    const off = y * w;
    for (let x = x0; x <= x1; x++) {
      if (luma[off + x] <= threshold) blackCount[x - x0]++;
    }
  }
  const runThresh = Math.max(2, Math.floor(bandH * 0.35));
  const isBlack = new Uint8Array(bandW);
  for (let i = 0; i < bandW; i++) isBlack[i] = blackCount[i] >= runThresh ? 1 : 0;

  // Collect column runs → list of black-key centre xs (in band-local coords).
  const centres: number[] = [];
  let i = 0;
  while (i < bandW) {
    if (!isBlack[i]) { i++; continue; }
    let j = i;
    while (j < bandW && isBlack[j]) j++;
    const widthFrac = (j - i) / bandW;
    if (widthFrac < 0.04) centres.push((i + j - 1) / 2);
    i = j;
  }
  // Need at least 5 black keys to identify a 2-group + 3-group neighbourhood.
  if (centres.length < 5) return null;

  // Gap signature → median = within-group spacing; gaps ≥ 1.5× median
  // are between-group ("wide") gaps. E4/F4 is one of them, near the centre.
  const gaps: { mid: number; size: number }[] = [];
  for (let k = 0; k + 1 < centres.length; k++) {
    gaps.push({ mid: (centres[k] + centres[k + 1]) / 2, size: centres[k + 1] - centres[k] });
  }
  const sortedSizes = gaps.map((g) => g.size).slice().sort((a, b) => a - b);
  const med = sortedSizes[Math.floor(sortedSizes.length / 2)];
  const wideThresh = med * 1.5;
  const wideGaps = gaps.filter((g) => g.size >= wideThresh);
  if (wideGaps.length === 0) return null;

  // Score: closeness to bbox centre + how "wide" relative to median.
  const bbCentre = bandW / 2;
  let best: { gap: typeof wideGaps[number]; score: number } | null = null;
  for (const g of wideGaps) {
    const distFrac = Math.abs(g.mid - bbCentre) / (bandW / 2); // 0..1+
    const wideness = g.size / Math.max(med, 1e-3);
    const distScore = Math.max(0, 1 - distFrac); // closer-to-centre wins
    const wideScore = Math.min(1, (wideness - 1) / 1.5); // 1.5× already great
    const score = distScore * 0.7 + wideScore * 0.3;
    if (!best || score > best.score) best = { gap: g, score };
  }
  if (!best) return null;

  const efX = x0 + best.gap.mid;
  const efNorm = efX / w;
  // Sanity-clamp inside the bbox.
  if (efNorm <= bbox.leftX + 0.001 || efNorm >= bbox.rightX - 0.001) return null;
  return { centerX: efNorm, score: best.score };
}

// ---------------------------------------------------------------------------
// Aggregation across frames
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Per-coordinate median bbox across N frames — robust to single bad frames. */
function medianBBox(bboxes: BBox[]): BBox {
  return {
    leftX: median(bboxes.map((b) => b.leftX)),
    rightX: median(bboxes.map((b) => b.rightX)),
    topY: median(bboxes.map((b) => b.topY)),
    bottomY: median(bboxes.map((b) => b.bottomY)),
  };
}

/** Pick the frame whose bbox is closest (L1 distance) to the median bbox,
 *  weighted by score. That's the cleanest frame for the E4/F4 detail pass. */
function pickRepresentativeFrame(scored: ScoredBBox[], medianB: BBox): number {
  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < scored.length; i++) {
    const b = scored[i].bbox;
    const d =
      Math.abs(b.leftX - medianB.leftX) +
      Math.abs(b.rightX - medianB.rightX) +
      Math.abs(b.topY - medianB.topY) +
      Math.abs(b.bottomY - medianB.bottomY);
    // Higher score + smaller distance wins.
    const val = scored[i].score - d * 1.5;
    if (val > bestVal) {
      bestVal = val;
      bestIdx = i;
    }
  }
  return bestIdx;
}
