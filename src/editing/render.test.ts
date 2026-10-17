import { afterEach, expect, it, vi } from 'vitest';
import { TimelineRenderer } from './render';
import { timeline } from './model';
afterEach(() => vi.restoreAllMocks());
function renderer() {
  const video = { currentTime: 2, seeking: false, ended: false };
  const renderer = Object.assign(Object.create(TimelineRenderer.prototype), {
    playing: true, position: 1.9, duration: 10, clockClipId: 'clip',
    segments: timeline([{ id: 'clip', assetId: 'v', in: 0, out: 10, transition: 'cut', transitionSeconds: .5 }]),
    sources: new Map([['clip', { video }]]),
    audio: { currentTime: 10, getOutputTimestamp: () => ({ contextTime: 9.95 }), baseLatency: .01, outputLatency: .04 },
  }) as TimelineRenderer;
  return { renderer, video };
}
it('uses actual media time without drifting while decoding or buffering stalls', () => {
  const r = renderer(); vi.spyOn(performance, 'now').mockReturnValue(1000);
  expect(r.renderer.currentTime).toBe(2);
  vi.spyOn(performance, 'now').mockReturnValue(2000);
  expect(r.renderer.currentTime).toBe(2);
  r.video.currentTime = 2.25; expect(r.renderer.currentTime).toBe(2.25);
  r.video.seeking = true; expect(r.renderer.currentTime).toBe(1.9);
});
it('captures the audible press instant, accounting for output latency and queued events', () => {
  const r = renderer(); vi.spyOn(performance, 'now').mockReturnValue(1000);
  expect(r.renderer.getMarkTime(900)).toBeCloseTo(1.85);
  expect(r.renderer.getMarkTime(1000)).toBeCloseTo(1.95);
});
