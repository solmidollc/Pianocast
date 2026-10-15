import { useEffect, useRef, useState, type ReactNode } from 'react';
import { changeEdit, closeVideoEdit, createVideoEdit, deleteCurrentEdit, editError, importVideoFiles, openVideoEdit, refreshEdits, saveVideoEdit, useVideoEdits } from '../editing/store';
import { cropPixels, dominantSegment, editDuration, formatTime, parseTime, placeCrop, newClip, timedCues, type Crop, type EditClip, type EditDraft, type ScoreCue } from '../editing/model';
import { scoreSize, videoTransform } from '../editing/composition';
import { canvasBlob, cropScore, downloadBlob } from '../editing/media';
import { availableExportFormats, exportVideoEdit, TimelineRenderer } from '../editing/render';
import type { ExportFormat } from '../editing/export';
import { preparePDF, receivePDFSource, renderPDFPage } from '../annotation/pdfSource';
import { useDialogKeyboard } from './useDialogKeyboard';
import '../editing/editor.css';

type Mode = 'edit' | 'score' | 'export';
export function VideoEditor() {
  const state = useVideoEdits();
  useEffect(() => { void refreshEdits(); }, []);
  useEffect(() => { if (state.open && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }, [state.open]);
  return state.open && state.draft ? <Workspace key={state.draft.id} draft={state.draft} /> : null;
}

function Workspace({ draft }: { draft: EditDraft }) {
  const { review, busy, error, saveStatus, library } = useVideoEdits();
  const canvas = useRef<HTMLCanvasElement>(null), player = useRef<TimelineRenderer>();
  const videoDrag = useRef<{ y: number; offsetY: number; height: number }>();
  const timeRef = useRef(0), cancel = useRef<AbortController>();
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [ready, setReady] = useState(false);
  const [systemIndex, setSystemIndex] = useState(() => {
    const marked = new Set(timedCues(draft).map(cue => cue.systemId));
    const next = draft.systems.findIndex(system => !marked.has(system.id));
    return next < 0 ? draft.systems.length : next;
  }), [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0);
  const nextSystem = useRef(systemIndex);
  const [undoMarks, setUndoMarks] = useState<{ id: string; index: number; replaced: ScoreCue[] }[]>([]);
  const [markStatus, setMarkStatus] = useState('');
  const [drawer, setDrawer] = useState<'library' | 'timings' | null>(null);
  const [camera, setCamera] = useState(false), [format, setFormat] = useState('mp4'), [formats, setFormats] = useState<ExportFormat[]>([]);
  const [formatsReady, setFormatsReady] = useState(false), [resolution, setResolution] = useState<720 | 1080>(720), [finished, setFinished] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false), [mode, setMode] = useState<Mode>('edit');
  const [scoreStep, setScoreStep] = useState<'crop' | 'timing'>(draft.systems.length ? 'timing' : 'crop');
  const duration = editDuration(draft.clips), cues = timedCues(draft), cropping = mode === 'score' && scoreStep === 'crop';
  const timing = mode === 'score' && scoreStep === 'timing';
  const timingRef = useRef(timing); timingRef.current = timing;
  const selectSystem = (index: number) => { nextSystem.current = index; setSystemIndex(index); };
  useEffect(() => { if (nextSystem.current > draft.systems.length) selectSystem(draft.systems.length); }, [draft.systems.length]);
  const close = () => { if (!exporting && !busy) void closeVideoEdit(); };
  useDialogKeyboard(true, 'Video editor', close);

  useEffect(() => {
    let stale = false; setFormatsReady(false);
    void availableExportFormats(resolution).then(values => {
      if (stale) return;
      setFormats(values); setFormat(current => values.some(f => f.ext === current) ? current : values[0]?.ext || ''); setFormatsReady(true);
    }).catch(() => { if (!stale) { setFormats([]); setFormatsReady(true); } });
    return () => { stale = true; };
  }, [resolution]);
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
      const current = useVideoEdits.getState().draft!; renderer.updateComposition(current); renderer.setPreviewVisible(!timingRef.current);
      await renderer.seek(Math.min(timeRef.current, renderer.duration)); if (!disposed) setReady(true);
    }).catch(value => { if (!disposed) editError(value); });
    return () => { disposed = true; player.current?.dispose(); player.current = undefined; };
  }, [draft.assets, draft.clips, draft.systems]);
  useEffect(() => { player.current?.updateComposition(draft); }, [draft.cues, draft.scoreLayout, draft.videoZoom, draft.videoOffsetY, draft.scoreScale]);
  useEffect(() => { player.current?.setPreviewVisible(!timing); }, [timing]);
  useEffect(() => () => cancel.current?.abort(), []);
  const pause = () => { player.current?.pause(); setPlaying(false); };
  const navigate = (value: Mode, step?: 'crop' | 'timing') => {
    pause(); useVideoEdits.setState({ review: false }); setMode(value); if (step) setScoreStep(step);
  };
  const seek = async (value: number) => {
    if (!player.current || exporting) return;
    setPlaying(false); try { await player.current.seek(value); } catch (value) { editError(value); }
  };
  const play = async () => {
    if (!player.current || exporting) return;
    try {
      if (player.current.isPlaying) pause();
      else { await player.current.play(); setPlaying(true); }
    } catch (value) { editError(value); }
  };
  const tap = () => {
    const current = useVideoEdits.getState().draft!;
    const index = nextSystem.current, system = current.systems[index], segment = dominantSegment(current.clips, player.current?.currentTime ?? timeRef.current);
    if (!ready || !system || !segment || exporting || busy) return;
    const cue = { id: crypto.randomUUID(), clipId: segment.clip.id, sourceTime: segment.sourceTime, systemId: system.id };
    const replaced = current.cues.filter(old => old.clipId === cue.clipId && Math.abs(old.sourceTime - cue.sourceTime) <= 0.05);
    changeEdit({ cues: [...current.cues.filter(old => !replaced.includes(old)), cue] });
    setUndoMarks(marks => [...marks, { id: cue.id, index, replaced }]);
    setMarkStatus(`${system.label} marked at ${formatTime(player.current?.currentTime ?? timeRef.current)}`);
    selectSystem(index + 1);
  };
  const undoMark = () => {
    const last = undoMarks.at(-1), current = useVideoEdits.getState().draft; if (!last || !current) return;
    changeEdit({ cues: [...current.cues.filter(cue => cue.id !== last.id), ...last.replaced.filter(cue => !current.cues.some(c => c.id === cue.id))] });
    selectSystem(Math.min(last.index, current.systems.length)); setUndoMarks(marks => marks.slice(0, -1)); setMarkStatus('Last mark undone');
  };
  const patchClip = (id: string, patch: Partial<EditClip>) => { pause(); changeEdit({ clips: draft.clips.map(clip => clip.id === id ? { ...clip, ...patch } : clip) }); };
  const takeFrame = async () => {
    if (!canvas.current || !ready) return;
    try { changeEdit({ thumbnail: await canvasBlob(canvas.current), thumbnailChoice: 'frame' }); } catch (value) { editError(value); }
  };
  const downloadThumbnail = () => { if (draft.thumbnail) downloadBlob(draft.thumbnail, `${draft.title || 'pianocanva'}-thumbnail.jpg`); };
  const exportEdit = async () => {
    pause(); setExporting(true); setFinished(false); setProgress(0);
    useVideoEdits.setState({ error: '' }); cancel.current = new AbortController();
    try {
      try { await saveVideoEdit(); } catch { /* A full local library must not block downloading. */ }
      const result = await exportVideoEdit(draft, { resolution, format, signal: cancel.current.signal, onProgress: setProgress });
      downloadBlob(result.blob, `${draft.title || 'pianocanva'}-edited.${result.extension}`); downloadThumbnail(); setFinished(true);
    } catch (value) { if (!(value instanceof DOMException && value.name === 'AbortError')) editError(value); }
    finally { setExporting(false); }
  };
  const original = draft.assets[0];
  const systemStrip = <div className="score-system-list" aria-label="Cropped score systems">{draft.systems.map((system, index) => <div key={system.id} className={systemIndex === index ? 'score-system selected' : 'score-system'}>
    <button aria-pressed={systemIndex === index} onClick={() => selectSystem(index)}><BlobImage blob={system.image} label={system.label} /><span>{system.label}<small>Page {system.page}</small></span></button>
    <button className="score-remove" aria-label={`Remove ${system.label}`} onClick={() => { changeEdit({ systems: draft.systems.filter(s => s.id !== system.id), cues: draft.cues.filter(c => c.systemId !== system.id) }); selectSystem(Math.max(0, Math.min(systemIndex, draft.systems.length - 2))); setUndoMarks([]); }}>×</button>
  </div>)}</div>;
  const thumbnail = <fieldset disabled={exporting || busy} className="video-edit-section"><div className="section-heading"><h2>Thumbnail <span className="edit-badge">Optional</span></h2>{draft.thumbnail && <button onClick={() => changeEdit({ thumbnail: null, thumbnailChoice: null })}>Remove thumbnail</button>}</div>
    <p>Choose a video frame or take a photo.</p><div className="video-edit-row"><button disabled={!ready} onClick={() => void takeFrame()}>Use current frame</button><button onClick={() => { pause(); setCamera(true); }}>Take a picture</button></div>
    {draft.thumbnail && <BlobImage blob={draft.thumbnail} label="Chosen thumbnail" className="video-edit-thumbnail" />}
  </fieldset>;

  const transport = <div className="video-edit-transport"><button disabled={!ready || exporting} onClick={() => void play()}>{playing ? 'Pause' : 'Play'}</button><input aria-label="Video playhead" type="range" min="0" max={Math.max(duration, 0.01)} step="0.01" value={Math.min(time, duration)} disabled={!ready || exporting} onChange={event => void seek(Number(event.target.value))} /><output>{formatTime(time)} <span>/ {formatTime(duration)}</span></output></div>;
  const steps = [
    { label: 'Clips', mode: 'edit' as const },
    { label: 'Crop score', mode: 'score' as const, step: 'crop' as const },
    { label: 'Sync', mode: 'score' as const, step: 'timing' as const },
    { label: 'Export', mode: 'export' as const },
  ];
  return <div className="video-editor-backdrop"><section role="dialog" aria-modal="true" aria-label="Video editor" className={`video-editor mode-${mode}${cropping ? ' is-cropping' : ''}${timing ? ' is-timing' : ''}`} onKeyDown={event => {
    if (drawer || camera || event.target instanceof HTMLElement && event.target.closest('input, textarea, select') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat) { if (event.code === 'KeyT' || event.code === 'Space') event.preventDefault(); return; }
    if (event.code === 'Space' && (!(event.target instanceof HTMLElement && event.target.closest('button')) || !!(event.target instanceof HTMLElement && event.target.closest('.score-focus'))) && !cropping) { event.preventDefault(); void play(); }
    if (event.code === 'KeyT' && timing) { event.preventDefault(); tap(); }
  }}>
    <header className="video-editor-header"><div><span className="editor-eyebrow">PIANOCANVA STUDIO</span><h1>{review ? 'Your take is ready' : 'Video editor'}</h1></div><div className="editor-header-actions"><button disabled={exporting || busy} onClick={() => { pause(); setDrawer('library'); }}>Library</button><button disabled={exporting || busy} onClick={close} aria-label="Close video editor">Save & close <span aria-hidden="true">×</span></button></div></header>
    <nav className="editor-nav" aria-label="Editing workspace">{steps.map((step, index) => <button key={step.label} disabled={exporting || busy || step.step === 'timing' && (!draft.systems.length || !draft.clips.length)} aria-current={mode === step.mode && (!step.step || scoreStep === step.step) ? 'step' : undefined} onClick={() => navigate(step.mode, step.step)}><span className="nav-number">{index + 1}</span>{step.label}</button>)}</nav>
    {error && <p role="alert" className="video-edit-error">{error}<button onClick={() => useVideoEdits.setState({ error: '' })} aria-label="Dismiss editing error">×</button></p>}
    <div className="video-editor-body">
      <div className="video-editor-main">
        <div className="editor-preview-area" hidden={cropping || timing}>
          <canvas ref={canvas} width={1280} height={720} className={`video-edit-preview${ready && !exporting ? ' is-adjustable' : ''}`} aria-label="Edited video preview" tabIndex={0} title="Drag up or down" onPointerDown={event => {
            if (!ready || exporting || busy) return;
            event.preventDefault(); pause(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
            const bounds = event.currentTarget.getBoundingClientRect();
            videoDrag.current = { y: event.clientY, offsetY: videoTransform(draft).offsetY, height: Math.min(bounds.height, bounds.width * 9 / 16) };
          }} onPointerMove={event => {
            const start = videoDrag.current; if (!start || exporting || busy) return;
            changeEdit({ videoOffsetY: Math.max(-1, Math.min(1, start.offsetY + (event.clientY - start.y) * 2 / start.height)) });
          }} onPointerUp={() => { videoDrag.current = undefined; }} onPointerCancel={() => { videoDrag.current = undefined; }} />
          {!draft.clips.length && <div className="preview-empty"><span aria-hidden="true">▷</span><p>Your performance goes here</p><FileButton label="Import videos" accept="video/*,.webm,.mp4,.mov" multiple disabled={busy || exporting} onFiles={files => void importVideoFiles(files)} /></div>}
          {!timing && transport}
        </div>
        {review && <><div className="video-edit-review"><h2>Edit before saving?</h2><p>Your take is saved in your local library.</p><div className="video-edit-row"><button className="edit-primary" onClick={() => navigate('edit')}>Edit video and add score</button><button disabled={!original} onClick={() => { downloadBlob(original.blob, original.name); downloadThumbnail(); setFinished(true); }}>Download original</button></div></div>{thumbnail}</>}
        {mode === 'edit' && !review && draft.clips.length > 0 && <fieldset disabled={exporting || busy} className="video-edit-section"><div className="section-heading"><h2>Clips <span className="edit-count">{draft.clips.length}</span></h2><FileButton label="Import videos" accept="video/*,.webm,.mp4,.mov" multiple onFiles={files => void importVideoFiles(files)} />{busy && <span role="status">Loading…</span>}</div>
          <ol className="video-clip-list">{draft.clips.map((clip, index) => {
            const asset = draft.assets.find(asset => asset.id === clip.assetId)!;
            return <li key={clip.id}><div className="clip-heading"><span className="clip-number">{String(index + 1).padStart(2, '0')}</span><strong>{asset.name}</strong><span className="editor-muted">{formatTime(clip.out - clip.in)}</span></div><div className="video-edit-row">
              <TimeInput label="Start" ariaLabel={`Clip ${index + 1} in`} value={clip.in} onChange={value => patchClip(clip.id, { in: Math.max(0, Math.min(clip.out - 0.1, value)) })} />
              <TimeInput label="End" ariaLabel={`Clip ${index + 1} out`} value={clip.out} onChange={value => patchClip(clip.id, { out: Math.max(clip.in + 0.1, Math.min(asset.duration, value)) })} />
              <button disabled={index === 0} aria-label={`Move clip ${index + 1} earlier`} onClick={() => { const clips = [...draft.clips]; [clips[index - 1], clips[index]] = [clips[index], clips[index - 1]]; changeEdit({ clips }); }}>↑</button>
              <button disabled={index === draft.clips.length - 1} aria-label={`Move clip ${index + 1} later`} onClick={() => { const clips = [...draft.clips]; [clips[index + 1], clips[index]] = [clips[index], clips[index + 1]]; changeEdit({ clips }); }}>↓</button>
              <button onClick={() => { const copy = { ...clip, id: crypto.randomUUID() }, clips = [...draft.clips]; clips.splice(index + 1, 0, copy); changeEdit({ clips, cues: [...draft.cues, ...draft.cues.filter(c => c.clipId === clip.id).map(c => ({ ...c, id: crypto.randomUUID(), clipId: copy.id }))] }); }}>Duplicate</button>
              <button onClick={() => changeEdit({ clips: draft.clips.filter(c => c.id !== clip.id), cues: draft.cues.filter(c => c.clipId !== clip.id) })}>Remove</button>
            </div>{index < draft.clips.length - 1 && <div className="video-edit-row"><label>Transition<select aria-label={`Clip ${index + 1} transition`} value={clip.transition} onChange={event => patchClip(clip.id, { transition: event.target.value as EditClip['transition'] })}><option value="cut">Cut</option><option value="crossfade">Crossfade</option><option value="fade">Fade through black</option></select></label>{clip.transition !== 'cut' && <label>Duration (seconds)<input aria-label={`Clip ${index + 1} transition duration`} type="number" min="0.1" max="3" step="0.1" value={clip.transitionSeconds} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) patchClip(clip.id, { transitionSeconds: Math.min(3, Math.max(0.1, n)) }); }} /></label>}</div>}</li>;
          })}</ol>
          {draft.assets.length > 0 && <details><summary>Source videos</summary>{draft.assets.map(asset => <div className="video-edit-row" key={asset.id}><span>{asset.name}</span><button onClick={() => changeEdit({ clips: [...draft.clips, newClip(asset)] })}>Add segment</button><button onClick={() => downloadBlob(asset.blob, asset.name)}>Download source</button></div>)}</details>}
        </fieldset>}
        {mode === 'edit' && !review && draft.clips.length > 0 && <div className="editor-next"><button onClick={() => navigate('export')}>Skip to export</button><button className="edit-primary" onClick={() => navigate('score', 'crop')}>Add score →</button></div>}
        {cropping && <><ScoreCropper draft={draft} pause={pause} />{systemStrip}<div className="score-crop-footer"><span className="editor-muted">{draft.systems.length} systems</span><button className="edit-primary" disabled={!draft.systems.length || !draft.clips.length} onClick={() => navigate('score', 'timing')}>Sync →</button>{!draft.clips.length && <button onClick={() => navigate('edit')}>Add a video</button>}</div></>}
        {timing && <div className="score-timing-workspace">
          <div className="timing-heading"><div><h2>Listen & tap</h2><p>Tap the score when each system begins.</p></div><button onClick={() => { pause(); setDrawer('timings'); }}>Timings <span className="edit-count">{cues.length}</span></button></div>
          <div className="timing-system-picker"><label htmlFor="timing-system">Next</label><select id="timing-system" aria-label="Next score system" value={systemIndex < draft.systems.length ? systemIndex : ''} onChange={event => { selectSystem(Number(event.target.value)); setMarkStatus(''); }}><option value="" disabled>Pass complete</option>{draft.systems.map((system, index) => <option key={system.id} value={index}>{system.label} · {index + 1} / {draft.systems.length}</option>)}</select><button disabled={!undoMarks.length} onClick={undoMark}>Undo</button></div>
          {systemIndex < draft.systems.length ? <button className="score-focus" disabled={!ready || busy} onClick={tap} aria-label={`Mark ${draft.systems[systemIndex].label} start`}><ScoreFocus image={ready ? player.current?.getScoreImage(draft.systems[systemIndex].id) : undefined} /><span className="score-focus-hint">{ready ? <>Tap to mark <kbd>T</kbd></> : 'Loading…'}</span></button> : <div className="score-sync-complete"><span aria-hidden="true">✓</span><h2>{draft.systems.every(system => cues.some(cue => cue.systemId === system.id)) ? 'All systems marked' : 'Pass complete'}</h2><p>Ready to see your video?</p><button className="edit-primary" onClick={() => navigate('export')}>Preview & export →</button><button onClick={() => { pause(); setDrawer('timings'); }}>Review timings</button></div>}
          <div className="timing-footer"><p role="status" className="timing-status">{markStatus || 'Space to play · T to mark'}</p>{transport}</div>
        </div>}
        {mode === 'export' && <><fieldset disabled={exporting || busy} className="video-edit-section"><h2>Export</h2><div className="video-edit-row"><label>Format<select aria-label="Export format" disabled={!formats.length} value={format} onChange={event => setFormat(event.target.value)}>{formats.map(f => <option key={f.ext} value={f.ext}>{f.ext === 'mp4' ? 'MP4 · H.264 / AAC' : 'WebM · VP8 / Opus'}</option>)}</select></label><label>Resolution<select aria-label="Export resolution" value={resolution} onChange={event => setResolution(Number(event.target.value) as 720 | 1080)}><option value="720">720p</option><option value="1080">1080p</option></select></label><button className="edit-primary export-button" disabled={!ready || !duration || !formatsReady || !formats.length} onClick={() => void exportEdit()}>Export and download video</button></div>{formatsReady && !formats.length && <p role="alert">Fast video export needs a browser with WebCodecs encoding. Try Chrome or Edge.</p>}</fieldset>{thumbnail}</>}
        {exporting && <div role="status" className="video-edit-section export-progress"><progress value={progress} max={1} /><span>Exporting {Math.round(progress * 100)}%</span><button onClick={() => cancel.current?.abort()}>Cancel export</button></div>}
        {finished && mode !== 'score' && <p role="status">Download started.</p>}
      </div>
      {mode === 'export' && <aside className="video-editor-tools"><FrameControls draft={draft} disabled={exporting || busy || !ready} /></aside>}
    </div>
    {drawer && <EditorDrawer label={drawer === 'library' ? 'Video library' : 'Score timings'} onClose={() => setDrawer(null)}>
      {drawer === 'timings' ? <><p>Choose a time to listen again.</p><ol className="score-cue-list">{cues.map(cue => <li key={cue.id}><button onClick={() => { void seek(cue.time); selectSystem(draft.systems.findIndex(system => system.id === cue.systemId)); setDrawer(null); }}><time>{formatTime(cue.time)}</time> {draft.systems.find(s => s.id === cue.systemId)?.label}</button><button aria-label={`Delete cue at ${formatTime(cue.time)}`} onClick={() => { changeEdit({ cues: draft.cues.filter(c => c.id !== cue.id) }); selectSystem(draft.systems.findIndex(system => system.id === cue.systemId)); setUndoMarks([]); }}>×</button></li>)}</ol>{!cues.length && <p>No starts marked yet.</p>}{draft.cues.length > cues.length && <p>{draft.cues.length - cues.length} starts are outside the current trims.</p>}<button className="edit-primary" onClick={() => { setDrawer(null); navigate('export'); }}>Preview & export →</button></> : <fieldset disabled={exporting || busy} className="editor-library"><label>Edit name<input aria-label="Video edit name" value={draft.title} maxLength={120} onChange={event => changeEdit({ title: event.target.value })} /></label><label>Saved edits<select aria-label="Saved video edits" value={draft.id} onChange={event => void openVideoEdit(event.target.value)}><option value={draft.id}>{draft.title || 'Current edit'}</option>{library.filter(edit => edit.id !== draft.id).map(edit => <option key={edit.id} value={edit.id}>{edit.title} · {formatTime(edit.duration)}</option>)}</select></label><div className="video-edit-row"><button onClick={() => void createVideoEdit()}>New edit</button><button onClick={() => void saveVideoEdit().catch(() => {})}>Save edit</button></div><p role="status">{saveStatus === 'saved' ? 'Saved on this device' : saveStatus === 'saving' ? 'Saving…' : 'Save failed. Download your source before leaving.'}</p><details><summary>Manage edit</summary><button onClick={() => setDeleteArmed(true)}>Delete local edit</button>{deleteArmed && <div><p>Delete this edit and its local source copies? Download any recordings you want to keep first.</p><button onClick={() => void deleteCurrentEdit()}>Delete edit and local source copies</button><button onClick={() => setDeleteArmed(false)}>Cancel deletion</button></div>}</details></fieldset>}
    </EditorDrawer>}
    {camera && <ThumbnailCamera onClose={() => setCamera(false)} onPhoto={blob => { changeEdit({ thumbnail: blob, thumbnailChoice: 'photo' }); setCamera(false); }} />}
  </section></div>;
}

