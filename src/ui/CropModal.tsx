import { useDialogKeyboard } from './useDialogKeyboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { defaultCropRect, type CropRect } from '../modules/perspective';
import { useLocalCameraStream } from '../modules/cameraStream';
import { companionStatus } from '../companion/signaling';

interface Props {
  /** Currently committed crop, or null. The modal initializes from this. */
  initial: CropRect | null;
  source: 'local' | 'companion';
  deviceId: string | null;
  onApply: (crop: CropRect) => void;
  onClose: () => void;
}

const VIEWPORT_MAX_W_FRAC = 0.82;
const VIEWPORT_MAX_H_FRAC = 0.68;

/**
 * CropModal — two-step Adobe-Scan-style alignment, plus a rotation handle.
 *
 *  Step 1: position + size + rotate a rectangle over the entire keyboard.
 *          Handles: left guide, right guide, top edge, bottom edge, body
 *          drag, and a dedicated rotation grip above the top edge. The
 *          centre dashed guide auto-tracks the rectangle's geometric centre
 *          while the user hasn't yet touched it directly (i.e. before
 *          step 2).
 *
 *  Step 2: drag the centre guide alone onto the real E4/F4 gap. Touching
 *          the centre sets `centerTouched`, which sticks for the rest of
 *          the modal lifetime so subsequent rectangle changes (Back) leave
 *          the centre where the user placed it.
 *
 * The whole rectangle (edges, guides, hit-zones, rotation handle) lives
 * inside a single CSS-rotated wrapper whose transform-origin is the rect's
 * centre. Drag deltas are inverse-rotated into the rect's local frame so
 * dragging "outward" on a tilted edge feels axis-aligned. The dim mask
 * outside the rect lives in a SEPARATE, un-rotated SVG — the viewport
 * boundary doesn't rotate.
 */
