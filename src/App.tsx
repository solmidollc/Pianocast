import { useEffect, useRef, useState } from 'react';
import { FullscreenRecording } from './ui/FullscreenRecording';
import { KeyboardShortcuts } from './ui/KeyboardShortcuts';
import { TopBar } from './ui/TopBar';
import { LeftPanel } from './ui/LeftPanel';
import { RightPanel } from './ui/RightPanel';
import { SceneCanvas } from './scene/SceneCanvas';
import { OutputBridge } from './output/OutputBridge';
import {
  startDesktopSignalingClient,
  stopDesktopSignalingClient,
} from './companion/desktopSignaling';
import { useScaleDetector } from './theory/scaleDetector';
import { pianoEngine } from './audio/pianoEngine';

import { initializeScenes } from './state/sceneLibrary';

import { StartPage, type SessionMode } from './ui/StartPage';

export function App() {
  const [mode, setMode] = useState<SessionMode | null>(null);
  const tutorialStarted = useRef(false);
  const selectMode = (selectedMode: SessionMode) => {
    if (!tutorialStarted.current) {
      initializeScenes();
      tutorialStarted.current = true;
    }
    setMode(selectedMode);
  };
  return mode === null
    ? <StartPage onSelect={selectMode} />
    : <Editor mode={mode} onChangeMode={() => setMode(null)} />;
}

function Editor({ mode, onChangeMode }: { mode: SessionMode; onChangeMode: () => void }) {
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const enterFullscreen = () => {
    setFullscreen(true);
    void rootRef.current?.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const changed = () => { if (!document.fullscreenElement) setFullscreen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('fullscreenchange', changed);
    window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('fullscreenchange', changed); window.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => {
    startDesktopSignalingClient();
    return () => stopDesktopSignalingClient();
  }, []);

  // Boot the Concert Grand audio engine in the editor process only.
  // OutputView mounts its own React tree and never reaches this effect,
  // which is exactly what we want: piano audio plays once, to the user's
  // chosen output device, and OBS / Zoom capture it separately as desktop
  // audio. init() is idempotent — the AudioPanel calling it again is fine.
  useEffect(() => {
    void pianoEngine.init();
  }, []);

  // Auto-key from a solo scale run.
  useScaleDetector();

  return (
    <div ref={rootRef} className="relative h-full w-full flex flex-col bg-ink-950 text-ink-100 font-sans">
      <OutputBridge />
      <div className={fullscreen ? 'hidden' : ''}><TopBar mode={mode} onChangeMode={onChangeMode} onFullscreen={enterFullscreen} /></div>
      <div className="flex-1 flex min-h-0">
        <div className={fullscreen ? 'hidden' : 'w-64 flex flex-col border-r border-white/5 bg-ink-900'}><div className="flex-1 min-h-0 overflow-y-auto"><LeftPanel /></div><KeyboardShortcuts /></div>
        <SceneCanvas recordingView={fullscreen} />
        <div className={fullscreen ? 'hidden' : 'flex'}><RightPanel /></div>
      </div>
      {fullscreen && <FullscreenRecording />}
    </div>
  );
}
