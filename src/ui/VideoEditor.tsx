import { useEffect, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Download, X, Check, SlidersHorizontal, RotateCcw, Upload, Film, Crop, Music2, Play } from 'lucide-react';
import { changeEdit, closeVideoEdit, editError, importVideoFiles, refreshEdits, saveVideoEdit, useVideoEdits } from '../editing/store';
import { dominantSegment, editDuration, formatTime, newClip, timedCues, scoreSteps, type EditDraft, type EditClip, type ScoreCue } from '../editing/model';
import { appendMark, deleteVideoPart, orderedMarks, removeMarksFrom, splitVideo, thumbnailIntroDuration } from '../editing/operations';
import { scoreSize, videoTransform } from '../editing/composition';
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
  const canvas = useRef<HTMLCanvasElement>(null), player = useRef<TimelineRenderer>();
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number; width: number; height: number }>();
  const timeRef = useRef(0), cancel = useRef<AbortController>(), starting = useRef(false);
  const history = useRef<{ past: EditDraft[]; future: EditDraft[] }>({ past: [], future: [] });
  const clipboard = useRef<{ clip: EditClip; cues: ScoreCue[] }>();
  const [, repaint] = useState(0);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(draft.clips[0]?.id || ''), [selectedMark, setSelectedMark] = useState(-1);
  const [mode, setMode] = useState<Mode>('edit'), [panel, setPanel] = useState(() => window.innerWidth >= 850);
  const [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0), [finished, setFinished] = useState(false);
  const [camera, setCamera] = useState(false);
  const [formats, setFormats] = useState<ExportFormat[]>([]), [format, setFormat] = useState('mp4'), [resolution, setResolution] = useState<720 | 1080>(720);
  const duration = editDuration(draft.clips), marks = orderedMarks(draft), steps = scoreSteps(draft);
  const timing = mode === 'sync', cropping = mode === 'crop', timingRef = useRef(timing); timingRef.current = timing;
  const activeMark = Math.max(0, marks.reduce((last, mark, index) => mark.time <= time + .001 ? index : last, -1));
  const displayedStep = steps[activeMark], displayedSystem = draft.systems.find(system => system.id === displayedStep?.systemId);
  const timingGap = timedCues(draft).length > marks.length;
  const close = () => { if (!exporting && !busy) void closeVideoEdit(); };
  useDialogKeyboard(true, 'Video editor', close);
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
  useEffect(() => { player.current?.updateComposition(draft); }, [draft.cues, draft.scoreLayout, draft.videoZoom, draft.videoOffsetX, draft.videoOffsetY, draft.scoreScale]);
  useEffect(() => { player.current?.setPreviewVisible(!timing); }, [timing]);
  useEffect(() => () => cancel.current?.abort(), []);
  useEffect(() => { history.current = { past: [], future: [] }; clipboard.current = undefined; setSelected(draft.clips[0]?.id || ''); }, [draft.assets]);
  const pause = () => { player.current?.pause(); setPlaying(false); };
  const seek = async (value: number) => {
    if (!player.current || exporting) return;
    setPlaying(false); try { await player.current.seek(value); } catch (value) { editError(value); }
  };
  const play = async () => {
    if (!player.current || exporting) return;
    try { if (player.current.isPlaying) pause(); else { await player.current.play(); setPlaying(true); } } catch (value) { editError(value); }
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
    if (cut) clipboard.current = { clip, cues: current.cues.filter(cue => cue.clipId === clip.id) };
    const patch = deleteVideoPart(current, selected); apply(patch); setSelected(patch.clips[0]?.id || '');
  };
  const paste = () => {
    const copied = clipboard.current, current = useVideoEdits.getState().draft!; if (!copied || !current.assets.some(a => a.id === copied.clip.assetId)) return;
    const clip = { ...copied.clip, id: crypto.randomUUID(), transition: 'cut' as const }, clips = [...current.clips];
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
  return <div className="video-editor-backdrop" data-theme={theme}><section role="dialog" aria-modal="true" aria-label="Video editor" className={`video-editor mode-${mode}${cropping ? ' is-cropping' : ''}${timing ? ' is-timing' : ''}${panel && !timing && !cropping ? ' inspector-open' : ''}`} onKeyDown={event => {
    if (camera || event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true]')) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.code === 'KeyZ') { event.preventDefault(); if (timing) removeTiming(Math.max(0, marks.length - 1)); else undoEdit(event.shiftKey); return; }
    if (mod && !timing && event.code === 'KeyX') { event.preventDefault(); removePart(true); return; }
    if (mod && !timing && event.code === 'KeyV') { event.preventDefault(); paste(); return; }
    if (mod || event.altKey) return;
    if (event.repeat) { if (['KeyT', 'Space'].includes(event.code)) event.preventDefault(); return; }
    if (event.code === 'KeyT' && timing) { event.preventDefault(); tap(event.timeStamp); }
    if (event.code === 'KeyS' && mode === 'edit') { event.preventDefault(); split(); }
    if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); if (timing && selectedMark >= 0) removeTiming(selectedMark); else if (mode === 'edit') removePart(); }
    if (event.code === 'Space' && !cropping && (!(event.target instanceof HTMLElement && event.target.closest('button')) || !!(event.target instanceof HTMLElement && event.target.closest('.score-focus')))) { event.preventDefault(); void play(); }
  }}>
    <header className="video-editor-header"><strong className="editor-wordmark">PianoCanva</strong><span className="editor-document" title={draft.title}>{draft.title}</span><span className="editor-header-spacer" /><span role="status" className="editor-save-status" title={saveStatus === 'saved' ? 'Saved on this device' : saveStatus === 'saving' ? 'Saving' : 'Save failed'}>{saveStatus === 'saved' && <Check size={14} />}</span><IconButton icon={SlidersHorizontal} label="Inspector" disabled={timing || cropping} aria-pressed={panel} onClick={() => setPanel(!panel)} /></header>
    <nav className="editor-nav" aria-label="Editing workspace">{([{ mode: 'edit', label: 'Video', icon: Film }, { mode: 'crop', label: 'Score', icon: Crop }, { mode: 'sync', label: 'Sync', icon: Music2 }, { mode: 'export', label: 'Export', icon: Download }] as const).map(step => <button key={step.mode} disabled={exporting || busy || step.mode === 'sync' && (!steps.length || !duration)} aria-current={mode === step.mode ? 'page' : undefined} onClick={() => navigate(step.mode)}><step.icon size={16} strokeWidth={1.7} aria-hidden="true" />{step.label}</button>)}</nav>
    {error && <div role="alert" className="video-edit-error">{error}<IconButton icon={X} label="Dismiss error" onClick={() => useVideoEdits.setState({ error: '' })} /></div>}
    {review && <div className="video-edit-review"><span>Take ready</span><button onClick={() => useVideoEdits.setState({ review: false })}>Edit</button><button disabled={!draft.assets[0]} onClick={() => { const source = draft.assets[0]; if (source) downloadBlob(source.blob, source.name); }}>Download original</button></div>}
    <div className="video-editor-body">
      <main className="video-editor-main">
        <div className="editor-preview-area" hidden={cropping || timing}>
          {draft.assets.length > 0 && <div className="editor-preview-toolbar"><FileButton label={draft.assets.length ? 'Change video' : 'Import video'} disabled={busy || exporting} onFiles={importVideo} /><span title={draft.assets[0]?.name}>{draft.assets[0]?.name}</span></div>}
          <div className="editor-preview-stage"><canvas ref={canvas} width={1280} height={720} className={`video-edit-preview${ready && !exporting ? ' is-adjustable' : ''}`} aria-label="Video preview" tabIndex={0} onPointerDown={event => {
            if (!ready || exporting || busy) return; event.preventDefault(); pause(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
            const bounds = event.currentTarget.getBoundingClientRect(), width = Math.min(bounds.width, bounds.height * 16 / 9), { offsetX, offsetY } = videoTransform(draft);
            drag.current = { x: event.clientX, y: event.clientY, offsetX, offsetY, width, height: width * 9 / 16 };
          }} onPointerMove={event => { const start = drag.current; if (start && !exporting && !busy) changeEdit({ videoOffsetX: Math.max(-1, Math.min(1, start.offsetX + (event.clientX - start.x) * 2 / start.width)), videoOffsetY: Math.max(-1, Math.min(1, start.offsetY + (event.clientY - start.y) * 2 / start.height)) }); }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} />
          {!duration && <div className="preview-empty"><Film size={32} strokeWidth={1} />{!draft.assets.length && <FileButton label="Import video" disabled={busy || exporting} onFiles={importVideo} />}</div>}</div>
        </div>
        {cropping && <ScoreCropper draft={draft} pause={pause} onSync={() => navigate('sync')} onAddVideo={() => navigate('edit')} />}
        {timing && <div className="score-timing-workspace"><div className="timing-heading"><h2>System {activeMark + 1} <span>/ {steps.length}</span></h2><span>{timingGap ? 'Reset timing after editing' : !marks.length ? 'Tap to start' : marks.length < steps.length ? `Next: ${marks.length + 1}` : 'Complete'}</span></div>
          <button className="score-focus" disabled={!ready || busy} aria-label={!marks.length ? 'Start performance and mark system 1 at zero' : `Mark system ${Math.min(steps.length, marks.length + 1)}`} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); tap(event.timeStamp); }} onClick={event => { if (event.detail === 0) tap(event.timeStamp); }}><ScoreFocus image={ready && displayedSystem ? player.current?.getScoreImage(displayedSystem.id) : undefined} /><span className="score-focus-hint">{!ready ? 'Loading…' : !marks.length ? <Play size={18} /> : marks.length < steps.length ? <kbd>T</kbd> : <Check size={18} />}</span></button>
        </div>}
      </main>
      {panel && !timing && !cropping && <aside className="video-editor-tools" aria-label="Inspector"><FrameControls draft={draft} disabled={exporting || busy || !ready} />{mode === 'export' && <><fieldset disabled={exporting || busy} className="video-edit-section"><h2>Export</h2><div className="video-edit-row"><label>Format<select aria-label="Export format" value={format} onChange={event => setFormat(event.target.value)}>{formats.map(f => <option key={f.ext} value={f.ext}>{f.ext.toUpperCase()}</option>)}</select></label><label>Size<select aria-label="Export resolution" value={resolution} onChange={event => setResolution(Number(event.target.value) as 720 | 1080)}><option value="720">720p</option><option value="1080">1080p</option></select></label></div><button className="edit-primary export-button" disabled={!ready || !duration || !formats.length} onClick={() => void exportEdit()}><Download size={16} />Export</button>{!formats.length && <p>Video encoding unavailable.</p>}</fieldset>
        <fieldset disabled={exporting || busy} className="video-edit-section thumbnail-panel"><div className="section-heading"><h2>Thumbnail</h2>{draft.thumbnail && <IconButton icon={X} label="Remove thumbnail" onClick={() => changeEdit({ thumbnail: null, thumbnailChoice: null })} />}</div><div className="video-edit-row"><IconButton icon={ImageIcon} label="Use current frame" disabled={!ready} onClick={() => void takeFrame()} /><IconButton icon={Camera} label="Take a photo" onClick={() => { pause(); setCamera(true); }} /></div>{draft.thumbnail && <><BlobImage blob={draft.thumbnail} label="Thumbnail" className="video-edit-thumbnail" /><div className="thumbnail-intro"><label><input aria-label="Add thumbnail intro" type="checkbox" checked={!!draft.thumbnailIntro} onChange={event => changeEdit({ thumbnailIntro: event.target.checked })} />Intro</label><select aria-label="Thumbnail intro duration" disabled={!draft.thumbnailIntro} value={draft.thumbnailIntroSeconds || 1} onChange={event => changeEdit({ thumbnailIntroSeconds: Number(event.target.value) })}><option value="0.5">0.5 s</option><option value="1">1 s</option><option value="2">2 s</option></select></div></>}</fieldset></>}{exporting && <div className="export-progress" role="status"><progress value={progress} max={1} /><span>{Math.round(progress * 100)}%</span><button onClick={() => cancel.current?.abort()}>Cancel</button></div>}{finished && <p role="status">Download started.</p>}</aside>}
    </div>
    {!cropping && <VideoTimeline draft={draft} time={time} playing={playing} ready={ready} disabled={exporting || busy} timing={timing} selected={selected} onSelect={setSelected} onSeek={value => void seek(value)} onPlay={() => void play()} onSplit={split} onDelete={removePart} onPaste={paste} onTrim={trim} onUndo={() => timing ? removeTiming(Math.max(0, marks.length - 1)) : undoEdit()} onRedo={() => undoEdit(true)} canUndo={!!history.current.past.length} canRedo={!!history.current.future.length} canPaste={!!clipboard.current} selectedMark={selectedMark} onSelectMark={setSelectedMark} onDeleteMarks={() => removeTiming(selectedMark)} onClearMarks={() => { removeTiming(0); void seek(0); }} />}

    {camera && <ThumbnailCamera onClose={() => setCamera(false)} onPhoto={blob => { changeEdit({ thumbnail: blob, thumbnailChoice: 'photo' }); setCamera(false); }} />}
  </section></div>;
}
function FrameControls({ draft, disabled }: { draft: EditDraft; disabled: boolean }) {
  const { zoom, offsetX, offsetY } = videoTransform(draft);
  const slider = (label: string, key: 'videoZoom' | 'videoOffsetX' | 'videoOffsetY' | 'scoreScale', value: number, min: number, max: number) => <label>{label}<output>{Math.round(value * 100)}%</output><input aria-label={label} type="range" min={min} max={max} step=".01" value={value} onChange={event => changeEdit({ [key]: Number(event.target.value) })} /></label>;
  return <fieldset className="video-edit-section frame-controls" disabled={disabled}><div className="section-heading"><h2>Layout</h2><IconButton icon={RotateCcw} label="Reset layout" onClick={() => changeEdit({ videoZoom: 1, videoOffsetX: 0, videoOffsetY: 0, scoreScale: 1 })} /></div>{draft.systems.length > 0 && slider('Score size', 'scoreScale', scoreSize(draft.scoreScale), .25, 1)}{slider('Video size', 'videoZoom', zoom, .25, 3)}{slider('Horizontal', 'videoOffsetX', offsetX, -1, 1)}{slider('Vertical', 'videoOffsetY', offsetY, -1, 1)}{draft.systems.length > 0 && <label>Score<select aria-label="Score placement" value={draft.scoreLayout} onChange={event => changeEdit({ scoreLayout: event.target.value as EditDraft['scoreLayout'] })}><option value="above">Above video</option><option value="overlay">Over video</option></select></label>}</fieldset>;
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
