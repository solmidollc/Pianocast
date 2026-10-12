/**
 * Runtime-context helpers.
 *
 * Piano Keys ships ONE renderer bundle that mounts two views — the editor
 * (default) and the hidden offscreen ProgramOutput (`?view=output`). Most
 * code doesn't care which it's running in, but the two views compete for
 * single-consumer system resources (notably the camera), so a tiny number
 * of paths need to know.
 *
 * Use this rather than touching `window.location.search` ad hoc, so the
 * test for "am I the editor or the offscreen window" is centralised and
 * greppable.
 */

export function isOutputView(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('view') === 'output';
}

/** Convenience inverse — explicit in the camera-pipeline comments. */
export function isEditorView(): boolean {
  return !isOutputView();
}
