import { useEffect, useRef, useState } from 'react';
import {
  buildSvgFilterSpec,
  cssFilterChain,
  defaultAdjustments,
  digitalZoomFactor,
  type CameraAdjustments,
} from './cameraAdjustments';
import { setCameraTrack } from './cameraTrackRegistry';

interface Props {
  width: number;
  height: number;
  /** Module id — needed to namespace the SVG filter and the track registry. */
  moduleId: string;
  deviceId: string | null;
  mirror?: boolean;
  crop?: { top: number; right: number; bottom: number; left: number } | null;
  /** Per-source video adjustments. Optional — falls back to identity. */
  adjustments?: CameraAdjustments;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'live' }
  | { kind: 'error'; message: string };

/**
 * CameraModule
 *
 * Renders a single system camera / capture device into the scene.
 *
 * Adjustments pipeline (per-source CameraAdjustments):
 *   - Cheap stuff (brightness / contrast / saturate) → CSS filter on the
 *     <video> element. GPU-composited, zero CPU per frame.
 *   - Tonal + colour-temp / tint                     → SVG <filter> referenced
 *     from the same `filter:` chain. Also GPU-composited in Chromium.
 *   - Hardware zoom (where caps.zoom exists)         → track.applyConstraints,
 *     driven by the Properties panel.
 *   - Digital zoom fallback                          → CSS transform: scale.
 *
 * Lifecycle notes (unchanged from before):
 *   - We tear the stream down on deviceId change OR unmount and start fresh.
 *   - The MediaStreamTrack's `ended` event fires when the OS reports the
 *     device as gone (unplug, lid close, capture-card sleep). We surface
 *     that as an error state and stop holding a stale track.
 *   - In the program-output window this same component re-runs the
 *     getUserMedia call independently. Some capture cards refuse the second
 *     consumer; the editor preview still works, and the output simply shows
 *     "Device unavailable" — no crash.
 *
 * `width` / `height` are scene-local px; we object-fit: cover the video so
 * any aspect mismatch crops cleanly to the module frame.
 */
