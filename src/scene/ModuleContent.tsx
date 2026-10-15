import { annotationBoard } from '../annotation/surfaces';
import { useApp, type ModuleInstance } from '../state/store';
import { MelodicNotationModule } from '../modules/MelodicNotation';
import { NotationModule } from '../modules/Notation';
import { KeyboardModule } from '../modules/Keyboard';
import { OverheadCamera } from '../modules/OverheadCamera';
import { AnnotationModule } from '../modules/Annotation';
import { CameraModule } from '../modules/Camera';
import type { Point } from '../modules/perspective';

interface Props {
  module: ModuleInstance;
  width: number;
  height: number;
  /** True only inside the editor — enables keystone handles, etc. */
  inEditor?: boolean;
}

export function ModuleContent(props:Props) {
  const {module,width,height}=props,board=annotationBoard(module);
  if(board && module.kind!=='annotation')return <div style={{position:'relative',width,height}}><ModuleVisual {...props}/><div style={{position:'absolute',inset:0,pointerEvents:'none'}}><AnnotationModule board={board} width={width} height={height}/></div></div>;
  return <ModuleVisual {...props}/>;
}
function ModuleVisual({ module, width, height, inEditor = false }: Props) {
  const updateModule = useApp((s) => s.updateModule);

  switch (module.kind) {
    case 'text': return <div style={{width,height,display:'flex',alignItems:'center',padding:16,whiteSpace:'pre-wrap',overflow:'hidden',color:String(module.options.color??'#ffffff'),fontSize:Number(module.options.fontSize??36),background:module.options.backdrop?'rgba(0,0,0,.7)':'transparent',lineHeight:1.4}}>{String(module.options.text??'')}</div>;
    case 'annotation': return <AnnotationModule board={String(module.options.boardId ?? module.id)} width={width} height={height} />;
    case 'notation': {
      const opts = module.options as {
        notehead?: 'whole' | 'quarter';
        notationMode?: 'chord' | 'melodic';
        melodyIdleSeconds?: number;
        melodyResetToken?: number;
        melodyDemoToken?: number;
        range?: [number, number];
        trebleOttava?: 'none' | '8va';
        bassOttava?: 'none' | '8vb';
        style?: 'standard' | 'centered';
      };
      // Notation gets the BASE dims as well as the slot dims — they encode
      // the staff's pixel scale (set by corner drags in ModuleFrame).
      const NotationView = opts.notationMode === 'melodic' ? MelodicNotationModule : NotationModule;
      return (
        <NotationView
          width={width}
          height={height}
          baseWidth={module.baseWidth}
          baseHeight={module.baseHeight}
          idleSeconds={opts.melodyIdleSeconds}
          resetToken={opts.melodyResetToken}
          demoToken={opts.melodyDemoToken}
          range={opts.range}
          trebleOttava={opts.trebleOttava}
          bassOttava={opts.bassOttava}
          style={opts.style}
          harmonyMode={module.options.harmonyMode==='roman'?'roman':'chord'}
          harmonyEnabled={module.options.harmonyEnabled !== false}
          harmonyIntervals={module.options.harmonyIntervals !== false}
          notehead={opts.notehead}
        />
      );
    }
    case 'keyboard':
      return (
        <KeyboardModule
          width={width}
          height={height}
          rangeLow={(module.options as any).range?.[0] ?? 21}
          rangeHigh={(module.options as any).range?.[1] ?? 108}
        />
      );
    case 'harmonic': return null; // Legacy scenes migrate this into Notation.
    case 'overheadVisualizer': {
      const keyboardHeight = Math.min(height - 40, Math.max(40, Number(module.options.keyboardHeight ?? 220)));
      return (
        <div style={{ width, height, overflow: 'hidden' }}>
          <KeyboardModule width={width} height={keyboardHeight}
            rangeLow={(module.options as any).range?.[0] ?? 21}
            rangeHigh={(module.options as any).range?.[1] ?? 108} />
          <div style={{ position: 'relative', width, height: height - keyboardHeight, overflow: 'hidden' }}>
            <ModuleContent module={{ ...module, kind: 'overhead' }}
              width={width} height={height - keyboardHeight} inEditor={inEditor} />
          </div>
        </div>
      );
    }
    case 'overhead': {
      const opts = module.options as any;
      const editKeystone = !!opts.editKeystone && inEditor;
      const onKeystoneChange = inEditor
        ? (corners: Point[]) =>
            updateModule(module.id, { options: { ...opts, keystone: corners } })
        : undefined;
      // Auto-crop only writes back from the scene-editor instance — the
      // Preview-window instance reads the same options object and would
      // otherwise race against the editor to mutate state.
      const onCropChange = inEditor
        ? (crop: import('../modules/perspective').CropRect) =>
            updateModule(module.id, { options: { ...opts, crop } })
        : undefined;
      return (
        <OverheadCamera
          width={width}
          height={height}
          moduleId={module.id}
          source={(opts.source ?? 'local') as 'local' | 'companion'}
          deviceId={opts.deviceId ?? null}
          crop={opts.crop ?? null}
          keystone={opts.keystone}
          mirror={!!opts.mirror}
          adjustments={opts.adjustments}
          editKeystone={editKeystone}
          onKeystoneChange={onKeystoneChange}
          onCropChange={onCropChange}
          autoCropToken={opts.autoCropToken ?? 0}
        />
      );
    }
    case 'camera': {
      const opts = module.options as any;
      return (
        <CameraModule
          width={width}
          height={height}
          moduleId={module.id}
          deviceId={opts.deviceId ?? null}
          mirror={!!opts.mirror}
          adjustments={opts.adjustments}
          crop={(opts as any).cameraCrop}
        />
      );
    }
  }
}

