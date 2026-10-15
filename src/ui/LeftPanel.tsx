import { elementName } from '../state/elementNames';
import { useEditsLocked } from '../annotation/connectionLock';
import { disconnectAnnotation } from '../annotation/peer';
import { useState } from 'react';
import { useApp, type ModuleKind } from '../state/store';
import { MODULE_LABEL } from '../scene/ModuleContent';
import { renameElement,duplicateSceneWithInk } from '../state/projects';
import { MAX_SCENES, useScenes } from '../state/sceneLibrary';

const PALETTE: { kind: ModuleKind; description: string }[] = [
  { kind: 'text', description:'Text overlay' },
  { kind: 'annotation', description: 'Live handwriting from a companion device' },
  { kind: 'notation', description: 'Grand staff, real-time' },
  { kind: 'keyboard', description: '88-key visualizer' },
  { kind: 'camera', description: 'System video capture device' },
  { kind: 'overhead', description: 'Companion phone camera' },
  { kind: 'overheadVisualizer', description: 'Camera and keyboard in one layer' },
];

export function LeftPanel() {
  const editingLocked=useEditsLocked();
  const {
    modules,
    selectedId,
    select,
    addModule,
    toggleVisible,
    removeModule,
    reorderLayers,
  } = useApp();

  const { scenes, activeId, switchScene, createBlank, renameScene, setShortcut, deleteScene, reorderScenes } = useScenes();
  const [renaming,setRenaming]=useState<string|null>(null),[elementDraft,setElementDraft]=useState('');
  const [editingScenes, setEditingScenes] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const sorted = [...modules].sort((a, b) => b.z - a.z);

  return (
    <aside className="editor-left-panel w-full bg-ink-900 flex flex-col overflow-y-auto overflow-x-hidden">
      {editingLocked&&<div className="px-5 pt-4 text-xs text-ink-300"><p>Tablet connected · Editing locked</p><button className="mt-2 text-accent-soft" onClick={disconnectAnnotation}>Disconnect tablet</button></div>}
      <Section title="Layers"><fieldset disabled={editingLocked}>
        <ul className="space-y-px" aria-label="Scene layers, front to back">
          {sorted.map((m, index) => {
            const active = m.id === selectedId;
            const moveTo = (targetIndex: number) => {
              const ids = sorted.map((layer) => layer.id);
              ids.splice(index, 1);
              ids.splice(targetIndex, 0, m.id);
              reorderLayers(ids);
            };
            return (
              <li key={m.id}
                draggable={!editingLocked}
                data-layer-id={m.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', m.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggedId(m.id);
                }}
                onDragOver={(e) => {
                  if (!draggedId || draggedId === m.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDropTarget({ id: m.id, after: e.clientY > rect.top + rect.height / 2 });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const source = draggedId;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > rect.top + rect.height / 2;
                  if (source && source !== m.id) {
                    const ids = sorted.map((layer) => layer.id).filter((id) => id !== source);
                    ids.splice(ids.indexOf(m.id) + (after ? 1 : 0), 0, source);
                    reorderLayers(ids);
                  }
                  setDraggedId(null);
                  setDropTarget(null);
                }}
                onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}
                className={`relative flex items-center px-2 py-2 text-xs rounded transition-colors ${active ? 'bg-white/8 text-ink-50 ring-1 ring-inset ring-white/15' : 'text-ink-200 hover:bg-white/4'} ${draggedId === m.id ? 'opacity-40' : ''}`}
              >
                {dropTarget?.id === m.id && (
                  <div className={`pointer-events-none absolute inset-x-0 h-0.5 bg-accent ${dropTarget.after ? 'bottom-0' : 'top-0'}`} />
                )}
                <span aria-hidden className="mr-2 text-ink-500 cursor-grab touch-none select-none"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDraggedId(m.id);
                  }}
                  onPointerMove={(e) => {
                    if (draggedId !== m.id) return;
                    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-layer-id]');
                    const id = target?.dataset.layerId;
                    if (!target || !id || id === m.id) { setDropTarget(null); return; }
                    const rect = target.getBoundingClientRect();
                    setDropTarget({ id, after: e.clientY > rect.top + rect.height / 2 });
                  }}
                  onPointerUp={(e) => {
                    if (draggedId === m.id) {
                      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-layer-id]');
                      const id = target?.dataset.layerId;
                      if (target && id && id !== m.id) {
                        const rect = target.getBoundingClientRect();
                        const ids = sorted.map((layer) => layer.id).filter((id) => id !== m.id);
                        ids.splice(ids.indexOf(id) + (e.clientY > rect.top + rect.height / 2 ? 1 : 0), 0, m.id);
                        reorderLayers(ids);
                      }
                    }
                    setDraggedId(null);
                    setDropTarget(null);
                  }}
                  onPointerCancel={() => { setDraggedId(null); setDropTarget(null); }}
                >⠿</span>
                {renaming===m.id?<input autoFocus aria-label="Rename element" maxLength={80} value={elementDraft} className="min-w-0 flex-1 bg-ink-800 px-1 py-1 text-xs" onChange={e=>setElementDraft(e.target.value)} onBlur={()=>{renameElement(m.id,elementDraft);setRenaming(null);}} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){setRenaming(null);}}}/>:<button type="button" onDoubleClick={()=>{setRenaming(m.id);setElementDraft(elementName(m));}} onClick={() => select(m.id)}
                  className="flex-1 text-left min-w-0 truncate"
                  title="Select layer. Alt+Up/Down to reorder; Alt+Home/End for front/back."
                  onKeyDown={(e) => {
                    if (!e.altKey) return;
                    const target = e.key === 'ArrowUp' ? Math.max(0, index - 1)
                      : e.key === 'ArrowDown' ? Math.min(sorted.length - 1, index + 1)
                      : e.key === 'Home' ? 0 : e.key === 'End' ? sorted.length - 1 : null;
                    if (target !== null) { e.preventDefault(); moveTo(target); }
                  }}>
                  {elementName(m)}
                </button>}
                {active&&renaming!==m.id&&<button type="button" aria-label={'Rename '+elementName(m)} title="Rename element" className="px-1 text-ink-400 hover:text-ink-100" onClick={()=>{setRenaming(m.id);setElementDraft(elementName(m));}}><svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m16 3 5 5L8 21H3v-5zM13 6l5 5"/></svg></button>}
                {active && (
                  <>
                    <button type="button" aria-label="Bring layer to front" title="Bring to front"
                      disabled={index === 0} onClick={() => moveTo(0)}
                      className="px-1.5 text-ink-400 hover:text-ink-100 disabled:opacity-30">↑</button>
                    <button type="button" aria-label="Send layer to back" title="Send to back"
                      disabled={index === sorted.length - 1} onClick={() => moveTo(sorted.length - 1)}
                      className="px-1.5 text-ink-400 hover:text-ink-100 disabled:opacity-30">↓</button>
                  </>
                )}
                <button type="button" onClick={() => toggleVisible(m.id)}
                  aria-label={`${m.visible ? 'Hide' : 'Show'} ${elementName(m)}`}
                  className={`mx-1 w-6 h-6 shrink-0 rounded flex items-center justify-center hover:bg-white/10 ${m.visible ? 'text-accent-soft' : 'text-ink-400'}`}
                  title={m.visible ? 'Hide' : 'Show'}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>{!m.visible && <path d="m3 3 18 18"/>}</svg></button>
                <button type="button" onClick={() => removeModule(m.id)}
                  aria-label={`Remove ${elementName(m)}`}
                  className="w-6 h-6 shrink-0 rounded text-ink-400 hover:bg-white/10 hover:text-ink-100 text-base leading-none"
                  title="Remove">×</button>
              </li>
            );
          })}
        </ul></fieldset>
      </Section>

      <Section title="Scenes">
        <ul className="space-y-1">
          {scenes.map(scene => (
            <li key={scene.id}>
              <button onClick={() => switchScene(scene.id)} aria-pressed={scene.id === activeId}
                className={`w-full text-left px-3 py-2 rounded transition-colors ${scene.id === activeId ? 'bg-accent/15' : 'hover:bg-white/4'}`}>
                <span className="text-sm text-ink-100">{scene.name}</span>
                {scene.shortcut && <kbd className="float-right min-w-5 text-center border border-white/15 rounded px-1 py-0.5 text-ink-300 text-[11px]">{scene.shortcut.toUpperCase()}</kbd>}
              </button>
            </li>
          ))}
        </ul>
        <button disabled={editingLocked} onClick={()=>setEditingScenes(true)} className="scene-manage-link">Manage scenes</button>
      </Section>
      {editingScenes&&<SceneManager onClose={()=>setEditingScenes(false)}/>}

      <fieldset disabled={editingLocked}><details className="px-2">
        <summary className="px-3 py-3 text-xs text-ink-400 cursor-pointer">Transition</summary>
        <label className="px-3 py-2 flex justify-between text-xs text-ink-400">Style<select aria-label="Transition style" value={useApp((s) => s.transitionMode)} onChange={(e) => useApp.getState().setTransitionMode(e.target.value as 'move' | 'fade' | 'dissolve')} className="bg-ink-800 rounded px-2 py-1"><option value="move">Move</option><option value="fade">Fade</option><option value="dissolve">Dissolve</option></select></label>
        <label className="px-3 py-2 flex justify-between text-xs text-ink-400">Duration (seconds)<input aria-label="Transition duration" type="number" min="0" max="5" step="0.1" value={useApp((s) => s.transitionSeconds)} onChange={(e) => useApp.getState().setTransitionSeconds(Math.max(0, Math.min(5, Number(e.target.value))))} className="w-16 bg-ink-800 rounded px-2" /></label>
      </details>
      <details>
        <summary className="px-5 py-3 text-xs text-ink-300 cursor-pointer hover:text-ink-50">Add element</summary>
      <Section title="Elements">
        <ul className="space-y-1">
          {PALETTE.map((p) => (
            <li key={p.kind}>
              <button
                onClick={() => addModule(p.kind)}
                className="w-full text-left px-3 py-2 rounded hover:bg-white/4 transition-colors"
              >
                <div className="text-sm text-ink-100">{MODULE_LABEL[p.kind]}</div>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      </details>
      </fieldset><div className="flex-1" />
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-2 pt-4 pb-2">
      <div className="px-3 mb-2 text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {title}
      </div>
      {children}
    </div>
  );
}




function SceneManager({onClose}:{onClose:()=>void}){
 const {scenes,renameScene,setShortcut,reorderScenes,deleteScene}=useScenes();const locked=useEditsLocked();const [pending,setPending]=useState<string|null>(null);
 const move=(id:string,offset:number)=>{const ids=scenes.map(s=>s.id),index=ids.indexOf(id);[ids[index],ids[index+offset]]=[ids[index+offset],ids[index]];reorderScenes(ids);};
 return <div className="project-modal-backdrop" onClick={onClose}><section role="dialog" aria-modal="true" aria-label="Manage scenes" className="project-modal scene-manager" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape')onClose();}}><div className="project-modal-heading"><h2>Manage scenes</h2><button autoFocus aria-label="Close scene manager" onClick={onClose}>×</button></div><div className="scene-manager-list">{scenes.map((scene,index)=><div className="scene-manager-row" key={scene.id}><div className="scene-manager-fields"><label>Scene name<input disabled={locked} aria-label={'Name for '+scene.name} defaultValue={scene.name} maxLength={80} onBlur={e=>renameScene(scene.id,e.target.value)}/></label><label>Shortcut<input disabled={locked} aria-label={'Shortcut for '+scene.name} placeholder="—" maxLength={1} value={scene.shortcut.toUpperCase()} onChange={e=>setShortcut(scene.id,e.target.value)}/></label></div><div className="scene-manager-actions"><button disabled={locked||index===0} aria-label={'Move '+scene.name+' earlier'} title="Move earlier" onClick={()=>move(scene.id,-1)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 10 4-4 4 4"/></svg></button><button disabled={locked||index===scenes.length-1} aria-label={'Move '+scene.name+' later'} title="Move later" onClick={()=>move(scene.id,1)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4"/></svg></button><button disabled={locked||scenes.length>=MAX_SCENES} onClick={()=>duplicateSceneWithInk(scene.id)}>Duplicate</button><button disabled={locked} className="scene-manager-delete" onClick={()=>setPending(scene.id)}>Delete</button></div>{pending===scene.id&&<div className="scene-manager-confirm"><span>Delete this scene?</span><button disabled={locked} onClick={()=>{deleteScene(scene.id);setPending(null);}}>Delete</button><button onClick={()=>setPending(null)}>Cancel</button></div>}</div>)}</div><div className="scene-manager-footer"><span>Shortcuts use one letter or number.</span><button className="project-primary" onClick={onClose}>Done</button></div></section></div>;
}
