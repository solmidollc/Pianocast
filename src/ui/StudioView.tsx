import { useDialogKeyboard } from './useDialogKeyboard';
import { useEffect, useRef, useState } from 'react';
import { MAX_SCENES, useScenes } from '../state/sceneLibrary';
import { useApp } from '../state/store';
import { SCENE_PRESETS } from '../state/scenePresets';
import { SceneLibraryDialog } from './SceneLibraryDialog';
import { useEditsLocked } from '../annotation/connectionLock';
import { ScenePreview } from './ScenePreview';
import { recorder } from '../recording/recorder';

export type StudioTheme = 'original' | 'studio-light';
export function ThemePicker({ theme, onChange }: { theme: StudioTheme; onChange: (theme: StudioTheme) => void }) {
  return <label className="studio-theme-picker">Theme<span className="studio-theme-select"><select aria-label="Theme" value={theme} onChange={e => onChange(e.target.value as StudioTheme)}><option value="original">Dark</option><option value="studio-light">Light</option></select><svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4"/></svg></span></label>;
}
// UI-only, event-driven snapshots. Never run a thumbnail renderer during recording.
function snapshot(): string | null {
  if (['recording', 'paused', 'starting', 'stopping'].includes(recorder.getSnapshot().status) || useApp.getState().transitioning) return null;
  const source = document.querySelector('[data-recording-module]')?.parentElement?.parentElement;
  if (!source) return null;
  try {
    const copy = source.cloneNode(true) as HTMLElement;
    const originalNodes = [source, ...Array.from(source.querySelectorAll('*'))];
    [copy, ...Array.from(copy.querySelectorAll('*'))].forEach((node, index) => {
      if (node instanceof SVGElement) return;
      const style = getComputedStyle(originalNodes[index]);
      node.setAttribute('style', Array.from(style).map(key => key + ':' + style.getPropertyValue(key)).join(';'));
    });
    const originals = Array.from(source.querySelectorAll('video,canvas'));
    Array.from(copy.querySelectorAll('video,canvas')).forEach((element, i) => {
      const media = originals[i];
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d');
      if (context && media && (!(media instanceof HTMLVideoElement) || media.readyState >= 2)) {
        context.drawImage(media as HTMLVideoElement | HTMLCanvasElement, 0, 0, 320, 180);
        const image = document.createElement('img');
        image.src = canvas.toDataURL('image/jpeg', .65);
        image.setAttribute('style', element.getAttribute('style') || '');
        image.style.width = '100%'; image.style.height = '100%'; image.style.objectFit = 'cover';
        element.replaceWith(image);
      } else element.remove();
    });
    copy.querySelectorAll('[data-editor-overlay]').forEach(node=>node.remove());
    copy.style.transform = 'none'; copy.style.position = 'relative';
    copy.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const { canvasWidth: w, canvasHeight: h } = useApp.getState();
    const css = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n');
    const markup = new XMLSerializer().serializeToString(copy);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>${css}</style><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`);
  } catch { return null; }
}
const previewCache:Record<string,string>={};
function useSceneSnapshots(activeId:string){
 const [snapshots,setSnapshots]=useState<Record<string,string>>(()=>({...previewCache}));const activeRef=useRef(activeId);
 useEffect(()=>{const remember=(id:string)=>{const image=snapshot();if(image){previewCache[id]=image;while(Object.keys(previewCache).length>18)delete previewCache[Object.keys(previewCache)[0]];setSnapshots({...previewCache});}};const timer=setTimeout(()=>remember(activeId),650);const unsubscribe=useScenes.subscribe(next=>{if(next.activeId!==activeRef.current){remember(activeRef.current);activeRef.current=next.activeId;}});return()=>{clearTimeout(timer);unsubscribe();const image=snapshot();if(image)previewCache[activeRef.current]=image;};},[activeId]);
 return snapshots;
}
export function SceneStrip({ editing, onEdit }: { editing: boolean; onEdit: () => void }) {
  const editingLocked=useEditsLocked();
  const { scenes, activeId, switchScene, deleteScene } = useScenes();
  const [libraryOpen,setLibraryOpen]=useState(false);
  const snapshots=useSceneSnapshots(activeId);
  const [pendingDelete,setPendingDelete]=useState<string|null>(null);
  useDialogKeyboard(!!pendingDelete,'Delete scene',()=>setPendingDelete(null));
  const { canvasWidth: w, canvasHeight: h } = useApp.getState();
  return <section className="studio-chrome studio-scenes" aria-label="Scenes">
    <div className="studio-strip-heading"><span>Scenes</span></div>
    {libraryOpen&&<SceneLibraryDialog onClose={()=>setLibraryOpen(false)} onAdded={onEdit}/>}
    <div className="studio-scene-list" tabIndex={0} aria-label="Scene previews">{scenes.map(scene => {
      const modules = scene.modules ?? SCENE_PRESETS.find(p => p.id === scene.id)?.build(w,h) ?? [];
      return <div key={scene.id} className={'studio-scene ' + (scene.id === activeId ? 'is-active' : '')}>
        <button className="studio-scene-select" aria-pressed={scene.id === activeId} onClick={() => switchScene(scene.id)} aria-label={'Switch to ' + scene.name}>
          <div className="studio-thumbnail">{snapshots[scene.id] ? <img src={snapshots[scene.id]} alt="" /> : <ScenePreview modules={modules} width={w} height={h}/>}</div>
          <span className="studio-scene-caption">{scene.name}<kbd>{scene.shortcut.toUpperCase()}</kbd></span>
        </button>
        <button disabled={editingLocked} className="studio-scene-delete" title={'Delete '+scene.name} aria-label={'Delete scene '+scene.name} onClick={()=>setPendingDelete(scene.id)}>×</button>
        <button disabled={editingLocked} className="studio-scene-edit" title={'Edit ' + scene.name} aria-label={'Edit ' + scene.name} onClick={() => { switchScene(scene.id); onEdit(); }}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z"/></svg></button>
      </div>;
    })}
    {scenes.length<MAX_SCENES&&<button disabled={editingLocked} className="studio-scene studio-scene-add" aria-label="Add scene" title="New scene" onClick={()=>setLibraryOpen(true)}><span aria-hidden="true">＋</span></button>}
    </div>
    {pendingDelete&&<div className="ink-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Delete scene" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setPendingDelete(null);}}}><section className="ink-dialog"><h2>Delete {scenes.find(s=>s.id===pendingDelete)?.name}?</h2><p>{scenes.length===1?'A new empty scene will replace it.':'This removes this scene from the project.'}</p><button onClick={()=>{deleteScene(pendingDelete);setPendingDelete(null);}}>Delete scene</button><button onClick={()=>setPendingDelete(null)}>Cancel</button></section></div>}
  </section>;
}



export function FullscreenScenes(){const {scenes,activeId,switchScene}=useScenes(),snapshots=useSceneSnapshots(activeId),{canvasWidth:w,canvasHeight:h}=useApp.getState();if(scenes.length<2)return null;return <nav className="fullscreen-scenes" aria-label="Fullscreen scenes">{scenes.map(scene=><button key={scene.id} aria-pressed={activeId===scene.id} aria-label={'Switch to '+scene.name} title={scene.name+(scene.shortcut?' · '+scene.shortcut.toUpperCase():'')} onClick={()=>switchScene(scene.id)}><div className="fullscreen-scene-preview">{snapshots[scene.id]?<img src={snapshots[scene.id]} alt=""/>:<ScenePreview modules={scene.modules??[]} width={w} height={h}/>}</div>{scene.shortcut&&<kbd>{scene.shortcut.toUpperCase()}</kbd>}</button>)}</nav>;}
