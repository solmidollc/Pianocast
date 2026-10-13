import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EFFECT_PRESETS,
  applyPreset,
  isDefaultSoftware,
  type CameraAdjustments,
} from '../modules/cameraAdjustments';
import { subscribeCameraTrack } from '../modules/cameraTrackRegistry';

interface Props {
  /**
   * Module-scoped identifier — the same id the camera component registers
   * its MediaStreamTrack under, and the SVG filter id used by the render
   * pipeline. Required so each camera's controls are isolated.
   */
  moduleId: string;
  adjustments: CameraAdjustments;
  onChange: (adj: CameraAdjustments) => void;
}

/**
 * Per-camera adjustments panel — three collapsible groups (Camera settings,
 * Image adjustments, Effects). Shared by CameraProperties and
 * OverheadProperties so a single source-of-truth UI drives both modules.
 *
 *   1. Camera settings   — hardware controls; gated on track.getCapabilities().
 *   2. Image adjustments — software (CSS+SVG filter chain), always available.
 *   3. Effects           — preset one-tap looks that just set the sliders.
 *
 * Live preview is automatic — each change calls `onChange`, the store
 * updates, ModuleContent re-reads, and the render path picks the new value
 * up the same frame.
 */
export function CameraAdjustmentsPanel({ moduleId, adjustments, onChange }: Props) {
  return (
    <>
      <CameraSettingsSection
        moduleId={moduleId}
        adjustments={adjustments}
        onChange={onChange}
      />
      <ImageAdjustmentsSection adjustments={adjustments} onChange={onChange} />
      <EffectsSection adjustments={adjustments} onChange={onChange} />
    </>
  );
}

// ===========================================================================
// Section 1 — Camera (hardware, capability-gated)
// ===========================================================================

interface CapabilityState {
  /** Reported as supported by track.getCapabilities(). */
  zoom: { min: number; max: number; step: number } | null;
  exposureCompensation: { min: number; max: number; step: number } | null;
  colorTemperature: { min: number; max: number; step: number } | null;
  focusDistance: { min: number; max: number; step: number } | null;
  hdr: boolean;
}

