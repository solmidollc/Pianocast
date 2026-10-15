import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { ModuleFrame } from './ModuleFrame';

/**
 * The scene canvas — OBS-style program canvas, locked to a fixed logical
 * output resolution (1920×1080 by default, from the store). It does not
 * track the window or monitor size. The editor renders a fit-to-viewport
 * preview of it; the virtual camera publishes it at native resolution.
 *
 * Layout architecture:
 *
 *   wrapRef ─── flex centred, overflow-hidden
 *      └── slot — sized to canvasWidth*scale × canvasHeight*scale (the
 *                 EXACT painted dimensions, not the unscaled box). This is
 *                 the safeguard that makes off-screen overflow impossible:
 *                 there is no "phantom" 1920-px-wide layout box pushing
 *                 against the panels.
 *           └── canvas — width=canvasWidth, height=canvasHeight, with
 *                        transform: scale(s) from top-left so child modules
 *                        positioned in unscaled canvas coords land in the
 *                        right visual spot. overflow:hidden clips any
 *                        module that strays past the canvas edges.
 *                 └── modules
 */
export function SceneCanvas({ recordingView = false }: { recordingView?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const {
    canvasWidth,
    canvasHeight,
    background,
    modules,
    selectedId,
    select,
    snapGuides,
  } = useApp();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const compute = () => {
      const r = el.getBoundingClientRect();
      const padding = recordingView ? 0 : 40;
      const s = Math.min(
        Math.max(1, r.width - padding) / canvasWidth,
        Math.max(1, r.height - padding) / canvasHeight,
      );
      setScale(Math.max(0.05, s));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasWidth, canvasHeight, recordingView]);

  const checkered =
    'repeating-conic-gradient(#1a1c20 0% 25%, #15171b 0% 50%) 50% / 24px 24px';

  const renderedW = canvasWidth * scale;
  const renderedH = canvasHeight * scale;

  return (
    <div
      ref={wrapRef}
      className="flex-1 flex items-center justify-center overflow-hidden relative bg-ink-950"
      onPointerDown={() => select(null)}
    >
      <div
        className="relative shadow-[0_0_0_1px_rgba(255,255,255,0.16),0_30px_60px_-30px_rgba(0,0,0,0.6)]"
        style={{ width: renderedW, height: renderedH }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            ...({'--scene-zoom':scale} as React.CSSProperties),
            position: 'absolute',
            top: 0,
            left: 0,
            width: canvasWidth,
            height: canvasHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            overflow: 'hidden',
            pointerEvents: recordingView ? 'none' : undefined,
            background:
              background.type === 'transparent' ? checkered : background.color,
          }}
        >
          {[...modules]
            .sort((a, b) => a.z - b.z)
            .map((m) => (
              <ModuleFrame
                key={m.id}
                module={m}
                scale={scale}
                selected={!recordingView && selectedId === m.id}
                editing={!recordingView}
              />
            ))}

          {/* Snap guides. Only present while a drag/resize has a snap
              hit. Drawn in canvas coords (parent has transform: scale),
              so we don't have to compensate for the editor zoom — the
              dashed strokes scale with everything else. The lines run
              full canvas length so the alignment they express is
              unmistakeable. */}
          {!recordingView && snapGuides && (
            <svg
              width={canvasWidth}
              height={canvasHeight}
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                overflow: 'visible',
              }}
            >
              {snapGuides.vLines.map((x, i) => (
                <line
                  key={`v${i}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={canvasHeight}
                  stroke="#FF6FB5"
                  strokeWidth={1}
                  strokeDasharray="6 5"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {snapGuides.hLines.map((y, i) => (
                <line
                  key={`h${i}`}
                  x1={0}
                  y1={y}
                  x2={canvasWidth}
                  y2={y}
                  stroke="#FF6FB5"
                  strokeWidth={1}
                  strokeDasharray="6 5"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}
        </div>
      </div>


    </div>
  );
}

