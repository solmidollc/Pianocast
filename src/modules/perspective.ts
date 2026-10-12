/**
 * Geometry helpers for the OverheadCamera module.
 *
 * Two transforms live here:
 *   - 3-point keyboard alignment (a 2D similarity from A0 / centre / C8
 *     landmarks). Least-squares Procrustes fit; collinear inputs stay stable.
 *   - 4-corner manual keystone (a full 2D projective). Solved as 8 linear
 *     equations in 8 unknowns via Gaussian elimination.
 *
 * Both produce a 3×3 matrix; we compose them as `keystone ∘ alignment` and
 * emit a single CSS matrix3d() string. Chromium GPU-composites that, so the
 * OverheadCamera spends zero per-frame CPU on rectification.
 */

export type Point = [number, number];

/**
 * 3×3 row-major matrix:
 *   [m[0][0] m[0][1] m[0][2]]
 *   [m[1][0] m[1][1] m[1][2]]
 *   [m[2][0] m[2][1] m[2][2]]
 */
export type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export const IDENTITY_MAT3: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export function multiplyMat3(A: Mat3, B: Mat3): Mat3 {
  const out: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j];
      out[i][j] = s;
    }
  }
  return out;
}

/**
 * Convert a 3×3 projective matrix to a CSS matrix3d() string. The matrix is
 * normalized so the (2,2) entry is 1 first, which keeps Chromium's compositor
 * happy with extreme magnitudes.
 */
