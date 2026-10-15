import { recorder } from '../recording/recorder';
import { useEffect, useState } from 'react';
import { useScenes } from '../state/sceneLibrary';
import { useApp } from '../state/store';
import { undoScene, redoScene } from '../state/history';

export function KeyboardShortcuts({readOnly=false,compact=false}:{readOnly?:boolean;compact?:boolean}) {
  const scenes = useScenes(s => s.scenes);
  const [open, setOpen] = useState(false);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? '⌘' : 'Ctrl';
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.isComposing || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        if (open) setOpen(false);
        else useApp.getState().select(null);
        return;
      }
      if (target?.closest('[role="dialog"], dialog') || open) return;
      const command = mac ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();
      if (!readOnly && command && !event.altKey && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoScene(); else undoScene();
        return;
      }
      if (!readOnly && !mac && command && !event.altKey && key === 'y') {
        event.preventDefault(); redoScene(); return;
      }
      if (!command && !event.altKey && event.key === '?') {
        event.preventDefault(); setOpen(true); return;
      }
      if(event.shiftKey&&!command&&!event.altKey&&['r','p','s'].includes(key)){
        event.preventDefault();if(event.repeat)return;
        const status=recorder.getSnapshot().status;
        if(key==='r'&&(status==='idle'||status==='error'))void recorder.start();
        else if(key==='p'){if(status==='recording')recorder.pause();else if(status==='paused')recorder.resume();}
        else if(key==='s'&&(status==='recording'||status==='paused'))void recorder.stop();
        return;
      }
      const scene = useApp.getState();
      const shortcutScene = useScenes.getState().scenes.find(s => s.shortcut && s.shortcut === key);
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && shortcutScene) {
        event.preventDefault(); if (!event.repeat) useScenes.getState().switchScene(shortcutScene.id); return;
      }
      if(readOnly)return;
      const selected = scene.modules.find((m) => m.id === scene.selectedId);
      if (!selected) return;
      if (!command && !event.altKey && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        if (!event.repeat) scene.removeModule(selected.id);
      } else if (!command && !event.altKey && event.key.startsWith('Arrow')) {
        const step = event.shiftKey ? 10 : 1;
        const offset = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (offset) { event.preventDefault(); scene.updateModule(selected.id, { x: selected.x + offset[0], y: selected.y + offset[1] }); }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [mac, open, readOnly]);
  return (
    <>
      <button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={()=>setOpen(true)} className={compact?"shortcut-help-button":"px-5 py-3 text-xs text-ink-400 hover:text-ink-100 text-left"}>{compact?<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M7 15h10"/></svg>:"Keyboard shortcuts"}</button>
      {open && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center" onClick={() => setOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="bg-ink-900 border border-white/10 rounded-xl p-6 w-96 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between mb-4"><h2 className="text-base">Keyboard shortcuts</h2><button type="button" autoFocus aria-label="Close shortcuts" onClick={() => setOpen(false)}>×</button></div>
            <p className="text-xs text-ink-400 mb-4">{mac ? 'Mac' : /Win/.test(navigator.platform) ? 'Windows' : 'Linux'} · Scene editing</p>
            <dl className="text-sm space-y-3">
              {[['Record','Shift + R'],['Pause / resume','Shift + P'],['Stop and save','Shift + S'],['Save project', mod + ' + S'], ['Undo', mod + ' + Z'], ['Redo', mod + ' + Shift + Z' + (mac ? '' : ' / Ctrl + Y')], ['Delete layer', mac ? 'Delete (⌫)' : 'Delete / Backspace'], ['Move layer', 'Arrow keys'], ['Move by 10', 'Shift + Arrow'], ['Deselect / close', 'Esc'], ['Show shortcuts', '?']].map(([label, keys]) => <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="text-ink-400 text-right">{keys}</dd></div>)}
            {scenes.filter(s => s.shortcut).map(s => <div key={s.id} className="flex justify-between gap-4"><dt>{s.name}</dt><dd className="text-ink-400">{s.shortcut.toUpperCase()}</dd></div>)}
            </dl>
          </section>
        </div>
      )}
    </>
  );
}


