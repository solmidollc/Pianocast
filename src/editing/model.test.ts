import { describe, expect, it } from 'vitest';
import { activeSegments, cropPixels, formatTime, parseTime, placeCrop, editDuration, scoreAt, scoreCropGroups, scoreNumbers, scoreSteps, firstUnmarkedScoreStep, timedCues, timeline, type EditClip, type EditDraft } from './model';

const a: EditClip = { id: 'a', assetId: 'red', in: 0.5, out: 2.5, transition: 'crossfade', transitionSeconds: 0.5 };
const b: EditClip = { id: 'b', assetId: 'blue', in: 0.25, out: 2.75, transition: 'cut', transitionSeconds: 0.5 };
const draft = (): EditDraft => ({ id: 'edit', title: 'Performance', updatedAt: '', assets: [], clips: [a, b], scoreLayout: 'above', scoreHeight: 0.24, thumbnail: null, thumbnailChoice: null,
  systems: [{ id: 'staff-1', label: 'First', page: 1, crop: { x: 0, y: 0, width: 1, height: 0.2 }, image: new Blob() }, { id: 'staff-2', label: 'Second', page: 2, crop: { x: 0, y: 0.2, width: 1, height: 0.2 }, image: new Blob() }],
  cues: [{ id: 'c1', clipId: 'a', sourceTime: 1, systemId: 'staff-1' }, { id: 'c2', clipId: 'b', sourceTime: 0.75, systemId: 'staff-2' }],
});

describe('score performance order', () => {
  it('keeps older edits in crop order without rewriting their images or cues', () => {
    const edit = draft();
    expect(scoreSteps(edit)).toEqual([{ id: 'staff-1', systemId: 'staff-1' }, { id: 'staff-2', systemId: 'staff-2' }]);
    expect(scoreNumbers(edit, 'staff-1')).toEqual([1]);
    expect(firstUnmarkedScoreStep(edit)).toBe(2);
    expect(edit.scoreSequence).toBeUndefined();
  });
  it('numbers repeats by occurrence while reusing the same cropped image', () => {
    const edit = draft();
    edit.scoreSequence = [{ id: 'one', systemId: 'staff-1' }, { id: 'two', systemId: 'staff-2' }, { id: 'three', systemId: 'staff-1' }];
    expect(scoreNumbers(edit, 'staff-1')).toEqual([1, 3]);
    expect(scoreNumbers(edit, 'staff-2')).toEqual([2]);
    expect(edit.systems).toHaveLength(2);
    // A legacy mark covers one occurrence, rather than every repeat of the crop.
    expect(firstUnmarkedScoreStep(edit)).toBe(2);
    edit.cues.push({ id: 'repeat', clipId: 'b', sourceTime: 2, systemId: 'staff-1', stepId: 'three' });
    expect(firstUnmarkedScoreStep(edit)).toBe(3);
    expect(scoreAt(edit, 3.25)?.id).toBe('staff-1');
  });
  it('does not treat a later repeat as the unmarked first occurrence', () => {
    const edit = draft();
    edit.scoreSequence = [{ id: 'one', systemId: 'staff-1' }, { id: 'two', systemId: 'staff-1' }];
    edit.cues = [{ ...edit.cues[0], stepId: 'two' }];
    expect(firstUnmarkedScoreStep(edit)).toBe(0);
    edit.clips = [{ ...a, in: 1.25 }];
    expect(firstUnmarkedScoreStep(edit)).toBe(0);
  });
  it('ignores missing crops and respects an explicitly empty performance order', () => {
    const edit = draft();
    edit.scoreSequence = [{ id: 'missing', systemId: 'deleted' }, { id: 'two', systemId: 'staff-2' }];
    expect(scoreNumbers(edit, 'staff-2')).toEqual([1]);
    edit.scoreSequence = [];
    expect(scoreSteps(edit)).toEqual([]);
  });
  it('groups old duplicate crops into one numbered outline without rewriting their cues', () => {
    const edit = draft(); edit.systems.push({ ...edit.systems[0], id: 'old-repeat' });
    const groups = scoreCropGroups(edit, 1);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual(['staff-1', 'old-repeat']);
    expect(groups[0].numbers).toEqual([1, 3]);
    expect(edit.systems).toHaveLength(3); expect(edit.cues).toHaveLength(2);
    edit.systems[2].pdfId = 'another-pdf';
    expect(scoreCropGroups(edit, 1, 'original-pdf')[0].numbers).toEqual([1]);
  });
});

