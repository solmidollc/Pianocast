import { applySnap, computeNextRect, type DragHandle } from './geometry';
import { createPortal } from 'react-dom';
import { elementName } from '../state/elementNames';
import { useBoardLocked,lockedBoardSize,useEditsLocked,editsLocked } from '../annotation/connectionLock';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useApp, type ModuleInstance } from '../state/store';
import { getDissolveSnapshot } from './dissolveSnapshot';
import { beginSceneEdit, endSceneEdit } from '../state/history';
import { MODULE_LABEL, ScaledModule } from './ModuleContent';

interface Props {
  module: ModuleInstance;
  scale: number;
  selected: boolean;
  editing?: boolean;
}

/**
 * Snap radius in CSS pixels (so the feel is the same at 25% editor zoom and at
 * 100%). Divided by the editor's `scale` to convert to scene-coord pixels
 * before the distance test.
 */
const SNAP_PX = 8;

/**
 * Wraps a single module on the scene canvas. Handles selection, dragging,
 * and 8-handle resizing.
 *
 * Resize behaviour:
 *   - Side-centre handles (n, s, e, w) — single-axis change of the slot
 *     `width` / `height`. For every module kind this changes only the slot;
 *     `baseWidth` / `baseHeight` are left alone.
 *   - Corner handles (ne, nw, se, sw):
 *       · Keyboard AND Overhead Camera: free resize. The Keyboard keeps
 *         its native fit-to-width behaviour, and the Overhead Camera now
 *         renders at TRUE aspect with top-aligned natural-size sampling
 *         (see OverheadCamera.tsx), so any corner drag just reveals more
 *         or less of the captured region — it can never distort the
 *         image. Aspect-locking the corner here would only restrict the
 *         user pointlessly.
 *       · Notation AND Harmonic readout: aspect-locked uniform scale of
 *         *both* the slot (width, height) AND the base dims (baseWidth,
 *         baseHeight) by the same factor — see the notation block below.
 *       · Everything else: aspect-locked uniform scale of just the slot.
 *
 * Why notation + harmonic are special — their content scales differently.
 * For other non-Keyboard modules, ScaledModule wraps the content in a CSS
 * `scale(sx, sy)` keyed off (slot / base) — corner drags grow the slot so
 * sx == sy, side drags grow one dim so sx != sy and the content stretches
 * into the frame. That would non-uniformly squish the notation staff
 * (the SVG is drawn at natural proportions; a side drag would smear
 * glyphs) and the harmonic readout's chord glyphs the same way.
 *
 * The notation/harmonic contract instead:
 *   - Slot dims (width, height) define the visible rectangle the content
 *     lives in. A side drag grows the slot → more empty breathing room
 *     around the (still centered, same-pixel-size) content.
 *   - Base dims (baseWidth, baseHeight) encode the content's pixel scale.
 *     For notation: scale = baseHeight / SLOT_REF_H drives the SVG viewBox
 *     window (slotPx / scale). For harmonic: scale = baseHeight /
 *     SLOT_REF_H is applied as a CSS `transform: scale(s)` on the
 *     centered text. A corner drag scales slot AND base together →
 *     content visually zooms; side drags leave base alone so the content
 *     stays at its current pixel size.
 * No drag ever stretches either module non-uniformly.
 *
 * All math runs in unscaled scene coordinates; we divide pointer deltas by
 * `scale` so the math is the same whether the editor is fit at 50 % or 100 %.
 */
export function ModuleFrame(props: Props) {
  return props.module.options.transitionGhost ? <DissolveGhost module={props.module} /> : <EditableModuleFrame {...props} />;
}

function DissolveGhost({ module }: { module: ModuleInstance }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const copy = getDissolveSnapshot();
    if (copy && host.current) host.current.replaceChildren(copy);
  }, []);
  return <div style={{ position: 'absolute', left: module.x, top: module.y, width: module.width,
    height: module.height, zIndex: module.z, pointerEvents: 'none',
    opacity: Number(module.options.transitionOpacity ?? 1) }}>
    <div ref={host} data-recording-module={module.id} className="absolute inset-0 overflow-hidden" />
  </div>;
}

