import { useEffect, useRef, useState } from 'react';
import { changeEdit, closeVideoEdit, createVideoEdit, deleteCurrentEdit, editError, importVideoFiles, openVideoEdit, refreshEdits, saveVideoEdit, useVideoEdits } from '../editing/store';
import { cropPixels, dominantSegment, editDuration, formatTime, newClip, timedCues, type Crop, type EditClip, type EditDraft, type ScoreSystem } from '../editing/model';
import { canvasBlob, cropScore, downloadBlob } from '../editing/media';
import { availableExportFormats, exportVideoEdit, TimelineRenderer } from '../editing/render';
import { preparePDF, receivePDFSource, renderPDFPage } from '../annotation/pdfSource';
import { useDialogKeyboard } from './useDialogKeyboard';
import '../editing/editor.css';

export function VideoEditor() {
  const state = useVideoEdits();
  useEffect(() => { void refreshEdits(); }, []);
  useEffect(() => { if (state.open && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }, [state.open]);
  return state.open && state.draft ? <Workspace key={state.draft.id} draft={state.draft} /> : null;
}

function Workspace({ draft }: { draft: EditDraft }) {
  const { review, busy, error, saveStatus, library } = useVideoEdits();
  const canvas = useRef<HTMLCanvasElement>(null), player = useRef<TimelineRenderer>();
  const timeRef = useRef(0), cancel = useRef<AbortController>();
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [ready, setReady] = useState(false);
  const [systemIndex, setSystemIndex] = useState(0), [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0);
  const [camera, setCamera] = useState(false), [format, setFormat] = useState(() => availableExportFormats()[0]?.ext || 'webm');
  const [resolution, setResolution] = useState<720 | 1080>(720), [finished, setFinished] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const duration = editDuration(draft.clips), formats = availableExportFormats();
  const close = () => { if (!exporting && !busy) void closeVideoEdit(); };
  useDialogKeyboard(true, 'Video editor', close);

  useEffect(() => {
    let disposed = false; setReady(false); setPlaying(false);
    if (!draft.clips.length || !canvas.current) { canvas.current?.getContext('2d')?.clearRect(0, 0, 1280, 720); return; }
    void TimelineRenderer.create(draft, canvas.current, {
      onTime: value => { if (!disposed) { timeRef.current = value; setTime(value); } },
      onEnd: () => { if (!disposed) setPlaying(false); },
      onError: value => { if (!disposed) { setPlaying(false); editError(value); } },
    }).then(async renderer => {
      if (disposed) { renderer.dispose(); return; }
      player.current = renderer;
      const current = useVideoEdits.getState().draft!; renderer.updateScore(current.cues, current.scoreLayout, current.scoreHeight);
      await renderer.seek(Math.min(timeRef.current, renderer.duration)); if (!disposed) setReady(true);
    }).catch(value => { if (!disposed) editError(value); });
    return () => { disposed = true; player.current?.dispose(); player.current = undefined; };
  }, [draft.assets, draft.clips, draft.systems]);
  useEffect(() => { player.current?.updateScore(draft.cues, draft.scoreLayout, draft.scoreHeight); }, [draft.cues, draft.scoreLayout, draft.scoreHeight]);
  useEffect(() => () => cancel.current?.abort(), []);

  const seek = async (value: number) => {
    if (!player.current || exporting) return;
    setPlaying(false); try { await player.current.seek(value); } catch (value) { editError(value); }
  };
  const play = async () => {
    if (!player.current || exporting) return;
    try {
      if (player.current.isPlaying) { player.current.pause(); setPlaying(false); }
      else { await player.current.play(); setPlaying(true); }
    } catch (value) { editError(value); }
  };
  const tap = () => {
    const system = draft.systems[systemIndex], segment = dominantSegment(draft.clips, player.current?.currentTime ?? timeRef.current);
    if (!system || !segment || exporting) return;
    const cue = { id: crypto.randomUUID(), clipId: segment.clip.id, sourceTime: segment.sourceTime, systemId: system.id };
    const cues = draft.cues.filter(old => old.clipId !== cue.clipId || Math.abs(old.sourceTime - cue.sourceTime) > 0.05);
    changeEdit({ cues: [...cues, cue] }); setSystemIndex(Math.min(draft.systems.length - 1, systemIndex + 1));
  };
  const patchClip = (id: string, patch: Partial<EditClip>) => {
    void player.current?.pause(); setPlaying(false);
    changeEdit({ clips: draft.clips.map(clip => clip.id === id ? { ...clip, ...patch } : clip) });
  };
  const takeFrame = async () => {
    if (!canvas.current || !ready) return;
    try { changeEdit({ thumbnail: await canvasBlob(canvas.current), thumbnailChoice: 'frame' }); } catch (value) { editError(value); }
  };
  const downloadThumbnail = () => { if (draft.thumbnail) downloadBlob(draft.thumbnail, `${draft.title || 'pianocanva'}-thumbnail.jpg`); };
  const exportEdit = async () => {
    player.current?.pause(); setPlaying(false); setExporting(true); setFinished(false); setProgress(0);
    useVideoEdits.setState({ error: '' }); cancel.current = new AbortController();
    try {
      try { await saveVideoEdit(); } catch { /* Export remains available when local storage is full. */ }
      const result = await exportVideoEdit(draft, { resolution, format, signal: cancel.current.signal, onProgress: setProgress });
      downloadBlob(result.blob, `${draft.title || 'pianocanva'}-edited.${result.extension}`); downloadThumbnail(); setFinished(true);
    } catch (value) { if (!(value instanceof DOMException && value.name === 'AbortError')) editError(value); }
    finally { setExporting(false); }
  };
  const original = draft.assets[0];

  return <div className="video-editor-backdrop">
    <section role="dialog" aria-modal="true" aria-label="Video editor" className="video-editor" onKeyDown={event => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); void play(); }
      if (event.code === 'KeyT') { event.preventDefault(); tap(); }
    }}>
      <header className="video-editor-header"><div><h1>{review ? 'Your take is ready' : 'Edit video'}</h1><p>Trim, blend clips, and synchronize a cropped score with your performance.</p></div><button type="button" disabled={exporting || busy} onClick={close} aria-label="Close video editor">Keep for later ×</button></header>
      {error && <p role="alert" className="video-edit-error">{error}<button onClick={() => useVideoEdits.setState({ error: '' })} aria-label="Dismiss editing error">×</button></p>}
      <div className="video-editor-body">
        <div className="video-editor-main">
          <canvas ref={canvas} width={1280} height={720} className="video-edit-preview" aria-label="Edited video preview" tabIndex={0} />
          <div className="video-edit-transport"><button disabled={!ready || exporting} onClick={() => void play()}>{playing ? 'Pause preview' : 'Play preview'}</button><input aria-label="Video playhead" type="range" min="0" max={Math.max(duration, 0.01)} step="0.01" value={Math.min(time, duration)} disabled={!ready || exporting} onChange={event => void seek(Number(event.target.value))} /><output>{formatTime(time)} / {formatTime(duration)}</output></div>
          {review && <div className="video-edit-review"><h2>Edit before saving?</h2><p>This take is retained in your local video library. Choose a thumbnail below, then download the original or edit it first.</p><button className="edit-primary" onClick={() => useVideoEdits.setState({ review: false })}>Edit video and add score</button><button disabled={draft.thumbnailChoice === null || !original} onClick={() => { downloadBlob(original.blob, original.name); downloadThumbnail(); setFinished(true); }}>Download original</button></div>}
          {!review && <fieldset disabled={exporting || busy} className="video-edit-section">
            <div className="video-edit-row"><h2>Clips</h2><label className="edit-file">Import videos<input aria-label="Import videos" type="file" accept="video/*,.webm,.mp4,.mov" multiple onChange={event => { if (event.target.files) void importVideoFiles(event.target.files); event.target.value = ''; }} /></label>{busy && <span role="status">Loading…</span>}</div>
            {!draft.clips.length && <p>Import a recording from this device. The original files stay unchanged.</p>}
            <ol className="video-clip-list">{draft.clips.map((clip, index) => {
              const asset = draft.assets.find(asset => asset.id === clip.assetId)!;
              return <li key={clip.id}><strong>{index + 1}. {asset.name}</strong><div className="video-edit-row">
                <label>In (seconds)<input aria-label={`Clip ${index + 1} in`} type="number" min="0" max={clip.out - 0.1} step="0.01" value={Number(clip.in.toFixed(3))} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) patchClip(clip.id, { in: Math.max(0, Math.min(clip.out - 0.1, n)) }); }} /></label>
                <label>Out (seconds)<input aria-label={`Clip ${index + 1} out`} type="number" min={clip.in + 0.1} max={asset.duration} step="0.01" value={Number(clip.out.toFixed(3))} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) patchClip(clip.id, { out: Math.max(clip.in + 0.1, Math.min(asset.duration, n)) }); }} /></label>
                <button disabled={index === 0} aria-label={`Move clip ${index + 1} earlier`} onClick={() => { const clips = [...draft.clips]; [clips[index - 1], clips[index]] = [clips[index], clips[index - 1]]; changeEdit({ clips }); }}>↑</button>
                <button disabled={index === draft.clips.length - 1} aria-label={`Move clip ${index + 1} later`} onClick={() => { const clips = [...draft.clips]; [clips[index + 1], clips[index]] = [clips[index], clips[index + 1]]; changeEdit({ clips }); }}>↓</button>
                <button onClick={() => { const copy = { ...clip, id: crypto.randomUUID() }, clips = [...draft.clips]; clips.splice(index + 1, 0, copy); changeEdit({ clips, cues: [...draft.cues, ...draft.cues.filter(c => c.clipId === clip.id).map(c => ({ ...c, id: crypto.randomUUID(), clipId: copy.id }))] }); }}>Duplicate segment</button>
                <button onClick={() => changeEdit({ clips: draft.clips.filter(c => c.id !== clip.id), cues: draft.cues.filter(c => c.clipId !== clip.id) })}>Remove</button>
              </div>{index < draft.clips.length - 1 && <div className="video-edit-row"><label>Transition to next clip<select aria-label={`Clip ${index + 1} transition`} value={clip.transition} onChange={event => patchClip(clip.id, { transition: event.target.value as EditClip['transition'] })}><option value="cut">Cut</option><option value="crossfade">Crossfade</option><option value="fade">Fade through black</option></select></label>{clip.transition !== 'cut' && <label>Duration (seconds)<input aria-label={`Clip ${index + 1} transition duration`} type="number" min="0.1" max="3" step="0.1" value={clip.transitionSeconds} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) patchClip(clip.id, { transitionSeconds: Math.min(3, Math.max(0.1, n)) }); }} /></label>}</div>}</li>;
            })}</ol>
            {draft.assets.length > 0 && <details><summary>Reuse a source video</summary>{draft.assets.map(asset => <div className="video-edit-row" key={asset.id}><span>{asset.name}</span><button onClick={() => changeEdit({ clips: [...draft.clips, newClip(asset)] })}>Add another segment</button><button onClick={() => downloadBlob(asset.blob, asset.name)}>Download source</button></div>)}</details>}
          </fieldset>}
          <fieldset disabled={exporting || busy} className="video-edit-section"><h2>Would you like a thumbnail?</h2><p>Choose a frame from the preview, take a new picture, or skip. The thumbnail downloads as a separate JPEG.</p><div className="video-edit-row"><button disabled={!ready} onClick={() => void takeFrame()}>Use current video frame</button><button onClick={() => { player.current?.pause(); setPlaying(false); setCamera(true); }}>Take a picture</button><button aria-pressed={draft.thumbnailChoice === 'skip'} onClick={() => changeEdit({ thumbnail: null, thumbnailChoice: 'skip' })}>Skip thumbnail</button></div>{draft.thumbnail && <BlobImage blob={draft.thumbnail} label="Chosen thumbnail" className="video-edit-thumbnail" />}<p role="status">{draft.thumbnailChoice === null ? 'Choose an option before downloading.' : draft.thumbnailChoice === 'skip' ? 'No thumbnail selected.' : 'Thumbnail selected.'}</p></fieldset>
          {!review && <fieldset disabled={exporting || busy || !ready} className="video-edit-section"><h2>Export</h2><div className="video-edit-row"><label>Format<select aria-label="Export format" value={format} onChange={event => setFormat(event.target.value)}>{formats.map(f => <option key={f.ext} value={f.ext}>{f.ext.toUpperCase()}{f.mime === 'video/mp4' ? ' (browser codecs)' : f.ext === 'mp4' ? ' (H.264 / AAC)' : ''}</option>)}</select></label><label>Resolution<select aria-label="Export resolution" value={resolution} onChange={event => setResolution(Number(event.target.value) as 720 | 1080)}><option value="720">720p</option><option value="1080">1080p</option></select></label><button className="edit-primary" disabled={draft.thumbnailChoice === null || !duration || !formats.length} onClick={() => void exportEdit()}>Export and download video</button></div><p>Export renders the whole edit, including audio, transitions and timed score changes. It runs in real time; keep this tab visible. MP4 codecs depend on your browser; check the file in your intended player.</p></fieldset>}
          {exporting && <div role="status" className="video-edit-section"><progress value={progress} max={1} /> Exporting {Math.round(progress * 100)}% <button onClick={() => cancel.current?.abort()}>Cancel export</button></div>}
          {finished && <p role="status">Download started. Your original videos and local edit are retained.</p>}
        </div>
        <aside className="video-editor-tools"><fieldset disabled={exporting || busy} className="video-edit-section"><h2>Local video library</h2><label>Edit name<input aria-label="Video edit name" value={draft.title} maxLength={120} onChange={event => changeEdit({ title: event.target.value })} /></label><div className="video-edit-row"><button onClick={() => void createVideoEdit()}>New edit</button><button onClick={() => void saveVideoEdit().catch(() => {})}>Save edit</button></div><label>Open a saved edit<select aria-label="Saved video edits" value={draft.id} onChange={event => void openVideoEdit(event.target.value)}><option value={draft.id}>{draft.title || 'Current edit'}</option>{library.filter(edit => edit.id !== draft.id).map(edit => <option key={edit.id} value={edit.id}>{edit.title} · {formatTime(edit.duration)}</option>)}</select></label><p role="status">{saveStatus === 'saved' ? 'Saved in this browser on this device.' : saveStatus === 'saving' ? 'Saving…' : 'Save failed. Download your source before leaving.'}</p></fieldset>
          <fieldset disabled={exporting || busy} className="video-edit-section"><button onClick={() => setDeleteArmed(true)}>Delete local edit</button>{deleteArmed && <div><p>Delete this edit and its retained source copies? Download any recordings you want to keep first. Files already on your device are unchanged.</p><button onClick={() => void deleteCurrentEdit()}>Delete edit and local source copies</button><button onClick={() => setDeleteArmed(false)}>Cancel deletion</button></div>}</fieldset>
          {!review && <fieldset disabled={exporting || busy} className="video-edit-section"><h2>Interpreter · Score synchronization</h2><p>1. Upload a PDF and crop each grand-staff system. 2. Play your performance. 3. Tap the start of each next system, or press T while the preview is focused.</p><ScoreCropper draft={draft} pause={() => { player.current?.pause(); setPlaying(false); }} />
            <label>Score placement<select aria-label="Score placement" value={draft.scoreLayout} onChange={event => changeEdit({ scoreLayout: event.target.value as EditDraft['scoreLayout'] })}><option value="above">Fit video below score</option><option value="overlay">Cover the top of video (Interpreter)</option></select></label><label>Score strip height: {Math.round(draft.scoreHeight * 100)}%<input aria-label="Score strip height" type="range" min="0.12" max="0.45" step="0.01" value={draft.scoreHeight} onChange={event => changeEdit({ scoreHeight: Number(event.target.value) })} /></label>
            <div className="score-system-list">{draft.systems.map((system, index) => <div key={system.id} className={systemIndex === index ? 'score-system selected' : 'score-system'}><button aria-pressed={systemIndex === index} onClick={() => setSystemIndex(index)}><BlobImage blob={system.image} label={system.label} /><span>{system.label} · page {system.page}</span></button><button aria-label={`Remove ${system.label}`} onClick={() => { changeEdit({ systems: draft.systems.filter(s => s.id !== system.id), cues: draft.cues.filter(c => c.systemId !== system.id) }); setSystemIndex(Math.max(0, Math.min(systemIndex, draft.systems.length - 2))); }}>×</button></div>)}</div>
            <button className="edit-primary" disabled={!ready || !draft.systems[systemIndex]} onClick={tap}>Tap start: {draft.systems[systemIndex]?.label || 'crop a system first'}</button>
            <p>Tap while playing, or seek to an exact frame and tap. Select an earlier system again for repeats. Cues follow their source segment when you trim or move clips.</p>
            <ol className="score-cue-list">{timedCues(draft).map(cue => <li key={cue.id}><button onClick={() => void seek(cue.time)}>{formatTime(cue.time)} · {draft.systems.find(s => s.id === cue.systemId)?.label}</button><button aria-label={`Delete cue at ${formatTime(cue.time)}`} onClick={() => changeEdit({ cues: draft.cues.filter(c => c.id !== cue.id) })}>×</button></li>)}</ol>
            {draft.cues.length > timedCues(draft).length && <p>{draft.cues.length - timedCues(draft).length} cue(s) are outside the current trims and will not be exported.</p>}
          </fieldset>}
        </aside>
      </div>
      {camera && <ThumbnailCamera onClose={() => setCamera(false)} onPhoto={blob => { changeEdit({ thumbnail: blob, thumbnailChoice: 'photo' }); setCamera(false); }} />}
    </section>
  </div>;
}

