import { AdvancedSettings } from './AdvancedSettings';
import { useApp, type ModuleInstance } from '../state/store';
import { useCameraDevices } from '../modules/cameraDevices';
import { CameraAdjustmentsPanel } from './CameraAdjustmentsPanel';
import { defaultAdjustments, type CameraAdjustments } from '../modules/cameraAdjustments';

interface Props {
  module: ModuleInstance;
}

/**
 * Camera-source properties: a single labelled dropdown that lists every video
 * input the OS reports, plus a mirror toggle. The dropdown re-populates
 * automatically when a device is plugged or unplugged (devicechange event in
 * useCameraDevices).
 *
 * Before camera permission is granted, OS-supplied labels are empty strings.
 * We surface a "Grant access" button in that case rather than showing a list
 * of unidentified IDs.
 */
export function CameraProperties({ module }: Props) {
  const updateModule = useApp((s) => s.updateModule);
  const opts = module.options as {
    deviceId: string | null;
    mirror?: boolean;
    cameraCrop?: { top: number; right: number; bottom: number; left: number } | null;
    adjustments?: CameraAdjustments;
  };
  const { devices, labelsAvailable, permissionDenied, requestAccess } = useCameraDevices();

  const setDevice = (id: string | null) =>
    updateModule(module.id, { options: { ...opts, deviceId: id } });
  const setMirror = (m: boolean) =>
    updateModule(module.id, { options: { ...opts, mirror: m } });
  const setAdjustments = (adjustments: CameraAdjustments) =>
    updateModule(module.id, { options: { ...opts, adjustments } });

  return (
    <>
      <div className="px-4 py-1.5 flex items-center justify-between text-xs">
        <span className="text-ink-400">Device</span>
        <select
          value={opts.deviceId ?? ''}
          onChange={(e) => setDevice(e.target.value || null)}
          // Focus on the dropdown counts as a user gesture, so calling
          // requestAccess() here triggers the browser's camera permission
          // prompt at exactly the moment the user is asking for a device
          // list. Once permission is granted the enumerate inside
          // requestAccess() repopulates with proper labels and deviceIds.
          // In Electron the auto-prime on mount has already populated; this
          // is just a refresh.
          onFocus={() => requestAccess()}
          className="bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 hover:border-white/20 focus:border-accent focus:outline-none transition-colors max-w-[170px] truncate"
        >
          <option value="">
            {devices.length === 0 ? 'No cameras found' : 'Select device'}
          </option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div className="px-4 pb-1.5 flex justify-end">
        <button
          type="button"
          onClick={() => requestAccess()}
          className="text-[10px] text-accent-soft hover:text-ink-50"
        >
          Refresh devices
        </button>
      </div>

      <div className="px-4 py-1.5 flex items-center justify-between text-xs">
        <span className="text-ink-400">Mirror</span>
        <input
          type="checkbox"
          checked={!!opts.mirror}
          onChange={(e) => setMirror(e.target.checked)}
        />
      </div>

      {!labelsAvailable && !permissionDenied && (
        <div className="px-4 pt-1 pb-2">
          <button
            onClick={() => requestAccess()}
            className="text-[11px] text-accent-soft hover:text-ink-50"
          >
            Grant camera access to see device names
          </button>
        </div>
      )}

      {permissionDenied && (
        <div className="px-4 pt-1 pb-2 text-[11px] text-ink-400 leading-relaxed">
          Camera access denied. Grant it in your system / browser settings to
          enumerate devices.
        </div>
      )}

      <div className="px-4 py-3 border-t border-white/5">
        <label className="flex justify-between items-center text-xs text-ink-400">
          Crop camera
          <input type="checkbox" checked={!!opts.cameraCrop}
            onChange={(e) => updateModule(module.id, { options: { ...opts,
              cameraCrop: e.target.checked ? { top: 0, right: 0, bottom: 0, left: 0 } : null } })} />
        </label>
        {opts.cameraCrop && (
          <div className="mt-2 space-y-2">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <label key={side} className="flex items-center justify-between text-xs text-ink-400 capitalize">
                {side}
                <input aria-label={`Crop ${side} percent`} type="number" min={0} max={45}
                  value={Math.round(opts.cameraCrop![side] * 100)}
                  onChange={(e) => {
                    const value = Math.max(0, Math.min(45, Number(e.target.value)));
                    if (Number.isFinite(value)) updateModule(module.id, { options: { ...opts,
                      cameraCrop: { ...opts.cameraCrop!, [side]: value / 100 } } });
                  }}
                  className="w-16 bg-ink-800 text-ink-100 rounded px-2 py-1" />
              </label>
            ))}
            <div className="text-[10px] text-ink-500">Trim each edge (%)</div>
            <button type="button" className="text-xs text-accent-soft"
              onClick={() => updateModule(module.id, { options: { ...opts,
                cameraCrop: { top: 0, right: 0, bottom: 0, left: 0 } } })}>Reset crop</button>
          </div>
        )}
      </div>

      <AdvancedSettings label="Adjustments & effects">
      <CameraAdjustmentsPanel
        moduleId={module.id}
        adjustments={opts.adjustments ?? defaultAdjustments()}
        onChange={setAdjustments}
      />
      </AdvancedSettings>
    </>
  );
}
