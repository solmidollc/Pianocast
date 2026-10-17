import type { ModuleInstance } from '../state/store';
export type DragHandle =
  | 'move'
  | 'n' | 's' | 'e' | 'w'
  | 'ne' | 'nw' | 'se' | 'sw';

const MIN_SIZE = 80;

/**
 * Compute the next (x, y, width, height [, baseWidth, baseHeight]) from a
 * drag in unscaled scene coords. Handles all eight handles plus the move
 * case. Notation corner drags additionally scale baseWidth / baseHeight —
 * see the file-level comment for the contract.
 */
export function computeNextRect(
  handle: DragHandle,
  origin: ModuleInstance,
  dx: number,
  dy: number,
  kind: ModuleInstance['kind'],
): Partial<Pick<ModuleInstance, 'x' | 'y' | 'width' | 'height' | 'baseWidth' | 'baseHeight'>> {
  let { x, y, width, height } = origin;
  // Optional outputs — only set for notation corner drags.
  let baseWidth: number | undefined;
  let baseHeight: number | undefined;

  switch (handle) {
    case 'move':
      x = origin.x + dx;
      y = origin.y + dy;
      break;

    case 'n':
      y = origin.y + dy;
      height = Math.max(MIN_SIZE, origin.height - dy);
      break;
    case 's':
      height = Math.max(MIN_SIZE, origin.height + dy);
      break;
    case 'e':
      width = Math.max(MIN_SIZE, origin.width + dx);
      break;
    case 'w':
      x = origin.x + dx;
      width = Math.max(MIN_SIZE, origin.width - dx);
      break;

    case 'ne':
    case 'nw':
    case 'se':
    case 'sw': {
      if (kind === 'keyboard' || kind === 'overhead' || kind === 'overheadVisualizer') {
        // Free resize. Keyboard's native behaviour is preserved as-is.
        // Overhead is included here because its renderer is natural-aspect
        // (the shader paints black past the captured region and tops the
        // image at the slot's top), so any corner drag just reveals more
        // or less of the captured image — never distorts it.
        switch (handle) {
          case 'ne':
            y = origin.y + dy;
            height = Math.max(MIN_SIZE, origin.height - dy);
            width = Math.max(MIN_SIZE, origin.width + dx);
            break;
          case 'nw':
            x = origin.x + dx;
            y = origin.y + dy;
            width = Math.max(MIN_SIZE, origin.width - dx);
            height = Math.max(MIN_SIZE, origin.height - dy);
            break;
          case 'se':
            width = Math.max(MIN_SIZE, origin.width + dx);
            height = Math.max(MIN_SIZE, origin.height + dy);
            break;
          case 'sw':
            x = origin.x + dx;
            width = Math.max(MIN_SIZE, origin.width - dx);
            height = Math.max(MIN_SIZE, origin.height + dy);
            break;
        }
      } else {
        // Aspect-locked, uniform resize. Project the pointer delta onto the
        // corner's outward diagonal direction (±width, ±height) to get a
        // single scale factor.
        const ow = origin.width;
        const oh = origin.height;
        const vx = handle === 'ne' || handle === 'se' ? +1 : -1;
        const vy = handle === 'se' || handle === 'sw' ? +1 : -1;
        const denom = ow * ow + oh * oh;
        const scaleDelta = (dx * vx * ow + dy * vy * oh) / denom;

        const minScale = Math.max(MIN_SIZE / ow, MIN_SIZE / oh);
        const factor = Math.max(minScale, 1 + scaleDelta);

        const newW = ow * factor;
        const newH = oh * factor;

        width = newW;
        height = newH;
        // Keep the corner opposite the drag fixed in scene space.
        if (handle === 'nw' || handle === 'sw') x = origin.x + (ow - newW);
        if (handle === 'nw' || handle === 'ne') y = origin.y + (oh - newH);

        if (kind === 'harmonic' || kind === 'notation') {
          // Scale the base dims by the same factor. This keeps
          //   scale = baseHeight / SLOT_REF_H
          // (in Notation.tsx / HarmonicReadout.tsx) proportional to the
          // slot, so a corner drag zooms the content (notation: more
          // pixels per viewBox natural unit; harmonic: bigger CSS
          // transform scale on the centred text) while leaving side
          // drags free to grow the slot around the unchanged content
          // — adding breathing room without scaling it.
          baseWidth = origin.baseWidth * factor;
          baseHeight = origin.baseHeight * factor;
        }
      }
      break;
    }
  }

  if (handle !== 'move' && handle.includes('w')) x = origin.x + origin.width - width;
  if (handle !== 'move' && handle.includes('n')) y = origin.y + origin.height - height;
  const out: Partial<Pick<ModuleInstance, 'x' | 'y' | 'width' | 'height' | 'baseWidth' | 'baseHeight'>> =
    { x, y, width, height };
  if (baseWidth !== undefined) out.baseWidth = baseWidth;
  if (baseHeight !== undefined) out.baseHeight = baseHeight;
  return out;
}