function FrameControls({ draft, disabled }: { draft: EditDraft; disabled: boolean }) {
  const { zoom, offsetY } = videoTransform(draft);
  return <fieldset className="video-edit-section frame-controls" disabled={disabled}>
    <div className="section-heading"><h2>Layout</h2><button onClick={() => changeEdit({ videoZoom: 1, videoOffsetY: 0, scoreScale: 1 })}>Reset</button></div>
    {draft.systems.length > 0 && <label>Score size <output>{Math.round(scoreSize(draft.scoreScale) * 100)}%</output><input aria-label="Score size" type="range" min="0.25" max="1" step="0.01" value={scoreSize(draft.scoreScale)} onChange={event => changeEdit({ scoreScale: Number(event.target.value) })} /></label>}
    <label>Video size <output>{Math.round(zoom * 100)}%</output><input aria-label="Video size" type="range" min="0.25" max="3" step="0.01" value={zoom} onChange={event => changeEdit({ videoZoom: Number(event.target.value) })} /></label>
    <label>Vertical position <output>{Math.round(offsetY * 100)}%</output><input aria-label="Video vertical position" type="range" min="-1" max="1" step="0.01" value={offsetY} onChange={event => changeEdit({ videoOffsetY: Number(event.target.value) })} /></label>
    {draft.systems.length > 0 && <label>Score<select aria-label="Score placement" value={draft.scoreLayout} onChange={event => changeEdit({ scoreLayout: event.target.value as EditDraft['scoreLayout'] })}><option value="above">Video below score</option><option value="overlay">Score over video</option></select></label>}
  </fieldset>;
}

