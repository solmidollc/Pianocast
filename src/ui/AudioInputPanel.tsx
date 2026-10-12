import { AdvancedSettings } from './AdvancedSettings';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { audioInput } from '../audio/audioInput';
import { useAudioInputDevices } from '../audio/audioInputDevices';
import { recorder } from '../recording/recorder';

/**
 * AudioInputPanel — plain microphone capture.
 *
 *   - Enable toggle
 *   - Device picker
 *   - Level slider (gain into the recording + monitor)
 *   - Monitor on/off (local playback — headphones recommended)
 *   - Output meter (what the recording hears)
 */
export function AudioInputPanel() {
  const s = useSyncExternalStore(
    (cb) => audioInput.subscribe(cb),
    () => audioInput.getSnapshot(),
    () => audioInput.getSnapshot(),
  );
  const rec = useSyncExternalStore(
    (cb) => recorder.subscribe(cb),
    () => recorder.getSnapshot(),
    () => recorder.getSnapshot(),
  );
  const { devices, labelsAvailable, permissionDenied, requestAccess } = useAudioInputDevices();
  const [meter, setMeter] = useState<{ level: number; peak: number }>({ level: 0, peak: 0 });

  useEffect(() => {
    void audioInput.init();
  }, []);

  // Meter polling with hardware-style ballistics (fast attack, slow decay)
  // and a peak-hold marker.
  const ballRef = useRef({ level: 0, peak: 0, peakAt: 0 });
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const b = ballRef.current;
      const raw = audioInput.peekOutputLevel();
      if (raw > b.level) b.level = raw;
      else b.level = Math.max(0, b.level - 0.06);
      if (raw > b.peak) {
        b.peak = raw;
        b.peakAt = now;
      } else if (now - b.peakAt > 1200) {
        b.peak = Math.max(0, b.peak - 0.012);
      }
      setMeter({ level: b.level, peak: b.peak });
      timer = window.setTimeout(tick, 50);
    };
    timer = window.setTimeout(tick, 50);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  const status = s.status;

  return (
    <>
      {/* Master enable */}
      <div className="px-4 py-1.5 flex items-center justify-between text-xs">
        <span className="text-ink-400">Microphone</span>
        <input
          type="checkbox"
          checked={s.enabled}
          onChange={(e) => void audioInput.setEnabled(e.target.checked)}
        />
      </div>

      {/* Device picker */}
      <div className="px-4 py-1.5 flex items-center justify-between text-xs">
        <span className="text-ink-400">Device</span>
        <select
          value={s.deviceId ?? ''}
          onChange={async (e) => {
            const next = e.target.value || null;
            if (next && !s.enabled) await audioInput.setEnabled(true);
            await audioInput.setDevice(next);
          }}
          onFocus={() => void requestAccess()}
          className="bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 hover:border-white/20 focus:border-accent focus:outline-none transition-colors max-w-[170px] truncate disabled:opacity-50"
        >
          <option value="">
            {devices.length === 0 ? 'No microphones found' : 'Select device'}
          </option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {!labelsAvailable && !permissionDenied && s.enabled && (
        <div className="px-4 pt-0.5 pb-1.5 flex justify-end">
          <button
            type="button"
            onClick={() => void requestAccess()}
            className="text-[10px] text-accent-soft hover:text-ink-50"
          >
            Grant access to see device names
          </button>
        </div>
      )}
      {permissionDenied && (
        <div className="px-4 py-1 text-[11px] text-rose-400 leading-relaxed">
          Microphone access denied. Grant it in your system / browser settings.
        </div>
      )}
      {status.kind === 'error' && (
        <div className="px-4 py-1 text-[11px] text-rose-400 leading-relaxed">
          {status.message}
        </div>
      )}
      {status.kind === 'opening' && (
        <div className="px-4 py-1 text-[11px] text-ink-300 leading-relaxed">
          Opening microphone…
        </div>
      )}
      {status.kind === 'live' && (
        <div className="px-4 py-0.5 text-[10px] text-ink-500 leading-relaxed">
          Live · ~{s.latencyMs.toFixed(0)} ms out
        </div>
      )}

      {/* Level */}
      <Slider
        label="Level"
        min={0} max={2} step={0.01}
        value={s.outputLevel} defaultValue={0.9} decimals={2}
        onChange={(v) => audioInput.setOutputLevel(v)}
      />

      {/* Meter */}
      <div className="px-4 pt-1 pb-2">
        <div className="flex items-center justify-between text-[10px] text-ink-500 mb-0.5">
          <span>Output</span>
          <span className="tabular-nums">{Math.round(meter.peak * 100)}%</span>
        </div>
        <Meter level={meter.level} peak={meter.peak} />
      </div>

      <Divider />

      <AdvancedSettings label="Monitoring & sync">
      {/* Monitor */}
      <div className="px-4 py-1.5 flex items-center justify-between text-xs">
        <span className="text-ink-400">Monitor</span>
        <input
          type="checkbox"
          checked={s.monitorEnabled}
          onChange={(e) => audioInput.setMonitorEnabled(e.target.checked)}
        />
      </div>
      {s.monitorEnabled && (
        <div className="px-4 pb-2 text-[10px] text-amber-300 leading-relaxed">
          Use headphones — open speakers will pick up your mic and create a
          feedback loop.
        </div>
      )}

      <Divider />

      {/* AV sync compensation. Applied inside the recorder's audio mix,
          not the live monitor, so it only affects saved files. */}
      <Slider
        label="A/V sync"
        min={0} max={300} step={5}
        value={rec.audioDelayMs} defaultValue={80} decimals={0}
        unit=" ms"
        onChange={(v) => recorder.setAudioDelayMs(v)}
      />
      <div className="px-4 pb-2 text-[10px] text-ink-500">Recording audio delay.</div>
      </AdvancedSettings>
    </>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function Divider() {
  return <div className="mx-4 my-2 border-t border-white/4" />;
}

function Meter({ level, peak }: { level: number; peak: number }) {
  const clip = peak > 0.95;
  const warn = peak > 0.75;
  const barColour = clip ? '#ff5d6c' : warn ? '#f4b740' : '#7C5CFF';
  const peakColour = clip ? '#ff5d6c' : '#f8f8fc';
  return (
    <div
      className="h-2 rounded bg-white/8 overflow-hidden relative"
      role="meter"
      aria-valuenow={Math.round(level * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        style={{
          width: `${Math.min(100, level * 100)}%`,
          background: barColour,
          height: '100%',
          transition: 'width 50ms linear, background 150ms',
        }}
      />
      {peak > 0.01 && (
        <div
          style={{
            position: 'absolute',
            left: `calc(${Math.min(100, peak * 100)}% - 1px)`,
            top: 0,
            bottom: 0,
            width: 2,
            background: peakColour,
            opacity: 0.9,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

function Slider({
  label,
  min, max, step,
  value, defaultValue,
  unit, decimals,
  onChange,
}: {
  label: string;
  min: number; max: number; step: number;
  value: number; defaultValue: number;
  unit?: string; decimals?: number;
  onChange: (v: number) => void;
}) {
  const displayDecimals = decimals !== undefined ? decimals : step >= 1 ? 0 : 2;
  return (
    <div className="px-4 py-1">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-ink-400 w-24 truncate">{label}</span>
        <input
          type="range"
          min={min} max={max} step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
          className="flex-1 accent-accent"
          title="Double-click to reset"
        />
        <span className="text-ink-300 tabular-nums w-12 text-right">
          {value.toFixed(displayDecimals)}{unit ?? ''}
        </span>
      </div>
    </div>
  );
}
