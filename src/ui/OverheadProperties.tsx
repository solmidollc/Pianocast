import { useState } from 'react';
import { useApp, type ModuleInstance } from '../state/store';
import { useCameraDevices } from '../modules/cameraDevices';
import type { CropRect } from '../modules/perspective';
import { CropModal } from './CropModal';
import { CameraAdjustmentsPanel } from './CameraAdjustmentsPanel';
import { defaultAdjustments, type CameraAdjustments } from '../modules/cameraAdjustments';
import { getCameraTrack } from '../modules/cameraTrackRegistry';

interface Props {
  module: ModuleInstance;
}

type OverheadOptions = {
  source: 'local' | 'companion';
  deviceId: string | null;
  keystone: [number, number][];
  editKeystone: boolean;
  mirror: boolean;
  crop: CropRect | null;
  /**
   * Monotonic counter the OverheadCamera watches. Incrementing it asks the
   * camera to re-run auto-crop on the current frame. Pre-filling the modal
   * is automatic — auto-crop writes back into `crop`, which the modal reads
   * as its `initial` value.
   */
  autoCropToken?: number;
  /** Per-source video adjustments (CSS+SVG filter chain + hardware controls). */
  adjustments?: CameraAdjustments;
};

/**
 * OverheadCamera properties panel.
 *
 * Three concerns:
 *   - Source: local capture device or phone companion
 *   - Crop to keyboard: opens a dedicated popup (CropModal). The scene stays
 *     uncluttered; alignment lives in the popup.
 *   - Manual fine-tune: 4-corner keystone, mirror, reset.
 */
