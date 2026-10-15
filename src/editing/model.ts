export type Transition = 'cut' | 'crossfade' | 'fade';
export interface MediaAsset { id: string; name: string; blob: Blob; duration: number; width: number; height: number }
export interface EditClip { id: string; assetId: string; in: number; out: number; transition: Transition; transitionSeconds: number }
export interface Crop { x: number; y: number; width: number; height: number }
export interface ScoreSystem { id: string; label: string; page: number; crop: Crop; image: Blob }
/** Source-anchored cues survive trimming and clip reordering. */
export interface ScoreCue { id: string; clipId: string; sourceTime: number; systemId: string }
export interface ScorePDF { board: string; id: string; name: string; data: string; count: number }
export interface EditDraft {
  id: string; title: string; updatedAt: string; assets: MediaAsset[]; clips: EditClip[];
  systems: ScoreSystem[]; cues: ScoreCue[]; pdf?: ScorePDF; cropTemplate?: Crop;
  scoreLayout: 'above' | 'overlay'; scoreHeight: number; // Legacy height retained for saved edits.
  videoZoom?: number; videoOffsetY?: number; scoreScale?: number;
  thumbnail: Blob | null; thumbnailChoice: 'frame' | 'photo' | 'skip' | null;
}
export interface Segment { clip: EditClip; start: number; end: number; overlap: number }
export interface TimedCue extends ScoreCue { time: number }
export const MIN_CLIP_SECONDS = 0.1;

export function newDraft(asset?: MediaAsset, recorded = false): EditDraft {
  return {
    id: crypto.randomUUID(), title: asset?.name.replace(/\.[^.]+$/, '') || 'Video edit', updatedAt: new Date().toISOString(),
    assets: asset ? [asset] : [], clips: asset ? [newClip(asset)] : [], systems: [], cues: [],
    scoreLayout: recorded ? 'overlay' : 'above', scoreHeight: recorded ? 0.22 : 0.24, videoZoom: 1, videoOffsetY: 0, scoreScale: 1, thumbnail: null, thumbnailChoice: null,
  };
}
export function newClip(asset: MediaAsset): EditClip {
  return { id: crypto.randomUUID(), assetId: asset.id, in: 0, out: asset.duration, transition: 'cut', transitionSeconds: 0.5 };
}
export function clipLength(clip: EditClip) { return Math.max(0, clip.out - clip.in); }
export function timeline(clips: EditClip[]): Segment[] {
  let start = 0;
  return clips.map((clip, index) => {
    const length = clipLength(clip), next = clips[index + 1];
    const overlap = clip.transition === 'crossfade' && next ? Math.max(0, Math.min(clip.transitionSeconds, length / 2, clipLength(next) / 2)) : 0;
    const segment = { clip, start, end: start + length, overlap };
    start = segment.end - overlap;
    return segment;
  });
}
export function editDuration(clips: EditClip[]) { return timeline(clips).at(-1)?.end ?? 0; }
export function activeSegments(clips: EditClip[], time: number) {
  const segments = timeline(clips), total = segments.at(-1)?.end ?? 0;
  const t = Math.max(0, Math.min(Math.max(0, total - 0.001), time));
  return segments.flatMap((segment, index) => {
    if (t < segment.start || t >= segment.end) return [];
    return [{ ...segment, ...segmentWeights(segments, index, t), sourceTime: segment.clip.in + t - segment.start }];
  });
}
export function dominantSegment(clips: EditClip[], time: number) {
  return activeSegments(clips, time).sort((a, b) => b.gain - a.gain)[0];
}
export function timedCues(draft: Pick<EditDraft, 'clips' | 'cues' | 'systems'>): TimedCue[] {
  const segments = timeline(draft.clips), systems = new Set(draft.systems.map(s => s.id));
  return draft.cues.flatMap(cue => {
    const segment = segments.find(s => s.clip.id === cue.clipId);
    return segment && systems.has(cue.systemId) && cue.sourceTime >= segment.clip.in && cue.sourceTime < segment.clip.out
      ? [{ ...cue, time: segment.start + cue.sourceTime - segment.clip.in }] : [];
  }).sort((a, b) => a.time - b.time);
}
export function scoreAt(draft: EditDraft, time: number): ScoreSystem | undefined {
  const cue = timedCues(draft).filter(c => c.time <= time + 0.001).at(-1);
  return cue ? draft.systems.find(s => s.id === cue.systemId) : undefined;
}
export function cropPixels(crop: Crop, width: number, height: number) {
  const x = Math.max(0, Math.min(1, crop.x)), y = Math.max(0, Math.min(1, crop.y));
  return { x: Math.round(x * width), y: Math.round(y * height), width: Math.max(1, Math.round(Math.min(1 - x, Math.max(0, crop.width)) * width)), height: Math.max(1, Math.round(Math.min(1 - y, Math.max(0, crop.height)) * height)) };
}
/** Shared envelope for preview video and offline audio mixing. */
export function segmentWeights(segments: Segment[], index: number, time: number) {
  const segment = segments[index], previous = segments[index - 1];
  let opacity = previous?.overlap ? Math.min(1, (time - segment.start) / previous.overlap) : 1;
  const gain = segment.overlap && time > segment.end - segment.overlap ? (segment.end - time) / segment.overlap : opacity;
  if (previous?.clip.transition === 'fade') opacity *= Math.min(1, (time - segment.start) / Math.max(0.001, Math.min(previous.clip.transitionSeconds / 2, clipLength(segment.clip) / 2)));
  if (segment.clip.transition === 'fade' && segments[index + 1]) opacity *= Math.min(1, (segment.end - time) / Math.max(0.001, Math.min(segment.clip.transitionSeconds / 2, clipLength(segment.clip) / 2)));
  return { opacity: Math.max(0, opacity), gain: Math.max(0, Math.min(gain, opacity)) };
}

export function formatTime(time: number) {
  const total = Math.floor(Number.isFinite(time) ? Math.max(0, time) : 0);
  const seconds = String(total % 60).padStart(2, '0');
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${seconds}`
    : `${Math.floor(total / 60)}:${seconds}`;
}
export function parseTime(text: string): number | undefined {
  if (!/^\d+:([0-5]\d)(:[0-5]\d)?$/.test(text.trim())) return;
  const parts = text.trim().split(':').map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}
/** Center the reusable frame without shrinking it at the page edges. */
export function placeCrop(template: Crop, x: number, y: number): Crop {
  const width = Math.min(1, Math.max(0.001, template.width)), height = Math.min(1, Math.max(0.001, template.height));
  return { x: Math.max(0, Math.min(1 - width, x - width / 2)), y: Math.max(0, Math.min(1 - height, y - height / 2)), width, height };
}