function CameraSettingsSection({
  moduleId,
  adjustments,
  onChange,
}: {
  moduleId: string;
  adjustments: CameraAdjustments;
  onChange: (adj: CameraAdjustments) => void;
}) {
  const [open, setOpen] = useState(true);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [caps, setCaps] = useState<CapabilityState>({
    zoom: null,
    exposureCompensation: null,
    colorTemperature: null,
    focusDistance: null,
    hdr: false,
  });

  // Subscribe to whichever track the camera component has registered for
  // this module id. The callback fires once with the current value (which
  // may be null) and again on every change, so we don't need a polling loop.
  useEffect(() => subscribeCameraTrack(moduleId, setTrack), [moduleId]);

  useEffect(() => {
    if (!track) {
      setCaps({
        zoom: null,
        exposureCompensation: null,
        colorTemperature: null,
        focusDistance: null,
        hdr: false,
      });
      return;
    }
    // getCapabilities() is synchronous but only returns useful data after
    // the device has been "live" for one tick — chase it with a microtask
    // so first-mount races resolve cleanly.
    queueMicrotask(() => {
      try {
        // The experimental MediaTrackCapabilities keys (zoom, exposure-
        // Compensation, colorTemperature, focusDistance, hdr) aren't in the
        // TS DOM lib, so we cast through `unknown` and pull each field out
        // by name.
        type CapRange = { min: number; max: number; step?: number };
        const c = track.getCapabilities
          ? (track.getCapabilities() as unknown as Record<string, unknown>)
          : undefined;
        if (!c) return;
        const asRange = (v: unknown): CapRange | undefined =>
          v && typeof v === 'object' && 'min' in v && 'max' in v
            ? (v as CapRange)
            : undefined;
        const range = (r: CapRange | undefined) =>
          r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min
            ? { min: r.min, max: r.max, step: r.step ?? (r.max - r.min) / 100 }
            : null;
        setCaps({
          zoom: range(asRange(c['zoom'])),
          exposureCompensation: range(asRange(c['exposureCompensation'])),
          colorTemperature: range(asRange(c['colorTemperature'])),
          focusDistance: range(asRange(c['focusDistance'])),
          // HDR support is non-uniform across vendors — be permissive.
          hdr: c['hdr'] !== undefined,
        });
      } catch {
        /* Capabilities aren't required; degrade silently. */
      }
    });
  }, [track]);

  const applyHardware = useCallback(
    async (key: string, value: number | boolean) => {
      if (!track) return;
      try {
        // The experimental constrainable properties (zoom, exposureCompensation,
        // colorTemperature, focusDistance, hdr) aren't in the TS DOM lib but
        // Chromium / Safari accept them as advanced constraints. Cast through
        // a Record so we don't have to maintain a parallel type declaration.
        await track.applyConstraints({
          advanced: [{ [key]: value } as unknown as MediaTrackConstraintSet],
        });
      } catch {
        // Some devices reject mid-range values briefly during auto modes.
        // Adjustments are user-initiated; a single failure is best ignored
        // rather than surfaced as a panel error.
      }
    },
    [track],
  );

  // Zoom: hardware where available, digital fallback otherwise. Either way
  // the slider exists — value drives `adjustments.zoom`. The render path
  // reads the same field and decides which to use.
  const hardwareZoom = !!caps.zoom;
  // Digital zoom default range: 1..3×.
  const zoomRange = caps.zoom ?? { min: 1, max: 3, step: 0.01 };
  const zoomLabel = 'Zoom';

  const setZoom = (v: number) => {
    onChange({ ...adjustments, zoom: v });
    if (hardwareZoom) applyHardware('zoom', v);
  };

  const setExposure = (v: number) => {
    onChange({ ...adjustments, exposureCompensation: v });
    applyHardware('exposureCompensation', v);
  };

  const setColorTemperature = (v: number) => {
    onChange({ ...adjustments, colorTemperature: v });
    applyHardware('colorTemperature', v);
  };

  const setFocusDistance = (v: number) => {
    onChange({ ...adjustments, focusDistance: v });
    applyHardware('focusDistance', v);
  };

  const setHdr = (v: boolean) => {
    onChange({ ...adjustments, hdr: v });
    applyHardware('hdr', v);
  };

  // Hardware reset — clears whichever hardware constraints we've applied and
  // returns the device to "default / auto". applyConstraints({}) on a track
  // clears advanced constraints applied through this MediaStream.
  const resetHardware = async () => {
    onChange({
      ...adjustments,
      zoom: null,
      exposureCompensation: null,
      colorTemperature: null,
      focusDistance: null,
      hdr: null,
    });
    if (track) {
      try {
        await track.applyConstraints({});
      } catch {
        /* same rationale as above */
      }
    }
  };

  // If no track + no capabilities, show only the digital zoom (software-only)
  // so the section isn't empty when the camera is still opening.
  return (
    <Section title="Camera settings" open={open} onToggle={() => setOpen((v) => !v)}>
      <Slider
        label={zoomLabel}
        min={zoomRange.min}
        max={zoomRange.max}
        step={zoomRange.step}
        value={adjustments.zoom ?? (hardwareZoom ? zoomRange.min : 1)}
        unit={hardwareZoom ? '' : '×'}
        decimals={2}
        defaultValue={hardwareZoom ? zoomRange.min : 1}
        onChange={setZoom}
      />
      {caps.exposureCompensation && (
        <Slider
          label="Exposure"
          min={caps.exposureCompensation.min}
          max={caps.exposureCompensation.max}
          step={caps.exposureCompensation.step}
          value={adjustments.exposureCompensation ?? 0}
          decimals={2}
          defaultValue={0}
          onChange={setExposure}
        />
      )}
      {caps.colorTemperature && (
        <Slider
          label="White balance"
          min={caps.colorTemperature.min}
          max={caps.colorTemperature.max}
          step={Math.max(caps.colorTemperature.step, 50)}
          value={
            adjustments.colorTemperature ??
            (caps.colorTemperature.min + caps.colorTemperature.max) / 2
          }
          unit=" K"
          decimals={0}
          defaultValue={(caps.colorTemperature.min + caps.colorTemperature.max) / 2}
          onChange={setColorTemperature}
        />
      )}
      {caps.focusDistance && (
        <Slider
          label="Focus"
          min={caps.focusDistance.min}
          max={caps.focusDistance.max}
          step={caps.focusDistance.step}
          value={adjustments.focusDistance ?? caps.focusDistance.min}
          decimals={2}
          defaultValue={caps.focusDistance.min}
          onChange={setFocusDistance}
        />
      )}
      {caps.hdr && (
        <Row label="HDR">
          <input
            type="checkbox"
            checked={!!adjustments.hdr}
            onChange={(e) => setHdr(e.target.checked)}
          />
        </Row>
      )}
      <div className="px-4 pb-1 flex justify-end">
        <button
          onClick={resetHardware}
          className="text-[10px] text-accent-soft hover:text-ink-50"
        >
          Reset camera
        </button>
      </div>
    </Section>
  );
}

// ===========================================================================
// Section 2 — Image adjustments (software)
// ===========================================================================

