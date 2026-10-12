import { useEffect } from 'react';
import { useApp } from '../state/store';
import { midiEngine } from '../midi/engine';

/**
 * Editor-side bridge that publishes scene + input state to main so the hidden
 * output BrowserWindow can mirror it for the virtual camera.
 *
 * This component renders nothing. It lives at the top of the editor tree and:
 *   - Pushes scene state to main on every store change.
 *   - Pushes the selected MIDI input id when it changes.
 *   - Stamps "input changed" timestamps for end-to-end latency measurement.
 *
 * It is purely additive; the editor UI and the MIDI / theory engines are
 * not aware of it.
 */
export function OutputBridge() {
  useEffect(() => {
    if (!window.pk) return;

    const publishScene = (s: ReturnType<typeof useApp.getState>) => {
      window.pk!.editor.publishScene({
        modules: s.modules,
        background: s.background,
        canvasWidth: s.canvasWidth,
        canvasHeight: s.canvasHeight,
        key: s.key,
      });
    };

    // Push initial state, then on every change.
    publishScene(useApp.getState());
    const unsubStore = useApp.subscribe((s) => publishScene(s));

    // Track the MIDI engine — push device id changes and stamp input ticks
    // whenever the snapshot identity changes (i.e. a real MIDI event landed).
    let lastSnap = midiEngine.getSnapshot();
    let lastId: string | null = midiEngine.getInputId();
    window.pk.editor.publishInputId(lastId);

    const unsubMidi = midiEngine.subscribe(() => {
      const s = midiEngine.getSnapshot();
      if (s !== lastSnap) {
        lastSnap = s;
        window.pk!.editor.publishInputTick(Date.now());
      }
      const id = midiEngine.getInputId();
      if (id !== lastId) {
        lastId = id;
        window.pk!.editor.publishInputId(id);
      }
    });

    // Handle resync requests from the output window (e.g. on cold start).
    const unsubResync = window.pk.editor.onResyncRequest(() => {
      publishScene(useApp.getState());
      window.pk!.editor.publishInputId(midiEngine.getInputId());
    });

    return () => {
      unsubStore();
      unsubMidi();
      unsubResync?.();
    };
  }, []);
  return null;
}