/**
 * Snap the prospective rect to canvas-axis lines:
 *   - the two centre lines (x = cw/2, y = ch/2),
 *   - the four canvas edges (x = 0, x = cw, y = 0, y = ch).
 *
 * For a `move` handle, the rect's left edge, horizontal centre, and right
 * edge all compete to snap on X; the analogue holds for Y. For a resize
 * handle only the edge(s) the user is dragging snap (e.g. dragging 'e'
 * snaps the right edge; 'nw' snaps both the left edge AND the top edge).
 *
 * The returned `patch` carries forward every key that `computeNextRect`
 * already set, with x/y/width/height possibly displaced by the snap. The
 * `vLines`/`hLines` arrays are populated only with the canvas-axis values
 * that the rect actually snapped to — the SceneCanvas draws a dashed
 * guide at each entry.
 *
 * The snap math runs in scene coords; the caller passes the threshold
 * scaled by the editor's zoom so the feel is consistent at any zoom level.
 */
interface SnapResult {
  patch: Partial<Pick<ModuleInstance, 'x' | 'y' | 'width' | 'height' | 'baseWidth' | 'baseHeight'>>;
  vLines: number[];
  hLines: number[];
}

export function applySnap(
  handle: DragHandle,
  origin: ModuleInstance,
  next: Partial<Pick<ModuleInstance, 'x' | 'y' | 'width' | 'height' | 'baseWidth' | 'baseHeight'>>,
  cw: number,
  ch: number,
  threshold: number,
  others: ModuleInstance[] = [],
): SnapResult {
  const x = next.x ?? origin.x;
  const y = next.y ?? origin.y;
  const width = next.width ?? origin.width;
  const height = next.height ?? origin.height;

  const xTargets = [0, cw / 2, cw, ...others.flatMap(m=>[m.x,m.x+m.width/2,m.x+m.width])];
  const yTargets = [0, ch / 2, ch, ...others.flatMap(m=>[m.y,m.y+m.height/2,m.y+m.height])];
  if (handle !== 'move') for (const other of others) {
    if (handle.includes('e')) xTargets.push(x + other.width);
    if (handle.includes('w')) xTargets.push(x + width - other.width);
    if (handle.includes('s')) yTargets.push(y + other.height);
    if (handle.includes('n')) yTargets.push(y + height - other.height);
  }

  // Build the list of (modulePointValue, shiftRect) pairs to consider.
  // Each shift function returns the adjusted rect when its point snaps
  // to a target axis.
  type AxisSnap = {
    value: number;
    apply: (target: number) => { x: number; y: number; width: number; height: number };
  };

  const xSnaps: AxisSnap[] = [];
  const ySnaps: AxisSnap[] = [];

  if (handle === 'move') {
    // Body drag — every X point of the rect competes to snap.
    xSnaps.push(
      { value: x,             apply: (t) => ({ x: t,                 y, width, height }) },
      { value: x + width / 2, apply: (t) => ({ x: t - width / 2,     y, width, height }) },
      { value: x + width,     apply: (t) => ({ x: t - width,         y, width, height }) },
    );
    ySnaps.push(
      { value: y,              apply: (t) => ({ x, y: t,                  width, height }) },
      { value: y + height / 2, apply: (t) => ({ x, y: t - height / 2,     width, height }) },
      { value: y + height,     apply: (t) => ({ x, y: t - height,         width, height }) },
    );
  } else {
    // Resize — only the edge(s) the handle drags snap. Aspect-locked corner
    // resize on non-keyboard/overhead modules still calls into this, but
    // only the same-axis edges get a snap chance; the opposite-axis size
    // is left alone so the aspect ratio survives.
    if (handle === 'w' || handle === 'nw' || handle === 'sw') {
      xSnaps.push({
        value: x,
        apply: (t) => ({ x: t, y, width: Math.max(MIN_SIZE, width + (x - t)), height }),
      });
    }
    if (handle === 'e' || handle === 'ne' || handle === 'se') {
      xSnaps.push({
        value: x + width,
        apply: (t) => ({ x, y, width: Math.max(MIN_SIZE, t - x), height }),
      });
    }
    if (handle === 'n' || handle === 'ne' || handle === 'nw') {
      ySnaps.push({
        value: y,
        apply: (t) => ({ x, y: t, width, height: Math.max(MIN_SIZE, height + (y - t)) }),
      });
    }
    if (handle === 's' || handle === 'se' || handle === 'sw') {
      ySnaps.push({
        value: y + height,
        apply: (t) => ({ x, y, width, height: Math.max(MIN_SIZE, t - y) }),
      });
    }
  }

  // Pick the smallest-distance snap per axis. Ties broken by order
  // (left/centre/right ↔ same priority as inserted).
  let bestX: { d: number; snap: AxisSnap; target: number } | null = null;
  for (const s of xSnaps) {
    for (const t of xTargets) {
      const d = Math.abs(s.value - t);
      if (d <= threshold && (!bestX || d < bestX.d)) bestX = { d, snap: s, target: t };
    }
  }
  let bestY: { d: number; snap: AxisSnap; target: number } | null = null;
  for (const s of ySnaps) {
    for (const t of yTargets) {
      const d = Math.abs(s.value - t);
      if (d <= threshold && (!bestY || d < bestY.d)) bestY = { d, snap: s, target: t };
    }
  }

  let snapped = { x, y, width, height };
  const vLines: number[] = [];
  const hLines: number[] = [];

  if (bestX) {
    const after = bestX.snap.apply(bestX.target);
    snapped = { ...snapped, x: after.x, width: after.width };
    vLines.push(bestX.target);
  }
  if (bestY) {
    // Apply Y on top of the X-shifted rect so both displacements compose.
    const after = bestY.snap.apply(bestY.target);
    snapped = { ...snapped, y: after.y, height: after.height };
    hLines.push(bestY.target);
  }

  if (handle.length === 2 && !['keyboard','overhead','overheadVisualizer'].includes(origin.kind) && (bestX || bestY)) {
    const fromX = !!bestX && (!bestY || bestX.d <= bestY.d), ratio = origin.width / origin.height;
    if (fromX) snapped.height = snapped.width / ratio; else snapped.width = snapped.height * ratio;
    if (handle.includes('w')) snapped.x = origin.x + origin.width - snapped.width;
    if (handle.includes('n')) snapped.y = origin.y + origin.height - snapped.height;
    if (origin.kind === 'harmonic') { next.baseWidth = (origin.baseWidth || origin.width) * snapped.width / origin.width; next.baseHeight = (origin.baseHeight || origin.height) * snapped.height / origin.height; }
    if (fromX) hLines.length = 0; else vLines.length = 0;
  }
  return {
    patch: { ...next, x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height },
    vLines,
    hLines,
  };
}