describe('video edit timing and score synchronization', () => {
  it('overlaps a crossfade and gives it complementary audio weights', () => {
    expect(editDuration([a, b])).toBe(4);
    const active = activeSegments([a, b], 1.75);
    expect(active).toHaveLength(2);
    expect(active.map(s => s.gain)).toEqual([0.5, 0.5]);
    expect(active.map(s => s.opacity)).toEqual([1, 0.5]);
  });
  it('caps transitions on short clips to prevent three-way overlap', () => {
    const clip = { ...a, in: 0, out: 0.2, transitionSeconds: 3 };
    const segments = timeline([clip, { ...clip, id: 'b' }, { ...clip, id: 'c' }]);
    expect(segments[0].overlap).toBe(0.1);
    expect(activeSegments(segments.map(s => s.clip), 0.15)).toHaveLength(2);
  });
  it('fades through black without changing total duration', () => {
    const clips = [{ ...a, transition: 'fade' as const }, b];
    expect(editDuration(clips)).toBe(4.5);
    expect(activeSegments(clips, 2)[0].opacity).toBe(0);
    expect(activeSegments(clips, 2.125)[0].gain).toBeCloseTo(0.5);
  });
  it('keeps cues attached to source media after trimming and reordering', () => {
    const edit = draft();
    expect(timedCues(edit).map(c => c.time)).toEqual([0.5, 2]);
    edit.clips = [{ ...b, transition: 'cut' }, { ...a, in: 0.75 }];
    expect(timedCues(edit).map(c => [c.id, c.time])).toEqual([['c2', 0.5], ['c1', 2.75]]);
    expect(scoreAt(edit, 0.6)?.id).toBe('staff-2');
  });
  it('excludes trimmed-away cues and changes the displayed crop at the marked time', () => {
    const edit = draft();
    expect(scoreAt(edit, 0.49)).toBeUndefined();
    expect(scoreAt(edit, 0.5)?.id).toBe('staff-1');
    expect(scoreAt(edit, 2)?.id).toBe('staff-2');
    edit.clips = [{ ...a, in: 1.25 }, b];
    expect(timedCues(edit).map(c => c.id)).toEqual(['c2']);
    expect(edit.cues).toHaveLength(2);
  });
  it('constrains the crop to PDF page pixels', () => {
    expect(cropPixels({ x: 0.8, y: 0.9, width: 0.5, height: 0.5 }, 1000, 2000)).toEqual({ x: 800, y: 1800, width: 200, height: 200 });
  });
});


describe('readable clocks and reusable score frames', () => {
  it('shows minutes and seconds, introducing hours only when needed', () => {
    expect([0, 9.99, 65.3, 3599.99, 3600, 7265, -1, Infinity].map(formatTime))
      .toEqual(['0:00', '0:09', '1:05', '59:59', '1:00:00', '2:01:05', '0:00', '0:00']);
    expect(parseTime('12:34')).toBe(754);
    expect(parseTime('1:02:03')).toBe(3723);
    for (const value of ['12.34', '1:99', '1:60:00', '-1:00', 'abc', '']) expect(parseTime(value)).toBeUndefined();
  });
  it('preserves the first frame size when placing crops against page edges', () => {
    const first = { x: 0.05, y: 0.1, width: 0.9, height: 0.2 };
    expect(placeCrop(first, 0.5, 0.65)).toEqual({ x: expect.closeTo(0.05), y: 0.55, width: 0.9, height: 0.2 });
    expect(placeCrop(first, 0, 1)).toEqual({ x: 0, y: 0.8, width: 0.9, height: 0.2 });
    expect(first.y).toBe(0.1);
  });
});
