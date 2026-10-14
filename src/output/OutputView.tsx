import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { ACOUSTIC_INPUT_ID, midiEngine } from '../midi/engine';
import { ProgramOutput } from '../scene/ProgramOutput';

/**
 * The view mounted inside the hidden offscreen BrowserWindow that the virtual
 * camera service captures from.
 *
 * Responsibilities:
 *   - Boot Web MIDI in this window. Each BrowserWindow has its own MIDIAccess,
 *     so we attach to the same device the editor selected and process events
 *     independently — no need to ferry note data across IPC.
 *   - Mirror the editor's scene state (modules, key, background) via IPC.
 *   - Render ProgramOutput at the canvas's native resolution with no chrome.
 */
export function OutputView() {
  const [ready, setReady] = useState(false);
  const { canvasWidth, canvasHeight } = useApp();

  useEffect(() => {
    const acoustic = new BroadcastChannel('pianocanva-acoustic-output');
    acoustic.onmessage = event => {
      const note = event.data?.note;
      if (note === null || Number.isInteger(note) && note >= 21 && note <= 108) midiEngine.setAcousticNote(note);
    };
    midiEngine.init().catch(() => {
      /* still useful for editor-only previews */
    });

    const unsubScene = window.pk?.output.onSceneState((state: PkScenePayload) => {
      useApp.setState(state as Partial<ReturnType<typeof useApp.getState>>);
      setReady(true);
    });
    const unsubInputId = window.pk?.output.onInputId((id: string | null) => {
      midiEngine.selectInput(id);
      if (id === ACOUSTIC_INPUT_ID) acoustic.postMessage({ request: true });
    });

    // Request the editor to broadcast its current state.
    window.pk?.output.requestSync();

    return () => {
      acoustic.close();
      unsubScene?.();
      unsubInputId?.();
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: canvasWidth,
          height: canvasHeight,
          // The offscreen BrowserWindow is sized exactly to canvas dimensions;
          // no scaling needed. If the editor changes the canvas size, main
          // resizes the window to match.
        }}
      >
        {ready && <ProgramOutput />}
      </div>
    </div>
  );
}

