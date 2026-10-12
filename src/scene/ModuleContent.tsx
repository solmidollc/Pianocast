import { useApp, type ModuleInstance } from '../state/store';
import { MelodicNotationModule } from '../modules/MelodicNotation';
import { NotationModule } from '../modules/Notation';
import { KeyboardModule } from '../modules/Keyboard';
import { HarmonicReadout } from '../modules/HarmonicReadout';
import { OverheadCamera } from '../modules/OverheadCamera';
import { CameraModule } from '../modules/Camera';
import type { Point } from '../modules/perspective';

interface Props {
  module: ModuleInstance;
  width: number;
  height: number;
  /** True only inside the editor — enables keystone handles, etc. */
  inEditor?: boolean;
}

export function ModuleContent({ module, width, height, inEditor = false }: Props) {
  const updateModule = useApp((s) => s.updateModule);

  switch (module.kind) {
    case 'notation': {
      const opts = module.options as {
        notationMode?: 'chord' | 'melodic';
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
          resetToken={opts.melodyResetToken}
          demoToken={opts.melodyDemoToken}
          range={opts.range}
          trebleOttava={opts.trebleOttava}
          bassOttava={opts.bassOttava}
          style={opts.style}
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
    case 'harmonic':
      // Like notation, harmonic gets its base dims too — they encode the
      // CSS `transform: scale` applied to the centred chord text. Corner
      // drags update them in lock-step with the slot; side drags leave
      // them alone (content stays the same pixel size, slot grows around
      // it).
      return (
        <HarmonicReadout
          width={width}
          height={height}
          baseWidth={module.baseWidth}
          baseHeight={module.baseHeight}
          mode={(module.options as any).mode ?? 'chord'}
          showIntervals={(module.options as any).showIntervals ?? true}
        />
      );
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
  notation: 'Notation',
  keyboard: 'Keyboard',
  harmonic: 'Harmonic Readout',
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
