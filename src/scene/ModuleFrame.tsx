import { useCallback, useEffect, useRef } from 'react';
import { useApp, type ModuleInstance } from '../state/store';
import { beginSceneEdit, endSceneEdit } from '../state/history';
import { MODULE_LABEL, ScaledModule } from './ModuleContent';

interface Props {
  module: ModuleInstance;
  scale: number;
  selected: boolean;
}

type DragHandle =
  | 'move'
  | 'n' | 's' | 'e' | 'w'
  | 'ne' | 'nw' | 'se' | 'sw';

const MIN_SIZE = 80;

/**
 * Snap radius in CSS pixels (so the feel is the same at 25% editor zoom and at
 * 100%). Divided by the editor's `scale` to convert to scene-coord pixels
 * before the distance test.
 */
const SNAP_PX = 8;

/**
 * Wraps a single module on the scene canvas. Handles selection, dragging,
 * and 8-handle resizing.
 *
 * Resize behaviour:
 *   - Side-centre handles (n, s, e, w) — single-axis change of the slot
 *     `width` / `height`. For every module kind this changes only the slot;
 *     `baseWidth` / `baseHeight` are left alone.
 *   - Corner handles (ne, nw, se, sw):
 *       · Keyboard AND Overhead Camera: free resize. The Keyboard keeps
 *         its native fit-to-width behaviour, and the Overhead Camera now
 *         renders at TRUE aspect with top-aligned natural-size sampling
 *         (see OverheadCamera.tsx), so any corner drag just reveals more
 *         or less of the captured region — it can never distort the
 *         image. Aspect-locking the corner here would only restrict the
 *         user pointlessly.
 *       · Notation AND Harmonic readout: aspect-locked uniform scale of
 *         *both* the slot (width, height) AND the base dims (baseWidth,
 *         baseHeight) by the same factor — see the notation block below.
 *       · Everything else: aspect-locked uniform scale of just the slot.
 *
 * Why notation + harmonic are special — their content scales differently.
 * For other non-Keyboard modules, ScaledModule wraps the content in a CSS
 * `scale(sx, sy)` keyed off (slot / base) — corner drags grow the slot so
 * sx == sy, side drags grow one dim so sx != sy and the content stretches
 * into the frame. That would non-uniformly squish the notation staff
 * (the SVG is drawn at natural proportions; a side drag would smear
 * glyphs) and the harmonic readout's chord glyphs the same way.
 *
 * The notation/harmonic contract instead:
 *   - Slot dims (width, height) define the visible rectangle the content
 *     lives in. A side drag grows the slot → more empty breathing room
 *     around the (still centered, same-pixel-size) content.
 *   - Base dims (baseWidth, baseHeight) encode the content's pixel scale.
 *     For notation: scale = baseHeight / SLOT_REF_H drives the SVG viewBox
 *     window (slotPx / scale). For harmonic: scale = baseHeight /
 *     SLOT_REF_H is applied as a CSS `transform: scale(s)` on the
 *     centered text. A corner drag scales slot AND base together →
 *     content visually zooms; side drags leave base alone so the content
 *     stays at its current pixel size.
 * No drag ever stretches either module non-uniformly.
 *
 * All math runs in unscaled scene coordinates; we divide pointer deltas by
 * `scale` so the math is the same whether the editor is fit at 50 % or 100 %.
 */
