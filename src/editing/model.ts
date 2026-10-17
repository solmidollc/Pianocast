export type Transition = 'cut' | 'crossfade' | 'fade';
export interface MediaAsset { id: string; name: string; blob: Blob; duration: number; width: number; height: number }
export interface EditClip { id: string; assetId: string; in: number; out: number; transition: Transition; transitionSeconds: number }
export interface Crop { x: number; y: number; width: number; height: number }
export interface ScoreSystem { id: string; label: string; page: number; crop: Crop; image: Blob; pdfId?: string }
export interface ScoreStep { id: string; systemId: string }
/** Source-anchored cues survive trimming and clip reordering. */
export interface ScoreCue { id: string; clipId: string; sourceTime: number; systemId: string; stepId?: string }
export interface ScorePDF { board: string; id: string; name: string; data: string; count: number }
export interface EditDraft {
  id: string; title: string; updatedAt: string; lastOpenedAt?:string; assets: MediaAsset[]; clips: EditClip[];
  systems: ScoreSystem[]; cues: ScoreCue[]; pdf?: ScorePDF; cropTemplate?: Crop; scoreSequence?: ScoreStep[];
  scoreLayout: 'above' | 'below' | 'overlay'; scoreHeight: number; // Legacy height retained for saved edits.
  scoreSpace?: number; scoreSizing?: 'uniform' | 'per-crop';
  videoZoom?: number; videoOffsetX?: number; videoOffsetY?: number; scoreScale?: number;
  thumbnailIntro?: boolean; thumbnailIntroSeconds?: number;
  originalSaved?: boolean; originalSaveSkipped?: boolean;
  thumbnail: Blob | null; thumbnailChoice: 'frame' | 'photo' | 'skip' | null;
}
export interface Segment { clip: EditClip; start: number; end: number; overlap: number }
export interface TimedCue extends ScoreCue { time: number }
export const MIN_CLIP_SECONDS = 0.1;

export function newDraft(asset?: MediaAsset, recorded = false): EditDraft {
  const now=new Date().toISOString();
  return {
    id: crypto.randomUUID(), title: asset?.name.replace(/\.[^.]+$/, '') || 'Score Sync', updatedAt: now,lastOpenedAt:now,
    assets: asset ? [asset] : [], clips: asset ? [newClip(asset)] : [], systems: [], cues: [],
    scoreLayout: 'above', scoreHeight: 0.24, scoreSpace: 0.24, scoreSizing: 'uniform', videoZoom: 1, videoOffsetY: 0, scoreScale: 1, originalSaved: recorded ? false : undefined, thumbnail: null, thumbnailChoice: null,
  };
}
export function newClip(asset: MediaAsset): EditClip {
  return { id: crypto.randomUUID(), assetId: asset.id, in: 0, out: asset.duration, transition: 'cut', transitionSeconds: 0.5 };
}
/** Older edits used crop order directly. Repeats now reuse the same cropped image. */
export function scoreSteps(draft: Pick<EditDraft, 'systems' | 'scoreSequence'>): ScoreStep[] {
  const ids = new Set(draft.systems.map(system => system.id));
  return (draft.scoreSequence ?? draft.systems.map(system => ({ id: system.id, systemId: system.id }))).filter(step => ids.has(step.systemId));
}
export function scoreNumbers(draft: Pick<EditDraft, 'systems' | 'scoreSequence'>, systemId: string): number[] {
  return scoreSteps(draft).flatMap((step, index) => step.systemId === systemId ? [index + 1] : []);
}
/** Old edits could store a new copy of a crop for every repeat. Show one outline. */
export function scoreCropGroups(draft: Pick<EditDraft, 'systems' | 'scoreSequence'>, page: number, pdfId?: string) {
  const groups: { system: ScoreSystem; ids: string[]; numbers: number[] }[] = [];
  for (const system of draft.systems.filter(system => system.page === page && (!system.pdfId || system.pdfId === pdfId))) {
    const group = groups.find(group => (['x', 'y', 'width', 'height'] as const).every(key => Math.abs(group.system.crop[key] - system.crop[key]) < 0.000001));
    if (group) group.ids.push(system.id);
    else groups.push({ system, ids: [system.id], numbers: [] });
  }
  scoreSteps(draft).forEach((step, index) => groups.find(group => group.ids.includes(step.systemId))?.numbers.push(index + 1));
  return groups;
}
export function firstUnmarkedScoreStep(draft: EditDraft): number {
  const cues = timedCues(draft), marked = new Set(cues.flatMap(cue => cue.stepId ? [cue.stepId] : []));
  const legacy = new Map<string, number>();
  for (const cue of cues) if (!cue.stepId) legacy.set(cue.systemId, (legacy.get(cue.systemId) || 0) + 1);
  const steps = scoreSteps(draft);
  const index = steps.findIndex(step => {
    if (marked.has(step.id)) return false;
    const count = legacy.get(step.systemId) || 0;
    if (count) { legacy.set(step.systemId, count - 1); return false; }
    return true;
  });
  return index < 0 ? steps.length : index;
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
