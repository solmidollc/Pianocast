import { useApp } from '../state/store';
import { ScaledModule } from './ModuleContent';

/**
 * Program output — the actual broadcast frame.
 *
 * This renders the scene at its native resolution (1920×1080) without any
 * editor chrome: no selection outlines, no handles, no panels. The same DOM
 * the editor uses for previews is mounted here, just clean. To produce the
 * virtual camera feed, we'll capture this element via getDisplayMedia on
 * the next phase and pipe it into a platform-specific virtual camera bridge
 * (CMIO DAL on macOS, DirectShow filter on Windows).
 *
 * For now, this view is exposed so OBS / Zoom can pick it up via Window
 * Capture: open it in a separate Electron BrowserWindow, set the OBS source
 * to that window, and you have a working signal chain end-to-end while the
 * native camera bridge is being built.
 */
export function ProgramOutput() {
  const { canvasWidth, canvasHeight, background, modules } = useApp();
  const checkered =
    'repeating-conic-gradient(#1a1c20 0% 25%, #15171b 0% 50%) 50% / 24px 24px';

  return (
    <div
      style={{
        position: 'relative',
        width: canvasWidth,
        height: canvasHeight,
        background:
          background.type === 'transparent' ? checkered : background.color,
        overflow: 'hidden',
      }}
    >
      {[...modules]
        .filter((m) => m.visible)
        .sort((a, b) => a.z - b.z)
        .map((m) => (
          <div
            key={m.id}
            style={{
              position: 'absolute',
              left: m.x,
              top: m.y,
              width: m.width,
              height: m.height,
              zIndex: m.z,
              overflow: 'hidden',
            }}
          >
            <ScaledModule module={m} />
          </div>
        ))}
    </div>
  );
}