export function ModuleFrame({ module, scale, selected }: Props) {
  const select = useApp((s) => s.select);
  const update = useApp((s) => s.updateModule);
  const canvasWidth = useApp((s) => s.canvasWidth);
  const canvasHeight = useApp((s) => s.canvasHeight);
  const setSnapGuides = useApp((s) => s.setSnapGuides);

  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    handle: DragHandle;
    startX: number;
    startY: number;
    origin: ModuleInstance;
  } | null>(null);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) endSceneEdit();
    const frame = frameRef.current;
    if (drag && frame?.hasPointerCapture(drag.pointerId)) {
      frame.releasePointerCapture(drag.pointerId);
    }
    setSnapGuides(null);
  }, [setSnapGuides]);

  useEffect(() => {
    const endPointer = (event: PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) endDrag();
    };
    const onVisibility = () => { if (document.hidden) endDrag(); };
    window.addEventListener('pointerup', endPointer, true);
    window.addEventListener('pointercancel', endPointer, true);
    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pointerup', endPointer, true);
      window.removeEventListener('pointercancel', endPointer, true);
      window.removeEventListener('blur', endDrag);
      document.removeEventListener('visibilitychange', onVisibility);
      endDrag();
    };
  }, [endDrag]);

  useEffect(() => { if (!selected || !module.visible) endDrag(); }, [selected, module.visible, endDrag]);

  const onPointerDown = useCallback(
    (handle: DragHandle) => (e: React.PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      e.stopPropagation();
      endDrag();
      frameRef.current?.setPointerCapture(e.pointerId);
      select(module.id);
      beginSceneEdit();
      dragRef.current = {
        pointerId: e.pointerId,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        origin: { ...module },
      };
    },
    [module, select, endDrag],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      // Recover even if the browser missed the release event.
      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
        endDrag();
        return;
      }
      const dx = (e.clientX - d.startX) / scale;
      const dy = (e.clientY - d.startY) / scale;
      const { handle, origin } = d;
      const next = computeNextRect(handle, origin, dx, dy, module.kind);
      // Snap the prospective rect to canvas centre + edges. Snap is applied
      // AFTER aspect-locked corner math so the corner ratio is preserved
      // when only one axis snaps (the snap only displaces, never re-stretches
      // for non-keyboard/overhead modules).
      const snapped = module.kind === 'notation' && handle.length === 2
        ? { patch: next, vLines: [], hLines: [] }
        : applySnap(
        handle,
        origin,
        next,
        canvasWidth,
        canvasHeight,
        SNAP_PX / scale,
      );
      update(module.id, snapped.patch);
      setSnapGuides(
        snapped.vLines.length || snapped.hLines.length
          ? { vLines: snapped.vLines, hLines: snapped.hLines }
          : null,
      );
    },
    [module.id, module.kind, scale, update, canvasWidth, canvasHeight, setSnapGuides, endDrag],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerId === dragRef.current?.pointerId) endDrag();
  }, [endDrag]);

  if (!module.visible) return null;

  const handles: { h: DragHandle; cls: string; pos: React.CSSProperties }[] = [
    { h: 'nw', cls: 'cursor-nwse-resize', pos: { top: -4, left: -4 } },
    { h: 'n',  cls: 'cursor-ns-resize',   pos: { top: -4, left: '50%', transform: 'translateX(-50%)' } },
    { h: 'ne', cls: 'cursor-nesw-resize', pos: { top: -4, right: -4 } },
    { h: 'e',  cls: 'cursor-ew-resize',   pos: { top: '50%', right: -4, transform: 'translateY(-50%)' } },
    { h: 'se', cls: 'cursor-nwse-resize', pos: { bottom: -4, right: -4 } },
    { h: 's',  cls: 'cursor-ns-resize',   pos: { bottom: -4, left: '50%', transform: 'translateX(-50%)' } },
    { h: 'sw', cls: 'cursor-nesw-resize', pos: { bottom: -4, left: -4 } },
    { h: 'w',  cls: 'cursor-ew-resize',   pos: { top: '50%', left: -4, transform: 'translateY(-50%)' } },
  ];

  return (
    <div
      ref={frameRef}
      className="absolute"
      style={{
        touchAction: 'none',
        left: module.x,
        top: module.y,
        width: module.width,
        height: module.height,
        zIndex: module.z,
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      {/* Drag area. overflow:hidden is for safety — the scale wrapper sizes
          the visual extent to the frame, so nothing should ever overflow,
          but we clip in case a child's natural extent slips through. */}
      <div
        className="absolute inset-0"
        data-recording-module={module.id}
        onPointerDown={onPointerDown('move')}
        style={{ cursor: 'move', overflow: 'hidden' }}
      >
        <ScaledModule module={module} inEditor />
      </div>

      {/* Selection overlay */}
      {selected && (
        <>
          <div
            className="pointer-events-none absolute inset-0"
            style={{ outline: `${2 / scale}px solid #7C5CFF`, outlineOffset: 0 }}
          />
          <div
            className="absolute"
            style={{
              top: -22 / scale,
              left: 0,
              fontSize: 11 / scale,
              color: '#9F87FF',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 500,
              pointerEvents: 'none',
            }}
          >
            {MODULE_LABEL[module.kind]}
          </div>
          {handles.map(({ h, cls, pos }) => (
            <div
              key={h}
              className={`absolute ${cls} bg-accent`}
              style={{
                width: 10 / scale,
                height: 10 / scale,
                borderRadius: 2 / scale,
                ...pos,
                marginLeft: pos.left === -4 ? -5 / scale + 4 : 0,
              }}
              onPointerDown={onPointerDown(h)}
            />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Compute the next (x, y, width, height [, baseWidth, baseHeight]) from a
 * drag in unscaled scene coords. Handles all eight handles plus the move
 * case. Notation corner drags additionally scale baseWidth / baseHeight —
 * see the file-level comment for the contract.
 */
function computeNextRect(
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

function applySnap(
  handle: DragHandle,
  origin: ModuleInstance,
  next: Partial<Pick<ModuleInstance, 'x' | 'y' | 'width' | 'height' | 'baseWidth' | 'baseHeight'>>,
  cw: number,
  ch: number,
  threshold: number,
): SnapResult {
  const x = next.x ?? origin.x;
  const y = next.y ?? origin.y;
  const width = next.width ?? origin.width;
  const height = next.height ?? origin.height;

  const xTargets = [0, cw / 2, cw];
  const yTargets = [0, ch / 2, ch];

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

  return {
    patch: { ...next, x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height },
    vLines,
    hLines,
  };
}
