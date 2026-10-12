import { useEffect, useState } from 'react';
import { SCENE_PRESETS } from '../state/scenePresets';
import { useApp } from '../state/store';
import { undoScene, redoScene } from '../state/history';

export function KeyboardShortcuts() {
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
      if (command && !event.altKey && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoScene(); else undoScene();
        return;
      }
      if (!mac && command && !event.altKey && key === 'y') {
        event.preventDefault(); redoScene(); return;
      }
      if (!command && !event.altKey && event.key === '?') {
        event.preventDefault(); setOpen(true); return;
      }
      const scene = useApp.getState();
      if (!command && !event.altKey && !event.shiftKey && /^[1-4]$/.test(event.key)) {
        event.preventDefault(); if (!event.repeat) scene.applyPreset(SCENE_PRESETS[Number(event.key)-1].build(scene.canvasWidth, scene.canvasHeight)); return;
      }
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
  }, [mac, open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="px-5 py-3 text-xs text-ink-400 hover:text-ink-100 text-left">Keyboard shortcuts</button>
      {open && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center" onClick={() => setOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="bg-ink-900 border border-white/10 rounded-xl p-6 w-96 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between mb-4"><h2 className="text-base">Keyboard shortcuts</h2><button type="button" autoFocus aria-label="Close shortcuts" onClick={() => setOpen(false)}>×</button></div>
            <p className="text-xs text-ink-400 mb-4">{mac ? 'Mac' : /Win/.test(navigator.platform) ? 'Windows' : 'Linux'} · Scene editing</p>
            <dl className="text-sm space-y-3">
              {[['Undo', mod + ' + Z'], ['Redo', mod + ' + Shift + Z' + (mac ? '' : ' / Ctrl + Y')], ['Delete layer', mac ? 'Delete (⌫)' : 'Delete / Backspace'], ['Move layer', 'Arrow keys'], ['Move by 10', 'Shift + Arrow'], ['Deselect / close', 'Esc'], ['Preset 1 / Preset 2', '1 / 2'], ['Headshot / Overhead', '3 / 4'], ['Show shortcuts', '?']].map(([label, keys]) => <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="text-ink-400 text-right">{keys}</dd></div>)}
            </dl>
          </section>
        </div>
      )}
    </>
  );
}
