import { describe, expect, it } from 'vitest';
import { appendMark, deleteVideoPart, orderedMarks, removeMarksFrom, splitVideo, thumbnailIntroDuration, reorderVideo } from './operations';
import { editDuration, newDraft, scoreSteps } from './model';
function draft() {
  const d = newDraft();
  d.clips = [{ id: 'clip', assetId: 'video', in: 0, out: 10, transition: 'cut', transitionSeconds: .5 }];
  d.systems = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id, page: 1, crop: { x: 0, y: 0, width: 1, height: .2 }, image: new Blob() }));
  return d;
}
describe('ordered score marks', () => {
  it('always marks the first system at zero and keeps exact later press times', () => {
    const d = draft(); d.cues = appendMark(d, 4.5)!;
    expect(orderedMarks(d).map(c => c.time)).toEqual([0]);
    d.cues = appendMark(d, 2.01347)!;
    expect(orderedMarks(d).map(c => c.time)).toEqual([0, 2.01347]);
    expect(appendMark(d, 1)).toBeUndefined();
    expect(appendMark(d, 2.02)).toBeUndefined();
    expect(d.cues).toHaveLength(2);
  });
  it('preserves every earlier mark when adding a repeat', () => {
    const d = draft(); d.scoreSequence = [{ id: 'one', systemId: 'a' }, { id: 'two', systemId: 'b' }, { id: 'repeat', systemId: 'a' }];
    for (const t of [0, 2.1, 4.3]) d.cues = appendMark(d, t)!;
    expect(d.cues.map(c => c.systemId)).toEqual(['a', 'b', 'a']);
    expect(d.cues.map(c => c.stepId)).toEqual(['one', 'two', 'repeat']);
    expect(orderedMarks(d).map(c => c.time)).toEqual([0, 2.1, 4.3]);
  });
  it('removes a selected marker and its entire suffix without numbering holes', () => {
    const d = draft(); for (const t of [0, 1, 2, 3, 4]) d.cues = appendMark(d, t)!;
    d.cues = removeMarksFrom(d, 3);
    expect(orderedMarks(d).map(c => c.systemId)).toEqual(['a', 'b', 'c']);
    d.cues = appendMark(d, 5.123)!;
    expect(d.cues.at(-1)?.systemId).toBe('d');
    expect(removeMarksFrom(d, 0)).toEqual([]);
  });
  it('keeps legacy references and does not silently repair or erase timing gaps', () => {
    const d = draft(); d.cues = [{ id: 'a', systemId: 'a', clipId: 'clip', sourceTime: 0 }, { id: 'c', systemId: 'c', clipId: 'clip', sourceTime: 3 }];
    expect(orderedMarks(d).map(c => c.id)).toEqual(['a']);
    expect(appendMark(d, 4)).toBeUndefined();
    expect(d.cues).toHaveLength(2);
  });
});
describe('one source with timeline cuts', () => {
  it('splits without changing duration or source-anchored score times', () => {
    const d = draft(); for (const t of [0, 2, 5]) d.cues = appendMark(d, t)!;
    const split = splitVideo(d, 3)!;
    expect(split.clips.map(c => [c.in, c.out])).toEqual([[0, 3], [3, 10]]);
    expect(editDuration(split.clips)).toBe(10);
    expect(split.cues[2].clipId).toBe(split.clips[1].id);
    expect(orderedMarks({ ...d, ...split }).map(c => c.time)).toEqual([0, 2, 5]);
    expect(splitVideo(d, .05)).toBeUndefined(); expect(splitVideo(d, 9.95)).toBeUndefined();
  });
  it('deleting a marked portion removes subsequent score marks as well', () => {
    let d = draft(); for (const t of [0, 2, 5]) d.cues = appendMark(d, t)!;
    d = { ...d, ...splitVideo(d, 2)! }; d = { ...d, ...splitVideo(d, 4)! };
    const patch = deleteVideoPart(d, d.clips[1].id);
    expect(editDuration(patch.clips)).toBe(8);
    expect(patch.cues.map(c => c.systemId)).toEqual(['a']);
    expect(scoreSteps(d)).toHaveLength(5);
  });
});
it('adds an intro only when a thumbnail is selected and rounds it to whole frames', () => {
  const d = draft(); d.thumbnailIntro = true; expect(thumbnailIntroDuration(d)).toBe(0);
  d.thumbnail = new Blob(); expect(thumbnailIntroDuration(d)).toBe(1 / 30);
  d.thumbnailIntroSeconds = .51; expect(thumbnailIntroDuration(d)).toBe(1 / 30);
  d.thumbnailIntro = false; expect(thumbnailIntroDuration(d)).toBe(0);
});

it('rearranges segments without deleting any source-anchored score mark', () => {
  let d = draft(); for (const time of [0, 2, 5]) d.cues = appendMark(d, time)!;
  d = { ...d, ...splitVideo(d, 3)! };
  const [left, right] = d.clips, cues = [...d.cues];
  d.clips = reorderVideo(d, right.id, left.id);
  expect(d.clips.map(clip => clip.id)).toEqual([right.id, left.id]);
  expect(editDuration(d.clips)).toBe(10); expect(d.cues).toEqual(cues);
  expect(reorderVideo(d, right.id).map(clip => clip.id)).toEqual([left.id, right.id]);
});
