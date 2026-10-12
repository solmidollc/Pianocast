import { AdvancedSettings } from './AdvancedSettings';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  INSTRUMENTS,
  pianoEngine,
  type InstrumentId,
  type ReverbType,
} from '../audio/pianoEngine';
import { useAudioOutputDevices } from '../audio/audioDevices';
import { AboutModal } from './AboutModal';

/**
 * AudioPanel — Right-rail section for instrument selection, tone shaping,
 * routing, and credits.
 *
 * Grouped layout (subtle dividers, not loud sub-headers):
 *   - Instrument picker         → top, prominent.
 *   - Status + master enable    → reads "Loading… / Ready · Nms".
 *   - Volume + sensitivity      → core feel controls.
 *   - Reverb (type / size / amount) → tonal space.
 *   - Tone tilt                 → mellow ↔ bright.
 *   - Tuning + stereo width     → finer touch.
 *   - Output device             → routing.
 *   - Note about capture, then About / Credits.
 *
 * Live preview throughout; nothing blocks the UI thread. All controls
 * mirror to the singleton pianoEngine which owns the AudioContext.
 */
export function AudioPanel() {
  const s = useSyncExternalStore(
    (cb) => pianoEngine.subscribe(cb),
    () => pianoEngine.getSnapshot(),
    () => pianoEngine.getSnapshot(),
  );
  const { devices, labelsAvailable, requestLabels } = useAudioOutputDevices();
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    void pianoEngine.init();
  }, []);

  const def = useMemo(
    () => INSTRUMENTS.find((i) => i.id === s.instrumentId) ?? INSTRUMENTS[0],
    [s.instrumentId],
  );

  const status = s.status;

  return (
    <>
      <AdvancedSettings label="Software instrument (advanced)">
      {/* Instrument picker */}
      <div className="px-4 py-1.5 flex items-center justify-between text-xs">
        <span className="text-ink-400">Instrument</span>
        <select
          value={s.instrumentId}
          onChange={(e) => pianoEngine.loadInstrument(e.target.value as InstrumentId)}
          className="bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 hover:border-white/20 focus:border-accent focus:outline-none transition-colors max-w-[170px] truncate"
          title={def.hint}
        >
          {INSTRUMENTS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
              {!i.bundled ? ' (download)' : ''}
            </option>
          ))}
        </select>
      </div>


      {/* Master enable */}
      <div className="px-4 py-1.5 flex items-center justify-between text-xs border-t border-white/4 pt-2">
        <span className="text-ink-400">Enable instrument sound</span>
        <input
          type="checkbox"
          aria-label="Enable instrument sound"
          checked={s.enabled}
          onChange={(e) => pianoEngine.setEnabled(e.target.checked)}
        />
      </div>

      {/* Status line */}
      {status.kind === 'loading' && (
        <div className="px-4 py-1 text-[11px] text-ink-300 leading-relaxed">
          Loading samples…
          <div className="mt-1 h-[2px] bg-white/8 overflow-hidden rounded">
            <div
              className="h-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.round(status.progress * 100)}%` }}
            />
          </div>
        </div>
      )}
      {status.kind === 'error' && (
        <div className="px-4 py-1 text-[11px] text-rose-400 leading-relaxed">
          Sample load failed: {status.message}
        </div>
      )}
      {status.kind === 'ready' && (
        <div className="px-4 py-0.5 text-[10px] text-ink-500 leading-relaxed">
          Ready · ~{s.latencyMs.toFixed(0)} ms out
          {!s.contextRunning && ' · click anywhere to enable audio'}
          {!def.honorsSustain && ' · pedal ignored (instrument has no damper)'}
        </div>
      )}

      {/* Volume + sensitivity */}
      <Slider
        label="Volume"
        min={0} max={1} step={0.01}
        value={s.volume} defaultValue={0.8} decimals={2}
        onChange={(v) => pianoEngine.setVolume(v)}
      />
      
      <Slider
        label="Sensitivity"
        min={0.5} max={2} step={0.05}
        value={s.velocityCurve} defaultValue={1} decimals={2}
        onChange={(v) => pianoEngine.setVelocityCurve(v)}
        invert
        disabled={!def.velocitySensitive}
        disabledHint="No velocity response on this instrument."
      />
      {/* Damper-release feel. Scales the per-instrument register-aware
          release curve so the player can dial in staccato across the whole
          keyboard by ear. Catalogue defaults already shape the bass↔treble
          curve; this is the global feel knob on top. */}
      <Slider
        label="Release"
        min={0.3} max={2.5} step={0.05}
        value={s.releaseFeel} defaultValue={1.0} decimals={2}
        onChange={(v) => pianoEngine.setReleaseFeel(v)}
        leftHint="snappy"
        rightHint="lingering"
        // Only applies when the catalogue says this instrument has a
        // damper-release model — the harpsichord and pipe organ have
        // their own built-in release behaviour, and we don't override it.
        disabled={def.baseReleaseSec === undefined}
        disabledHint="This instrument uses its own release; no damper to tune."
      />

      {/* Reverb group */}
      <Divider />
      <div className="px-4 py-1.5 flex items-center justify-between text-xs">
        <span className="text-ink-400">Reverb</span>
        <select
          value={s.reverbType}
          onChange={(e) => pianoEngine.setReverbType(e.target.value as ReverbType)}
          className="bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 hover:border-white/20 focus:border-accent focus:outline-none transition-colors"
        >
          <option value="room">Room</option>
          <option value="hall">Hall</option>
          <option value="plate">Plate</option>
        </select>
      </div>
      <Slider
        label="Room size"
        min={0.4} max={1.6} step={0.05}
        value={s.reverbSize} defaultValue={1.0} decimals={2}
        onChange={(v) => pianoEngine.setReverbSize(v)}
      />
      <Slider
        label="Amount"
        min={0} max={1} step={0.01}
        value={s.reverbAmount} defaultValue={0.18} decimals={2}
        onChange={(v) => pianoEngine.setReverbAmount(v)}
      />

      {/* Tone tilt */}
      <Divider />
      <Slider
        label="Tone"
        min={-1} max={1} step={0.05}
        value={s.toneTilt} defaultValue={0} decimals={2}
        onChange={(v) => pianoEngine.setToneTilt(v)}
        leftHint="mellow"
        rightHint="bright"
      />

      {/* Tuning + width */}
      <Slider
        label="Tuning A"
        min={415} max={466} step={0.5}
        value={s.tuningHz} defaultValue={440} unit=" Hz" decimals={1}
        onChange={(v) => pianoEngine.setTuningHz(v)}
      />
      <Slider
        label="Stereo width"
        min={0} max={2} step={0.05}
        value={s.stereoWidth} defaultValue={1.0} decimals={2}
        onChange={(v) => pianoEngine.setStereoWidth(v)}
      />

      {/* Output device */}
      <Divider />
      <div className="px-4 py-1.5 flex items-center justify-between text-xs">
        <span className="text-ink-400">Output</span>
        <select
          value={s.sinkId ?? ''}
          onChange={(e) => pianoEngine.setSinkId(e.target.value || null)}
          className="bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 hover:border-white/20 focus:border-accent focus:outline-none transition-colors max-w-[170px] truncate"
        >
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      {!labelsAvailable && (
        <div className="px-4 pt-0.5 pb-1.5 flex justify-end">
          <button
            type="button"
            onClick={() => requestLabels()}
            className="text-[10px] text-accent-soft hover:text-ink-50"
          >
            Grant access to see device names
          </button>
        </div>
      )}

      {/* Capture / virtual-cam note */}


      {/* Credit link */}
      <div className="px-4 pb-2 flex justify-end">
        <button
          onClick={() => setAboutOpen(true)}
          className="text-[10px] text-accent-soft hover:text-ink-50"
        >
          About / Credits
        </button>
      </div>

      </AdvancedSettings>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function Divider() {
  return <div className="mx-4 my-2 border-t border-white/4" />;
}

