import { create } from 'zustand';
import { useApp, type ModuleInstance, type SceneBackground } from './store';
import { clearSceneHistory } from './history';
import { SCENE_PRESETS } from './scenePresets';

export interface SavedScene {
  id: string;
  name: string;
  shortcut: string;
  modules: ModuleInstance[] | null;
  background: SceneBackground;
}
export interface Library {
  scenes: SavedScene[];
  activeId: string;
  switchScene: (id: string) => void;
  createBlank: (name: string) => void;
  renameScene: (id: string, name: string) => void;
  duplicateScene: (id:string) => void;
  deleteScene: (id:string) => void;
  reorderScenes: (ids:string[]) => void;
  addScene: (scene:SavedScene) => void;
  setShortcut: (id: string, shortcut: string) => void;
}
export const MAX_SCENES = 9;
const STORAGE = 'pk.scenes.v1';
const clean = (modules: ModuleInstance[]) => structuredClone(modules).map(m => {
  delete m.options.transitionOpacity;
  m.options.editKeystone = false;
  m.options.cropping = false;
  return m;
});
let switching = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const defaults: SavedScene[] = SCENE_PRESETS.map((p, i) => ({
  id: p.id, name: p.label, shortcut: String(i + 1), modules: null,
  background: { type: 'solid', color: '#0C0D10' },
}));
function read(): { scenes: SavedScene[]; activeId: string } {
  // Remove the former persistent scene cache; scene edits now belong to this tab.
  try { localStorage.removeItem(STORAGE); } catch { /* storage unavailable */ }
  try {
    const data = JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null');
    if (Array.isArray(data?.scenes) && data.scenes.length && data.scenes.every((s: SavedScene) =>
      typeof s.id === 'string' && typeof s.name === 'string' && typeof s.shortcut === 'string' &&
      (s.modules === null || Array.isArray(s.modules)) && s.background)) {
      const names:Record<string,string>={'Preset 1':'Stage Left','Preset 2':'Stage Right','Headshot View':'Spotlight','Overhead Creator':'Pro Creator','Overhead':'Pro Creator'};
      data.scenes=data.scenes.map((scene:SavedScene)=>({...scene,name:names[scene.name]??scene.name}));
      return { scenes: data.scenes, activeId: data.scenes.some((s: SavedScene) => s.id === data.activeId) ? data.activeId : data.scenes[0].id };
    }
  } catch { /* fresh library */ }
  return { scenes: defaults, activeId: 'creator' };
}
export const useScenes = create<Library>((set, get) => ({
  ...read(),
  switchScene: (id) => {
    if (id === get().activeId && get().scenes.find(s => s.id === id)?.modules !== null) return;
    const next = get().scenes.find(s => s.id === id);
    if (!next) return;
    useApp.getState().finishTransition();
    saveActive();
    switching = true;
    set({ activeId: id });
    const app = useApp.getState();
    const built = next.modules ?? SCENE_PRESETS.find(p => p.id === id)?.build(app.canvasWidth, app.canvasHeight) ?? [];
    app.applyPreset(built, next.modules ?? undefined);
    useApp.setState({ background: structuredClone(next.background), selectedId: null, snapGuides: null });
    switching = false;
    if (!useApp.getState().transitioning) saveActive();
    clearSceneHistory();
    persist();
  },
  createBlank: (name) => {
    if (get().scenes.length >= MAX_SCENES) return;
    const id = 'scene-' + Math.random().toString(36).slice(2, 10);
    set(s => ({ scenes: [...s.scenes, { id, name: name.trim() || 'New scene', shortcut: '', modules: [], background: { type: 'solid', color: '#0C0D10' } }] }));
    get().switchScene(id);
  },
  addScene: (scene) => {
    if(get().scenes.length>=MAX_SCENES)return;
    saveActive();set(s=>({scenes:[...s.scenes,scene]}));get().switchScene(scene.id);persist();
  },
  duplicateScene: (id) => {
    saveActive();const scene=get().scenes.find(s=>s.id===id);if(!scene)return;
    get().addScene(copyScene(scene,scene.name+' copy'));
  },
  deleteScene: (id) => {
    if(get().scenes.length<=1)return;
    if(get().activeId===id)get().switchScene(get().scenes.find(s=>s.id!==id)!.id);
    set(s=>({scenes:s.scenes.filter(s=>s.id!==id)}));persist();
  },
  reorderScenes: (ids) => {
    if(ids.length!==get().scenes.length || new Set(ids).size!==ids.length || ids.some(id=>!get().scenes.some(s=>s.id===id)))return;
    set({scenes:ids.map(id=>get().scenes.find(s=>s.id===id)!)});persist();
  },
  renameScene: (id, name) => {
    if (!name.trim()) return;
    set(s => ({ scenes: s.scenes.map(scene => scene.id === id ? { ...scene, name: name.trim() } : scene) }));
    persist();
  },
  setShortcut: (id, shortcut) => {
    const key = shortcut.trim().toLowerCase();
    if (key && !/^[a-z0-9]$/.test(key)) return;
    // Assigning an occupied key moves it to this scene, avoiding ambiguity.
    set(s => ({ scenes: s.scenes.map(scene => scene.id === id ? { ...scene, shortcut: key }
      : key && scene.shortcut === key ? { ...scene, shortcut: '' } : scene) }));
    persist();
  },
}));
function persist() {
  clearTimeout(timer);
  const { scenes, activeId } = useScenes.getState();
  try { sessionStorage.setItem(STORAGE, JSON.stringify({ scenes, activeId })); } catch { /* storage unavailable */ }
}
export function saveActive() {
  if (switching || useApp.getState().transitioning) return;
  const { modules, background } = useApp.getState();
  const { activeId } = useScenes.getState();
  useScenes.setState(s => ({ scenes: s.scenes.map(scene => scene.id === activeId
    ? { ...scene, modules: clean(modules), background: structuredClone(background) } : scene) }));
}
export function initializeScenes() {
  const { activeId, scenes } = useScenes.getState();
  const current = scenes.find(s => s.id === activeId);
  if (current?.modules !== null && current?.modules) {
    useApp.setState({ modules: clean(current.modules), background: structuredClone(current.background), selectedId: null });
  } else useScenes.getState().switchScene(activeId);
}
useApp.subscribe((state, old) => {
  if (switching || state.transitioning || (state.modules === old.modules && state.background === old.background)) return;
  saveActive();
  if (old.transitioning) clearSceneHistory();
  clearTimeout(timer);
  timer = setTimeout(persist, 200);
});
window.addEventListener('pagehide', () => { useApp.getState().finishTransition(); saveActive(); persist(); });


export function copyScene(scene:SavedScene,name=scene.name):SavedScene {
  const copy=structuredClone(scene);copy.id='scene-'+crypto.randomUUID();copy.name=name;copy.shortcut='';
  copy.modules=copy.modules?.map(m=>({...m,id:crypto.randomUUID(),options:{...m.options,...(m.kind==='annotation'?{boardId:crypto.randomUUID()}:{} )}}))??null;
  return copy;
}
export function loadSceneWorkspace(scenes:SavedScene[],activeId:string) {
 useApp.getState().finishTransition();switching=true;
 useScenes.setState({scenes:structuredClone(scenes),activeId:scenes.some(s=>s.id===activeId)?activeId:scenes[0].id});
 const scene=useScenes.getState().scenes.find(s=>s.id===useScenes.getState().activeId)!;
 const modules=scene.modules??SCENE_PRESETS.find(p=>p.id===scene.id)?.build(1920,1080).map((m,i)=>({...m,id:crypto.randomUUID(),z:i+1}))??[];
 useApp.setState({modules:clean(modules),background:structuredClone(scene.background),selectedId:null,snapGuides:null,cameraSetups:{}});
 switching=false;saveActive();clearSceneHistory();persist();
}