function BlobImage({ blob, label, className }: { blob: Blob; label: string; className?: string }) {
  const [url, setURL] = useState('');
  useEffect(() => { const value = URL.createObjectURL(blob); setURL(value); return () => URL.revokeObjectURL(value); }, [blob]);
  return url ? <img src={url} alt={label} className={className} /> : null;
}

function ScoreCropper({ draft, pause }: { draft: EditDraft; pause: () => void }) {
  const [page, setPage] = useState(1), [image, setImage] = useState<HTMLCanvasElement>(), [crop, setCrop] = useState<Crop>();
  const [loading, setLoading] = useState(false), [label, setLabel] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null), origin = useRef<{ x: number; y: number }>();
  useEffect(() => {
    let stale = false; setImage(undefined); setCrop(undefined);
    if (!draft.pdf) return;
    setLoading(true);
    try { receivePDFSource({ kind: 'pdf-file', ...draft.pdf }); }
    catch (error) { editError(error); setLoading(false); return; }
    void renderPDFPage(draft.pdf.board, page).then(value => { if (!stale) setImage(value); }).catch(error => { if (!stale) editError(error); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [draft.pdf, page]);
  useEffect(() => {
    if (!image || !canvas.current) return;
    const target = canvas.current, ctx = target.getContext('2d')!; target.width = image.width; target.height = image.height; ctx.drawImage(image, 0, 0);
    if (crop) { const rect = cropPixels(crop, target.width, target.height); ctx.strokeStyle = '#ec4899'; ctx.lineWidth = Math.max(3, target.width / 350); ctx.strokeRect(rect.x, rect.y, rect.width, rect.height); ctx.fillStyle = 'rgba(236,72,153,.12)'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height); }
  }, [image, crop]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
  const upload = async (file: File) => {
    pause(); setLoading(true);
    try { const pdf = await preparePDF(file); changeEdit({ pdf: { board: 'edit-score-' + draft.id, id: pdf.id, name: pdf.name, data: pdf.data, count: pdf.count } }); setPage(1); }
    catch (error) { editError(error); } finally { setLoading(false); }
  };
  return <div className="score-cropper"><label className="edit-file">Upload score PDF<input aria-label="Upload score PDF" type="file" accept="application/pdf,.pdf" disabled={loading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>{loading && <p role="status">Loading score…</p>}
    {draft.pdf && <><label>PDF page<input aria-label="Score PDF page" type="number" min="1" max={draft.pdf.count} value={page} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) setPage(Math.min(draft.pdf!.count, Math.max(1, Math.round(n)))); }} /> of {draft.pdf.count}</label><p>Drag around both staves of one system, including the clefs and everything you want shown.</p>
      {image && <canvas ref={canvas} aria-label="Crop grand staff from PDF" className="score-crop-canvas" style={{width:`min(100%, ${55 * image.width / image.height}vh)`}} onPointerDown={event => { event.preventDefault(); pause(); event.currentTarget.setPointerCapture(event.pointerId); origin.current = point(event); setCrop(undefined); }} onPointerMove={event => { if (!origin.current) return; const p = point(event), start = origin.current; setCrop({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) }); }} onPointerUp={() => { origin.current = undefined; }} onPointerCancel={() => { origin.current = undefined; }} />}
      {!crop && image && <button onClick={() => setCrop({x:0,y:0,width:1,height:0.2})}>Enter crop coordinates</button>}
      {crop && <div className="score-crop-numbers">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key} (%)<input aria-label={`Crop ${key} percent`} type="number" min="0" max="100" step="0.1" value={Number((crop[key] * 100).toFixed(1))} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) setCrop({ ...crop, [key]: Math.max(0, Math.min(1, n / 100)) }); }} /></label>)}</div>}
      <label>System name<input aria-label="Score system name" value={label} maxLength={60} placeholder={`System ${draft.systems.length + 1}`} onChange={event => setLabel(event.target.value)} /></label><button disabled={!crop || !image || loading} onClick={async () => { if (!image || !crop) return; try { const system = await cropScore(image, crop, page, label.trim() || `System ${draft.systems.length + 1}`); changeEdit({ systems: [...draft.systems, system] }); setCrop(undefined); setLabel(''); } catch (error) { editError(error); } }}>Add cropped system</button>
    </>}
  </div>;
}

