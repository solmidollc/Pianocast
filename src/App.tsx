import { useEffect, useRef, useState } from 'react';
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

import { useApp } from './state/store';
import { SCENE_PRESETS } from './state/scenePresets';

import { StartPage, type SessionMode } from './ui/StartPage';

export function App() {
  const [mode, setMode] = useState<SessionMode | null>(null);
  const tutorialStarted = useRef(false);
  const selectMode = (selectedMode: SessionMode) => {
    if (selectedMode === 'tutorial' && !tutorialStarted.current) {
      const scene = useApp.getState();
      const creator = SCENE_PRESETS.find((preset) => preset.id === 'creator');
      if (creator) scene.applyPreset(creator.build(scene.canvasWidth, scene.canvasHeight));
      tutorialStarted.current = true;
    }
    setMode(selectedMode);
  };
  return mode === null
    ? <StartPage onSelect={selectMode} />
    : <Editor mode={mode} onChangeMode={() => setMode(null)} />;
}

function Editor({ mode, onChangeMode }: { mode: SessionMode; onChangeMode: () => void }) {
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
      <TopBar mode={mode} onChangeMode={onChangeMode} />
      <div className="flex-1 flex min-h-0">
        <LeftPanel />
        <SceneCanvas />
        <RightPanel />
      </div>
    </div>
  );
}
