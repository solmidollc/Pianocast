import { ScenePlaceholder } from '../scene/ScenePlaceholder';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { companionStatus } from '../companion/signaling';
import { useLocalCameraStream } from './cameraStream';
import {
  IDENTITY_MAT3,
  defaultCropRect,
  mat3ToCssMatrix3d,
  perspectiveMat3FromCorners,
  type CropRect,
  type Point,
} from './perspective';
import { autoCrop } from './overheadAutoCrop';
import {
  buildSvgFilterSpec,
  cssFilterChain,
  defaultAdjustments,
  digitalZoomFactor,
  type CameraAdjustments,
} from './cameraAdjustments';
import { setCameraTrack } from './cameraTrackRegistry';
import { CameraFilterDefs } from './Camera';

interface Props {
  width: number;
  height: number;
  /** Module id — namespaces the SVG filter and the track registry. */
  moduleId: string;
  source: 'local' | 'companion';
  deviceId: string | null;
  crop: CropRect | null;
  keystone?: Point[];
  editKeystone?: boolean;
  mirror?: boolean;
  /** Per-source image adjustments. Optional — falls back to identity. */
  adjustments?: CameraAdjustments;
  onKeystoneChange?: (corners: Point[]) => void;
  /**
   * Auto-crop wiring. When a fresh stream comes online with no crop set,
   * OverheadCamera grabs a frame, runs the auto-detector, and emits the
   * resulting CropRect (or defaultCropRect() on failure) via this callback.
   * Without it auto-crop is silently disabled — i.e. previews used outside
   * the scene editor (Preview window) don't try to mutate state.
   */
  onCropChange?: (crop: CropRect) => void;
  /**
   * Manual re-trigger for auto-crop. Each increment forces a re-detection,
   * even if a crop is already set. Backed by an opaque timestamp/counter in
   * the module options so the Properties panel can fire it from outside the
   * scene tree without sharing a ref.
   */
  autoCropToken?: number;
}

const IDENTITY_CORNERS: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/**
 * OverheadCamera — single-pass WebGL rectification.
 *
 * Drops the two-half CSS-matrix3d split and rectifies the keyboard region in
 * one draw. Architecture:
 *
 *    hidden <video>  ─► (texSubImage2D every rAF) ─► GL_TEXTURE_2D
 *                                                       │
 *                                                       ▼
 *                         single fragment shader, single draw
 *                                                       │
 *                                                       ▼
 *                                          one <canvas>, no seam
 *
 * The fragment shader maps destination UV (canvas 0..1) → source UV using:
 *   - left half  (vUv.x in [0, 0.5])   maps from image [leftX..centerX]
 *   - right half (vUv.x in [0.5, 1])   maps from image [centerX..rightX]
 *   - vertically                        maps from image [topY..bottomY]
 *
 * The E4/F4 centre is a control point inside this one transform — moving it
 * stretches each half independently to correct camera tilt, with no seam at
 * the boundary (both branches yield srcX = centerX at vUv.x = 0.5). Because
 * the shader samples the texture at normalized source UVs directly, the
 * rendered region is exactly what was cropped in the popup — no scale drift
 * between the popup's display coords and the module's render coords.
 *
 * The 4-corner keystone applies as a CSS matrix3d on the canvas wrapper,
 * composed with mirror. Both stay GPU-composited.
 */