export function CropModal({ initial, source, deviceId, onApply, onClose }: Props) {
  useDialogKeyboard(true,'Crop overhead camera',onClose);
  const [draft, setDraft] = useState<CropRect>(initial ?? defaultCropRect());
  const [step, setStep] = useState<1 | 2>(1);
  // `centerTouched` tracks whether the user has manually repositioned the
  // E4/F4 centre line IN THIS MODAL SESSION. Until they do, the centre
  // auto-tracks the geometric midpoint of left/right as they resize the
  // rectangle (spec: "stay centered in the rectangle as the crop is
  // resized — unless the user has manually repositioned it"). Starting
  // false on every open — even when an existing crop already had an
  // off-midpoint centre — means re-opening to adjust will re-snap. The
  // user can still re-do step 2's E4/F4 calibration before applying.
  const [centerTouched, setCenterTouched] = useState<boolean>(false);

  // Stream
  const local = useLocalCameraStream(source === 'local' ? deviceId : null);
  const [companion, setCompanion] = useState(companionStatus.snapshot());
  useEffect(() => companionStatus.subscribe(() => setCompanion(companionStatus.snapshot())), []);
  const stream = source === 'companion' ? companion.stream : local.stream;

  // Viewport sizing — locked to camera aspect.
  const [aspect, setAspect] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // srcObject sync (see CropModal comments above the original fix — inline
  // arrow ref churned srcObject during drags and blanked the preview).
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tryAspect = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setAspect(v.videoWidth / v.videoHeight);
      }
    };
    tryAspect();
    v.addEventListener('loadedmetadata', tryAspect);
    v.addEventListener('loadeddata', tryAspect);
    return () => {
      v.removeEventListener('loadedmetadata', tryAspect);
      v.removeEventListener('loadeddata', tryAspect);
    };
  }, [stream]);
  const [viewport, setViewport] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    if (aspect === null) return;
    const compute = () => {
      const maxW = window.innerWidth * VIEWPORT_MAX_W_FRAC;
      const maxH = window.innerHeight * VIEWPORT_MAX_H_FRAC;
      const w = Math.min(maxW, maxH * aspect);
      const h = w / aspect;
      setViewport({ w, h });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [aspect]);
  const { w: vw, h: vh } = viewport;
  const ready = aspect !== null;

  // ---------- rotation utilities ----------

  const theta = draft.rotation ?? 0;
  // Inverse rotation for mapping screen-space drag deltas into the rect's
  // local (un-rotated) frame. The wrapper CSS-rotates by +theta around the
  // rect centre; a screen-space (dx, dy) projects onto the rect's local
  // +x axis as dx*cos+dy*sin and onto local +y as -dx*sin+dy*cos.
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const toLocalDelta = (dx: number, dy: number) => ({
    dx: dx * cosT + dy * sinT,
    dy: -dx * sinT + dy * cosT,
  });

  // ---------- drag handlers ----------

  /** Apply an update to the draft; in step 1 with untouched centre, snap
   *  centre to the new midpoint of left/right. */
  const updateDraft = useCallback(
    (next: CropRect) => {
      if (step === 1 && !centerTouched) {
        next = { ...next, centerX: (next.leftX + next.rightX) / 2 };
      }
      setDraft(next);
    },
    [step, centerTouched],
  );

  const onLeftRightDrag = useCallback(
    (which: 'leftX' | 'rightX') => (e: React.PointerEvent) => {
      if (step !== 1) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = draft;
      const move = (mv: PointerEvent) => {
        const { dx: dxLocal } = toLocalDelta(mv.clientX - startX, mv.clientY - startY);
        const dx = dxLocal / vw;
        let nx = origin[which] + dx;
        if (which === 'leftX') {
          nx = Math.max(0, Math.min(origin.rightX - 0.02, nx));
        } else {
          nx = Math.max(origin.leftX + 0.02, Math.min(1, nx));
        }
        updateDraft({ ...origin, [which]: nx });
      };
      const up = (uv: PointerEvent) => {
        (uv.target as Element).releasePointerCapture?.(uv.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [draft, vw, step, updateDraft, cosT, sinT],
  );

  const onCenterDrag = useCallback(
    (e: React.PointerEvent) => {
      if (step !== 2) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = draft;
      const move = (mv: PointerEvent) => {
        const { dx: dxLocal } = toLocalDelta(mv.clientX - startX, mv.clientY - startY);
        const dx = dxLocal / vw;
        const nx = Math.max(
          origin.leftX + 0.001,
          Math.min(origin.rightX - 0.001, origin.centerX + dx),
        );
        setCenterTouched(true);
        setDraft({ ...origin, centerX: nx });
      };
      const up = (uv: PointerEvent) => {
        (uv.target as Element).releasePointerCapture?.(uv.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [draft, vw, step, cosT, sinT],
  );

  const onEdgeDrag = useCallback(
    (which: 'topY' | 'bottomY') => (e: React.PointerEvent) => {
      if (step !== 1) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = draft;
      const move = (mv: PointerEvent) => {
        const { dy: dyLocal } = toLocalDelta(mv.clientX - startX, mv.clientY - startY);
        const dy = dyLocal / vh;
        let ny = origin[which] + dy;
        if (which === 'topY') {
          ny = Math.max(0, Math.min(origin.bottomY - 0.02, ny));
          setDraft({ ...origin, topY: ny });
        } else {
          // Bottom edge can extend all the way to the source bottom.
          // Previously this was clamped to (1 - wristArea), forcing the
          // user to add a wrist band via a separate handle if they wanted
          // the crop to reach lower than the keys. The spec now allows
          // the bottom edge to extend straight down to include the
          // wrist/hands area in a single drag. If that drag pushes
          // bottomY past where the existing wrist band ended, shrink the
          // wrist band so `bottomY + wristArea ≤ 1` still holds.
          ny = Math.max(origin.topY + 0.02, Math.min(1, ny));
          const wrist = origin.wristArea ?? 0;
          const newWrist = Math.min(wrist, Math.max(0, 1 - ny));
          setDraft({ ...origin, bottomY: ny, wristArea: newWrist });
        }
      };
      const up = (uv: PointerEvent) => {
        (uv.target as Element).releasePointerCapture?.(uv.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [draft, vh, step, cosT, sinT],
  );

  /**
   * Wrist-area drag: drags the dashed lower edge of the camera-included
   * region downward in source coords, growing the band between the
   * keyboard's bottom and that edge. Releases up to a minimum of 0 (no
   * wrist area). The drag uses inverse-rotation just like the keyboard's
   * bottom edge so it feels axis-aligned even on a tilted crop.
   */
  const onWristDrag = useCallback(
    (e: React.PointerEvent) => {
      if (step !== 1) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = draft;
      const move = (mv: PointerEvent) => {
        const { dy: dyLocal } = toLocalDelta(mv.clientX - startX, mv.clientY - startY);
        const dy = dyLocal / vh;
        const next = Math.max(0, Math.min(1 - origin.bottomY, (origin.wristArea ?? 0) + dy));
        setDraft({ ...origin, wristArea: next });
      };
      const up = (uv: PointerEvent) => {
        (uv.target as Element).releasePointerCapture?.(uv.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [draft, vh, step, cosT, sinT],
  );

  const onBodyDrag = useCallback(
    (e: React.PointerEvent) => {
      if (step !== 1) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = draft;
      // Body translation: the rect's centre IS the wrapper's transform-
      // origin, so a screen-space (dx, dy) translates the rect's centre on
      // screen by exactly (dx, dy) regardless of rotation. We update all four
      // corners by the same un-rotated normalized delta; the wrapper carries
      // them with it. No inverse-rotation needed here.
      const move = (mv: PointerEvent) => {
        const dx = (mv.clientX - startX) / vw;
        const dy = (mv.clientY - startY) / vh;
        const cdx = Math.max(-origin.leftX, Math.min(1 - origin.rightX, dx));
        const cdy = Math.max(-origin.topY, Math.min(1 - origin.bottomY, dy));
        setDraft({
          ...origin,
          leftX: origin.leftX + cdx,
          centerX: origin.centerX + cdx,
          rightX: origin.rightX + cdx,
          topY: origin.topY + cdy,
          bottomY: origin.bottomY + cdy,
        });
      };
      const up = (uv: PointerEvent) => {
        (uv.target as Element).releasePointerCapture?.(uv.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [draft, vw, vh, step],
  );

  const onRotateDrag = useCallback(
    (e: React.PointerEvent) => {
      if (step !== 1) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      const viewportEl = viewportRef.current;
      if (!viewportEl) return;
      const vpRect = viewportEl.getBoundingClientRect();
      const origin = draft;
      const cxScreen = vpRect.left + ((origin.leftX + origin.rightX) / 2) * vw;
      const cyScreen = vpRect.top + ((origin.topY + origin.bottomY) / 2) * vh;
      const startAngle = Math.atan2(e.clientY - cyScreen, e.clientX - cxScreen);
      const startRotation = origin.rotation ?? 0;
      const move = (mv: PointerEvent) => {
        const ang = Math.atan2(mv.clientY - cyScreen, mv.clientX - cxScreen);
        let next = startRotation + (ang - startAngle);
        // Shift-snap to 1° increments (small detents) so the user can dial
        // in slight angles without overshoot. Plain drag stays continuous.
        if (mv.shiftKey) {
          const snap = Math.PI / 180;
          next = Math.round(next / snap) * snap;
        }
        setDraft({ ...origin, rotation: next });
      };
      const up = (uv: PointerEvent) => {
        (uv.target as Element).releasePointerCapture?.(uv.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [draft, vw, vh, step],
  );

  // ---------- derived pixel positions ----------

  const leftPx = draft.leftX * vw;
  const centerPx = draft.centerX * vw;
  const rightPx = draft.rightX * vw;
  const topPx = draft.topY * vh;
  const bottomPx = draft.bottomY * vh;
  const wristAreaNorm = draft.wristArea ?? 0;
  const wristBottomPx = (draft.bottomY + wristAreaNorm) * vh;
  const hasWrist = wristAreaNorm > 0.001;
  const cxPx = (leftPx + rightPx) / 2;
  const cyPx = (topPx + bottomPx) / 2;

  // The four rotated corners of the rectangle, in viewport-pixel coords.
  // Used by the un-rotated dim mask SVG below to punch a rotated hole.
  //
  // The hole INCLUDES the wrist band when one is active — the band rotates
  // around the keyboard rect's centre (same `rot()` helper), so a tilted
  // crop carries its wrist extension along with it. The dashed line drawn
  // inside the rotated overlay below marks the keyboard/wrist horizon.
  const rot = (x: number, y: number): [number, number] => {
    const dx = x - cxPx;
    const dy = y - cyPx;
    return [cxPx + dx * cosT - dy * sinT, cyPx + dx * sinT + dy * cosT];
  };
  const holeBottomPx = hasWrist ? wristBottomPx : bottomPx;
  const cornerTL = rot(leftPx, topPx);
  const cornerTR = rot(rightPx, topPx);
  const cornerBR = rot(rightPx, holeBottomPx);
  const cornerBL = rot(leftPx, holeBottomPx);
  const dimPath =
    `M0,0 H${vw} V${vh} H0 Z ` +
    `M${cornerTL[0]},${cornerTL[1]} ` +
    `L${cornerTR[0]},${cornerTR[1]} ` +
    `L${cornerBR[0]},${cornerBR[1]} ` +
    `L${cornerBL[0]},${cornerBL[1]} Z`;

  // ---------- step copy ----------

  const stepTitle =
    step === 1 ? 'Step 1 of 2 — Crop the keyboard' : 'Step 2 of 2 — Adjust the E4 | F4 gap';
  const stepHint =
    step === 1
      ? 'Fit the rectangle around the keyboard. Extend the bottom edge to include your hands. Use the round handle to rotate; hold Shift for 1° steps.'
      : 'Drag the centre line onto the real E4 | F4 gap to correct camera tilt.';

  // CSS transform applied to the wrapper that holds the rotated edges,
  // guides, hit-zones, and rotation grip. transform-origin is the rect's
  // centre in un-rotated viewport-fraction coords.
  const rotatedWrapperStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    transform: `rotate(${theta}rad)`,
    transformOrigin: `${(cxPx / Math.max(vw, 1)) * 100}% ${(cyPx / Math.max(vh, 1)) * 100}%`,
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(7,7,9,0.74)' }}
      onClick={onClose}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Crop overhead camera" className="camera-crop-dialog bg-ink-900 rounded border border-white/10 p-5 flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '92vw', maxHeight: '94vh' }}
      >
        {/* Header */}
        <div className="w-full flex items-baseline justify-between gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500">
              Overhead Camera
            </div>
            <div className="text-base text-ink-50 font-medium mt-0.5">{stepTitle}</div>
          </div>
          <div className="text-xs text-ink-300 max-w-md text-right">{stepHint}</div>
        </div>

        {/* Camera viewport */}
        <div
          ref={viewportRef}
          className="relative bg-black rounded overflow-hidden"
          style={{ width: vw, height: vh }}
        >
          {stream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-ink-300 text-sm">
              {source === 'companion'
                ? 'Waiting for the companion phone feed…'
                : local.status.kind === 'error'
                  ? local.status.message
                  : 'Opening device…'}
            </div>
          )}

          {/* Un-rotated dim mask — outer viewport rect + rotated inner hole,
              filled with even-odd so the camera shows through inside the
              rect. The four-point polygon punches the right shape no matter
              what theta is. */}
          <svg
            width={vw}
            height={vh}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <path d={dimPath} fill="rgba(7,7,9,0.55)" fillRule="evenodd" />
          </svg>

          {/* Rotated overlay: edges, guides, rotation handle, hit zones.
              transform-origin at the rect's centre keeps the visual centre
              fixed under rotation, which is what makes the rotation feel
              like the rectangle is spinning around itself. */}
          <div style={rotatedWrapperStyle}>
            <svg
              width={vw}
              height={vh}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              {/* Solid top + bottom edges */}
              <line
                x1={leftPx} y1={topPx} x2={rightPx} y2={topPx}
                stroke="#7C5CFF" strokeWidth={1.5}
              />
              <line
                x1={leftPx} y1={bottomPx} x2={rightPx} y2={bottomPx}
                stroke="#7C5CFF" strokeWidth={1.5}
              />
              {/* Three dashed vertical guides */}
              <line
                x1={leftPx} y1={topPx} x2={leftPx} y2={bottomPx}
                stroke="#9F87FF" strokeWidth={1.5} strokeDasharray="6 5"
                opacity={step === 1 ? 1 : 0.55}
              />
              <line
                x1={centerPx} y1={topPx} x2={centerPx} y2={bottomPx}
                stroke="#9F87FF"
                strokeWidth={step === 2 ? 2 : 1.5}
                strokeDasharray="6 5"
              />
              <line
                x1={rightPx} y1={topPx} x2={rightPx} y2={bottomPx}
                stroke="#9F87FF" strokeWidth={1.5} strokeDasharray="6 5"
                opacity={step === 1 ? 1 : 0.55}
              />
              {/* Rotation handle stem + grip (only in step 1) */}
              {step === 1 && (
                <>
                  <line
                    x1={cxPx} y1={topPx}
                    x2={cxPx} y2={topPx - 28}
                    stroke="#9F87FF" strokeWidth={1.5} strokeDasharray="3 3"
                  />
                  <circle
                    cx={cxPx} cy={topPx - 28}
                    r={6}
                    fill="#7C5CFF"
                    stroke="rgba(0,0,0,0.5)"
                    strokeWidth={2}
                  />
                </>
              )}

              {/* Wrist-area band (step 1 only). Continuous extension below
                  the keyboard rect, marked off by a dashed teal "wrist"
                  horizon at the keyboard's bottom and a solid wrist-bottom
                  edge the user drags to size the band. When wristArea = 0
                  the dashed horizon collapses onto the solid keyboard
                  bottom and the user sees no extra band. */}
              {step === 1 && hasWrist && (
                <>
                  {/* Soft dashed wrist horizon — coincides with the
                      keyboard bottom edge but uses a different colour /
                      stroke so the user can see "keyboard ends here,
                      wrist begins". */}
                  <line
                    x1={leftPx} y1={bottomPx} x2={rightPx} y2={bottomPx}
                    stroke="#37C3A4" strokeWidth={1.0} strokeDasharray="4 4"
                  />
                  {/* Wrist-bottom solid edge — the lower boundary of the
                      included region. */}
                  <line
                    x1={leftPx} y1={wristBottomPx} x2={rightPx} y2={wristBottomPx}
                    stroke="#37C3A4" strokeWidth={1.5}
                  />
                  {/* Side edges across the wrist band (dashed, lighter). */}
                  <line
                    x1={leftPx} y1={bottomPx} x2={leftPx} y2={wristBottomPx}
                    stroke="#37C3A4" strokeWidth={1} strokeDasharray="4 4"
                    opacity={0.6}
                  />
                  <line
                    x1={rightPx} y1={bottomPx} x2={rightPx} y2={wristBottomPx}
                    stroke="#37C3A4" strokeWidth={1} strokeDasharray="4 4"
                    opacity={0.6}
                  />
                </>
              )}
              {/* "wrist area" tag at the lower-left of the band when
                  active. Sits BELOW the band to stay out of the camera
                  view. */}
              {step === 1 && hasWrist && (
                <text
                  x={leftPx + 6}
                  y={wristBottomPx + 12}
                  fill="#37C3A4"
                  fontSize={9}
                  style={{ letterSpacing: '0.1em' }}
                >
                  WRIST AREA
                </text>
              )}
            </svg>

            {/* Hit-zones — positioned in un-rotated coords, then carried by
                the CSS rotation. Drag handlers inverse-rotate the deltas
                back into local space (see toLocalDelta above). */}
            {ready && step === 1 && (
              <>
                <div
                  onPointerDown={onBodyDrag}
                  style={{
                    position: 'absolute',
                    left: leftPx,
                    top: topPx,
                    width: Math.max(0, rightPx - leftPx),
                    height: Math.max(0, bottomPx - topPx),
                    cursor: 'move',
                    touchAction: 'none',
                  }}
                />
                <div
                  onPointerDown={onLeftRightDrag('leftX')}
                  style={{
                    position: 'absolute',
                    left: leftPx - 10, top: topPx,
                    width: 20, height: Math.max(0, bottomPx - topPx),
                    cursor: 'ew-resize', touchAction: 'none',
                  }}
                />
                <div
                  onPointerDown={onLeftRightDrag('rightX')}
                  style={{
                    position: 'absolute',
                    left: rightPx - 10, top: topPx,
                    width: 20, height: Math.max(0, bottomPx - topPx),
                    cursor: 'ew-resize', touchAction: 'none',
                  }}
                />
                <div
                  onPointerDown={onEdgeDrag('topY')}
                  style={{
                    position: 'absolute',
                    left: leftPx, top: topPx - 10,
                    width: Math.max(0, rightPx - leftPx), height: 20,
                    cursor: 'ns-resize', touchAction: 'none',
                  }}
                />
                <div
                  onPointerDown={onEdgeDrag('bottomY')}
                  style={{
                    position: 'absolute',
                    left: leftPx, top: bottomPx - 10,
                    width: Math.max(0, rightPx - leftPx), height: 20,
                    cursor: 'ns-resize', touchAction: 'none',
                  }}
                />
                {/* Rotation grip hit-zone — wraps the visible 6-px circle
                    with a generous 24-px hit area for finger drags. */}
                <div
                  onPointerDown={onRotateDrag}
                  style={{
                    position: 'absolute',
                    left: cxPx - 12,
                    top: topPx - 28 - 12,
                    width: 24,
                    height: 24,
                    cursor: 'grab',
                    touchAction: 'none',
                    borderRadius: '50%',
                  }}
                />
                {/* Wrist-area drag handle — appears just BELOW the keyboard
                    bottom edge so it's always reachable, even at wristArea
                    = 0. Dragging down grows the band; dragging back up
                    shrinks it; releasing at 0 collapses the visuals. */}
                <div
                  onPointerDown={onWristDrag}
                  style={{
                    position: 'absolute',
                    left: leftPx,
                    top: wristBottomPx - 6,
                    width: Math.max(0, rightPx - leftPx),
                    height: 14,
                    cursor: 'ns-resize',
                    touchAction: 'none',
                  }}
                  title="Drag down to include wrists / hands"
                />
              </>
            )}
            {ready && step === 2 && (
              <div
                onPointerDown={onCenterDrag}
                style={{
                  position: 'absolute',
                  left: centerPx - 12, top: topPx,
                  width: 24, height: Math.max(0, bottomPx - topPx),
                  cursor: 'ew-resize', touchAction: 'none',
                }}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="w-full flex items-center justify-between gap-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-white/10 text-ink-300 hover:border-white/20"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {/* Reset-rotation affordance — only meaningful in step 1 and
                when rotation is non-trivial. Keeps the chrome quiet when
                the user hasn't touched rotation. */}
            {step === 1 && Math.abs(theta) > 1e-4 && (
              <button
                onClick={() => setDraft({ ...draft, rotation: 0 })}
                className="text-[11px] text-accent-soft hover:text-ink-50"
              >
                Reset rotation
              </button>
            )}
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="text-xs px-3 py-1.5 rounded border border-white/10 text-ink-200 hover:border-white/20"
              >
                Back
              </button>
            )}
            {step === 1 ? (
              <button
                onClick={() => setStep(2)}
                className="text-xs px-4 py-1.5 rounded border border-accent bg-accent/15 text-ink-50 hover:bg-accent/25"
              >
                Next
              </button>
            ) : (
              <button
                onClick={() => {
                  onApply(draft);
                  onClose();
                }}
                className="text-xs px-4 py-1.5 rounded border border-accent bg-accent/15 text-ink-50 hover:bg-accent/25"
              >
                Apply
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

