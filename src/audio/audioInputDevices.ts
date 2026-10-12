import { useCallback, useEffect, useState } from 'react';

/**
 * useAudioInputDevices
 *
 * Sibling of useAudioOutputDevices, scoped to `audioinput`. Used by the
 * Audio Input panel to populate the "Microphone" select. Same shape as the
 * camera / output hooks so the UI can be uniform.
 *
 * Notes:
 *   - `enumerateDevices()` returns `audioinput` entries with empty `label`
 *     strings until the page has held a microphone stream. We unlock labels
 *     with a one-shot `getUserMedia({ audio: true })`, then stop the track
 *     immediately — permission persists; we don't hold the stream.
 *   - We don't filter by group or default flags. Every audioinput the OS
 *     reports is shown.
 *   - `devicechange` fires on hot-plug (USB mic in/out, AirPods connect).
 *     We also re-enumerate on the dropdown's onFocus via `refresh`.
 */

export interface AudioInputDeviceInfo {
  deviceId: string;
  label: string;
}

export interface UseAudioInputDevices {
  devices: AudioInputDeviceInfo[];
  labelsAvailable: boolean;
  permissionDenied: boolean;
  refresh: () => Promise<void>;
  requestAccess: () => Promise<void>;
}

let labelsPrimed = false;

async function primeLabelsOnce(): Promise<boolean> {
  if (labelsPrimed) return true;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const t of s.getTracks()) t.stop();
    labelsPrimed = true;
    return true;
  } catch {
    return false;
  }
}

export function useAudioInputDevices(): UseAudioInputDevices {
  const [devices, setDevices] = useState<AudioInputDeviceInfo[]>([]);
  const [labelsAvailable, setLabelsAvailable] = useState(labelsPrimed);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label:
            d.label ||
            (d.deviceId
              ? d.deviceId === 'default'
                ? 'System default'
                : `Microphone (${d.deviceId.slice(0, 6)}…)`
              : 'Microphone'),
        }));
      setDevices(inputs);
      setLabelsAvailable(labelsPrimed);
    } catch (err) {
      console.warn('[audioInputDevices] enumerateDevices failed', err);
    }
  }, []);

  const requestAccess = useCallback(async () => {
    const ok = await primeLabelsOnce();
    setPermissionDenied(!ok);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let mounted = true;
    refresh().catch(() => { /* refresh swallows already */ });
    const onChange = () => {
      if (mounted) refresh();
    };
    navigator.mediaDevices?.addEventListener('devicechange', onChange);
    return () => {
      mounted = false;
      navigator.mediaDevices?.removeEventListener('devicechange', onChange);
    };
  }, [refresh]);

  return { devices, labelsAvailable, permissionDenied, refresh, requestAccess };
}
