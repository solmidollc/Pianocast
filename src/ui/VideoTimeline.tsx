import { useEffect, useRef, useState } from 'react';
import { Scissors, ScissorsLineDashed as ClipboardCut, ClipboardPaste, Trash2, Undo2, Redo2, Play, Pause, SkipBack } from 'lucide-react';
import { editDuration, formatTime, timeline, type EditDraft } from '../editing/model';
import { orderedMarks } from '../editing/operations';
import { IconButton } from './EditorControls';
import { mediaEvent, seekMedia } from '../editing/media';

interface Props {
  draft: EditDraft; time: number; playing: boolean; ready: boolean; disabled: boolean; timing: boolean;
  selected: string; onSelect: (id: string) => void; onSeek: (time: number) => void; onPlay: () => void;
  onSplit: () => void; onDelete: (cut?: boolean) => void; onPaste: () => void;
  onTrim: (id: string, edge: 'in' | 'out', value: number) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; canPaste: boolean;
  selectedMark: number; onSelectMark: (index: number) => void; onDeleteMarks: () => void; onClearMarks: () => void;
}
export function VideoTimeline(p: Props) {
  const duration = editDuration(p.draft.clips), segments = timeline(p.draft.clips), marks = orderedMarks(p.draft);
  const track = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; edge: 'in' | 'out'; x: number; value: number; scale: number; lower: number; upper: number }>();
  const [trim, setTrim] = useState<{ id: string; edge: string; value: number }>();
  const [posters, setPosters] = useState<string[]>([]);
  const source = p.draft.assets[0];
  useEffect(() => {
    let stale = false; setPosters([]); if (!source) return;
    const video = document.createElement('video'), url = URL.createObjectURL(source.blob); video.muted = true; video.preload = 'auto';
    void (async () => {
      const metadata = mediaEvent(video, 'loadedmetadata'); video.src = url; await metadata;
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const images: string[] = [];
      for (let i = 0; i < 6 && !stale; i++) {
        await seekMedia(video, Math.min(source.duration - .05, source.duration * i / 6)); if (stale) return;
        canvas.getContext('2d')!.drawImage(video, 0, 0, 160, 90); images.push(canvas.toDataURL('image/jpeg', .6));
      }
      if (!stale) setPosters(images);
    })().catch(() => {});
    return () => { stale = true; video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); };
  }, [source]);
  // Keep closely spaced timestamps readable; playback follows the playhead automatically.
  const closest = marks.slice(1).reduce((gap, mark, index) => Math.min(gap, mark.time - marks[index].time), duration);
  const width = p.timing ? Math.max(100, marks.length * 64, duration / Math.max(1 / 30, closest) * 64 + 56) : 100;
  useEffect(() => {
    if (!p.timing || !scroller.current) return;
    const box = scroller.current, x = timePercent(p.time, duration) * box.scrollWidth / 100;
    if (x > box.scrollLeft + box.clientWidth - 30 || x < box.scrollLeft) box.scrollLeft = Math.max(0, x - box.clientWidth * .6);
  }, [marks.length, p.time, p.timing, duration]);
  return <section className={`editor-timeline${p.timing ? ' score-timeline' : ''}`} aria-label={p.timing ? 'Score timeline' : 'Video timeline'}>
    <div className="timeline-toolbar"><div className="timeline-tools">
      {p.timing ? <><IconButton icon={Undo2} label="Remove last timing" disabled={!marks.length || p.disabled} onClick={p.onUndo} /><IconButton icon={Trash2} label={p.selectedMark >= 0 ? `Remove system ${p.selectedMark + 1} and all following timings` : 'Select a timing to remove'} disabled={p.selectedMark < 0 || p.disabled} onClick={p.onDeleteMarks} /><button className="editor-text-button" disabled={!p.draft.cues.length || p.disabled} onClick={p.onClearMarks}>Reset</button></> : <><IconButton icon={Scissors} label="Split at playhead (S)" disabled={!p.ready || p.disabled} onClick={p.onSplit} /><IconButton icon={ClipboardCut} label="Cut selected segment" disabled={!p.selected || p.disabled} onClick={() => p.onDelete(true)} /><IconButton icon={Trash2} label="Delete selected segment" disabled={!p.selected || p.disabled} onClick={() => p.onDelete()} />{p.canPaste && <IconButton icon={ClipboardPaste} label="Paste segment" disabled={p.disabled} onClick={p.onPaste} />}<span className="timeline-divider" /><IconButton icon={Undo2} label="Undo edit" disabled={!p.canUndo || p.disabled} onClick={p.onUndo} /><IconButton icon={Redo2} label="Redo edit" disabled={!p.canRedo || p.disabled} onClick={p.onRedo} /></>}
    </div><div className="timeline-play"><IconButton icon={SkipBack} label="Go to start" disabled={!p.ready || p.disabled} onClick={() => p.onSeek(0)} /><IconButton icon={p.playing ? Pause : Play} label={p.playing ? 'Pause' : 'Play'} disabled={!p.ready || p.disabled} onClick={p.onPlay} /></div><output>{formatTime(p.time)} <span>/ {formatTime(duration)}</span></output></div>
    <div ref={scroller} className="timeline-scroll"><div className="timeline-content" style={{ minWidth: p.timing ? `${width}px` : undefined }}>
      <div className="timeline-ruler" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <span key={i} style={{ left: `${i * 12.5}%` }}>{formatTime(duration * i / 8)}</span>)}</div>
      <div className="timeline-seek"><input aria-label="Video playhead" type="range" min="0" max={Math.max(.01, duration)} step="0.001" value={Math.min(p.time, duration)} disabled={!p.ready || p.disabled} onChange={event => p.onSeek(Number(event.target.value))} /></div>
      {p.timing ? <div className="timeline-markers">{marks.map((cue, index) => <button key={cue.id} data-time={cue.time} className={p.selectedMark === index ? 'selected' : ''} style={{ left: `${timePercent(cue.time, duration)}%` }} aria-label={`System ${index + 1} at ${markTime(cue.time)}`} title={`System ${index + 1} · ${markTime(cue.time)}`} onClick={() => { p.onSelectMark(index); p.onSeek(cue.time); }}><strong>{index + 1}</strong><time>{markTime(cue.time)}</time></button>)}</div> : <div ref={track} className="timeline-track" aria-label="Video segments">
        {!segments.length && <span className="timeline-empty">Import video</span>}
        {segments.map((segment, index) => <div key={segment.clip.id} className={`timeline-segment${p.selected === segment.clip.id ? ' selected' : ''}`} style={{ left: `${timePercent(segment.start, duration)}%`, width: `${(segment.end - segment.start) / Math.max(.01, duration) * 100}%` }}>
          <button className="timeline-segment-select" aria-label={`Select segment ${index + 1}`} aria-pressed={p.selected === segment.clip.id} onClick={() => p.onSelect(segment.clip.id)}><span className="segment-filmstrip">{posters.map((url, i) => <img src={url} alt="" key={i} />)}</span><span className="segment-name">{p.draft.assets.find(a => a.id === segment.clip.assetId)?.name}</span></button>
          {(['in', 'out'] as const).map(edge => <button key={edge} className={`timeline-trim trim-${edge}`} role="slider" aria-label={`Trim ${edge === 'in' ? 'start' : 'end'} of segment ${index + 1}`} aria-valuemin={edge === 'in' ? 0 : segment.clip.in + .1} aria-valuemax={edge === 'in' ? segment.clip.out - .1 : p.draft.assets.find(a => a.id === segment.clip.assetId)!.duration} aria-valuenow={segment.clip[edge]} aria-valuetext={formatTime(segment.clip[edge])} disabled={p.disabled} onPointerDown={event => {
            event.stopPropagation(); p.onSelect(segment.clip.id); event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { id: segment.clip.id, edge, x: event.clientX, value: segment.clip[edge], scale: duration / track.current!.getBoundingClientRect().width, lower: edge === 'in' ? 0 : segment.clip.in + .1, upper: edge === 'in' ? segment.clip.out - .1 : p.draft.assets.find(a => a.id === segment.clip.assetId)!.duration };
          }} onPointerMove={event => { const d = drag.current; if (d) setTrim({ id: d.id, edge: d.edge, value: Math.max(d.lower, Math.min(d.upper, d.value + (event.clientX - d.x) * d.scale)) }); }} onPointerUp={event => { const d = drag.current; if (!d) return; const value = Math.max(d.lower, Math.min(d.upper, d.value + (event.clientX - d.x) * d.scale)); drag.current = undefined; setTrim(undefined); p.onTrim(d.id, d.edge, value); }} onPointerCancel={() => { drag.current = undefined; setTrim(undefined); }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const amount = (event.shiftKey ? 1 : .1) * (event.key === 'ArrowLeft' ? -1 : 1); p.onTrim(segment.clip.id, edge, segment.clip[edge] + amount); } }} />)}
          {trim?.id === segment.clip.id && <output className="trim-readout">{formatTime(trim.value)}</output>}
        </div>)}
        <div className="timeline-needle" style={{ left: `${timePercent(p.time, duration)}%` }} />
      </div>}
    </div></div>
  </section>;
}
function timePercent(time: number, duration: number) { return Math.max(0, Math.min(100, time / Math.max(.01, duration) * 100)); }
function markTime(time: number) { return `${formatTime(time)}.${Math.floor(time % 1 * 100).toString().padStart(2, '0')}`; }
