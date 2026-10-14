import { lockedBoardSize,editsLocked } from '../annotation/connectionLock';
import { useApp } from './store';

type Scene = Pick<ReturnType<typeof useApp.getState>, 'modules' | 'background' | 'cameraSetups' | 'selectedId'>;
const snapshot = (): Scene => {
  const { modules, background, cameraSetups, selectedId } = useApp.getState();
  return structuredClone({ modules, background, cameraSetups, selectedId });
};
let previous = snapshot();
export function clearSceneHistory() { past = []; future = []; previous = snapshot(); endSceneEdit(); }
let past: Scene[] = [];
let future: Scene[] = [];
let restoring = false;
let gesture = false;
let recordedGesture = false;
let lastChange = 0;

export function beginSceneEdit() { gesture = true; recordedGesture = false; lastChange = 0; }
export function endSceneEdit() { gesture = false; recordedGesture = false; lastChange = 0; }

useApp.subscribe((state, old) => {
  if (state.transitioning) return;
  if (state.modules === old.modules && state.background === old.background) {
    previous = snapshot();
    return;
  }
  if (!restoring) {
    const now = performance.now();
    if (gesture ? !recordedGesture : state.modules.length !== old.modules.length || state.background !== old.background || now - lastChange > 400 || !past.length) {
      past.push(previous);
      if (past.length > 100) past.shift();
    }
    recordedGesture = gesture;
    lastChange = now;
    future = [];
  }
  previous = snapshot();
});

function restore(scene: Scene) {
  restoring = true;
  const copy=structuredClone(scene);
  copy.modules=copy.modules.map(m=>{
    const size=m.kind==='annotation' && lockedBoardSize(String(m.options.boardId ?? m.id));
    return size?{...m,width:size[0],height:size[1]}:m;
  });
  useApp.setState({ ...copy, snapGuides: null });
  restoring = false;
  endSceneEdit();
}
export function undoScene() {
  if(editsLocked())return;
  const scene = past.pop();
  if (!scene) return;
  future.push(snapshot());
  restore(scene);
}
export function redoScene() {
  if(editsLocked())return;
  const scene = future.pop();
  if (!scene) return;
  past.push(snapshot());
  restore(scene);
}