function EditableModuleFrame({ module, scale, selected, editing=false }: Props) {
  const editingLocked=useEditsLocked();
  const annotationLocked=useBoardLocked(String(module.options.boardId ?? module.id)) && module.kind==='annotation';
  const select = useApp((s) => s.select);
  const update = useApp((s) => s.updateModule);
  const canvasWidth = useApp((s) => s.canvasWidth);
  const canvasHeight = useApp((s) => s.canvasHeight);
  const setSnapGuides = useApp((s) => s.setSnapGuides);

  const transitioning = useApp((s) => s.transitioning);
  const stableContent = useRef(module);
  if (!transitioning) stableContent.current = module;
  // Keep engraving geometry stable during motion. CSS scales the completed
  // staff; MIDI continues updating normally, without re-engraving every frame.
  const holdGeometry = transitioning && useApp.getState().transitionMode !== 'dissolve' && (module.kind === 'notation' || module.kind === 'harmonic');
  const contentModule = holdGeometry ? stableContent.current : module;
  const contentScale = Math.min(module.width / contentModule.width, module.height / contentModule.height);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    handle: DragHandle;
    startX: number;
    startY: number;
    origin: ModuleInstance;
  } | null>(null);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) endSceneEdit();
    const frame = frameRef.current;
    if (drag && frame?.hasPointerCapture(drag.pointerId)) {
      frame.releasePointerCapture(drag.pointerId);
    }
    setSnapGuides(null);
  }, [setSnapGuides]);

  useEffect(() => {
    const endPointer = (event: PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) endDrag();
    };
    const onVisibility = () => { if (document.hidden) endDrag(); };
    window.addEventListener('pointerup', endPointer, true);
    window.addEventListener('pointercancel', endPointer, true);
    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pointerup', endPointer, true);
      window.removeEventListener('pointercancel', endPointer, true);
      window.removeEventListener('blur', endDrag);
      document.removeEventListener('visibilitychange', onVisibility);
      endDrag();
    };
  }, [endDrag]);

  useEffect(() => { if (!selected || !module.visible) endDrag(); }, [selected, module.visible, endDrag]);

  const onPointerDown = useCallback(
    (handle: DragHandle) => (e: React.PointerEvent) => {
      if (editsLocked() || e.button !== 0 || !e.isPrimary || (handle!=='move' && module.kind==='annotation' && lockedBoardSize(String(module.options.boardId ?? module.id)))) return;
      e.preventDefault();
      e.stopPropagation();
      endDrag();
      frameRef.current?.setPointerCapture(e.pointerId);
      select(module.id);
      beginSceneEdit();
      dragRef.current = {
        pointerId: e.pointerId,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        origin: { ...module },
      };
    },
    [module, select, endDrag],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      // Recover even if the browser missed the release event.
      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
        endDrag();
        return;
      }
      const dx = (e.clientX - d.startX) / scale;
      const dy = (e.clientY - d.startY) / scale;
      const { handle, origin } = d;
      const next = computeNextRect(handle, origin, dx, dy, module.kind);
      // Snap the prospective rect to canvas centre + edges. Snap is applied
      // AFTER aspect-locked corner math so the corner ratio is preserved
      // when only one axis snaps (the snap only displaces, never re-stretches
      // for non-keyboard/overhead modules).
      const snapped = module.kind === 'notation' && handle.length === 2
        ? { patch: next, vLines: [], hLines: [] }
        : applySnap(
        handle,
        origin,
        next,
        canvasWidth,
        canvasHeight,
        e.altKey ? 0 : SNAP_PX / scale,
        useApp.getState().modules.filter(other=>other.id!==module.id&&other.visible&&!other.options.transitionGhost),
      );
      update(module.id, snapped.patch);
      setSnapGuides(
        snapped.vLines.length || snapped.hLines.length
          ? { vLines: snapped.vLines, hLines: snapped.hLines }
          : null,
      );
    },
    [module.id, module.kind, scale, update, canvasWidth, canvasHeight, setSnapGuides, endDrag],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerId === dragRef.current?.pointerId) endDrag();
  }, [endDrag]);

  if (!module.visible) return null;

  const handles: { h: DragHandle; cls: string; pos: React.CSSProperties }[] = [
    {h:'nw',cls:'cursor-nwse-resize',pos:{left:0,top:0}}, {h:'n',cls:'cursor-ns-resize',pos:{left:'50%',top:0}},
    {h:'ne',cls:'cursor-nesw-resize',pos:{left:'100%',top:0}}, {h:'e',cls:'cursor-ew-resize',pos:{left:'100%',top:'50%'}},
    {h:'se',cls:'cursor-nwse-resize',pos:{left:'100%',top:'100%'}}, {h:'s',cls:'cursor-ns-resize',pos:{left:'50%',top:'100%'}},
    {h:'sw',cls:'cursor-nesw-resize',pos:{left:0,top:'100%'}}, {h:'w',cls:'cursor-ew-resize',pos:{left:0,top:'50%'}}
  ];

  return (
    <div
      ref={frameRef}
      className="absolute"
      style={{
        touchAction: 'none',
        opacity: Number(module.options.transitionOpacity ?? 1),
        pointerEvents: useApp.getState().transitioning ? 'none' : undefined,
        left: module.x,
        top: module.y,
        width: module.width,
        height: module.height,
        zIndex: module.z,
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      {/* Drag area. overflow:hidden is for safety — the scale wrapper sizes
          the visual extent to the frame, so nothing should ever overflow,
          but we clip in case a child's natural extent slips through. */}
      <div
        className="absolute inset-0"
        data-recording-module={module.id}
        onPointerDown={onPointerDown('move')}
        onDoubleClick={(e) => { if (editsLocked()||module.kind !== 'camera') return; e.stopPropagation(); endDrag(); select(module.id); setTimeout(() => window.dispatchEvent(new CustomEvent('pianocast-crop', { detail: module.id })), 0); }}
        style={{ cursor: editingLocked?'default':'move', overflow: 'hidden' }}
      >
        {holdGeometry ? (
          <div style={{ position: 'absolute', width: contentModule.width, height: contentModule.height,
            left: (module.width - contentModule.width * contentScale) / 2,
            top: (module.height - contentModule.height * contentScale) / 2,
            transform: `scale(${contentScale})`, transformOrigin: 'top left' }}>
            <ScaledModule module={contentModule} inEditor={editing} />
          </div>
        ) : <ScaledModule module={module} inEditor={editing} />}
      </div>

      {editing && ['annotation','camera','overhead','overheadVisualizer'].includes(module.kind) && <div data-editor-overlay="true" className="annotation-editor-boundary" style={{borderWidth:1/scale,fontSize:16/scale,padding:8/scale}}>{module.kind==='annotation'&&<span>{elementName(module)}</span>}</div>}
      {/* Selection overlay */}
      {selected && frameRef.current?.parentElement && createPortal(
        <div data-editor-overlay="true" style={{position:'absolute',left:module.x,top:module.y,width:module.width,height:module.height,zIndex:100000,pointerEvents:'none'}}>
          <div
            data-editor-overlay="true" className="pointer-events-none absolute inset-0"
            style={{ outline: `${1 / scale}px solid #7c5cff`, outlineOffset: 0 }}
          />
          <div
            data-editor-overlay="true" className="absolute"
            style={{
              top: -22 / scale,
              left: 0,
              fontSize: 11 / scale,
              color: '#c2c8d0',
              letterSpacing: '0',
              textTransform: 'none',
              fontWeight: 500,
              pointerEvents: 'none',
            }}
          >
            {elementName(module)}
          </div>
          {!editingLocked && !annotationLocked && handles.map(({ h, cls, pos }) => (
            <button type="button"
              key={h} aria-label={`Resize ${elementName(module)} ${h}`} data-resize-handle={h}
              data-editor-overlay="true" className={`absolute ${cls}`}
              style={{width:20/scale,height:20/scale,background:'transparent',border:0,padding:0,...pos,transform:'translate(-50%,-50%)',pointerEvents:'auto',touchAction:'none'}}
              onPointerDown={onPointerDown(h)}
              onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const step=event.shiftKey?10:1;beginSceneEdit();update(module.id,computeNextRect(h,module,event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0,module.kind));endSceneEdit();}}
            ><span style={{position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',width:8/scale,height:8/scale,borderRadius:1/scale,background:'#fff',border:`${1/scale}px solid #7c5cff`,pointerEvents:'none'}} /></button>
          ))}
        </div>, frameRef.current.parentElement
      )}
    </div>
  );
}