function ImageAdjustmentsSection({
  adjustments,
  onChange,
}: {
  adjustments: CameraAdjustments;
  onChange: (adj: CameraAdjustments) => void;
}) {
  const [open, setOpen] = useState(true);

  // When the user moves any software slider, drop the preset label — we no
  // longer purely match the preset, even if the underlying numbers are close.
  const set = (patch: Partial<CameraAdjustments>) =>
    onChange({ ...adjustments, ...patch, presetName: null });

  const reset = () =>
    onChange({
      ...adjustments,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      whites: 0,
      blacks: 0,
      highlights: 0,
      shadows: 0,
      presetName: null,
    });

  return (
    <Section title="Adjustments" open={open} onToggle={() => setOpen((v) => !v)}>
      <Slider
        label="Brightness" min={-100} max={100} step={1}
        value={adjustments.brightness} defaultValue={0}
        onChange={(v) => set({ brightness: v })}
      />
      <Slider
        label="Contrast" min={-100} max={100} step={1}
        value={adjustments.contrast} defaultValue={0}
        onChange={(v) => set({ contrast: v })}
      />
      <Slider
        label="Saturation" min={-100} max={100} step={1}
        value={adjustments.saturation} defaultValue={0}
        onChange={(v) => set({ saturation: v })}
      />
      <Slider
        label="Temperature" min={-100} max={100} step={1}
        value={adjustments.temperature} defaultValue={0}
        onChange={(v) => set({ temperature: v })}
      />
      <Slider
        label="Tint" min={-100} max={100} step={1}
        value={adjustments.tint} defaultValue={0}
        onChange={(v) => set({ tint: v })}
      />
      <Divider />
      <Slider
        label="Whites" min={-100} max={100} step={1}
        value={adjustments.whites} defaultValue={0}
        onChange={(v) => set({ whites: v })}
      />
      <Slider
        label="Blacks" min={-100} max={100} step={1}
        value={adjustments.blacks} defaultValue={0}
        onChange={(v) => set({ blacks: v })}
      />
      <Slider
        label="Highlights" min={-100} max={100} step={1}
        value={adjustments.highlights} defaultValue={0}
        onChange={(v) => set({ highlights: v })}
      />
      <Slider
        label="Shadows" min={-100} max={100} step={1}
        value={adjustments.shadows} defaultValue={0}
        onChange={(v) => set({ shadows: v })}
      />
      <div className="px-4 pb-1 flex justify-end">
        <button
          disabled={isDefaultSoftware(adjustments)}
          onClick={reset}
          className="text-[10px] text-accent-soft hover:text-ink-50 disabled:opacity-30 disabled:cursor-default"
        >
          Reset adjustments
        </button>
      </div>
    </Section>
  );
}

// ===========================================================================
// Section 3 — Effects (presets)
// ===========================================================================

function EffectsSection({
  adjustments,
  onChange,
}: {
  adjustments: CameraAdjustments;
  onChange: (adj: CameraAdjustments) => void;
}) {
  const [open, setOpen] = useState(true);
  const active = adjustments.presetName;
  return (
    <Section title="Effects" open={open} onToggle={() => setOpen((v) => !v)}>
      <div className="px-4 pb-2 flex flex-wrap gap-1.5">
        <PresetChip
          name="None"
          active={active === null}
          onClick={() => onChange(applyPreset(adjustments, null))}
        />
        {EFFECT_PRESETS.map((p) => (
          <PresetChip
            key={p.name}
            name={p.name}
            active={active === p.name}
            onClick={() => onChange(applyPreset(adjustments, p.name))}
          />
        ))}
      </div>

    </Section>
  );
}

function PresetChip({
  name,
  active,
  onClick,
}: {
  name: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'text-[11px] px-2.5 py-1 rounded-full border transition-colors ' +
        (active
          ? 'border-accent bg-accent/20 text-ink-50'
          : 'border-white/10 bg-ink-800 text-ink-200 hover:border-white/20')
      }
    >
      {name}
    </button>
  );
}

// ===========================================================================
// Layout primitives
// ===========================================================================

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-white/4 pt-3 mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 mb-2 flex items-center justify-between"
      >
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">
          {title}
        </span>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{ transform: open ? 'rotate(90deg)' : undefined }}><path d="m4 3 3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open && <div className="space-y-0.5 pb-1">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-1.5 flex items-center justify-between text-xs">
      <span className="text-ink-400">{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="mx-4 my-2 border-t border-white/4" />;
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  defaultValue,
  unit,
  decimals,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  unit?: string;
  decimals?: number;
  onChange: (v: number) => void;
}) {
  // Decimals: default to 0 for integer-step sliders, otherwise 2.
  const displayDecimals = useMemo(
    () => (decimals !== undefined ? decimals : step >= 1 ? 0 : 2),
    [decimals, step],
  );
  return (
    <div className="px-4 py-1 flex items-center gap-3 text-xs">
      <span className="text-ink-400 w-24 shrink-0 leading-snug">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
        className="flex-1 min-w-0 accent-accent"
        title="Double-click to reset"
      />
      <span className="text-ink-300 tabular-nums w-12 text-right">
        {value.toFixed(displayDecimals)}{unit ?? ''}
      </span>
    </div>
  );
}

