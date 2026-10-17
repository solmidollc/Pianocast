import { useEffect, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Download, X, Check, SlidersHorizontal, RotateCcw, Upload, Film, Play, ArrowRight, ChevronLeft, Minus, Plus } from 'lucide-react';
import { changeEdit, closeVideoEdit, editError, importVideoFiles, refreshEdits, saveVideoEdit, useVideoEdits } from '../editing/store';
import { editDuration, timedCues, scoreSteps, type EditDraft, type EditClip, type ScoreCue } from '../editing/model';
import { appendMark, deleteVideoPart, orderedMarks, removeMarksFrom, splitVideo, reorderVideo } from '../editing/operations';
import { scoreSize, scoreSpace, videoTransform } from '../editing/composition';
import { canvasBlob, downloadBlob } from '../editing/media';
import { availableExportFormats, exportVideoEdit, TimelineRenderer } from '../editing/render';
import type { ExportFormat } from '../editing/export';
import type { StudioTheme } from './StudioView';
import { ScoreCropper } from './ScoreCropper';
import { IconButton } from './EditorControls';
import { VideoTimeline } from './VideoTimeline';
import { useDialogKeyboard } from './useDialogKeyboard';
import '../editing/editor.css';

type Mode = 'edit' | 'crop' | 'sync' | 'export';
export function VideoEditor({ theme = 'original' }: { theme?: StudioTheme }) {
  const state = useVideoEdits();
  useEffect(() => { void refreshEdits(); }, []);
  useEffect(() => { if (state.open && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }, [state.open]);
  return state.open && state.draft ? <Workspace key={state.draft.id} draft={state.draft} theme={theme} /> : null;
}
function Workspace({ draft, theme }: { draft: EditDraft; theme: StudioTheme }) {
  const { review, busy, error, saveStatus } = useVideoEdits();
  const workspace = useRef<HTMLElement>(null);
  const previewStage = useRef<HTMLDivElement>(null), [previewSize, setPreviewSize] = useState({ width: 640, height: 360 });
  const canvas = useRef<HTMLCanvasElement>(null), player = useRef<TimelineRenderer>();
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number; width: number; height: number }>();
  const timeRef = useRef(0), cancel = useRef<AbortController>(), starting = useRef(false);
  const history = useRef<{ past: EditDraft[]; future: EditDraft[] }>({ past: [], future: [] });
  const clipboard = useRef<EditClip>();
  const [, repaint] = useState(0);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(draft.clips[0]?.id || ''), [selectedMark, setSelectedMark] = useState(-1);
  const [mode, setMode] = useState<Mode>('edit'), [panel, setPanel] = useState(() => window.innerWidth >= 850);
  const [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0), [finished, setFinished] = useState(false);
  const [choosingFrame, setChoosingFrame] = useState(false), [seeking, setSeeking] = useState(false);
  const seekRequest = useRef(0);
  const [camera, setCamera] = useState(false), [cropBusy, setCropBusy] = useState(false), [savingOriginal, setSavingOriginal] = useState(false);
  const [formats, setFormats] = useState<ExportFormat[]>([]), [format, setFormat] = useState('mp4'), [resolution, setResolution] = useState<720 | 1080>(720);
  const duration = editDuration(draft.clips), marks = orderedMarks(draft), steps = scoreSteps(draft);
  const timing = mode === 'sync', cropping = mode === 'crop', timingRef = useRef(timing); timingRef.current = timing;
  const activeMark = Math.max(0, marks.reduce((last, mark, index) => mark.time <= time + .001 ? index : last, -1));
  const displayedStep = steps[activeMark], displayedSystem = draft.systems.find(system => system.id === displayedStep?.systemId);
  const timingGap = timedCues(draft).length > marks.length;
  const close = () => { if (!exporting && !busy && !savingOriginal) void closeVideoEdit(); };
  useDialogKeyboard(true, 'Score Sync', () => { if (cropping) window.dispatchEvent(new Event('pianocanva-cancel-score-crop')); else { player.current?.pause(); setPlaying(false); setChoosingFrame(false); } });
  useDialogKeyboard(review, 'Save recording', () => { changeEdit({ originalSaveSkipped: true }); useVideoEdits.setState({ review: false }); });
  useEffect(() => {
    const stage = previewStage.current; if (!stage) return;
    const resize = () => { const width = Math.max(1, Math.min(stage.clientWidth - 24, (stage.clientHeight - 24) * 16 / 9)); setPreviewSize({ width, height: width * 9 / 16 }); };
    const observer = new ResizeObserver(resize); observer.observe(stage); resize(); return () => observer.disconnect();
  }, [cropping, timing]);
  useEffect(() => {
    let stale = false; setFormats([]);
    void availableExportFormats(resolution).then(values => { if (!stale) { setFormats(values); setFormat(current => values.some(f => f.ext === current) ? current : values[0]?.ext || ''); } }).catch(() => {});
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
      player.current = renderer; renderer.updateComposition(useVideoEdits.getState().draft!); renderer.setPreviewVisible(!timingRef.current);
      await renderer.seek(Math.min(timeRef.current, renderer.duration)); if (!disposed) setReady(true);
    }).catch(value => { if (!disposed) editError(value); });
    return () => { disposed = true; player.current?.dispose(); player.current = undefined; };
  }, [draft.assets, draft.clips, draft.systems]);
  useEffect(() => { player.current?.updateComposition(draft); }, [draft.cues, draft.scoreLayout, draft.videoZoom, draft.videoOffsetX, draft.videoOffsetY, draft.scoreScale, draft.scoreSpace, draft.scoreHeight, draft.scoreSizing]);
  useEffect(() => { player.current?.setPreviewVisible(!timing); }, [timing]);
  useEffect(() => () => cancel.current?.abort(), []);
  useEffect(() => { history.current = { past: [], future: [] }; clipboard.current = undefined; setSelected(draft.clips[0]?.id || ''); }, [draft.assets]);
  useEffect(() => { if (document.activeElement === document.body) workspace.current?.focus(); }, [draft.clips]);
  const pause = () => { player.current?.pause(); setPlaying(false); };
  const seek = async (value: number) => {
    const renderer = player.current; if (!renderer || exporting) return;
    const request = ++seekRequest.current; setSeeking(true); setPlaying(false); try { await renderer.seek(value); } catch (value) { if (player.current === renderer && !(value instanceof DOMException && value.name === 'AbortError')) editError(value); } finally { if (request === seekRequest.current) setSeeking(false); }
  };
  const play = async () => {
    const renderer = player.current; if (!renderer || exporting) return;
    try { if (renderer.isPlaying) pause(); else { await renderer.play(); if (player.current === renderer) setPlaying(true); } } catch (value) { if (player.current === renderer && !(value instanceof DOMException && value.name === 'AbortError')) editError(value); }
  };
  const navigate = (value: Mode) => { pause(); useVideoEdits.setState({ review: false }); setMode(value); if (value === 'export') setPanel(true); };
  const apply = (patch: Partial<EditDraft>) => {
    pause(); const current = useVideoEdits.getState().draft!;
    history.current.past = [...history.current.past.slice(-29), current]; history.current.future = [];
    changeEdit(patch); repaint(value => value + 1);
  };
  const undoEdit = (redo = false) => {
    pause(); const stacks = history.current, from = redo ? stacks.future : stacks.past, to = redo ? stacks.past : stacks.future;
    const previous = from.pop(); if (!previous) return;
    to.push(useVideoEdits.getState().draft!); changeEdit(previous); setSelected(previous.clips[0]?.id || ''); repaint(value => value + 1);
  };
  const split = () => {
    const current = useVideoEdits.getState().draft!, patch = splitVideo(current, player.current?.currentTime ?? timeRef.current);
    if (patch) { apply(patch); setSelected(patch.clips.find(clip => !current.clips.some(old => old.id === clip.id))?.id || ''); }
  };
  const removePart = (cut = false) => {
    const current = useVideoEdits.getState().draft!, clip = current.clips.find(clip => clip.id === selected); if (!clip) return;
    if (cut) clipboard.current = clip;
    const patch = deleteVideoPart(current, selected); apply(patch); setSelected(patch.clips[0]?.id || '');
  };
  const copy = () => { clipboard.current = useVideoEdits.getState().draft!.clips.find(clip => clip.id === selected); repaint(value => value + 1); };
  const reorder = (id: string, before?: string) => { const current = useVideoEdits.getState().draft!; apply({ clips: reorderVideo(current, id, before) }); setSelected(id); };
  const paste = () => {
    const copied = clipboard.current, current = useVideoEdits.getState().draft!; if (!copied || !current.assets.some(a => a.id === copied.assetId)) return;
    const clip = { ...copied, id: crypto.randomUUID(), transition: 'cut' as const }, clips = [...current.clips];
    clips.splice(Math.max(0, clips.findIndex(c => c.id === selected) + 1), 0, clip);
    apply({ clips }); setSelected(clip.id);
  };
  const trim = (id: string, edge: 'in' | 'out', value: number) => {
    const current = useVideoEdits.getState().draft!, clip = current.clips.find(clip => clip.id === id); if (!clip) return;
    const max = current.assets.find(a => a.id === clip.assetId)!.duration;
    const bounded = edge === 'in' ? Math.max(0, Math.min(clip.out - .1, value)) : Math.max(clip.in + .1, Math.min(max, value));
    apply({ clips: current.clips.map(c => c.id === id ? { ...c, [edge]: bounded } : c) });
  };
  const removeTiming = (index: number) => {
    pause(); const current = useVideoEdits.getState().draft!;
    changeEdit({ cues: removeMarksFrom(current, index) }); setSelectedMark(-1);
  };
  const tap = (eventTime?: number) => {
    const renderer = player.current, current = useVideoEdits.getState().draft!;
    if (!renderer || !ready || exporting || busy || starting.current) return;
    const prefix = orderedMarks(current);
    if (prefix.length >= scoreSteps(current).length) { if (!renderer.isPlaying) void play(); return; }
    if (prefix.length && !renderer.isPlaying && renderer.currentTime <= .001) { void play(); return; }
    const now = prefix.length ? renderer.getMarkTime(eventTime) : 0, cues = appendMark(current, now);
    if (!cues) return;
    changeEdit({ cues }); timeRef.current = prefix.length ? renderer.currentTime : 0; setTime(timeRef.current); setSelectedMark(-1);
    if (!prefix.length) {
      starting.current = true;
      void (async () => { try { await renderer.seek(0); await renderer.play(); setPlaying(true); } catch (value) { editError(value); } finally { starting.current = false; } })();
    }
  };
  const takeFrame = async () => { if (canvas.current && ready) { pause(); try { changeEdit({ thumbnail: await canvasBlob(canvas.current), thumbnailChoice: 'frame' }); } catch (value) { editError(value); } } };
  const downloadThumbnail = () => { if (draft.thumbnail) downloadBlob(draft.thumbnail, `${draft.title || 'pianocanva'}-thumbnail.jpg`); };
  const exportEdit = async () => {
    pause(); setExporting(true); setFinished(false); setProgress(0); useVideoEdits.setState({ error: '' }); cancel.current = new AbortController();
    try {
      try { await saveVideoEdit(); } catch { /* Download remains available after a local storage failure. */ }
      const result = await exportVideoEdit(draft, { resolution, format, signal: cancel.current.signal, onProgress: setProgress });
      downloadBlob(result.blob, `${draft.title || 'pianocanva'}-edited.${result.extension}`); downloadThumbnail(); setFinished(true);
    } catch (value) { if (!(value instanceof DOMException && value.name === 'AbortError')) editError(value); }
    finally { setExporting(false); }
  };
  const importVideo = (files: FileList) => { pause(); timeRef.current = 0; setTime(0); void importVideoFiles(files); };
  const saveOriginal = async () => {
    const source = draft.assets[0]; if (!source || savingOriginal) return;
    setSavingOriginal(true);
    try {
      const picker = (window as unknown as { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
      if (picker) { const handle = await picker.call(window, { suggestedName: source.name }); const file = await handle.createWritable(); await file.write(source.blob); await file.close(); }
      else downloadBlob(source.blob, source.name);
      changeEdit({ originalSaved: true, originalSaveSkipped: false });
      useVideoEdits.setState({ review: false });
    } catch (value) { if (!(value instanceof DOMException && value.name === 'AbortError')) editError(value); }
    finally { setSavingOriginal(false); }
  };
  const next = mode === 'edit' ? 'crop' : mode === 'crop' ? 'sync' : 'export';
  const nextDisabled = exporting || busy || cropBusy || (mode === 'edit' ? !duration : mode === 'crop' ? !steps.length || !duration : mode === 'export' ? !ready || !formats.length : false);
  return <div className="video-editor-backdrop" data-theme={theme}><section ref={workspace} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Score Sync" className={`video-editor mode-${mode}${cropping ? ' is-cropping' : ''}${timing ? ' is-timing' : ''}${panel && !timing && !cropping ? ' inspector-open' : ''}`} onKeyDown={event => {
    if (exporting || busy || cropBusy || review || camera || event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true]')) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.code === 'KeyZ') { event.preventDefault(); if (timing) removeTiming(Math.max(0, marks.length - 1)); else undoEdit(event.shiftKey); return; }
    if (mod && mode === 'edit' && event.code === 'KeyC') { event.preventDefault(); copy(); return; }
    if (mod && mode === 'edit' && event.code === 'KeyY') { event.preventDefault(); undoEdit(true); return; }
    if (mod && mode === 'edit' && event.code === 'KeyX') { event.preventDefault(); removePart(true); return; }
    if (mod && mode === 'edit' && event.code === 'KeyV') { event.preventDefault(); paste(); return; }
    if (mod || event.altKey) return;
    if (event.repeat) { if (['KeyT', 'Space'].includes(event.code)) event.preventDefault(); return; }
    if (event.code === 'KeyT' && timing) { event.preventDefault(); tap(event.timeStamp); }
    if (event.code === 'KeyS' && mode === 'edit') { event.preventDefault(); split(); }
    if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); if (timing && selectedMark >= 0) removeTiming(selectedMark); else if (mode === 'edit') removePart(); }
    if (event.code === 'Space' && !cropping && (!(event.target instanceof HTMLElement && event.target.closest('button')) || !!(event.target instanceof HTMLElement && event.target.closest('.score-focus')))) { event.preventDefault(); void play(); }
  }}>
    <header className="video-editor-header"><IconButton icon={ChevronLeft} label="Back to home" disabled={exporting || busy} onClick={close} /><strong className="editor-wordmark">PianoCanva</strong><span className="editor-document">Score Sync</span><span className="editor-header-spacer" /><span role="status" className="editor-save-status" title={saveStatus === 'saved' ? 'Saved on this device' : saveStatus === 'saving' ? 'Saving' : 'Save failed'}>{saveStatus === 'saved' && <Check size={14} />}</span><IconButton icon={SlidersHorizontal} label="Inspector" disabled={timing || cropping} aria-pressed={panel} onClick={() => setPanel(!panel)} /></header>
    <nav className="editor-nav" aria-label="Score Sync steps">{([{ mode: 'edit', label: 'Video' }, { mode: 'crop', label: 'Crop score' }, { mode: 'sync', label: 'Sync' }, { mode: 'export', label: 'Export' }] as const).map((step, index) => <button key={step.mode} disabled={exporting || busy || cropBusy || step.mode === 'sync' && (!steps.length || !duration)} aria-current={mode === step.mode ? 'step' : undefined} onClick={() => navigate(step.mode)}><span className="editor-step-number">{index + 1}</span>{step.label}</button>)}</nav>
    {error && <div role="alert" className="video-edit-error">{error}<IconButton icon={X} label="Dismiss error" onClick={() => useVideoEdits.setState({ error: '' })} /></div>}

    <div className="video-editor-body">
      <main className="video-editor-main">
        <div className="editor-preview-area" hidden={cropping || timing}>

          <div className="editor-preview-stage" ref={previewStage}><canvas ref={canvas} style={previewSize} width={1280} height={720} className={`video-edit-preview${ready && !exporting ? ' is-adjustable' : ''}`} aria-label="Video preview" tabIndex={0} onPointerDown={event => {
            if (!ready || exporting || busy) return; event.preventDefault(); pause(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
            const bounds = event.currentTarget.getBoundingClientRect(), width = Math.min(bounds.width, bounds.height * 16 / 9), { offsetX, offsetY } = videoTransform(draft);
            drag.current = { x: event.clientX, y: event.clientY, offsetX, offsetY, width, height: width * 9 / 16 };
          }} onPointerMove={event => { const start = drag.current; if (start && !exporting && !busy) changeEdit({ videoOffsetX: Math.max(-1, Math.min(1, start.offsetX + (event.clientX - start.x) * 2 / start.width)), videoOffsetY: Math.max(-1, Math.min(1, start.offsetY + (event.clientY - start.y) * 2 / start.height)) }); }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} />
          {!duration && <div className="preview-empty"><Film size={32} strokeWidth={1} /></div>}</div>
        </div>
        {cropping && <ScoreCropper draft={draft} pause={pause} onBusy={setCropBusy} />}
        {timing && <div className="score-timing-workspace"><div className="timing-heading"><h2>System {activeMark + 1} <span>/ {steps.length}</span></h2><span>{timingGap ? 'Reset timing after editing' : !marks.length ? 'Tap the score to start' : marks.length < steps.length ? `Next: ${marks.length + 1}` : 'Complete'}</span></div>
          <button className="score-focus" disabled={!ready || busy} aria-label={!marks.length ? 'Start performance and mark system 1 at zero' : `Mark system ${Math.min(steps.length, marks.length + 1)}`} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); tap(event.timeStamp); }} onClick={event => { if (event.detail === 0) tap(event.timeStamp); }}><ScoreFocus image={ready && displayedSystem ? player.current?.getScoreImage(displayedSystem.id) : undefined} /><span className="score-focus-hint">{!ready ? 'Loading…' : !marks.length ? <span>Tap the score to start &amp; mark crop 1 · <kbd>T</kbd></span> : marks.length < steps.length ? <span>Tap the score when the next crop starts · <kbd>T</kbd></span> : <Check size={18} />}</span></button>
        </div>}
      {!cropping && <VideoTimeline draft={draft} time={time} playing={playing} ready={ready} disabled={exporting || busy} timing={timing} selected={selected} onSelect={setSelected} onSeek={value => void seek(value)} onPlay={() => void play()} onSplit={split} onDelete={removePart} onPaste={paste} onCopy={copy} onReorder={reorder} onTrim={trim} onUndo={() => timing ? removeTiming(Math.max(0, marks.length - 1)) : undoEdit()} onRedo={() => undoEdit(true)} canUndo={!!history.current.past.length} canRedo={!!history.current.future.length} canPaste={!!clipboard.current} selectedMark={selectedMark} onSelectMark={setSelectedMark} onDeleteMarks={() => removeTiming(selectedMark)} onClearMarks={() => { removeTiming(0); void seek(0); }} />}
      </main>
      {panel && !timing && !cropping && <aside className="video-editor-tools" aria-label="Inspector"><FrameControls draft={draft} final={mode === 'export'} disabled={exporting || busy} />{mode === 'export' && <><fieldset disabled={exporting || busy} className="video-edit-section"><h2>Export</h2><div className="video-edit-row"><label>Format<select aria-label="Export format" value={format} onChange={event => setFormat(event.target.value)}>{formats.map(f => <option key={f.ext} value={f.ext}>{f.ext.toUpperCase()}</option>)}</select></label><label>Size<select aria-label="Export resolution" value={resolution} onChange={event => setResolution(Number(event.target.value) as 720 | 1080)}><option value="720">720p</option><option value="1080">1080p</option></select></label></div>{!formats.length && <p>Video encoding unavailable.</p>}</fieldset>
        <fieldset disabled={exporting || busy} className="video-edit-section thumbnail-panel"><div className="section-heading"><h2>Thumbnail</h2>{draft.thumbnail && <IconButton icon={X} label="Remove thumbnail" onClick={() => changeEdit({ thumbnail: null, thumbnailChoice: null })} />}</div><div className="video-edit-row"><button disabled={!ready} onClick={() => { pause(); setChoosingFrame(true); }}><ImageIcon size={16} />Choose frame</button><IconButton icon={Camera} label="Take a photo" onClick={() => { pause(); setCamera(true); }} /></div>{choosingFrame && <div className="thumbnail-frame-picker"><label>Video frame<input aria-label="Thumbnail frame" type="range" min="0" max={Math.max(0, duration - 1 / 30)} step={1 / 30} value={Math.min(time, Math.max(0, duration - 1 / 30))} onChange={event => void seek(Number(event.target.value))} /></label><button disabled={seeking} onClick={() => { void takeFrame(); setChoosingFrame(false); }}>Use this frame</button></div>}{draft.thumbnail && <><button className="thumbnail-preview-button" aria-label="Choose another thumbnail frame" onClick={() => { pause(); setChoosingFrame(true); }}><BlobImage blob={draft.thumbnail} label="Thumbnail" className="video-edit-thumbnail" /></button><div className="thumbnail-intro"><label><input aria-label="Include as first frame" type="checkbox" checked={!!draft.thumbnailIntro} onChange={event => changeEdit({ thumbnailIntro: event.target.checked })} />Include as first frame</label></div></>}</fieldset></>}{exporting && <div className="export-progress" role="status"><progress value={progress} max={1} /><span>{Math.round(progress * 100)}%</span><button onClick={() => cancel.current?.abort()}>Cancel</button></div>}{finished && <p role="status">Download started.</p>}</aside>}
    </div>
    <footer className="editor-workflow-footer">
      <div className="workflow-source">{mode === 'edit' || mode === 'export' ? <><FileButton label={duration ? "Change video" : "Upload video"} disabled={busy || exporting} onFiles={importVideo} />{draft.originalSaved !== undefined && draft.assets[0] && <IconButton icon={Download} label="Download original recording" onClick={() => downloadBlob(draft.assets[0].blob, draft.assets[0].name)} />}</> : <IconButton icon={ChevronLeft} label="Previous step" disabled={busy || exporting || cropBusy} onClick={() => navigate(mode === 'crop' ? 'edit' : 'crop')} />}</div>
      <button className="edit-primary workflow-next" disabled={nextDisabled} onClick={() => mode === 'export' ? void exportEdit() : navigate(next)}>{mode === 'export' ? <Download size={16} /> : null}{mode === 'export' ? 'Export video' : `Next: ${next === 'crop' ? 'Crop score' : next === 'sync' ? 'Sync' : 'Final Check'}`}{mode !== 'export' && <ArrowRight size={16} />}</button>
      <div className="workflow-zoom">{!cropping && !timing && <><IconButton icon={Minus} label="Zoom out" disabled={!ready || exporting} onClick={() => changeEdit({ videoZoom: Math.max(.25, videoTransform(draft).zoom - .1) })} /><label title="Video zoom"><input aria-label="Video zoom" type="range" min=".25" max="3" step=".01" value={videoTransform(draft).zoom} disabled={!ready || exporting} onChange={event => changeEdit({ videoZoom: Number(event.target.value) })} /><output>{Math.round(videoTransform(draft).zoom * 100)}%</output></label><IconButton icon={Plus} label="Zoom in" disabled={!ready || exporting} onClick={() => changeEdit({ videoZoom: Math.min(3, videoTransform(draft).zoom + .1) })} /></>}</div>
    </footer>
    {review && <div className="recorded-take-gate" role="dialog" aria-modal="true" aria-label="Save recording"><div><Download size={28} /><h2>Your recording is ready</h2><p>Save a copy, or continue to Score Sync.</p><button className="edit-primary" disabled={savingOriginal} onClick={() => void saveOriginal()}>{savingOriginal ? 'Saving…' : 'Save original & continue'}</button><button disabled={savingOriginal} onClick={() => { changeEdit({ originalSaveSkipped: true }); useVideoEdits.setState({ review: false }); }}>Continue without saving</button></div></div>}

    {camera && <ThumbnailCamera onClose={() => setCamera(false)} onPhoto={blob => { changeEdit({ thumbnail: blob, thumbnailChoice: 'photo' }); setCamera(false); }} />}
  </section></div>;
}
function FrameControls({ draft, disabled, final }: { draft: EditDraft; disabled: boolean; final: boolean }) {
  return <fieldset className="video-edit-section frame-controls" disabled={disabled}><div className="section-heading"><h2>{final ? 'Final Check' : 'Score area'}</h2><IconButton icon={RotateCcw} label="Reset layout" onClick={() => changeEdit({ videoZoom: 1, videoOffsetX: 0, videoOffsetY: 0, scoreScale: 1, scoreSpace: .24, scoreLayout: 'above', scoreSizing: 'uniform' })} /></div>
    <label>Score position<select aria-label="Score placement" value={draft.scoreLayout === 'below' ? 'below' : 'above'} onChange={event => changeEdit({ scoreLayout: event.target.value as EditDraft['scoreLayout'] })}><option value="above">Above video</option><option value="below">Below video</option></select></label>
    <label>Score area<output>{Math.round(scoreSpace(draft) * 100)}%</output><input aria-label="Score area" type="range" min=".1" max=".6" step=".01" value={scoreSpace(draft)} onChange={event => changeEdit({ scoreSpace: Number(event.target.value) })} /></label>
    <label>Crop dimensions<select aria-label="Crop dimensions" value={draft.scoreSizing || 'uniform'} onChange={event => changeEdit({ scoreSizing: event.target.value as 'uniform' | 'per-crop' })}><option value="uniform">Same frame · fill sides</option><option value="per-crop">Fit each crop</option></select></label>
    {final && <label>Score size<output>{Math.round(scoreSize(draft.scoreScale) * 100)}%</output><input aria-label="Score size" type="range" min=".25" max="1" step=".01" value={scoreSize(draft.scoreScale)} onChange={event => changeEdit({ scoreScale: Number(event.target.value) })} /></label>}
    <p>Drag the video to frame it.</p>
  </fieldset>;
}
function ScoreFocus({ image }: { image?: ImageBitmap }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const target = canvas.current; if (!target) return; target.width = image?.width || 1; target.height = image?.height || 1; if (image) target.getContext('2d')!.drawImage(image, 0, 0); }, [image]);
  return <canvas ref={canvas} aria-hidden="true" />;
}
function FileButton({ label, disabled, onFiles }: { label: string; disabled?: boolean; onFiles: (files: FileList) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <><button type="button" className="edit-import" disabled={disabled} onClick={() => input.current?.click()}><Upload size={15} strokeWidth={1.7} />{label}</button><input ref={input} hidden aria-label={label} type="file" accept="video/*,.webm,.mp4,.mov" disabled={disabled} onChange={event => { if (event.target.files?.length) onFiles(event.target.files); event.target.value = ''; }} /></>;
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
