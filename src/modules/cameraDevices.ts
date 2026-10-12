import { useCallback, useEffect, useState } from 'react';
import { isOutputView } from '../runtime/context';

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
}

/**
 * Camera enumeration state used by the Properties panel + CameraModule.
 *
 *   - `enumerateDevices()` returns empty `label` strings — and on some
 *     platforms, an incomplete list — until camera permission has been
 *     granted at least once. We unlock labels with a one-shot
 *     `getUserMedia({ video: true })`, then stop the tracks immediately.
 *     The permission persists; we don't keep a stream open.
 *
 *   - In Electron the main process auto-grants `media` permission, so the
 *     one-shot prime is silent. We do it on mount so dynamically-attached
 *     devices — macOS Continuity Camera, USB hotplug, capture cards that
 *     advertise themselves on Wi-Fi — surface in the list as soon as they
 *     come online, instead of being hidden behind an unprimed permission
 *     state. In the browser we wait for the user to click "Grant access" so
 *     we don't trigger an unsolicited permission prompt.
 *
 *   - `devicechange` is the OS-level hot-plug signal. It's not 100 % reliable
 *     across browsers / Electron versions (Continuity Camera in particular
 *     can come online without firing it), so we expose a `refresh` callback
 *     for callers to wire to a manual button AND we re-enumerate every time
 *     the device <select> receives focus.
 *
 *   - We do NOT filter by label, name pattern, default/virtual flags, or
 *     dedup by groupId. Every `videoinput` device that the OS reports is
 *     shown. Heuristic filtering is what would hide a device like Continuity
 *     Camera that has a non-standard label / no label at all.
 */

let labelsPrimed = false;

async function primeLabelsOnce(): Promise<boolean> {
  if (labelsPrimed) return true;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    for (const t of s.getTracks()) t.stop();
    labelsPrimed = true;
    return true;
  } catch {
    return false;
  }
}

function runningInElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as Window & { pk?: unknown }).pk;
}

export interface UseCameraDevices {
  devices: CameraDeviceInfo[];
  /** True once a getUserMedia handshake has unlocked device labels. */
  labelsAvailable: boolean;
  /** Set when the user denied camera access. */
  permissionDenied: boolean;
  /** Manually trigger the permission handshake (e.g. on user click). */
  requestAccess: () => Promise<void>;
  /** Re-enumerate now. Idempotent; safe to call from a button or onFocus. */
  refresh: () => Promise<void>;
}

export function useCameraDevices(): UseCameraDevices {
  const [devices, setDevices] = useState<CameraDeviceInfo[]>([]);
  const [labelsAvailable, setLabelsAvailable] = useState(labelsPrimed);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      console.warn('[cameraDevices] enumerateDevices not available in this environment');
      return;
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      // Log the RAW enumerateDevices() output so a future regression of the
      // same shape (empty list, unlabeled devices, kind-mismatch, dropped
      // filter) is visible at a glance in the console.
      // eslint-disable-next-line no-console
      console.debug(
        '[cameraDevices] enumerateDevices →',
        list.map((d) => ({ kind: d.kind, label: d.label, deviceId: d.deviceId })),
      );
      const videoInputs = list
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({
          deviceId: d.deviceId,
          // Fall back to a stable id-derived name so a still-empty label
          // doesn't collapse a real device into a generic placeholder.
          label: d.label || (d.deviceId ? `Camera (${d.deviceId.slice(0, 6)}…)` : 'Camera'),
        }));
      setDevices(videoInputs);
      setLabelsAvailable(labelsPrimed);
    } catch (err) {
      console.warn('[cameraDevices] enumerateDevices threw', err);
    }
  }, []);

  const requestAccess = useCallback(async () => {
    const ok = await primeLabelsOnce();
    setPermissionDenied(!ok);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      // In Electron, `media` permission is auto-granted by the main process,
      // so the prime is silent. The benefit is that devices that only appear
      // after a permission grant (Continuity Camera among them) are in the
      // very first enumerateDevices() call, instead of waiting for a manual
      // refresh later.
      //
      // The offscreen ProgramOutput window doesn't surface a device picker
      // (CameraProperties / OverheadProperties only render in the editor),
      // so the prime there is wasted work AND it momentarily holds a
      // camera handle that could contend with the editor's open stream.
      // Skip it.
      if (runningInElectron() && !isOutputView()) await primeLabelsOnce();
      if (mounted) await refresh();
    })();

    const onChange = () => {
      if (mounted) refresh();
    };
    navigator.mediaDevices?.addEventListener('devicechange', onChange);

    return () => {
      mounted = false;
      navigator.mediaDevices?.removeEventListener('devicechange', onChange);
    };
  }, [refresh]);

  return { devices, labelsAvailable, permissionDenied, requestAccess, refresh };
}