function Slider({
  label,
  min, max, step,
  value, defaultValue,
  unit, decimals, invert,
  leftHint, rightHint,
  disabled, disabledHint,
  onChange,
}: {
  label: string;
  min: number; max: number; step: number;
  value: number; defaultValue: number;
  unit?: string; decimals?: number;
  invert?: boolean;
  leftHint?: string; rightHint?: string;
  disabled?: boolean; disabledHint?: string;
  onChange: (v: number) => void;
}) {
  const displayDecimals = decimals !== undefined ? decimals : step >= 1 ? 0 : 2;
  const visualValue = invert ? max - (value - min) : value;
  const handle = (raw: number) => onChange(invert ? max - (raw - min) : raw);
  return (
    <div className={`px-4 py-1 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-ink-400 w-24 truncate">{label}</span>
        <input
          type="range"
          min={min} max={max} step={step}
          value={visualValue}
          disabled={disabled}
          onChange={(e) => handle(parseFloat(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
          className="flex-1 accent-accent"
          title={disabled ? disabledHint : 'Double-click to reset'}
        />
        <span className="text-ink-300 tabular-nums w-12 text-right">
          {value.toFixed(displayDecimals)}{unit ?? ''}
        </span>
      </div>
      {(leftHint || rightHint) && !disabled && (
        <div className="ml-[6.25rem] mr-[3rem] mt-0.5 flex justify-between text-[9px] text-ink-500">
          <span>{leftHint}</span>
          <span>{rightHint}</span>
        </div>
      )}
    </div>
  );
}
