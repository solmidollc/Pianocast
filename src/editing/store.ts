import { create } from 'zustand';
import { newClip, newDraft, editDuration, type EditDraft, type MediaAsset } from './model';
import { inspectVideo } from './media';
import { mostRecentFirst } from '../state/projectRecency';

export interface EditSummary { id: string; title: string; updatedAt: string; lastOpenedAt?:string; duration: number }
interface EditorState {
  open: boolean; review: boolean; draft: EditDraft | null; library: EditSummary[];
  busy: boolean; saveStatus: 'saved' | 'saving' | 'error'; error: string;
}
export const useVideoEdits = create<EditorState>(() => ({ open: false, review: false, draft: null, library: [], busy: false, saveStatus: 'saved', error: '' }));
let database: Promise<IDBDatabase> | undefined;
function db() { return database ??= new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('piano-canva.video-edits', 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('drafts', { keyPath: 'id' }); request.result.createObjectStore('summaries', { keyPath: 'id' }); };
  request.onsuccess = () => resolve(request.result); request.onerror = () => { database = undefined; reject(request.error); };
}); }
export function editError(error: unknown) { useVideoEdits.setState({ error: error instanceof Error ? error.message : String(error), busy: false }); }
export async function refreshEdits() {
  try {
    const database = await db();
    const library = await new Promise<EditSummary[]>((resolve, reject) => {
      const request = database.transaction('summaries').objectStore('summaries').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    useVideoEdits.setState({ library: library.sort(mostRecentFirst) });
  } catch (error) { editError(error); }
}
let timer: ReturnType<typeof setTimeout> | undefined, writes: Promise<unknown> = Promise.resolve();
export async function saveVideoEdit() {
  clearTimeout(timer); const draft = useVideoEdits.getState().draft; if (!draft) return;
  useVideoEdits.setState({ saveStatus: 'saving' });
  const write = writes.catch(() => {}).then(async () => {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(['drafts', 'summaries'], 'readwrite');
      tx.objectStore('drafts').put(draft);
      tx.objectStore('summaries').put({ id: draft.id, title: draft.title, updatedAt: draft.updatedAt, lastOpenedAt: draft.lastOpenedAt, duration: editDuration(draft.clips) });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }); writes = write;
  try { await write; if (writes === write && useVideoEdits.getState().draft === draft) useVideoEdits.setState({ saveStatus: 'saved' }); await refreshEdits(); }
  catch (error) { useVideoEdits.setState({ saveStatus: 'error' }); editError(new Error('Could not save this video edit on this device. Free storage or download the original before leaving. ' + (error instanceof Error ? error.message : ''))); throw error; }
}
export function changeEdit(patch: Partial<EditDraft>) {
  const draft = useVideoEdits.getState().draft; if (!draft) return;
  useVideoEdits.setState({ draft: { ...draft, ...patch, updatedAt: new Date().toISOString() }, saveStatus: 'saving' });
  clearTimeout(timer); timer = setTimeout(() => { void saveVideoEdit().catch(() => {}); }, 650);
}
export async function openVideoEdit(id?: string, options: { reviewRecording?: boolean } = {}) {
  if (useVideoEdits.getState().busy) return;
  useVideoEdits.setState({ busy: true, error: '' });
  try {
    await saveVideoEdit();
    let restoreId = id;
    if (!restoreId && !useVideoEdits.getState().draft) {
      await refreshEdits(); restoreId = useVideoEdits.getState().library[0]?.id;
    }
    if (restoreId) {
      const database = await db();
      const draft = await new Promise<EditDraft>((resolve, reject) => {
        const request = database.transaction('drafts').objectStore('drafts').get(restoreId); request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error('This edit was not found.')); request.onerror = () => reject(request.error);
      });
      useVideoEdits.setState({ draft });
    } else if (!useVideoEdits.getState().draft) useVideoEdits.setState({ draft: newDraft() });
    const draft=useVideoEdits.getState().draft!;
    useVideoEdits.setState({ draft:{...draft,lastOpenedAt:new Date().toISOString()} });
    useVideoEdits.setState({ open: true, review: !!options.reviewRecording && useVideoEdits.getState().draft?.originalSaved === false && !useVideoEdits.getState().draft?.originalSaveSkipped, busy: false }); await saveVideoEdit();
  } catch (error) { editError(error); }
}
export async function createVideoEdit() {
  try { await saveVideoEdit(); useVideoEdits.setState({ draft: newDraft(), open: true, review: false, error: '' }); }
  catch (error) { editError(error); }
}
export async function deleteCurrentEdit() {
  const draft = useVideoEdits.getState().draft; if (!draft) return;
  clearTimeout(timer); await writes.catch(() => {});
  try {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(['drafts', 'summaries'], 'readwrite');
      tx.objectStore('drafts').delete(draft.id); tx.objectStore('summaries').delete(draft.id);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    useVideoEdits.setState({ draft: newDraft(), review: false, saveStatus: 'saved', error: '' }); await refreshEdits();
  } catch (error) { editError(error); }
}
export async function closeVideoEdit() {
  try { await saveVideoEdit(); useVideoEdits.setState({ open: false, review: false }); }
  catch (error) { editError(error); }
}
export async function importVideoFiles(files: FileList | File[]) {
  if (useVideoEdits.getState().busy) return;
  useVideoEdits.setState({ busy: true, error: '' });
  try {
    const file = Array.from(files)[0];
    if (!file) { useVideoEdits.setState({ busy: false }); return; }
    const asset = await inspectVideo(file, file.name);
    const draft = useVideoEdits.getState().draft ?? newDraft();
    useVideoEdits.setState({ draft });
    changeEdit({ assets: [asset], clips: [newClip(asset)], cues: [], thumbnail: null, thumbnailChoice: null, thumbnailIntro: false, originalSaved: undefined, originalSaveSkipped: undefined });
    useVideoEdits.setState({ busy: false });
  } catch (error) { editError(error); }
}
/** Retain every take as a separate edit; previous edits remain in the library. */
export async function offerRecordedTake(blob: Blob, name: string, duration: number) {
  // A storage failure must not prevent access to the new in-memory take.
  try { await saveVideoEdit(); } catch { /* error stays visible */ }
  let asset: MediaAsset;
  try { asset = await inspectVideo(blob, name, duration); }
  catch (error) {
    // Never lose the only copy of a completed take because metadata decoding
    // fails. Keep a download path even when the browser cannot preview it.
    asset = { id: crypto.randomUUID(), name, blob, duration, width: 1920, height: 1080 };
    editError(error);
  }
  const draft = newDraft(asset, true);
  useVideoEdits.setState({ draft, open: true, review: true });
  try { await saveVideoEdit(); } catch { /* offer download/review even if storage is full */ }
  return draft.id;
}
