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
interface Library {
  scenes: SavedScene[];
  activeId: string;
  switchScene: (id: string) => void;
  createBlank: (name: string) => void;
  renameScene: (id: string, name: string) => void;
  setShortcut: (id: string, shortcut: string) => void;
}
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
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
    if (Array.isArray(data?.scenes) && data.scenes.length && data.scenes.every((s: SavedScene) =>
      typeof s.id === 'string' && typeof s.name === 'string' && typeof s.shortcut === 'string' &&
      (s.modules === null || Array.isArray(s.modules)) && s.background)) {
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
    const id = 'scene-' + Math.random().toString(36).slice(2, 10);
    set(s => ({ scenes: [...s.scenes, { id, name: name.trim() || 'New scene', shortcut: '', modules: [], background: { type: 'solid', color: '#0C0D10' } }] }));
    get().switchScene(id);
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
  try { localStorage.setItem(STORAGE, JSON.stringify({ scenes, activeId })); } catch { /* storage unavailable */ }
}
function saveActive() {
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
