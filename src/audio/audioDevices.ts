import { useCallback, useEffect, useState } from 'react';

/**
 * useAudioOutputDevices
 *
 * Sibling of useCameraDevices, scoped to `audiooutput`. Used by the Audio
 * panel to populate the "Output device" select. Returns the same shape
 * regardless of permission state so the UI doesn't need to special-case it.
 *
 * Notes:
 *   - `enumerateDevices()` returns audiooutput entries with EMPTY labels
 *     until the page has held a media stream (either microphone or
 *     camera). In Piano Keys the user has typically already granted
 *     camera access, so labels are usually populated by the time the
 *     audio panel opens; if not, we surface a "Grant access to see
 *     device names" affordance.
 *   - We don't filter by groupId — every audiooutput the OS reports
 *     (including virtual sinks like BlackHole, Loopback Audio, Voicemod)
 *     is shown. That's the whole point of letting the user pick.
 *   - HMR / hot-plug: we listen for `devicechange` and re-enumerate, AND
 *     expose a manual refresh.
 */

export interface AudioOutputDeviceInfo {
  deviceId: string;
  label: string;
}

export interface UseAudioOutputDevices {
  devices: AudioOutputDeviceInfo[];
  /** True once any getUserMedia handshake has unlocked device labels. */
  labelsAvailable: boolean;
  refresh: () => Promise<void>;
  /** Force the labels-unlock by requesting microphone access for a tick. */
  requestLabels: () => Promise<void>;
}

let labelsPrimed = false;

async function primeLabelsOnce(): Promise<boolean> {
  if (labelsPrimed) return true;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    // A microphone handshake also unlocks audiooutput labels in Chromium.
    // We immediately stop the track — we don't need to keep the input open.
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const t of s.getTracks()) t.stop();
    labelsPrimed = true;
    return true;
  } catch {
    return false;
  }
}

export function useAudioOutputDevices(): UseAudioOutputDevices {
  const [devices, setDevices] = useState<AudioOutputDeviceInfo[]>([]);
  const [labelsAvailable, setLabelsAvailable] = useState(labelsPrimed);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const outputs = list
        .filter((d) => d.kind === 'audiooutput')
        .map((d) => ({
          deviceId: d.deviceId,
          label:
            d.label ||
            (d.deviceId
              ? d.deviceId === 'default'
                ? 'System default'
                : `Audio output (${d.deviceId.slice(0, 6)}…)`
              : 'Audio output'),
        }));
      setDevices(outputs);
      setLabelsAvailable(labelsPrimed);
    } catch (err) {
      console.warn('[audioDevices] enumerateDevices failed', err);
    }
  }, []);

  const requestLabels = useCallback(async () => {
    await primeLabelsOnce();
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

  return { devices, labelsAvailable, refresh, requestLabels };
}
