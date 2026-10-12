import { useMemo } from 'react';
import { useMidi } from '../midi/useMidi';

interface Props {
  width: number;
  height: number;
  rangeLow?: number;
  rangeHigh?: number;
}

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const isBlack = (midi: number) => BLACK_KEYS.has(((midi % 12) + 12) % 12);

/**
 * Render an 88-key piano as SVG. We do the layout in pixel-precise terms:
 *  - white-key width is derived from the total width / number of whites in range
 *  - black keys are 60% width, 60% height, and inset by 30% of a white key
 *
 * Highlighting maps each held note to its rect's fill. We render the entire
 * keyboard once and rely on SVG attribute updates (key=midi) for re-render.
 */
export function KeyboardModule({ width, height, rangeLow = 21, rangeHigh = 108 }: Props) {
  const snap = useMidi();
  const heldSet = useMemo(() => {
    const s = new Set<number>();
    for (const n of snap.active) s.add(n.midi);
    return s;
  }, [snap.active]);

  const layout = useMemo(() => {
    const whites: number[] = [];
    const blacks: number[] = [];
    for (let m = rangeLow; m <= rangeHigh; m++) {
      if (isBlack(m)) blacks.push(m);
      else whites.push(m);
    }
    const whiteW = width / whites.length;
    const whiteH = height;
    const blackW = whiteW * 0.6;
    const blackH = whiteH * 0.62;
    const whiteIndex = new Map<number, number>();
    whites.forEach((m, i) => whiteIndex.set(m, i));
    return { whites, blacks, whiteW, whiteH, blackW, blackH, whiteIndex };
  }, [width, height, rangeLow, rangeHigh]);

  const whiteFill = '#F4F4F6';
  const whiteHeld = '#9F87FF';
  const blackFill = '#16181C';
  const blackHeld = '#7C5CFF';
  const stroke = 'rgba(0,0,0,0.18)';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block' }}
    >
      {/* White keys first, then blacks overlay them. */}
      {layout.whites.map((m, i) => {
        const x = i * layout.whiteW;
        const held = heldSet.has(m);
        return (
          <rect
            key={`w${m}`}
            x={x}
            y={0}
            width={layout.whiteW}
            height={layout.whiteH}
            fill={held ? whiteHeld : whiteFill}
            stroke={stroke}
            strokeWidth={1}
            rx={2}
          />
        );
      })}
      {layout.blacks.map((m) => {
        // Black key sits to the right of the white key with midi = m - 1.
        const leftWhite = m - 1;
        const wi = layout.whiteIndex.get(leftWhite);
        if (wi === undefined) return null;
        const x = (wi + 1) * layout.whiteW - layout.blackW / 2;
        const held = heldSet.has(m);
        return (
          <rect
            key={`b${m}`}
            x={x}
            y={0}
            width={layout.blackW}
            height={layout.blackH}
            fill={held ? blackHeld : blackFill}
            stroke={stroke}
            strokeWidth={1}
            rx={2}
          />
        );
      })}
    </svg>
  );
}
