import { describe, expect, it } from 'vitest';
import { scoreBandHeight, scoreContentBounds, videoRect, videoTransform } from './composition';

function page(width = 80, height = 40) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  return { pixels, ink(x: number, y: number, color = [0, 0, 0, 255]) { pixels.set(color, (y * width + x) * 4); } };
}

describe('score content sizing', () => {
  it('removes blank margins while preserving the entire grand staff and its edge marks', () => {
    const p = page();
    for (const y of [10, 12, 14, 20, 22, 24]) for (let x = 15; x <= 65; x++) p.ink(x, y);
    p.ink(11, 8); // A clef or fingering outside the staff lines.
    p.ink(68, 27, [220, 50, 90, 255]); // Colored annotation must remain visible.
    expect(scoreContentBounds(p.pixels, 80, 40)).toEqual({ x: 10, y: 7, width: 60, height: 22 });
  });
  it('treats transparent pixels as empty and leaves a blank crop usable', () => {
    const p = page(); p.ink(0, 0, [0, 0, 0, 0]);
    expect(scoreContentBounds(p.pixels, 80, 40)).toEqual({ x: 0, y: 0, width: 80, height: 40 });
    p.ink(40, 20);
    expect(scoreContentBounds(p.pixels, 80, 40)).toEqual({ x: 39, y: 19, width: 3, height: 3 });
  });
  it('uses the full width without fixed strip padding and keeps tall crops intact', () => {
    expect(scoreBandHeight({ width: 1000, height: 200 }, 1280, 720)).toBe(256);
    expect(scoreBandHeight({ width: 200, height: 1000 }, 1280, 720)).toBe(540);
    expect(scoreBandHeight(undefined, 1280, 720)).toBe(0);
  });
});

describe('video composition', () => {
  it('loads existing edits at their original size and position', () => {
    expect(videoTransform({})).toEqual({ zoom: 1, offsetY: 0 });
    const r = videoRect({ scoreLayout: 'above' }, 1280, 720, 1920, 1080, 160);
    expect(r.y).toBe(160); expect(r.height).toBe(560);
    expect(r.width / r.height).toBeCloseTo(1920 / 1080);
    expect(r.x + r.width / 2).toBeCloseTo(640);
  });
  it('scales both dimensions together for portrait and landscape clips', () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920]]) for (const zoom of [0.25, 1, 1.8, 3]) {
      const original = videoRect({ scoreLayout: 'above' }, 1280, 720, w, h, 180);
      const r = videoRect({ scoreLayout: 'above', videoZoom: zoom }, 1280, 720, w, h, 180);
      expect(r.width / r.height).toBeCloseTo(w / h);
      expect(r.width).toBeCloseTo(original.width * zoom);
      expect(r.height).toBeCloseTo(original.height * zoom);
      expect(r.x + r.width / 2).toBeCloseTo(640);
    }
  });
  it('moves only vertically, including when the enlarged video extends beyond the frame', () => {
    const base = { scoreLayout: 'overlay' as const, videoZoom: 2 };
    const center = videoRect(base, 1280, 720, 1920, 1080, 180);
    for (const offset of [-1, -0.5, 0.5, 1]) {
      const r = videoRect({ ...base, videoOffsetY: offset }, 1280, 720, 1920, 1080, 180);
      expect(r.x).toBe(center.x); expect(r.width).toBe(center.width); expect(r.height).toBe(center.height);
      expect(r.y - center.y).toBe(offset * 360);
    }
  });
  it('bounds invalid saved transforms without corrupting the frame geometry', () => {
    expect(videoTransform({ videoZoom: NaN, videoOffsetY: Infinity })).toEqual({ zoom: 1, offsetY: 0 });
    expect(videoTransform({ videoZoom: 9, videoOffsetY: -4 })).toEqual({ zoom: 3, offsetY: -1 });
  });
});