export const MODULE_LABEL: Record<ModuleInstance['kind'], string> = {
  text: 'Text',
  annotation: 'Annotation',
  notation: 'Notation',
  keyboard: 'Keyboard',
  harmonic: 'Harmony',
  overhead: 'Overhead Camera',
  overheadVisualizer: 'Overhead Camera with Visualizer',
  camera: 'Camera',
};

/**
 * Renders a module so it FILLS the parent box (which is sized to
 * module.width × module.height) by scaling its content, not by re-flowing it.
 *
 *   - Keyboard module: passed through with width/height = module.width/height,
 *     preserving its native fit-to-width key layout behaviour. The user
 *     explicitly asked for the Keyboard to keep its current resize feel.
 *
 *   - Everything else: rendered at the module's `baseWidth × baseHeight` and
 *     wrapped in a CSS transform that scales it to fill the box. Corner
 *     resizes (aspect-locked) keep sx == sy so the content zooms uniformly;
 *     side-handle resizes (single-axis) yield sx ≠ sy so the content
 *     stretches along that one dimension. Either way nothing gets clipped.
 *
 * The transform is GPU-composited; no per-frame CPU is spent scaling.
 */
export function ScaledModule({ module, inEditor = false }: { module: ModuleInstance; inEditor?: boolean }) {
  if (module.kind === 'keyboard') {
    return (
      <ModuleContent
        module={module}
        width={module.width}
        height={module.height}
        inEditor={inEditor}
      />
    );
  }
  // Notation + Harmonic both have their own resize contract (see
  // ModuleFrame.tsx + Notation.tsx + HarmonicReadout.tsx): side drags
  // grow the slot for breathing room around the centred content at the
  // SAME pixel size; corner drags scale slot + baseWidth + baseHeight
  // together so the content zooms with no distortion. Wrapping them in a
  // CSS `scale(sx, sy)` here would clobber both — a side drag would
  // non-uniformly stretch the SVG / text instead of just expanding the
  // slot, and a corner drag would double-scale. Pass through so each
  // module applies its own scale internally.
  //
  // Overhead is also passed through: its WebGL shader now samples at
  // TRUE aspect, top-aligned, with anything past the captured bottom
  // painted black (see OverheadCamera.tsx). Any CSS `scale(sx, sy)` wrap
  // here would re-distort the image — exactly the bug the spec calls out
  // ("the only permitted distortion is the E4/F4 adjustment"). So the
  // canvas just fills the slot via `width: '100%', height: '100%'` and
  // the shader handles everything else.
  if (
    module.kind === 'text' ||
    module.kind === 'annotation' ||
    module.kind === 'notation' ||
    module.kind === 'harmonic' ||
    module.kind === 'overhead' ||
    module.kind === 'overheadVisualizer' ||
    module.kind === 'camera'
  ) {
    return (
      <ModuleContent
        module={module}
        width={module.width}
        height={module.height}
        inEditor={inEditor}
      />
    );
  }
  const baseW = module.baseWidth || module.width;
  const baseH = module.baseHeight || module.height;
  const sx = module.width / baseW;
  const sy = module.height / baseH;
  return (
    <div
      style={{
        width: baseW,
        height: baseH,
        transform: `scale(${sx}, ${sy})`,
        transformOrigin: '0 0',
      }}
    >
      <ModuleContent
        module={module}
        width={baseW}
        height={baseH}
        inEditor={inEditor}
      />
    </div>
  );
}

