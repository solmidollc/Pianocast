import { useEffect } from 'react';
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

export function App() {
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
    <div className="h-full w-full flex flex-col bg-ink-950 text-ink-100 font-sans">
      <OutputBridge />
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <LeftPanel />
        <SceneCanvas />
        <RightPanel />
      </div>
    </div>
  );
}