export function CameraModule({
  width,
  height,
  moduleId,
  deviceId,
  mirror = false,
  adjustments,
  crop,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // Hardware zoom support is reported on the live track. We mirror it into
  // local state so the digital-zoom branch flips off the moment the track
  // exposes optical zoom (and back on if the user re-binds a non-zoom
  // device). Default false until we know better.
  const [hardwareZoom, setHardwareZoom] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let endedListener: (() => void) | null = null;
    let trackForCleanup: MediaStreamTrack | null = null;

    async function open() {
      if (!deviceId) {
        setStatus({ kind: 'idle' });
        setCameraTrack(moduleId, null);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: 'error', message: 'No camera API in this environment' });
        return;
      }
      setStatus({ kind: 'opening' });
      console.log('[CameraModule] requesting', { deviceId, moduleId });
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 },
          },
          audio: false,
        });
        if (cancelled) {
          for (const t of s.getTracks()) t.stop();
          return;
        }
        stream = s;
        const probe = s.getVideoTracks()[0];
        console.log('[CameraModule] getUserMedia resolved', {
          readyState: probe?.readyState,
          muted: probe?.muted,
          settings: probe?.getSettings?.(),
        });
        if (videoRef.current) {
          // srcObject + an explicit play(). The video element is
          // `display: none` while we wait for `setStatus({kind:'live'})`
          // to flip it to `block`, and Chromium occasionally skips the
          // implicit autoplay when srcObject lands on a hidden element.
          // OverheadCamera takes the same belt-and-braces approach.
          videoRef.current.srcObject = s;
          videoRef.current.play().catch((e) => {
            // play() rejecting here is a "couldn't start" rather than a
            // device-permission issue — log so DevTools shows it instead
            // of swallowing it into the status label.
            console.warn('[CameraModule] video.play() rejected', e);
          });
        }
        const track = s.getVideoTracks()[0];
        if (track) {
          trackForCleanup = track;
          // Register so the Properties panel can read capabilities and
          // apply constraints.
          setCameraTrack(moduleId, track);
          // Probe optical-zoom support so the render path can decide
          // between hardware and digital zoom.
          try {
            const caps = track.getCapabilities
              ? (track.getCapabilities() as unknown as Record<string, unknown>)
              : undefined;
            setHardwareZoom(!!(caps && caps['zoom']));
          } catch {
            setHardwareZoom(false);
          }
          endedListener = () => {
            if (!cancelled) {
              setStatus({ kind: 'error', message: 'Device disconnected' });
              setCameraTrack(moduleId, null);
            }
          };
          track.addEventListener('ended', endedListener);
        }
        setStatus({ kind: 'live' });
        // Confirm frames are arriving — videoWidth/videoHeight stay 0 until
        // the first decoded frame, so a quick after-tick poll tells us
        // whether the pipeline is actually delivering. Two attempts at
        // 250 ms and 1 s give a clear "frames arriving" / "black stream"
        // signal in the diagnostic log.
        const v = videoRef.current;
        if (v) {
          setTimeout(() => {
            if (!cancelled) console.log('[CameraModule] @250ms', { videoWidth: v.videoWidth, videoHeight: v.videoHeight });
          }, 250);
          setTimeout(() => {
            if (!cancelled) console.log('[CameraModule] @1000ms', { videoWidth: v.videoWidth, videoHeight: v.videoHeight, paused: v.paused, readyState: v.readyState });
          }, 1000);
        }
      } catch (err) {
        if (cancelled) return;
        // Surface the raw error to DevTools — the UI label below shows a
        // friendly summary, but for "no feed" debugging the raw .name +
        // .message tell the operator whether it's NotAllowedError (OS
        // permission denied), NotReadableError (in use by another app),
        // OverconstrainedError (deviceId stale / frameRate too high), or
        // NotFoundError (the picked device just vanished).
        console.error('[CameraModule] getUserMedia rejected', err);
        setStatus({ kind: 'error', message: describeError(err) });
        setCameraTrack(moduleId, null);
      }
    }

    open();

    return () => {
      cancelled = true;
      if (trackForCleanup && endedListener) {
        trackForCleanup.removeEventListener('ended', endedListener);
      }
      if (stream) {
        for (const t of stream.getTracks()) t.stop();
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraTrack(moduleId, null);
    };
  }, [deviceId, moduleId]);

  // The adjustment values feeding the render path. Empty / undefined means
  // identity — `defaultAdjustments()` builds an all-zeroed CameraAdjustments.
  const adj = adjustments ?? defaultAdjustments();
  const filterChain = cssFilterChain(adj, moduleId);
  const svg = buildSvgFilterSpec(adj, moduleId);
  const dz = digitalZoomFactor(adj, hardwareZoom);
  const baseMirror = mirror ? 'scaleX(-1)' : '';
  const zoomScale = dz === 1 ? '' : `scale(${dz})`;
  // Compose: mirror first (axis-flip), then digital zoom (uniform scale).
  // Either alone is fine; both together compose correctly since they share
  // the centred transform-origin.
  const transform = [baseMirror, zoomScale].filter(Boolean).join(' ') || 'none';

  const trim = crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const spanX = 1 - trim.left - trim.right;
  const spanY = 1 - trim.top - trim.bottom;

  return (
    <div
      className="w-full h-full relative overflow-hidden bg-ink-900"
      style={{ width, height }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          left: (-trim.left / spanX * 100) + '%',
          top: (-trim.top / spanY * 100) + '%',
          width: (100 / spanX) + '%',
          height: (100 / spanY) + '%',
          objectFit: 'cover',
          transform,
          filter: filterChain,
          display: status.kind === 'live' ? 'block' : 'none',
          background: '#000',
        }}
      />

      {/* SVG filter defs — mounted alongside the video in both editor and
          ProgramOutput documents. The video references the filter via its
          fragment URL, so each document needs its own copy. */}
      <CameraFilterDefs spec={svg} />

      {status.kind !== 'live' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <div className="scene-empty-label">
            Camera
          </div>
          <div className="text-ink-200 text-sm font-light max-w-sm">
            
            {status.kind === 'opening' && 'Opening device…'}
            {status.kind === 'error' && status.message}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Inline SVG that contains a single <filter> definition driving the camera
 * frame's temperature / tint and the whites / blacks / highlights / shadows
 * tone curve. The element is positioned absolutely and sized 0×0 so it
 * doesn't take layout space — only the <defs> matter.
 *
 * Exported so OverheadCamera can mount the exact same defs node. Keeping
 * the JSX in one place keeps the two cameras visually identical and means
 * any future filter-graph change touches one site, not two.
 */
export function CameraFilterDefs({
  spec,
}: {
  spec: ReturnType<typeof buildSvgFilterSpec>;
}) {
  return (
    <svg
      width={0}
      height={0}
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
      aria-hidden
    >
      <defs>
        <filter
          id={spec.id}
          // sRGB interpolation matches what the user sees on their monitor;
          // linearRGB would do "physically correct" mixing but visually
          // shifts the tone curve in a way that doesn't match expectations.
          colorInterpolationFilters="sRGB"
        >
          <feColorMatrix type="matrix" values={spec.colorMatrix} />
          <feComponentTransfer>
            <feFuncR type="table" tableValues={spec.toneR} />
            <feFuncG type="table" tableValues={spec.toneG} />
            <feFuncB type="table" tableValues={spec.toneB} />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'Camera unavailable';
  if (err.name === 'NotAllowedError') return 'Camera permission denied';
  if (err.name === 'NotFoundError') return 'Device not found';
  if (err.name === 'NotReadableError') return 'Device in use by another app';
  if (err.name === 'OverconstrainedError') return 'Device cannot meet constraints';
  return err.message || 'Camera unavailable';
}

