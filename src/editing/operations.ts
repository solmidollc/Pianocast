import { dominantSegment, editDuration, scoreSteps, timedCues, type EditClip, type EditDraft, type ScoreCue, type TimedCue } from './model';

/** Only a consecutive, chronological prefix is markable; legacy IDs remain readable. */
export function orderedMarks(draft: EditDraft): TimedCue[] {
  const available = timedCues(draft), used = new Set<string>(), result: TimedCue[] = [];
  for (const step of scoreSteps(draft)) {
    const cue = available.find(c => !used.has(c.id) && (c.stepId ? c.stepId === step.id : c.systemId === step.systemId));
    if (!cue || result.length && cue.time <= result[result.length - 1].time) break;
    used.add(cue.id); result.push(cue);
  }
  return result;
}
export function removeMarksFrom(draft: EditDraft, index: number): ScoreCue[] {
  const keep = new Set(orderedMarks(draft).slice(0, Math.max(0, index)).map(cue => cue.id));
  return draft.cues.filter(cue => keep.has(cue.id));
}
export function appendMark(draft: EditDraft, time: number): ScoreCue[] | undefined {
  const marks = orderedMarks(draft), step = scoreSteps(draft)[marks.length];
  // Never replace a neighboring cue, skip a step, or silently erase old gaps.
  if (!step || timedCues(draft).length !== marks.length) return;
  const at = marks.length ? time : 0;
  if (marks.length && at < marks[marks.length - 1].time + 1 / 30 - 1e-6) return;
  if (at < 0 || at >= editDuration(draft.clips)) return;
  const segment = dominantSegment(draft.clips, at); if (!segment) return;
  return [...draft.cues, { id: crypto.randomUUID(), clipId: segment.clip.id, sourceTime: segment.sourceTime, systemId: step.systemId, stepId: step.id }];
}
export function splitVideo(draft: EditDraft, time: number): Pick<EditDraft, 'clips' | 'cues'> | undefined {
  const segment = dominantSegment(draft.clips, time); if (!segment) return;
  const clip = segment.clip, at = segment.sourceTime;
  if (at - clip.in < 0.1 || clip.out - at < 0.1) return;
  const right: EditClip = { ...clip, id: crypto.randomUUID(), in: at };
  return {
    clips: draft.clips.flatMap(old => old.id === clip.id ? [{ ...clip, out: at, transition: 'cut' as const }, right] : [old]),
    cues: draft.cues.map(cue => cue.clipId === clip.id && cue.sourceTime >= at ? { ...cue, clipId: right.id } : cue),
  };
}
export function deleteVideoPart(draft: EditDraft, id: string): Pick<EditDraft, 'clips' | 'cues'> {
  const clips = draft.clips.filter(clip => clip.id !== id);
  const candidate = { ...draft, clips };
  // The edit explicitly removes this portion; retain only the ordered timing prefix.
  const prefix = orderedMarks(candidate), keep = new Set(prefix.map(cue => cue.id));
  return { clips, cues: draft.cues.filter(cue => keep.has(cue.id)) };
}
export function thumbnailIntroDuration(draft: Pick<EditDraft, 'thumbnail' | 'thumbnailIntro' | 'thumbnailIntroSeconds'>) {
  if (!draft.thumbnail || !draft.thumbnailIntro) return 0;
  const seconds = Number.isFinite(draft.thumbnailIntroSeconds) ? draft.thumbnailIntroSeconds! : 1;
  return Math.round(Math.max(0.25, Math.min(3, seconds)) * 30) / 30;
}