/** Uses the prepared notation without source-page margins, always at its own aspect ratio. */
function ScoreFocus({ image }: { image?: ImageBitmap }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current; if (!target) return;
    target.width = image?.width || 1; target.height = image?.height || 1;
    if (image) target.getContext('2d')!.drawImage(image, 0, 0);
  }, [image]);
  return <canvas ref={canvas} aria-hidden="true" />;
}
function EditorDrawer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useDialogKeyboard(true, label, onClose);
  return <div className="editor-drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={label} className="editor-drawer"><div className="section-heading"><h2>{label}</h2><button aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>Done ×</button></div>{children}</section></div>;
}

function FileButton({ label, accept, multiple, disabled, onFiles }: { label: string; accept: string; multiple?: boolean; disabled?: boolean; onFiles: (files: FileList) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <><button type="button" className="edit-import" disabled={disabled} onClick={() => input.current?.click()}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></svg>{label}</button><input ref={input} hidden aria-label={label} type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={event => { if (event.target.files?.length) onFiles(event.target.files); event.target.value = ''; }} /></>;
}
function TimeInput({ label, ariaLabel, value, onChange }: { label: string; ariaLabel: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(formatTime(value));
  useEffect(() => setText(formatTime(value)), [value]);
  const commit = () => { const parsed = parseTime(text); if (parsed !== undefined) onChange(parsed); setText(formatTime(parsed === undefined ? value : parsed)); };
  return <label className="edit-time-input">{label}<input aria-label={ariaLabel} aria-description="Minutes:seconds, or hours:minutes:seconds" type="text" value={text} onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}
function BlobImage({ blob, label, className }: { blob: Blob; label: string; className?: string }) {
  const [url, setURL] = useState('');
  useEffect(() => { const value = URL.createObjectURL(blob); setURL(value); return () => URL.revokeObjectURL(value); }, [blob]);
  return url ? <img src={url} alt={label} className={className} /> : null;
}

function ScoreCropper({ draft, pause }: { draft: EditDraft; pause: () => void }) {
  const template = draft.cropTemplate || draft.systems[0]?.crop;
  const [page, setPage] = useState(1), [image, setImage] = useState<HTMLCanvasElement>(), [crop, setCrop] = useState<Crop>();
  const [loading, setLoading] = useState(false), [label, setLabel] = useState(''), [manual, setManual] = useState(!template);
  const [saving, setSaving] = useState(false), pending = useRef(false);
  const canvas = useRef<HTMLCanvasElement>(null), origin = useRef<{ x: number; y: number }>();
  useEffect(() => {
    let stale = false; setImage(undefined); setCrop(undefined);
    if (!draft.pdf) return;
    setLoading(true);
    try { if (!receivePDFSource({ kind: 'pdf-file', ...draft.pdf })) throw new Error('Upload the PDF again.'); }
    catch (error) { editError(error); setLoading(false); return; }
    void renderPDFPage(draft.pdf.board, Math.min(page, draft.pdf.count)).then(value => { if (!stale) setImage(value); }).catch(error => { if (!stale) editError(error); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [draft.pdf, page]);
  useEffect(() => {
    if (!image || !canvas.current) return;
    const target = canvas.current, ctx = target.getContext('2d')!; target.width = image.width; target.height = image.height; ctx.drawImage(image, 0, 0);
    if (crop) {
      const rect = cropPixels(crop, target.width, target.height);
      ctx.fillStyle = 'rgba(15,18,26,.4)'; ctx.fillRect(0, 0, target.width, rect.y); ctx.fillRect(0, rect.y + rect.height, target.width, target.height - rect.y - rect.height); ctx.fillRect(0, rect.y, rect.x, rect.height); ctx.fillRect(rect.x + rect.width, rect.y, target.width - rect.x - rect.width, rect.height);
      ctx.strokeStyle = '#d74080'; ctx.lineWidth = Math.max(3, target.width / 350); ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }, [image, crop]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
  const add = async (selection: Crop, lockSize: boolean) => {
    if (!image || pending.current || loading) return;
    pending.current = true; setSaving(true); pause();
    const pdfId = draft.pdf?.id;
    try {
      const current = useVideoEdits.getState().draft!;
      const bounded = { ...selection, width: Math.min(selection.width, 1 - selection.x), height: Math.min(selection.height, 1 - selection.y) };
      const system = await cropScore(image, bounded, page, label.trim() || `System ${current.systems.length + 1}`);
      const latest = useVideoEdits.getState().draft;
      if (latest?.id !== draft.id || latest.pdf?.id !== pdfId) return;
      changeEdit({ systems: [...latest.systems, system], ...(lockSize ? { cropTemplate: bounded } : {}) });
      setManual(false); setCrop(undefined); setLabel('');
    } catch (error) { editError(error); }
    finally { pending.current = false; setSaving(false); }
  };
  const upload = async (file: File) => {
    pause(); setLoading(true);
    try { const pdf = await preparePDF(file); setPage(1); changeEdit({ pdf: { board: 'edit-score-' + draft.id, id: pdf.id, name: pdf.name, data: pdf.data, count: pdf.count } }); }
    catch (error) { editError(error); } finally { setLoading(false); }
  };
  return <div className="score-cropper"><div className="score-crop-toolbar"><div><h2>{draft.pdf?.name || 'Add your score'}</h2><p>{!draft.pdf ? 'Upload a PDF to begin.' : manual || !template ? 'Drag around the first grand-staff system.' : 'Click the center of each next system. The crop size stays the same.'}</p></div><FileButton label={draft.pdf ? 'Replace PDF' : 'Upload score PDF'} accept="application/pdf,.pdf" disabled={loading || saving} onFiles={files => void upload(files[0])} /></div>
    {loading && <p role="status">Loading score…</p>}
    {draft.pdf && <><div className="score-page-bar"><button disabled={page <= 1 || loading || saving} aria-label="Previous score page" onClick={() => setPage(page - 1)}>←</button><label>Page <input aria-label="Score PDF page" type="number" min="1" max={draft.pdf.count} value={page} disabled={loading || saving} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) setPage(Math.min(draft.pdf!.count, Math.max(1, Math.round(n)))); }} /> / {draft.pdf.count}</label><button disabled={page >= draft.pdf.count || loading || saving} aria-label="Next score page" onClick={() => setPage(page + 1)}>→</button>{template && <button aria-pressed={manual} disabled={saving} onClick={() => { setManual(!manual); setCrop(undefined); }}>{manual ? 'Use saved size' : 'Adjust crop size'}</button>}<span role="status" className="editor-muted">{saving ? 'Adding system…' : template && !manual ? 'One-click cropping' : 'Set crop size'}</span></div>
      <div className="score-page-stage">{image && <canvas ref={canvas} aria-label="Crop grand staff from PDF" className="score-crop-canvas" style={{ width: `min(100%, ${68 * image.width / image.height}vh)` }} onPointerDown={event => {
        if (saving || loading) return;
        event.preventDefault(); pause(); event.currentTarget.setPointerCapture(event.pointerId);
        const p = point(event);
        if (!manual && template) setCrop(placeCrop(template, p.x, p.y));
        else { origin.current = p; setCrop(undefined); }
      }} onPointerMove={event => {
        if (saving || loading) return;
        const p = point(event), start = origin.current;
        if (!manual && template) setCrop(placeCrop(template, p.x, p.y));
        else if (start) setCrop({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) });
      }} onPointerUp={event => {
        if (!manual && template && event.currentTarget.hasPointerCapture(event.pointerId)) { const p = point(event); void add(placeCrop(template, p.x, p.y), false); }
        origin.current = undefined;
      }} onPointerCancel={() => { origin.current = undefined; }} onPointerLeave={() => { if (!origin.current) setCrop(undefined); }} />}</div>
      {(manual || !template) && <div className="score-crop-actions"><label>System name<input aria-label="Score system name" value={label} maxLength={60} placeholder={`System ${draft.systems.length + 1}`} onChange={event => setLabel(event.target.value)} /></label><button className="edit-primary" disabled={!crop || !image || loading || saving} onClick={() => crop && void add(crop, true)}>Add cropped system</button><details><summary>Crop coordinates</summary>{!crop && <button onClick={() => setCrop({ x: 0, y: 0, width: 1, height: 0.2 })}>Enter crop coordinates</button>}{crop && <div className="score-crop-numbers">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key} (%)<input aria-label={`Crop ${key} percent`} type="number" min="0" max="100" step="0.1" value={Number((crop[key] * 100).toFixed(1))} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) setCrop({ ...crop, [key]: Math.max(0, Math.min(1, n / 100)) }); }} /></label>)}</div>}</details></div>}
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
