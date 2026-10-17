import { ChevronLeft, ChevronRight, Move, X, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { preparePDF, receivePDFSource, renderPDFPage } from '../annotation/pdfSource';
import { cropPixels, placeCrop, scoreCropGroups, scoreSteps, type Crop, type EditDraft, type ScoreSystem } from '../editing/model';
import { removeMarksFrom } from '../editing/operations';
import { cropScore } from '../editing/media';
import { changeEdit, editError, useVideoEdits } from '../editing/store';
import { adjustCrop } from '../editing/cropGeometry';
import { MusicRepeatIcon } from './MusicRepeatIcon';
import { scoreSpace } from '../editing/composition';

export function ScoreCropper({ draft, pause, onBusy }: { draft: EditDraft; pause: () => void; onBusy: (value: boolean) => void }) {
  const template = draft.cropTemplate || draft.systems[0]?.crop;
  const [page, setPage] = useState(1), [image, setImage] = useState<HTMLCanvasElement>(), [crop, setCrop] = useState<Crop>();
  const [loading, setLoading] = useState(false), [manual, setManual] = useState(!template), [editingId, setEditingId] = useState<string>();
  const [freeCrop, setFreeCrop] = useState(false), [repeatHelp, setRepeatHelp] = useState(false);
  const cropRef = useRef<Crop>();
  const adjust = useRef<{ id: string; crop: Crop; x: number; y: number; handle: string }>();
  const selectCrop = (value?: Crop) => { cropRef.current = value; setCrop(value); };
  const [saving, setSaving] = useState(false), pending = useRef(false);
  useEffect(() => { onBusy(loading || saving); return () => onBusy(false); }, [loading, saving, onBusy]);
  const canvas = useRef<HTMLCanvasElement>(null), input = useRef<HTMLInputElement>(null);
  const origin = useRef<{ x: number; y: number }>(), sheet = useRef<HTMLDivElement>(null);
  const sequence = scoreSteps(draft);
  const pageGroups = scoreCropGroups(draft, page, draft.pdf?.id);
  const valid = !!crop && !!image && crop.width * image.width >= 8 && crop.height * image.height >= 8;
  useEffect(() => { const cancel = () => { origin.current = undefined; adjust.current = undefined; cropRef.current = undefined; setCrop(undefined); setEditingId(undefined); setRepeatHelp(false); setManual(!useVideoEdits.getState().draft?.cropTemplate); }; window.addEventListener('pianocanva-cancel-score-crop', cancel); return () => window.removeEventListener('pianocanva-cancel-score-crop', cancel); }, []);
  const reset = () => { selectCrop(undefined); setEditingId(undefined); setManual(!template); origin.current = undefined; };

  useEffect(() => {
    let stale = false; setImage(undefined); selectCrop(undefined);
    if (!draft.pdf) return;
    setLoading(true);
    try { if (!receivePDFSource({ kind: 'pdf-file', ...draft.pdf })) throw new Error('Upload the PDF again.'); }
    catch (error) { editError(error); setLoading(false); return; }
    void renderPDFPage(draft.pdf.board, Math.min(page, draft.pdf.count)).then(value => { if (!stale) setImage(value); }).catch(error => { if (!stale) editError(error); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [draft.pdf, page]);
  useEffect(() => {
    if (!image || !canvas.current) return;
    const target = canvas.current, ctx = target.getContext('2d')!;
    target.width = image.width; target.height = image.height; ctx.drawImage(image, 0, 0);
    if (crop) {
      const rect = cropPixels(crop, target.width, target.height);
      ctx.fillStyle = 'rgba(15,18,26,.35)';
      ctx.fillRect(0, 0, target.width, rect.y); ctx.fillRect(0, rect.y + rect.height, target.width, target.height - rect.y - rect.height);
      ctx.fillRect(0, rect.y, rect.x, rect.height); ctx.fillRect(rect.x + rect.width, rect.y, target.width - rect.x - rect.width, rect.height);
      ctx.strokeStyle = getComputedStyle(target).getPropertyValue('--studio-blue').trim() || '#7c5cff'; ctx.lineWidth = Math.max(3, target.width / 350); ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }, [image, crop]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const add = async (selection: Crop, targetId = editingId) => {
    if (!image || pending.current || loading || selection.width * image.width < 30 || selection.height * image.height < 15) return;
    pending.current = true; setSaving(true); pause();
    const pdfId = draft.pdf?.id;
    try {
      const current = useVideoEdits.getState().draft!;
      const bounded = { ...selection, width: Math.min(selection.width, 1 - selection.x), height: Math.min(selection.height, 1 - selection.y) };
      const previous = current.systems.find(system => system.id === targetId);
      const editedIds = scoreCropGroups(current, page, pdfId).find(group => group.ids.includes(targetId || ''))?.ids || [];
      const system = { ...await cropScore(image, bounded, page, previous?.label || `System ${current.systems.length + 1}`), pdfId, ...(previous ? { id: previous.id } : {}) };
      const latest = useVideoEdits.getState().draft;
      if (latest?.id !== draft.id || latest.pdf?.id !== pdfId) return;
      changeEdit({
        systems: previous ? latest.systems.map(old => editedIds.includes(old.id) ? { ...system, id: old.id, label: old.label } : old) : [...latest.systems, system],
        scoreSequence: previous ? scoreSteps(latest) : [...scoreSteps(latest), { id: crypto.randomUUID(), systemId: system.id }],
        // Every completed custom crop or adjustment becomes the reusable frame.
        cropTemplate: bounded,
      });
      setManual(false); selectCrop(undefined); setEditingId(undefined);
    } catch (error) { editError(error); }
    finally { pending.current = false; setSaving(false); }
  };
  const repeat = (system: ScoreSystem) => {
    if (saving || loading || manual) return;
    pause(); const current = useVideoEdits.getState().draft!;
    changeEdit({ scoreSequence: [...scoreSteps(current), { id: crypto.randomUUID(), systemId: system.id }] });
    selectCrop(undefined);
  };
  const remove = (system: ScoreSystem) => {
    pause(); const current = useVideoEdits.getState().draft!;
    const ids = scoreCropGroups(current, page, draft.pdf?.id).find(group => group.ids.includes(system.id))?.ids || [system.id];
    changeEdit({ systems: current.systems.filter(old => !ids.includes(old.id)), scoreSequence: scoreSteps(current).filter(step => !ids.includes(step.systemId)), cues: removeMarksFrom(current, scoreSteps(current).findIndex(step => ids.includes(step.systemId))), cropTemplate: template });
    reset();
  };
  const undo = () => {
    pause(); const current = useVideoEdits.getState().draft!, steps = scoreSteps(current), last = steps.at(-1);
    if (!last) return;
    changeEdit({ scoreSequence: steps.slice(0, -1), cues: current.cues.filter(cue => cue.stepId !== last.id && !(!cue.stepId && last.id === last.systemId && cue.systemId === last.systemId)) });
    reset();
  };
  const upload = async (file: File) => {
    pause(); setLoading(true);
    try {
      const pdf = await preparePDF(file);
      setPage(1); reset();
      changeEdit({ pdf: { board: 'edit-score-' + draft.id, id: pdf.id, name: pdf.name, data: pdf.data, count: pdf.count }, systems: draft.systems.map(system => ({ ...system, pdfId: system.pdfId || draft.pdf?.id })) });
    } catch (error) { editError(error); } finally { setLoading(false); }
  };
  return <div className={`score-cropper${!draft.pdf ? ' crop-empty' : ''}`}>
    <div className="score-crop-toolbar"><div><h2>{draft.pdf?.name || 'Add your score'}</h2><p>{!draft.pdf ? 'Upload a PDF to begin.' : editingId ? 'Drag to adjust.' : manual ? 'Drag around a complete system. Release to save.' : 'Click the next system. Click it again for a repeat.'}</p></div><button className="edit-import" disabled={loading || saving} onClick={() => input.current?.click()}><Upload size={15} />{draft.pdf ? 'Change PDF' : 'Import PDF'}</button><input hidden ref={input} aria-label="Upload score PDF" type="file" accept="application/pdf,.pdf" onChange={event => { if (event.target.files?.[0]) void upload(event.target.files[0]); event.target.value = ''; }} /></div>
    {draft.pdf && <>
      <div className="score-page-bar"><button disabled={page <= 1 || loading || saving} aria-label="Previous score page" onClick={() => { reset(); setPage(page - 1); }}><ChevronLeft size={16} /></button><label>Page <input aria-label="Score PDF page" type="number" min="1" max={draft.pdf.count} value={page} disabled={loading || saving} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) { reset(); setPage(Math.min(draft.pdf!.count, Math.max(1, Math.round(n)))); } }} /> / {draft.pdf.count}</label><button disabled={page >= draft.pdf.count || loading || saving} aria-label="Next score page" onClick={() => { reset(); setPage(page + 1); }}><ChevronRight size={16} /></button></div>
      <div className="score-page-stage">{loading && <p role="status">Loading score…</p>}{image && <div ref={sheet} className={`score-page-sheet${manual ? ' is-selecting' : ''}`} style={{ width: `min(100%, ${68 * image.width / image.height}vh)` }}>
        <canvas ref={canvas} aria-label="Crop grand staff from PDF" className="score-crop-canvas" onPointerDown={event => {
          if (saving || loading) return;
          event.preventDefault(); pause(); event.currentTarget.setPointerCapture(event.pointerId);
          const p = point(event); origin.current = p;
          if (!manual && template) selectCrop(placeCrop(template, p.x, p.y)); else selectCrop(undefined);
        }} onPointerMove={event => {
          if (saving || loading) return;
          const p = point(event), start = origin.current;
          if (!manual && template) selectCrop(placeCrop(template, p.x, p.y));
          else if (start) {
            // The initial frame follows the score space chosen in step 1; custom crops remain free.
            const width = Math.abs(p.x - start.x);
            const guided = !template && !freeCrop && draft.scoreSizing !== 'per-crop' && image;
            const height = guided ? Math.min(width * image.width / image.height * 9 * scoreSpace(draft) / 16, p.y < start.y ? start.y : 1 - start.y) : Math.abs(p.y - start.y);
            selectCrop({ x: Math.min(start.x, p.x), y: p.y < start.y ? start.y - height : start.y, width, height });
          }
        }} onPointerUp={event => {
          if (!origin.current) return;
          if (!manual && template && event.currentTarget.hasPointerCapture(event.pointerId)) { const p = point(event); void add(placeCrop(template, p.x, p.y)); } else if (cropRef.current) void add(cropRef.current);
          origin.current = undefined;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={() => { origin.current = undefined; }} onPointerLeave={() => { if (!manual && !origin.current) selectCrop(undefined); }} />
        {pageGroups.map(({ system, numbers: positions }) => {
          const bounds = editingId === system.id && crop ? crop : system.crop;
          const startAdjust = (handle: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
            if (saving || loading) return; event.preventDefault(); event.stopPropagation(); pause();
            const p = point(event as unknown as React.PointerEvent<HTMLCanvasElement>);
            adjust.current = { id: system.id, crop: system.crop, ...p, handle }; setEditingId(system.id); selectCrop(system.crop); event.currentTarget.setPointerCapture(event.pointerId);
          };
          const moveAdjust = (event: React.PointerEvent<HTMLButtonElement>) => { const d = adjust.current; if (!d) return; const p = point(event as unknown as React.PointerEvent<HTMLCanvasElement>); selectCrop(adjustCrop(d.crop, d.handle, p.x - d.x, p.y - d.y)); };
          const finishAdjust = () => { const d = adjust.current; adjust.current = undefined; if (d && cropRef.current) void add(cropRef.current, d.id); };
          return <div key={system.id} className="score-crop-outline" data-system-id={system.id} style={{ left: `${bounds.x * 100}%`, top: `${bounds.y * 100}%`, width: `${bounds.width * 100}%`, height: `${bounds.height * 100}%` }}>
            <button className="score-crop-repeat" disabled={manual || saving || loading} aria-label={`Repeat ${system.label}`} title="Click to repeat" onClick={() => repeat(system)}><span className="score-crop-number">{positions.join(', ') || '+'}</span></button>
            <div className="score-crop-options"><button disabled={saving || loading} aria-label={`Move ${system.label}`} title="Drag to move crop" onPointerDown={startAdjust('move')} onPointerMove={moveAdjust} onPointerUp={finishAdjust} onPointerCancel={reset}><Move size={14} /></button><button disabled={saving || loading} aria-label={`Remove ${system.label}`} title="Remove crop" onClick={() => remove(system)}><X size={14} /></button></div>
            {['nw','n','ne','e','se','s','sw','w'].map(handle => <button key={handle} className={`crop-resize crop-resize-${handle}`} aria-label={`Resize ${system.label} ${handle}`} disabled={saving || loading} onPointerDown={startAdjust(handle)} onPointerMove={moveAdjust} onPointerUp={finishAdjust} onPointerCancel={reset} />)}
          </div>;
        })}
      </div>}</div>
    </>}
    <div className="score-crop-actions">
      {draft.pdf && <><button disabled={loading || saving} aria-pressed={manual} onClick={() => { selectCrop(undefined); setEditingId(undefined); setManual(!manual); }}>{manual ? 'Place crop' : 'Custom crop'}</button>{manual && !template && draft.scoreSizing !== 'per-crop' && <button aria-pressed={freeCrop} onClick={() => setFreeCrop(!freeCrop)}>Free crop</button>}<button disabled={!sequence.length || saving || loading} onClick={undo}>Undo order</button><button className="score-repeat-help" aria-label="Repeats and segno" aria-expanded={repeatHelp} onClick={() => setRepeatHelp(!repeatHelp)}><MusicRepeatIcon /></button>{repeatHelp && <p role="status">Click a crop again in playing order: 1 → 2 → 1 shows “1, 3”. For a segno return, click that crop again.</p>}</>}

    </div>
  </div>;
}
