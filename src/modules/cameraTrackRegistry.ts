/**
 * Module-id → MediaStreamTrack registry, used by the camera adjustment panels
 * to read each camera's live capabilities (`track.getCapabilities()`) and
 * apply hardware constraints (`track.applyConstraints()`) without dragging
 * a track ref through the React tree.
 *
 * Cameras register their current track on stream-attach and clear it on
 * detach. The CameraAdjustmentsPanel subscribes by module id and re-renders
 * whenever the track changes — controls are gated on what the device
 * actually reports as capable, so the UI is empty until a real track lands.
 *
 * Scope:
 *   - Editor-only. The hidden ProgramOutput window opens its own getUserMedia,
 *     which produces a *different* track on a different process. The output
 *     window doesn't need the registry — its adjustments arrive purely
 *     through serialised module options (the SVG/CSS filter chain).
 *   - Per-`moduleId`. A scene can legitimately have multiple camera modules
 *     bound to the same physical device; each one gets its own entry so
 *     the panel for module A doesn't see module B's track.
 */

type Listener = (track: MediaStreamTrack | null) => void;

const tracks = new Map<string, MediaStreamTrack | null>();
const listeners = new Map<string, Set<Listener>>();

/**
 * Camera component → registry. Pass `null` on detach. Safe to call many
 * times with the same track (idempotent — listeners are only fired when
 * the value actually changes).
 */
export function setCameraTrack(moduleId: string, track: MediaStreamTrack | null): void {
  const prev = tracks.get(moduleId) ?? null;
  if (prev === track) return;
  tracks.set(moduleId, track);
  const subs = listeners.get(moduleId);
  if (subs) for (const fn of subs) fn(track);
}

export function getCameraTrack(moduleId: string): MediaStreamTrack | null {
  return tracks.get(moduleId) ?? null;
}

/**
 * Subscribe to track changes. Returns an unsubscribe. The callback fires
 * once immediately with the current value so the subscriber doesn't have
 * to call `getCameraTrack` separately.
 */
export function subscribeCameraTrack(moduleId: string, fn: Listener): () => void {
  let set = listeners.get(moduleId);
  if (!set) {
    set = new Set();
    listeners.set(moduleId, set);
  }
  set.add(fn);
  fn(tracks.get(moduleId) ?? null);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(moduleId);
  };
}