export function mat3ToCssMatrix3d(m: Mat3): string {
  const inv = Math.abs(m[2][2]) > 1e-12 ? 1 / m[2][2] : 1;
  const a = m[0][0] * inv, b = m[0][1] * inv, c = m[0][2] * inv;
  const d = m[1][0] * inv, e = m[1][1] * inv, f = m[1][2] * inv;
  const g = m[2][0] * inv, h = m[2][1] * inv;
  // Column-major flatten of a 4×4 that embeds the 3×3 into the xy plane.
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${h},0,0,1,0,${c},${f},0,1)`;
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return new Array(n).fill(0);
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
    const p = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

function solvePerspective(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [tx, ty] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -tx * sx, -tx * sy]);
    b.push(tx);
    A.push([0, 0, 0, sx, sy, 1, -ty * sx, -ty * sy]);
    b.push(ty);
  }
  return solveLinear(A, b);
}

/**
 * 4-corner perspective: maps the rectangle (0,0)-(w,h) to the four
 * `dstCorners` in TL, TR, BR, BL order. Used by the manual keystone.
 */
export function perspectiveMat3FromCorners(
  w: number,
  h: number,
  dstCorners: Point[],
): Mat3 {
  if (dstCorners.length !== 4) return IDENTITY_MAT3;
  const isIdentity =
    dstCorners[0][0] === 0 && dstCorners[0][1] === 0 &&
    dstCorners[1][0] === w && dstCorners[1][1] === 0 &&
    dstCorners[2][0] === w && dstCorners[2][1] === h &&
    dstCorners[3][0] === 0 && dstCorners[3][1] === h;
  if (isIdentity) return IDENTITY_MAT3;
  const src: Point[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const [a, b, c, d, e, f, g, h2] = solvePerspective(src, dstCorners);
  return [
    [a, b, c],
    [d, e, f],
    [g, h2, 1],
  ];
}

/**
 * 2D similarity (rotation + uniform scale + translation) from N source/
 * destination correspondences, via closed-form Procrustes. Stable for the
 * near-collinear input the 3-point keyboard calibration produces.
 */
export function similarityMat3(src: Point[], dst: Point[]): Mat3 {
  const n = Math.min(src.length, dst.length);
  if (n < 2) return IDENTITY_MAT3;
  let sxm = 0, sym = 0, dxm = 0, dym = 0;
  for (let i = 0; i < n; i++) {
    sxm += src[i][0]; sym += src[i][1];
    dxm += dst[i][0]; dym += dst[i][1];
  }
  sxm /= n; sym /= n; dxm /= n; dym /= n;

  let nA = 0, nB = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - sxm, sy = src[i][1] - sym;
    const dx = dst[i][0] - dxm, dy = dst[i][1] - dym;
    nA += sx * dx + sy * dy;
    nB += sx * dy - sy * dx;
    den += sx * sx + sy * sy;
  }
  if (den < 1e-12) return IDENTITY_MAT3;
  const a = nA / den;
  const b = nB / den;
  const tx = dxm - a * sxm + b * sym;
  const ty = dym - b * sxm - a * sym;
  return [
    [a, -b, tx],
    [b,  a, ty],
    [0,  0,  1],
  ];
}

/**
 * Crop / rectification model.
 *
 * Five normalized 0..1 coords in image (module-local) space:
 *   leftX    ↔  left edge of A0
 *   centerX  ↔  the user-placed E4 / F4 gap  (NOT assumed to be the midpoint)
 *   rightX   ↔  right edge of C8
 *   topY     ↔  the top boundary of the crop
 *   bottomY  ↔  the bottom boundary of the crop
 *
 * The centerX is decoupled from the geometric midpoint so the user can correct
 * for a camera tilted left or right (which makes the two halves of the
 * keyboard appear unevenly wide in the image). The left and right halves are
 * each rectified to their own horizontal scale; they meet exactly at the
 * module's x = w/2.
 */
export interface CropRect {
  leftX: number;
  centerX: number;
  rightX: number;
  topY: number;
  bottomY: number;
  /**
   * In-plane rotation of the crop rectangle around its centre, in radians.
   * Positive = clockwise. Accounts for a piano or camera sitting at an
   * angle in the frame — separate from the perspective tilt that the
   * user-placed E4/F4 centre corrects.
   *
   * Optional for back-compat with pre-rotation crops; absent → 0.
   */
  rotation?: number;
  /**
   * Extra source band sampled BELOW `bottomY`, in normalized source units
   * (0..~0.5). Lets the overhead include the player's hands / wrists in
   * front of the keys. Zero = keyboard only; the wrist band is rendered
   * as a continuous extension of the keyboard region with no seam, so the
   * key-to-key alignment with the on-screen Keyboard above it is preserved.
   *
   * Optional / undefined → 0 (back-compat).
   */
  wristArea?: number;
}

export function defaultCropRect(): CropRect {
  return {
    leftX: 0.1,
    centerX: 0.5,
    rightX: 0.9,
    topY: 0.35,
    bottomY: 0.65,
    rotation: 0,
    wristArea: 0,
  };
}

/**
 * Per-pixel vertical span of the displayed overhead, normalized to source
 * coords. Equals the keyboard height plus the wrist extension. Used by the
 * scene layout to size the overhead module: a doubled wrist span makes the
 * module twice as tall, so the keyboard above can move up correspondingly.
 */
export function effectiveVSpan(crop: CropRect): number {
  return Math.max(1e-6, crop.bottomY - crop.topY + (crop.wristArea ?? 0));
}

/** Keyboard-only fraction of the crop, used when reflowing a wrist-extended
 *  overhead alongside the on-screen Keyboard above. */
export function keyboardVSpan(crop: CropRect): number {
  return Math.max(1e-6, crop.bottomY - crop.topY);
}

/**
 * Rotate (x, y) around (cx, cy) by `theta` radians, in a metric scaled by
 * `aspect` (= sourceWidth / sourceHeight) so the rotation is isotropic in
 * actual source pixels even though our normalized coordinate system is
 * anisotropic (x and y both run 0..1 but represent different pixel counts).
 */
export function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  theta: number,
  aspect: number,
): { x: number; y: number } {
  const rx = x - cx;
  const ry = (y - cy) * aspect;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const nrx = rx * c - ry * s;
  const nry = rx * s + ry * c;
  return { x: cx + nrx, y: cy + nry / aspect };
}

/**
 * CSS matrix3d for the LEFT half of the overhead feed.
 *
 * The video element it's applied to has CSS width = w / height = h (the
 * module's natural size) and is mounted inside a wrapper sized to (w/2, h)
 * with overflow: hidden. The transform stretches the image region
 * [leftX*w, centerX*w] × [topY*h, bottomY*h] to fill that wrapper, so A0's
 * left edge lands at the wrapper's x = 0 and the E4/F4 gap lands at x = w/2
 * (= the wrapper's right edge).
 *
 * Pure translate + scale; GPU-composited; zero per-frame CPU.
 */
export function leftHalfTransform(w: number, h: number, crop: CropRect): string {
  const hSpan = Math.max(crop.centerX - crop.leftX, 1e-6);
  const vSpan = Math.max(crop.bottomY - crop.topY, 1e-6);
  const sx = 1 / (2 * hSpan); // (w/2) / (hSpan * w)
  const sy = 1 / vSpan;       //   h    / (vSpan * h)
  const tx = -crop.leftX * w * sx;
  const ty = -crop.topY * h * sy;
  return affineMatrix3d(sx, sy, tx, ty);
}

/**
 * CSS matrix3d for the RIGHT half. Mirror of leftHalfTransform — stretches
 * image region [centerX*w, rightX*w] × [topY*h, bottomY*h] across the (w/2, h)
 * wrapper, so the E4/F4 gap lands at the wrapper's x = 0 and C8's right edge
 * lands at x = w/2.
 */
export function rightHalfTransform(w: number, h: number, crop: CropRect): string {
  const hSpan = Math.max(crop.rightX - crop.centerX, 1e-6);
  const vSpan = Math.max(crop.bottomY - crop.topY, 1e-6);
  const sx = 1 / (2 * hSpan);
  const sy = 1 / vSpan;
  const tx = -crop.centerX * w * sx;
  const ty = -crop.topY * h * sy;
  return affineMatrix3d(sx, sy, tx, ty);
}

function affineMatrix3d(sx: number, sy: number, tx: number, ty: number): string {
  // Column-major 4×4 with translate + non-uniform scale on the xy plane.
  return `matrix3d(${sx},0,0,0,0,${sy},0,0,0,0,1,0,${tx},${ty},0,1)`;
}

/**
 * Build a CSS matrix3d() that maps the rectangle (0,0)-(w,h) to the four
 * `corners`. Convenience wrapper kept for back-compat; identical to using
 * perspectiveMat3FromCorners + mat3ToCssMatrix3d.
 */
export function keystoneMatrix3d(w: number, h: number, corners: Point[]): string {
  if (
    corners[0][0] === 0 && corners[0][1] === 0 &&
    corners[1][0] === w && corners[1][1] === 0 &&
    corners[2][0] === w && corners[2][1] === h &&
    corners[3][0] === 0 && corners[3][1] === h
  ) {
    return 'none';
  }
  return mat3ToCssMatrix3d(perspectiveMat3FromCorners(w, h, corners));
}

export function defaultCorners(w: number, h: number): Point[] {
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
}

