import { useDialogKeyboard } from './useDialogKeyboard';
import { useEffect, useRef, useState } from 'react';
import { getCameraTrack } from '../modules/cameraTrackRegistry';
import { useApp, type ModuleInstance } from '../state/store';
export function CameraCropEditor({ module, onClose }: { module: ModuleInstance; onClose: () => void }) {
  useDialogKeyboard(true,'Crop camera',onClose);
  const video = useRef<HTMLVideoElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [crop, setCrop] = useState((module.options.cameraCrop as { top: number; right: number; bottom: number; left: number }) ?? { top: 0, right: 0, bottom: 0, left: 0 });
  const [aspect, setAspect] = useState(16 / 9);
  useEffect(() => {
    const track = getCameraTrack(module.id);
    if (track && video.current) {
      video.current.srcObject = new MediaStream([track]);
      void video.current.play().catch(() => {});
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); if (video.current) video.current.srcObject = null; };
  }, [module.id, onClose]);
  const point = (e: React.PointerEvent) => {
    const rect = area.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) };
  };
  return <div className="fixed inset-0 z-[9998] bg-black/75 flex items-center justify-center p-8" onPointerDown={(e) => e.stopPropagation()}>
    <section role="dialog" aria-modal="true" aria-label="Crop camera" className="w-full max-w-3xl bg-ink-900 rounded-xl border border-white/10 p-5">
      <div className="flex justify-between mb-3"><h2>Crop camera</h2><button aria-label="Close crop" onClick={onClose}>×</button></div>
      <p className="text-xs text-ink-400 mb-3">Drag to select what stays in the frame.</p>
      <div ref={area} className="relative overflow-hidden bg-black cursor-crosshair" style={{ aspectRatio: aspect, touchAction: 'none' }}
        onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = point(e); }}
        onPointerMove={(e) => { if (!drag.current) return; const p = point(e), a = drag.current; const left = Math.min(a.x, p.x), top = Math.min(a.y, p.y); if (Math.abs(p.x-a.x) < .03 || Math.abs(p.y-a.y) < .03) return; setCrop({ left, top, right: 1-Math.max(a.x,p.x), bottom: 1-Math.max(a.y,p.y) }); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        <video ref={video} muted playsInline autoPlay className="w-full h-full pointer-events-none" style={{ objectFit: 'contain', transform: module.options.mirror ? 'scaleX(-1)' : undefined }} onLoadedMetadata={() => { if(video.current?.videoWidth) setAspect(video.current.videoWidth/video.current.videoHeight); }} />
        {!getCameraTrack(module.id) && <div className="absolute inset-0 flex items-center justify-center text-ink-400 text-sm">Select a camera to preview</div>}
        <div className="absolute border-2 border-accent pointer-events-none" style={{ left: crop.left*100+'%', top: crop.top*100+'%', right: crop.right*100+'%', bottom: crop.bottom*100+'%', boxShadow: '0 0 0 2000px rgba(0,0,0,.5)' }} />
      </div>
      <div className="flex justify-between mt-4"><button onClick={() => setCrop({ top:0,right:0,bottom:0,left:0 })} className="text-xs text-ink-300">Reset</button><div className="flex gap-4"><button onClick={onClose} className="text-xs">Cancel</button><button className="px-4 py-2 rounded bg-accent text-xs" onClick={() => { const settings=getCameraTrack(module.id)?.getSettings(); const ratio=(settings?.width ?? 16)/(settings?.height ?? 9); useApp.getState().updateModule(module.id,{ height: module.width*(1-crop.top-crop.bottom)/(ratio*(1-crop.left-crop.right)), options:{...module.options,cameraCrop:crop} }); onClose(); }}>Apply crop</button></div></div>
    </section>
  </div>;
}

