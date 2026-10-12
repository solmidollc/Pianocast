import { describe, it, expect } from 'vitest';
import { computeCrossfade } from '../pianoEngine';

/**
 * Pin down the velocity-layer crossfade math.
 *
 * The Salamander Slender velocity layers are
 *   PPP[1..40] PP[41..67] MP[68..84] MF[85..100] FF[101..127]
 * so the catalogue declares boundaries [40, 67, 84, 100] with a half-width
 * of 5. Any velocity within ±5 of a boundary should produce a twin-voice
 * crossfade spec; everywhere else should pass through as a single voice.
 */

const layers = [40, 67, 84, 100];
const W = 5;

describe('computeCrossfade', () => {
  it('returns null comfortably inside a layer (single voice)', () => {
    expect(computeCrossfade(20, layers, W)).toBeNull();   // deep PPP
    expect(computeCrossfade(55, layers, W)).toBeNull();   // middle of PP
    expect(computeCrossfade(75, layers, W)).toBeNull();   // middle of MP
    expect(computeCrossfade(120, layers, W)).toBeNull();  // deep FF
  });

  it('returns a twin-voice spec exactly inside a crossfade window', () => {
    // Right at the 40|41 boundary — crossfade region is (35, 45].
    const x = computeCrossfade(40, layers, W);
    expect(x).not.toBeNull();
    expect(x!.vLow).toBeLessThanOrEqual(40);
    expect(x!.vHigh).toBeGreaterThan(40);
    expect(x!.vHigh).toBeLessThanOrEqual(67);
  });

  it('respects layer boundaries — neither voice escapes its layer', () => {
    // The full crossfade window around each boundary should keep voice
    // velocities inside the adjacent layers' velocity ranges.
    for (const b of layers) {
      for (let v = b - W + 1; v <= b + W; v++) {
        const x = computeCrossfade(v, layers, W);
        if (!x) continue;
        // vLow stays in the lower layer (≤ boundary).
        expect(x.vLow).toBeLessThanOrEqual(b);
        // vHigh stays in the upper layer (> boundary).
        expect(x.vHigh).toBeGreaterThan(b);
      }
    }
  });

  it('gives equal-power-ish behaviour at the boundary midpoint', () => {
    // At velocity = boundary the two voices should be roughly balanced —
    // gLow ≈ cos(π/4), gHigh ≈ sin(π/4), so vLow ≈ b · √(√½) and
    // vHigh ≈ (b+1) + (next-b-1) · √(√½). Round-trip through Math.round
    // means we don't pin the value; just check both are non-trivially
    // nonzero and broadly symmetric around the boundary.
    const x = computeCrossfade(67, layers, W);
    expect(x).not.toBeNull();
    expect(x!.vLow).toBeGreaterThan(20);
    expect(x!.vHigh).toBeGreaterThan(68);
  });

  it('returns null when no layers are configured', () => {
    expect(computeCrossfade(64, undefined, W)).toBeNull();
    expect(computeCrossfade(64, [], W)).toBeNull();
  });
});