export function OverheadProperties({ module }: Props) {
  const updateModule = useApp((s) => s.updateModule);
  const opts = module.options as OverheadOptions;
  const { devices, requestAccess: requestCameraAccess } = useCameraDevices();
  const [cropOpen, setCropOpen] = useState(false);

  const patch = (next: Partial<OverheadOptions>) =>
    updateModule(module.id, { options: { ...opts, ...next } });

  const openCrop = () => {
    // Toggling keystone off keeps the OverheadCamera free of competing
    // overlays while the modal is being authored.
    if (opts.editKeystone) patch({ editKeystone: false });
    setCropOpen(true);
  };
  /**
   * Apply a new crop AND size the module height to display the captured
   * region at its TRUE proportions. The shader (OverheadCamera.tsx) samples
   * at natural aspect and paints black past the captured bottom, so:
   *
   *   naturalHeightPx = moduleWidthPx × (vSpan × videoH) / (hSpan × videoW)
   *                   = moduleWidthPx × (vSpan / hSpan) / srcAspect
   *
   * Setting height = naturalHeightPx means the user immediately sees the
   * full crop with no clipping and no empty space — exactly the "no
   * shrinking to fit a small space" behaviour the spec calls for. The
   * lock-group reflow then bumps the on-screen Keyboard above to make
   * room.
   *
   * Source aspect is read from the live track if we have one; otherwise
   * we assume 16:9 (the overwhelming majority of webcams and phone
   * cameras). The keyboard's image lands close enough either way, and
   * the user can always nudge with the n-handle afterward.
   */
  const applyCrop = (crop: CropRect) => {
    const hSpan = Math.max(1e-6, crop.rightX - crop.leftX);
    const vSpan = Math.max(1e-6, (crop.bottomY - crop.topY) + (crop.wristArea ?? 0));
    const settings = getCameraTrack(module.id)?.getSettings?.();
    const srcAspect =
      settings && settings.width && settings.height
        ? settings.width / settings.height
        : 16 / 9;
    const naturalHeight = Math.round((module.width * vSpan) / (hSpan * srcAspect));
    const newHeight = Math.max(60, naturalHeight) + (module.kind === 'overheadVisualizer' ? Number(module.options.keyboardHeight ?? 220) : 0);
    updateModule(module.id, {
      options: { ...opts, crop },
      height: newHeight,
    });
  };
  const clearCrop = () => patch({ crop: null });
  const rerunAutoCrop = () => patch({ autoCropToken: (opts.autoCropToken ?? 0) + 1 });
  const setAdjustments = (adjustments: CameraAdjustments) => patch({ adjustments });

  return (
    <>
      {/* Source */}
      <div className="px-4 py-1.5 flex items-center justify-between text-xs">
        <span className="text-ink-400">Source</span>
        <select
          value={opts.source ?? 'local'}
          onChange={(e) => patch({ source: e.target.value as 'local' | 'companion' })}
          className="bg-ink-800 text-ink-100 text-xs px-2 py-1 rounded border border-white/8 hover:border-white/20 focus:border-accent focus:outline-none transition-colors"
        >
          <option value="local">Local camera</option>
          <option value="companion">Phone companion</option>
        </select>
      </div>

      {opts.source !== 'companion' && (
        <>
          <div className="px-4 py-1.5 flex items-center justify-between text-xs">
            <span className="text-ink-400">Device</span>
            <select
              value={opts.deviceId ?? ''}
              onChange={(e) => patch({ deviceId: e.target.value || null })}
              onFocus={() => requestCameraAccess()}
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
              onClick={() => requestCameraAccess()}
              className="text-[10px] text-accent-soft hover:text-ink-50"
            >
              Refresh devices
            </button>
          </div>
        </>
      )}

      {/* Crop / keyboard alignment */}
      <div className="border-t border-white/4 pt-3 mt-1">
        <div className="px-4 mb-2 text-[10px] uppercase tracking-[0.18em] text-ink-500">
          Crop to keyboard
        </div>

        {opts.crop ? (
          <div className="px-4 pb-1 space-y-2">
            <div className="text-[11px] text-ink-300 leading-relaxed">
              Cropped. Keep the piano and the overhead camera fixed — if either
              moves, the alignment drifts.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openCrop}
                className="flex-1 text-xs py-1.5 rounded border border-white/10 text-ink-200 hover:border-white/20"
              >
                Re-crop
              </button>
              <button
                onClick={clearCrop}
                className="text-xs py-1.5 px-3 rounded border border-white/10 text-ink-300 hover:border-white/20"
              >
                Clear
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={rerunAutoCrop}
                className="text-[11px] text-accent-soft hover:text-ink-50"
              >
                Re-run auto-crop
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-1">
            <button
              onClick={openCrop}
              className="w-full text-xs py-1.5 rounded border border-accent bg-accent/15 text-ink-50 hover:bg-accent/25 transition-colors"
            >
              Crop
            </button>
            <div className="text-[10px] text-ink-500 mt-1.5 leading-relaxed">
              Auto-crop runs the moment a camera comes online. Open this
              popup to fine-tune; drag the three guides onto A0, the E4 | F4
              gap, and C8, and use the rotation handle if the piano sits at
              an angle.
            </div>
            <div className="flex justify-end mt-1.5">
              <button
                onClick={rerunAutoCrop}
                className="text-[11px] text-accent-soft hover:text-ink-50"
              >
                Re-run auto-crop
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Manual fine-tune */}
      <div className="border-t border-white/4 pt-3 mt-2">
        <div className="px-4 mb-2 text-[10px] uppercase tracking-[0.18em] text-ink-500">
          Manual fine-tune
        </div>
        <div className="px-4 py-1.5 flex items-center justify-between text-xs">
          <span className="text-ink-400">Edit keystone</span>
          <input
            type="checkbox"
            checked={!!opts.editKeystone}
            onChange={(e) => patch({ editKeystone: e.target.checked })}
          />
        </div>
        <div className="px-4 py-1.5 flex items-center justify-between text-xs">
          <span className="text-ink-400">Mirror</span>
          <input
            type="checkbox"
            checked={!!opts.mirror}
            onChange={(e) => patch({ mirror: e.target.checked })}
          />
        </div>
        <div className="px-4 pb-1">
          <button
            className="text-[11px] text-accent-soft hover:text-ink-50"
            onClick={() => patch({ keystone: [[0, 0], [1, 0], [1, 1], [0, 1]] })}
          >
            Reset corners
          </button>
        </div>
      </div>

      <CameraAdjustmentsPanel
        moduleId={module.id}
        adjustments={opts.adjustments ?? defaultAdjustments()}
        onChange={setAdjustments}
      />

      {cropOpen && (
        <CropModal
          initial={opts.crop}
          source={opts.source ?? 'local'}
          deviceId={opts.deviceId ?? null}
          onApply={applyCrop}
          onClose={() => setCropOpen(false)}
        />
      )}
    </>
  );
}
