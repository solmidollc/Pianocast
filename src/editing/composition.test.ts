import { describe, expect, it, vi } from 'vitest';
import { drawScore, scoreBandHeight, scoreContentBounds, scoreSize, videoRect, videoTransform, type DrawContext } from './composition';

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
  it('adds centered side margins and frees video height without distorting notation', () => {
    const image = { width: 1000, height: 200 } as ImageBitmap;
    const drawImage = vi.fn(), fillRect = vi.fn(), ctx = { drawImage, fillRect } as unknown as DrawContext;
    for (const size of [0.25, 0.5, 0.75, 1]) {
      const band = scoreBandHeight(image, 1280, 720, size);
      drawScore(ctx, image, 1280, band, size);
      const [, x, y, w, h] = drawImage.mock.lastCall!;
      expect(w / h).toBeCloseTo(5);
      expect(w).toBeCloseTo(1280 * size);
      expect(x).toBeCloseTo((1280 - w) / 2);
      expect(y + h).toBeLessThanOrEqual(band);
      expect(band).toBe(256 * size);
      expect(fillRect.mock.lastCall).toEqual([0, 0, 1280, band]);
      const video = videoRect({ scoreLayout: 'above' }, 1280, 720, 1920, 1080, band);
      expect(video.height).toBe(720 - band);
    }
  });
  it('reduces even a height-capped crop proportionally and preserves all its content', () => {
    const image = { width: 200, height: 1000 } as ImageBitmap;
    const drawImage = vi.fn(), ctx = { drawImage, fillRect: vi.fn() } as unknown as DrawContext;
    const band = scoreBandHeight(image, 1280, 720, 0.5);
    expect(band).toBe(270);
    drawScore(ctx, image, 1280, band, 0.5);
    const [, x, y, w, h] = drawImage.mock.lastCall!;
    expect(w / h).toBeCloseTo(0.2); expect(h).toBe(270);
    expect(x + w / 2).toBe(640); expect(y).toBe(0);
  });
  it('keeps older edits full-size and bounds invalid saved score sizes', () => {
    expect(scoreSize()).toBe(1); expect(scoreSize(NaN)).toBe(1);
    expect(scoreSize(Infinity)).toBe(1); expect(scoreSize(3)).toBe(1);
    expect(scoreSize(-1)).toBe(0.25);
  });
});

describe('video composition', () => {
  it('loads existing edits at their original size and position', () => {
    expect(videoTransform({})).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 });
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
  it('moves horizontally without changing video proportions or the score geometry', () => {
    const base = videoRect({ scoreLayout: 'above' }, 1280, 720, 1920, 1080, 180);
    const shifted = videoRect({ scoreLayout: 'above', videoOffsetX: .25 }, 1280, 720, 1920, 1080, 180);
    expect(shifted.x - base.x).toBe(160); expect(shifted.y).toBe(base.y);
    expect(shifted.width).toBe(base.width); expect(shifted.height).toBe(base.height);
  });
  it('bounds invalid saved transforms without corrupting the frame geometry', () => {
    expect(videoTransform({ videoZoom: NaN, videoOffsetY: Infinity })).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 });
    expect(videoTransform({ videoZoom: 9, videoOffsetY: -4 })).toEqual({ zoom: 3, offsetX: 0, offsetY: -1 });
  });
});