export function OverheadCamera({
  width,
  height,
  moduleId,
  source,
  deviceId,
  crop,
  keystone,
  editKeystone = false,
  mirror = false,
  adjustments,
  onKeystoneChange,
  onCropChange,
  autoCropToken,
}: Props) {
  const local = useLocalCameraStream(source === 'local' ? deviceId : null);
  const [companion, setCompanion] = useState(companionStatus.snapshot());
  useEffect(() => companionStatus.subscribe(() => setCompanion(companionStatus.snapshot())), []);
  const stream = source === 'companion' ? companion.stream : local.stream;

  // Track-registry plumbing so the adjustment panel can read capabilities
  // (caps.zoom, caps.exposureCompensation, …) and applyConstraints() back
  // to this device. Companion-source streams are received over WebRTC and
  // don't expose hardware controls — registering them is harmless because
  // getCapabilities returns an empty set, but it keeps the panel UI alive.
  const [hardwareZoom, setHardwareZoom] = useState(false);
  useEffect(() => {
    const track = stream?.getVideoTracks()[0] ?? null;
    setCameraTrack(moduleId, track);
    if (track) {
      try {
        const caps = track.getCapabilities
          ? (track.getCapabilities() as unknown as Record<string, unknown>)
          : undefined;
        setHardwareZoom(!!(caps && caps['zoom']));
      } catch {
        setHardwareZoom(false);
      }
    } else {
      setHardwareZoom(false);
    }
    return () => {
      setCameraTrack(moduleId, null);
    };
  }, [stream, moduleId]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // The rAF loop reads the latest crop / mirror via refs so we don't have to
  // tear down and re-build the WebGL pipeline on every property tweak.
  const cropRef = useRef(crop);
  useEffect(() => {
    cropRef.current = crop;
  }, [crop]);

  // Attach stream to the hidden video and nudge play() — the texture upload
  // path needs `video.readyState >= HAVE_CURRENT_DATA` and `videoWidth > 0`.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream ?? null;
    if (stream) {
      v.play().catch(() => {
        /* autoplay restrictions are unlikely with muted + playsInline; ignore */
      });
    }
  }, [stream]);

  // Auto-crop trigger.
  //
  // Two cases fire detection:
  //   (a) A fresh stream identity arrives AND there is no crop yet — first-
  //       time auto-crop on camera add.
  //   (b) `autoCropToken` increments — the Properties panel's "Re-run
  //       auto-crop" button.
  //
  // Crop changing on its own (user dragged in the modal, cleared crop) does
  // NOT re-trigger; we record the stream identity AFTER running, so a later
  // `crop = null` does not look like a new stream.
  //
  // The detection itself is multi-frame, multi-threshold, and budgeted for
  // ~2 s of wall-clock — see overheadAutoCrop.ts. During that window we
  // surface a "Calibrating overhead…" overlay below so the user sees that
  // something is happening; the live 60 fps render loop is untouched.
  const lastStreamForAutoCrop = useRef<MediaStream | null>(null);
  const lastAutoCropToken = useRef<number>(autoCropToken ?? 0);
  const [calibrating, setCalibrating] = useState(false);
  const [calibProgress, setCalibProgress] = useState(0);
  useEffect(() => {
    if (!onCropChange) return;
    if (!stream) return;
    const v = videoRef.current;
    if (!v) return;

    const streamChanged = stream !== lastStreamForAutoCrop.current;
    const tokenChanged = (autoCropToken ?? 0) !== lastAutoCropToken.current;
    const wantAuto = (streamChanged && !crop) || tokenChanged;
    if (!wantAuto) return;

    lastStreamForAutoCrop.current = stream;
    lastAutoCropToken.current = autoCropToken ?? 0;

    const controller = new AbortController();
    setCalibrating(true);
    setCalibProgress(0);

    autoCrop(v, {
      signal: controller.signal,
      onProgress: (frac) => setCalibProgress(frac),
    })
      .then((detected) => {
        if (controller.signal.aborted) return;
        // Best-effort: on detection failure, fall back to the manual default
        // so the user sees something sensible and can fine-tune from there.
        onCropChange(detected ?? defaultCropRect());
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCalibrating(false);
          setCalibProgress(1);
        }
      });

    return () => {
      controller.abort();
      setCalibrating(false);
    };
  }, [stream, autoCropToken, crop, onCropChange]);

  // WebGL pipeline. Created once on mount; cleaned up on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const gl =
      canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
      }) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) {
      console.warn('[OverheadCamera] WebGL not supported');
      return;
    }

    const vertSrc = `
      attribute vec2 aPosition;
      attribute vec2 aUv;
      varying vec2 vUv;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vUv = aUv;
      }
    `;
    // The horizontal piecewise map uses E4/F4 (uCenterX) as a control point.
    // Both branches yield srcX = uCenterX at vUv.x = 0.5, so there's no seam.
    // The piecewise X-map is the ONLY permitted non-uniform mapping in this
    // shader — it's how the user aligns the physical keyboard with the
    // visualization above. Every other axis renders at TRUE aspect.
    //
    // VERTICAL is now top-aligned at NATURAL aspect (no stretch). The crop
    // rectangle defined in the modal has a real width/height in source
    // pixels; we display it at that exact aspect inside the module's canvas:
    //
    //   - vUv.y = 0  maps to srcY = uTopY (the keyboard top, locked to the
    //     visualization above via the lock-group reflow — never moves).
    //   - 1 unit of vUv.y  maps to (canvasH/canvasW) * (rightX - leftX) *
    //     uAspect units of srcY, so the displayed image keeps the crop's
    //     true proportions regardless of the slot's aspect.
    //   - When srcY climbs past uBottomY, we're past the captured region —
    //     paint black. This is the "reveal more or less" behaviour: a taller
    //     slot reaches deeper into the captured region (more wrist visible);
    //     a shorter slot reveals less. Neither distorts.
    //
    // uRotation rotates the SAMPLING coordinates around the rectangle's
    // centre in pixel-square space (multiply Y by uAspect, rotate, divide
    // back) so the rotation is isotropic in actual source pixels.
    const fragSrc = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uVideo;
      uniform float uLeftX;
      uniform float uCenterX;
      uniform float uRightX;
      uniform float uTopY;
      uniform float uBottomY;
      uniform float uRotation;
      uniform float uAspect;        // videoW / videoH
      uniform float uCanvasAspect;  // canvasW / canvasH
      void main() {
        float srcX;
        if (vUv.x < 0.5) {
          srcX = mix(uLeftX, uCenterX, vUv.x * 2.0);
        } else {
          srcX = mix(uCenterX, uRightX, (vUv.x - 0.5) * 2.0);
        }

        // Natural-aspect vertical map: srcY advances at the rate that keeps
        // the crop's source pixels square on the canvas. Beyond uBottomY,
        // we're past the captured region — paint black.
        float hSpan = uRightX - uLeftX;
        float srcYSpan = (hSpan * uAspect) / max(uCanvasAspect, 1e-6);
        float srcY = uTopY + vUv.y * srcYSpan;
        if (srcY > uBottomY) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }

        float cx = (uLeftX + uRightX) * 0.5;
        float cy = (uTopY + uBottomY) * 0.5;
        float rx = srcX - cx;
        float ry = (srcY - cy) * uAspect;
        float cR = cos(uRotation);
        float sR = sin(uRotation);
        float nrx = rx * cR - ry * sR;
        float nry = rx * sR + ry * cR;
        float sampleX = cx + nrx;
        float sampleY = cy + nry / uAspect;

        gl_FragColor = texture2D(uVideo, vec2(sampleX, sampleY));
      }
    `;

    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('[OverheadCamera] shader compile error:', gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[OverheadCamera] program link error:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // Full-screen quad: position (xy clip) + uv (st), interleaved.
    // vUv.y = 0 at canvas top, vUv.y = 1 at canvas bottom — matches image
    // memory order so `srcY = mix(topY, bottomY, vUv.y)` reads naturally.
    // (FLIP_Y_WEBGL stays at its default of false; the default upload places
    // source row 0 at texture row 0, and sampling at v = srcY then returns
    // source's normalized row, which is exactly what we want.)
    const verts = new Float32Array([
      // x,  y,  u, v
      -1, 1, 0, 0, // TL → canvas top-left
      1, 1, 1, 0, // TR
      -1, -1, 0, 1, // BL
      1, -1, 1, 1, // BR
    ]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, 'aPosition');
    const aUv = gl.getAttribLocation(program, 'aUv');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    const uVideo = gl.getUniformLocation(program, 'uVideo');
    const uLeftX = gl.getUniformLocation(program, 'uLeftX');
    const uCenterX = gl.getUniformLocation(program, 'uCenterX');
    const uRightX = gl.getUniformLocation(program, 'uRightX');
    const uTopY = gl.getUniformLocation(program, 'uTopY');
    const uBottomY = gl.getUniformLocation(program, 'uBottomY');
    const uRotation = gl.getUniformLocation(program, 'uRotation');
    const uAspect = gl.getUniformLocation(program, 'uAspect');
    const uCanvasAspect = gl.getUniformLocation(program, 'uCanvasAspect');
    gl.uniform1i(uVideo, 0);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Initialize as a 1×1 black so the first frame's sampler call doesn't
    // touch uninitialised storage.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );

    let rafId = 0;
    let textureW = 0;
    let textureH = 0;
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (
        video.readyState < video.HAVE_CURRENT_DATA ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0
      ) {
        // Pipeline is live; just no frames yet. Loop continues; we'll start
        // drawing the moment the source has data.
        return;
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (video.videoWidth !== textureW || video.videoHeight !== textureH) {
        // First frame after mount, OR the source changed dimensions (user
        // switched device). Re-init the texture storage so texSubImage2D
        // doesn't try to fit a differently-sized frame into the old slot.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        textureW = video.videoWidth;
        textureH = video.videoHeight;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
      }

      const c = cropRef.current;
      gl.uniform1f(uLeftX, c ? c.leftX : 0);
      gl.uniform1f(uCenterX, c ? c.centerX : 0.5);
      gl.uniform1f(uRightX, c ? c.rightX : 1);
      gl.uniform1f(uTopY, c ? c.topY : 0);
      // Effective bottom of the captured region. `wristArea` is now just an
      // additive extension of the crop (kept for back-compat with older
      // saves); the user mostly just drags the bottom edge directly. Either
      // way, the shader treats `bottomY + wristArea` as the source-y limit:
      // canvas pixels whose mapped srcY exceeds this paint black instead
      // of distorting the image to fit.
      const bottom = c
        ? c.bottomY + (c.wristArea ?? 0)
        : 1;
      gl.uniform1f(uBottomY, bottom);
      gl.uniform1f(uRotation, c?.rotation ?? 0);
      // Aspect = sourceWidth / sourceHeight, used to keep rotation isotropic
      // in pixel-square space even though sampling coords are 0..1 on both
      // axes. videoWidth/Height are guaranteed > 0 by the readyState gate.
      gl.uniform1f(uAspect, video.videoWidth / video.videoHeight);
      // Canvas aspect drives the natural-aspect vertical map (see fragment
      // shader). Recomputed every frame so a live slot-resize reflows
      // without re-creating the GL pipeline.
      gl.uniform1f(uCanvasAspect, canvas.width / Math.max(1, canvas.height));

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
      gl.deleteTexture(tex);
    };
    // Empty deps — we deliberately keep the GL context for the lifetime of
    // the module instance. Crop/keystone/mirror updates are funnelled through
    // refs / CSS.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keystone matrix3d (composed with mirror) on the canvas wrapper.
  const wrapperTransform = useMemo(() => {
    const corners: Point[] = keystone && keystone.length === 4 ? keystone : IDENTITY_CORNERS;
    const M_keystone = perspectiveMat3FromCorners(
      width,
      height,
      corners.map(([x, y]) => [x * width, y * height] as Point),
    );
    let css = M_keystone === IDENTITY_MAT3 ? 'none' : mat3ToCssMatrix3d(M_keystone);
    if (mirror) css = css === 'none' ? 'scaleX(-1)' : `${css} scaleX(-1)`;
    return css;
  }, [width, height, keystone, mirror]);

  const placeholderText = (() => {
    if (source === 'companion') {
      return companion.stream
        ? null
        : 'Pair the companion phone app to stream an overhead view.';
    }
    if (local.status.kind === 'error') return local.status.message;
    if (local.status.kind === 'opening') return 'Opening device…';
    if (!deviceId) return 'Pick a device in the Properties panel.';
    return null;
  })();

  const canvasW = Math.max(1, Math.round(width));
  const canvasH = Math.max(1, Math.round(height));

  // Adjustment-pipeline outputs. Identity when no adjustments are supplied,
  // so neither the filter chain nor digital zoom does anything visible.
  const adj = adjustments ?? defaultAdjustments();
  const filterChain = cssFilterChain(adj, moduleId);
  const svg = buildSvgFilterSpec(adj, moduleId);
  const dz = digitalZoomFactor(adj, hardwareZoom);
  const zoomTransform = dz === 1 ? 'none' : `scale(${dz})`;

  return (
    <div
      className="w-full h-full relative overflow-hidden bg-ink-900"
      style={{ width, height }}
    >
      {/* Hidden video — drives the texture. Kept 1×1 with opacity 0 instead
          of display:none so Chromium/Safari keep decoding frames. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

      {/* SVG filter defs for temperature / tint + tone curve. The canvas
          below references this filter via fragment URL, so the defs need
          to live in the same document. Each ProgramOutput window mounts
          its own copy. */}
      <CameraFilterDefs spec={svg} />

      {/* The canvas is ALWAYS mounted (not gated on `stream`) so the
          WebGL useEffect can capture canvasRef.current on the very first
          render. Gating it behind `{stream && ...}` was the black-screen
          bug: at initial mount stream is null, the conditional renders
          nothing, the effect sees ref.current === null and bails, then
          the empty deps array means it never re-fires when the canvas
          finally arrives. With the canvas always present the pipeline
          initialises immediately and the rAF loop starts drawing the
          instant frames arrive. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: wrapperTransform,
          transformOrigin: '0 0',
        }}
      >
        <canvas
          ref={canvasRef}
          width={canvasW}
          height={canvasH}
          style={{
            width: '100%',
            height: '100%',
            display: stream ? 'block' : 'none',
            background: '#000',
            // Adjustment pipeline. CSS filter (brightness / contrast /
            // saturate) + SVG filter URL (temp/tint + tonal LUT) stack on
            // the same `filter:` value; both are GPU-composited.
            filter: filterChain,
            // Digital zoom fallback. We centre the transform on the canvas
            // itself so a 2× zoom shows the middle of the (already-cropped)
            // overhead view — same intuition as a phone camera's pinch.
            // overflow:hidden on the wrapper crops anything that runs over.
            transform: zoomTransform,
            transformOrigin: '50% 50%',
          }}
        />
      </div>

      {!stream && <ScenePlaceholder label="Overhead Camera" labelClassName="overhead-empty-name" detail={placeholderText??'Waiting for source…'}/>}

      {editKeystone && stream && onKeystoneChange && (
        <KeystoneOverlay
          width={width}
          height={height}
          corners={keystone ?? IDENTITY_CORNERS}
          onChange={onKeystoneChange}
        />
      )}

      {/* Calibrating overlay — visible only while auto-crop is in flight.
          Lives ABOVE the canvas so the user sees the live feed beneath, with
          a translucent status chip in the corner and a progress bar at the
          bottom. Pointer-events: none so it doesn't intercept any UI. */}
      {calibrating && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'rgba(7,7,9,0.20)',
            transition: 'opacity 200ms ease',
          }}
        >
          <div
            className="absolute top-2 left-2 flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] text-ink-50"
            style={{ background: 'rgba(7,7,9,0.65)', backdropFilter: 'blur(4px)' }}
          >
            <span
              className="inline-block rounded-full"
              style={{
                width: 7,
                height: 7,
                background: '#7C5CFF',
                animation: 'pulse-dot 1.1s ease-in-out infinite',
              }}
            />
            Calibrating overhead…
          </div>
          <div
            className="absolute bottom-0 left-0 h-[2px]"
            style={{
              width: `${Math.round(calibProgress * 100)}%`,
              background: '#7C5CFF',
              transition: 'width 120ms linear',
            }}
          />
          <style>{`
            @keyframes pulse-dot {
              0%, 100% { opacity: 1; transform: scale(1); }
              50%      { opacity: 0.45; transform: scale(0.7); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keystone overlay — unchanged 4-corner manual fine-tune.
// ---------------------------------------------------------------------------

interface KeystoneOverlayProps {
  width: number;
  height: number;
  corners: Point[];
  onChange: (corners: Point[]) => void;
}

function KeystoneOverlay({ width, height, corners, onChange }: KeystoneOverlayProps) {
  const abs = corners.map(([x, y]) => [x * width, y * height] as Point);

  const onDrag = useCallback(
    (idx: number) => (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const start = abs[idx];
      const move = (mv: PointerEvent) => {
        const dx = mv.clientX - startClientX;
        const dy = mv.clientY - startClientY;
        const nx = Math.max(0, Math.min(width, start[0] + dx));
        const ny = Math.max(0, Math.min(height, start[1] + dy));
        const next: Point[] = corners.map(
          (c, i) => (i === idx ? [nx / width, ny / height] : c) as Point,
        );
        onChange(next);
      };
      const up = (uv: PointerEvent) => {
        (uv.target as Element).releasePointerCapture?.(uv.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [abs, corners, width, height, onChange],
  );

  return (
    <>
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <polygon
          points={abs.map((c) => c.join(',')).join(' ')}
          fill="none"
          stroke="#7C5CFF"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      </svg>
      {abs.map((c, i) => (
        <div
          key={i}
          onPointerDown={onDrag(i)}
          className="absolute bg-accent rounded-full cursor-grab active:cursor-grabbing"
          style={{
            width: 14,
            height: 14,
            left: c[0] - 7,
            top: c[1] - 7,
            boxShadow: '0 0 0 2px rgba(0,0,0,0.5)',
            touchAction: 'none',
          }}
        />
      ))}
    </>
  );
}
