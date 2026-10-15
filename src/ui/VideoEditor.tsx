import { useEffect, useRef, useState, type ReactNode } from 'react';
import { changeEdit, closeVideoEdit, createVideoEdit, deleteCurrentEdit, editError, importVideoFiles, openVideoEdit, refreshEdits, saveVideoEdit, useVideoEdits } from '../editing/store';
import { dominantSegment, editDuration, formatTime, parseTime, newClip, timedCues, scoreSteps, firstUnmarkedScoreStep, type EditClip, type EditDraft, type ScoreCue } from '../editing/model';
import { scoreSize, videoTransform } from '../editing/composition';
import { canvasBlob, downloadBlob } from '../editing/media';
import { availableExportFormats, exportVideoEdit, TimelineRenderer } from '../editing/render';
import type { ExportFormat } from '../editing/export';
import { ScoreCropper } from './ScoreCropper';
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
  const orderedSteps = scoreSteps(draft);
  const [systemIndex, setSystemIndex] = useState(() => Math.min(firstUnmarkedScoreStep(draft), Math.max(0, orderedSteps.length - 1)));
  const [systemStarted, setSystemStarted] = useState(false);
  const [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0);
  const cursor = useRef({ index: systemIndex, started: false });
  const [undoMarks, setUndoMarks] = useState<{ id: string; cursor: { index: number; started: boolean }; replaced: ScoreCue[] }[]>([]);
  const [markStatus, setMarkStatus] = useState('');
  const [drawer, setDrawer] = useState<'library' | 'timings' | null>(null);
  const [camera, setCamera] = useState(false), [format, setFormat] = useState('mp4'), [formats, setFormats] = useState<ExportFormat[]>([]);
  const [formatsReady, setFormatsReady] = useState(false), [resolution, setResolution] = useState<720 | 1080>(720), [finished, setFinished] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false), [mode, setMode] = useState<Mode>('edit');
  const [scoreStep, setScoreStep] = useState<'crop' | 'timing'>(draft.systems.length ? 'timing' : 'crop');
  const duration = editDuration(draft.clips), cues = timedCues(draft), cropping = mode === 'score' && scoreStep === 'crop';
  const timing = mode === 'score' && scoreStep === 'timing';
  const timingRef = useRef(timing); timingRef.current = timing;
  const selectSystem = (index: number, started = false) => { cursor.current = { index, started }; setSystemIndex(index); setSystemStarted(started); };
  useEffect(() => {
    if (cursor.current.index >= orderedSteps.length) selectSystem(Math.max(0, orderedSteps.length - 1));
    setUndoMarks([]);
  }, [draft.scoreSequence, draft.systems.length]);
  const displayedStep = orderedSteps[systemIndex], displayedSystem = draft.systems.find(system => system.id === displayedStep?.systemId);
  const nextStep = orderedSteps[systemStarted ? systemIndex + 1 : systemIndex];
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
    setPlaying(false);
    try {
      await player.current.seek(value);
      if (timing) {
        const current = useVideoEdits.getState().draft!, cue = timedCues(current).filter(cue => cue.time <= value + 0.001).at(-1);
        const index = cue ? scoreSteps(current).findIndex(step => cue.stepId ? step.id === cue.stepId : step.systemId === cue.systemId) : 0;
        selectSystem(Math.max(0, index), !!cue);
      }
    } catch (value) { editError(value); }
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
    const before = { ...cursor.current }, index = before.index + (before.started ? 1 : 0), step = scoreSteps(current)[index];
    const system = current.systems.find(system => system.id === step?.systemId);
    const now = player.current?.currentTime ?? timeRef.current, segment = dominantSegment(current.clips, now);
    if (!ready || !step || !system || !segment || exporting || busy) return;
    const cue = { id: crypto.randomUUID(), clipId: segment.clip.id, sourceTime: segment.sourceTime, systemId: system.id, stepId: step.id };
    const replaced = current.cues.filter(old => old.clipId === cue.clipId && Math.abs(old.sourceTime - cue.sourceTime) <= 0.05);
    changeEdit({ cues: [...current.cues.filter(old => !replaced.includes(old)), cue] });
    setUndoMarks(marks => [...marks, { id: cue.id, cursor: before, replaced }]);
    setMarkStatus(`${index + 1} marked at ${formatTime(now)}`);
    // Keep the just-started system visible. The next tap changes and marks it together.
    selectSystem(index, true);
  };
  const undoMark = () => {
    const last = undoMarks.at(-1), current = useVideoEdits.getState().draft; if (!last || !current) return;
    changeEdit({ cues: [...current.cues.filter(cue => cue.id !== last.id), ...last.replaced.filter(cue => !current.cues.some(c => c.id === cue.id))] });
    selectSystem(Math.min(last.cursor.index, Math.max(0, scoreSteps(current).length - 1)), last.cursor.started);
    setUndoMarks(marks => marks.slice(0, -1)); setMarkStatus('Last mark undone');
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
    <nav className="editor-nav" aria-label="Editing workspace">{steps.map((step, index) => <button key={step.label} disabled={exporting || busy || step.step === 'timing' && (!orderedSteps.length || !draft.clips.length)} aria-current={mode === step.mode && (!step.step || scoreStep === step.step) ? 'step' : undefined} onClick={() => navigate(step.mode, step.step)}><span className="nav-number">{index + 1}</span>{step.label}</button>)}</nav>
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
        {cropping && <ScoreCropper draft={draft} pause={pause} onSync={() => navigate('score', 'timing')} onAddVideo={() => navigate('edit')} />}
        {timing && <div className="score-timing-workspace">
          <div className="timing-heading"><div><h2>Listen & tap</h2><p>Tap to start, then tap to change.</p></div><button onClick={() => { pause(); setDrawer('timings'); }}>Timings <span className="edit-count">{cues.length}</span></button></div>
          <div className="timing-system-picker"><label htmlFor="timing-system">Showing</label><select id="timing-system" aria-label="Showing score system" value={systemIndex} onChange={event => { selectSystem(Number(event.target.value)); setMarkStatus(''); }}>{orderedSteps.map((step, index) => <option key={step.id} value={index}>{index + 1} / {orderedSteps.length} · Page {draft.systems.find(system => system.id === step.systemId)?.page}</option>)}</select><button disabled={!undoMarks.length} onClick={undoMark}>Undo</button></div>
          <button className="score-focus" disabled={!ready || busy || !displayedSystem} aria-disabled={!nextStep || undefined} onClick={tap} aria-label={nextStep ? `${systemStarted ? 'Change to' : 'Start'} system ${systemStarted ? systemIndex + 2 : systemIndex + 1}` : 'Last system playing'}><ScoreFocus image={ready && displayedSystem ? player.current?.getScoreImage(displayedSystem.id) : undefined} /><span className="score-focus-hint">{!ready ? 'Loading…' : !nextStep ? 'Last system' : systemStarted ? <>Next: {systemIndex + 2} · Tap <kbd>T</kbd></> : <>Tap to start <kbd>T</kbd></>}</span></button>
          <div className="timing-footer"><p role="status" className="timing-status">{markStatus || 'Space to play · T to mark'}</p>{transport}</div>
        </div>}
        {mode === 'export' && <><fieldset disabled={exporting || busy} className="video-edit-section"><h2>Export</h2><div className="video-edit-row"><label>Format<select aria-label="Export format" disabled={!formats.length} value={format} onChange={event => setFormat(event.target.value)}>{formats.map(f => <option key={f.ext} value={f.ext}>{f.ext === 'mp4' ? 'MP4 · H.264 / AAC' : 'WebM · VP8 / Opus'}</option>)}</select></label><label>Resolution<select aria-label="Export resolution" value={resolution} onChange={event => setResolution(Number(event.target.value) as 720 | 1080)}><option value="720">720p</option><option value="1080">1080p</option></select></label><button className="edit-primary export-button" disabled={!ready || !duration || !formatsReady || !formats.length} onClick={() => void exportEdit()}>Export and download video</button></div>{formatsReady && !formats.length && <p role="alert">Fast video export needs a browser with WebCodecs encoding. Try Chrome or Edge.</p>}</fieldset>{thumbnail}</>}
        {exporting && <div role="status" className="video-edit-section export-progress"><progress value={progress} max={1} /><span>Exporting {Math.round(progress * 100)}%</span><button onClick={() => cancel.current?.abort()}>Cancel export</button></div>}
        {finished && mode !== 'score' && <p role="status">Download started.</p>}
      </div>
      {mode === 'export' && <aside className="video-editor-tools"><FrameControls draft={draft} disabled={exporting || busy || !ready} /></aside>}
    </div>
    {drawer && <EditorDrawer label={drawer === 'library' ? 'Video library' : 'Score timings'} onClose={() => setDrawer(null)}>
      {drawer === 'timings' ? <><p>Choose a time to listen again.</p><ol className="score-cue-list">{cues.map(cue => <li key={cue.id}><button onClick={() => { void seek(cue.time); selectSystem(Math.max(0, orderedSteps.findIndex(step => cue.stepId ? step.id === cue.stepId : step.systemId === cue.systemId))); setDrawer(null); }}><time>{formatTime(cue.time)}</time> {draft.systems.find(s => s.id === cue.systemId)?.label}</button><button aria-label={`Delete cue at ${formatTime(cue.time)}`} onClick={() => { changeEdit({ cues: draft.cues.filter(c => c.id !== cue.id) }); selectSystem(Math.max(0, orderedSteps.findIndex(step => cue.stepId ? step.id === cue.stepId : step.systemId === cue.systemId))); setUndoMarks([]); }}>×</button></li>)}</ol>{!cues.length && <p>No starts marked yet.</p>}{draft.cues.length > cues.length && <p>{draft.cues.length - cues.length} starts are outside the current trims.</p>}<button className="edit-primary" onClick={() => { setDrawer(null); navigate('export'); }}>Preview & export →</button></> : <fieldset disabled={exporting || busy} className="editor-library"><label>Edit name<input aria-label="Video edit name" value={draft.title} maxLength={120} onChange={event => changeEdit({ title: event.target.value })} /></label><label>Saved edits<select aria-label="Saved video edits" value={draft.id} onChange={event => void openVideoEdit(event.target.value)}><option value={draft.id}>{draft.title || 'Current edit'}</option>{library.filter(edit => edit.id !== draft.id).map(edit => <option key={edit.id} value={edit.id}>{edit.title} · {formatTime(edit.duration)}</option>)}</select></label><div className="video-edit-row"><button onClick={() => void createVideoEdit()}>New edit</button><button onClick={() => void saveVideoEdit().catch(() => {})}>Save edit</button></div><p role="status">{saveStatus === 'saved' ? 'Saved on this device' : saveStatus === 'saving' ? 'Saving…' : 'Save failed. Download your source before leaving.'}</p><details><summary>Manage edit</summary><button onClick={() => setDeleteArmed(true)}>Delete local edit</button>{deleteArmed && <div><p>Delete this edit and its local source copies? Download any recordings you want to keep first.</p><button onClick={() => void deleteCurrentEdit()}>Delete edit and local source copies</button><button onClick={() => setDeleteArmed(false)}>Cancel deletion</button></div>}</details></fieldset>}
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
