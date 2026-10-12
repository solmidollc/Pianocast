import { useEffect, useState } from 'react';

export type LocalCameraStatus =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'live' }
  | { kind: 'error'; message: string };

export interface UseLocalCameraStream {
  stream: MediaStream | null;
  status: LocalCameraStatus;
}

/**
 * Open a system video-capture device by deviceId and return the resulting
 * MediaStream. Re-opens on deviceId change, tears the stream down on unmount,
 * and surfaces a typed error on track 'ended' / permission denial / single-
 * consumer rejection.
 *
 * The same shape as the local-source bits inside CameraModule, lifted so the
 * OverheadCamera can subscribe to it without duplicating the lifecycle dance.
 */
export function useLocalCameraStream(deviceId: string | null): UseLocalCameraStream {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<LocalCameraStatus>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    let active: MediaStream | null = null;
    let track: MediaStreamTrack | null = null;
    let endedListener: (() => void) | null = null;

    async function open() {
      if (!deviceId) {
        setStream(null);
        setStatus({ kind: 'idle' });
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: 'error', message: 'No camera API in this environment' });
        return;
      }
      setStatus({ kind: 'opening' });
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
        active = s;
        track = s.getVideoTracks()[0] ?? null;
        if (track) {
          endedListener = () => {
            if (!cancelled) {
              setStatus({ kind: 'error', message: 'Device disconnected' });
              setStream(null);
            }
          };
          track.addEventListener('ended', endedListener);
        }
        setStream(s);
        setStatus({ kind: 'live' });
      } catch (err) {
        if (cancelled) return;
        // Same DevTools surface as CameraModule — see comment there.
        console.error('[useLocalCameraStream] getUserMedia rejected', err);
        setStatus({ kind: 'error', message: describeError(err) });
        setStream(null);
      }
    }

    open();

    return () => {
      cancelled = true;
      if (track && endedListener) track.removeEventListener('ended', endedListener);
      if (active) {
        for (const t of active.getTracks()) t.stop();
      }
    };
  }, [deviceId]);

  return { stream, status };
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'Camera unavailable';
  if (err.name === 'NotAllowedError') return 'Camera permission denied';
  if (err.name === 'NotFoundError') return 'Device not found';
  if (err.name === 'NotReadableError') return 'Device in use by another app';
  if (err.name === 'OverconstrainedError') return 'Device cannot meet constraints';
  return err.message || 'Camera unavailable';
}
