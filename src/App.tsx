import { VideoEditor } from './ui/VideoEditor';
import { useEffect, useRef, useState } from 'react';
import { SceneStrip, FullscreenScenes, ThemePicker, type StudioTheme } from './ui/StudioView';
import { FullscreenRecording } from './ui/FullscreenRecording';
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

import { initializeProjects,useProjects,closeProject } from './state/projects';
import { AnnotationSurfaceBridge } from './annotation/SurfaceBridge';
import { ProjectHome } from './ui/ProjectHome';

import { type SessionMode } from './ui/StartPage';

export function App() {
 const [opened,setOpened]=useState(false);
 const [theme,setTheme]=useState<StudioTheme>(()=>{try{return sessionStorage.getItem('piano-canva.theme')==='studio-light'?'studio-light':'original';}catch{return 'original';}});
 const setAppearance=(value:StudioTheme)=>{setTheme(value);try{sessionStorage.setItem('piano-canva.theme',value);}catch{}};
 useEffect(()=>{void initializeProjects();},[]);
 const category=useProjects(s=>s.projects.find(p=>p.id===s.activeId)?.category);
 const mode:SessionMode=category==='livestream'?'live':category==='presentation'?'presentation':category==='performance'?'performance':'tutorial';
 const home=()=>{void closeProject().then(saved=>{if(saved)setOpened(false);});};
 return <>{opened?<Editor mode={mode} onChangeMode={home} theme={theme} onTheme={setAppearance}/>:<ProjectHome onOpen={()=>setOpened(true)} theme={theme} onTheme={setAppearance}/>}<VideoEditor theme={theme} /></>;
}

function Editor({ mode, onChangeMode,theme,onTheme }: { mode: SessionMode; onChangeMode: () => void;theme:StudioTheme;onTheme:(theme:StudioTheme)=>void }) {
  const [editing, setEditing] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [compactPanel,setCompactPanel]=useState<'canvas'|'layers'|'properties'>('canvas');
  const rootRef = useRef<HTMLDivElement>(null);
  const [livestream,setLivestream]=useState(false);
  const [fullscreenScenes,setFullscreenScenes]=useState(false);
  const enterFullscreen = (withScenes=false) => {
    setLivestream(false);
    setFullscreenScenes(withScenes);
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
    <div ref={rootRef} data-theme={theme} className="studio-editor relative h-full w-full flex flex-col bg-ink-950 text-ink-100 font-sans">
      <OutputBridge />
      <AnnotationSurfaceBridge />
      <div className={fullscreen ? 'hidden' : 'studio-chrome'}><div className="studio-theme-row"><ThemePicker theme={theme} onChange={onTheme} /></div><TopBar mode={mode} onChangeMode={onChangeMode} onFullscreen={enterFullscreen} readOnly={fullscreen} onLivestream={()=>{setLivestream(true);setFullscreenScenes(false);setFullscreen(true);}} /></div>
      {!fullscreen && <nav className="editor-compact-nav" aria-label="Workspace views">{(['canvas','layers','properties'] as const).map(view=><button key={view} aria-pressed={compactPanel===view} onClick={()=>setCompactPanel(view)}>{view==='canvas'?'Canvas':view==='layers'?'Layers and scenes':'Properties'}</button>)}</nav>}
      <div className={'editor-workspace flex-1 flex min-h-0'+(fullscreen?' is-output':'')} data-panel={compactPanel}>
        <div className={fullscreen || !editing ? 'hidden' : 'editor-layers studio-chrome w-64 flex flex-col border-r border-white/5 bg-ink-900'}><div className="flex-1 min-h-0 overflow-y-auto"><LeftPanel /></div></div>
        <SceneCanvas recordingView={fullscreen} />
        <div className={fullscreen || !editing ? 'hidden' : 'editor-properties studio-chrome flex'}><RightPanel /></div>
      </div>
      {!fullscreen && <SceneStrip editing={editing} onEdit={() => setEditing(true)} />}
      {fullscreen && fullscreenScenes && <FullscreenScenes/>}
      {fullscreen && !livestream && <FullscreenRecording sceneMode={fullscreenScenes}/>}

    </div>
  );
}