function ThumbnailCamera({ onClose, onPhoto }: { onClose: () => void; onPhoto: (blob: Blob) => void }) {
  const video = useRef<HTMLVideoElement>(null), [ready, setReady] = useState(false), [error, setError] = useState('');
  useDialogKeyboard(true, 'Thumbnail picture', onClose);
  useEffect(() => {
    let cancelled = false, stream: MediaStream | undefined;
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera capture is unavailable here. Choose a video frame instead.'); return; }
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(value => { if (cancelled) { value.getTracks().forEach(t => t.stop()); return; } stream = value; if (video.current) video.current.srcObject = value; }).catch(value => setError(value instanceof Error ? value.message : 'Camera unavailable.'));
    return () => { cancelled = true; stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  return <div className="video-editor-backdrop"><section role="dialog" aria-modal="true" aria-label="Thumbnail picture" className="thumbnail-camera"><h2>Take a thumbnail picture</h2>{error && <p role="alert">{error}</p>}<video ref={video} autoPlay playsInline muted onLoadedData={() => setReady(true)} /><div className="video-edit-row"><button disabled={!ready} onClick={async () => { const source = video.current!; const canvas = document.createElement('canvas'); canvas.width = source.videoWidth; canvas.height = source.videoHeight; canvas.getContext('2d')!.drawImage(source, 0, 0); try { onPhoto(await canvasBlob(canvas)); } catch (value) { setError(value instanceof Error ? value.message : 'Could not take picture.'); } }}>Take picture</button><button onClick={onClose}>Cancel</button></div></section></div>;
}
