import { lockedBoardSize } from '../annotation/connectionLock';
import { captureDissolve } from '../scene/dissolveSnapshot';
import { create } from 'zustand';
import type { KeyContext } from '../theory/types';
import { defaultAdjustments } from '../modules/cameraAdjustments';

export type ModuleKind = 'notation' | 'keyboard' | 'harmonic' | 'overhead' | 'overheadVisualizer' | 'camera' | 'annotation';

export interface ModuleInstance {
  id: string;
  kind: ModuleKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Natural render dimensions. The content of non-Keyboard modules is drawn
   * at this size and CSS-scaled to (width, height) inside ModuleFrame, so
   * resizing genuinely scales/stretches the content instead of clipping it.
   * Untouched by drag-resize — only the visible (width, height) change.
   * The Keyboard module keeps its native fit-to-width behavior and ignores
   * these values.
   */
  baseWidth: number;
  baseHeight: number;
  z: number;
  visible: boolean;
  options: Record<string, unknown>;
  /**
   * Lock-group id. Modules sharing the same `lockGroup` are kept in a
   * height-aware vertical stack pinned to the canvas bottom — currently
   * used by the Creator preset to keep the on-screen Keyboard aligned key-
   * to-key with the cropped Overhead Camera below it. Reflow runs every
   * time `updateModule` touches a member of the group; the rules live in
   * `reflowLockGroup` in this file.
   *
   * `undefined` = not in any group. Removing the field (via `unlockGroup`)
   * breaks the lock so the user can position the keyboard and camera
   * freely.
   */
  lockGroup?: string;
}

export interface SceneBackground {
  type: 'solid' | 'transparent';
  color: string;
}

/**
 * Transient overlay state — alignment guides drawn by the SceneCanvas while
 * a module is being dragged or resized AND is currently snapped to a canvas
 * axis. `vLines` are vertical guide positions in canvas-x coords (0..canvasW);
 * `hLines` are horizontal guide positions in canvas-y coords (0..canvasH).
 * Cleared by ModuleFrame on pointer-up.
 */
export interface SnapGuides {
  vLines: number[];
  hLines: number[];
}

export interface AppState {
  transitionMode: 'move' | 'fade' | 'dissolve';
  setTransitionMode: (mode: 'move' | 'fade' | 'dissolve') => void;
  transitionSeconds: number;
  transitioning: boolean;
  setTransitionSeconds: (seconds: number) => void;
  key: KeyContext;
  setKey: (k: KeyContext) => void;

  canvasWidth: number;
  canvasHeight: number;
  background: SceneBackground;
  setBackground: (b: SceneBackground) => void;

  modules: ModuleInstance[];
  cameraSetups: Partial<Record<'camera' | 'overhead', Pick<ModuleInstance, 'id' | 'options'>>>;
  selectedId: string | null;
  select: (id: string | null) => void;
  addModule: (kind: ModuleKind) => void;
  removeModule: (id: string) => void;
  toggleVisible: (id: string) => void;
  updateModule: (id: string, patch: Partial<ModuleInstance>) => void;
  raise: (id: string) => void;
  lower: (id: string) => void;
  /** Front-to-back order from the Layers panel. */
  reorderLayers: (ids: string[]) => void;
  /**
   * Replace the entire module list with the modules from a preset (e.g. the
   * Creator preset). Existing selection is cleared. Z-indices are re-issued
   * in supplied order so the caller controls layering.
   */
  applyPreset: (modules: Omit<ModuleInstance, 'id' | 'z'>[], saved?: ModuleInstance[]) => void;
  finishTransition: () => void;
  /**
   * Remove the lock-group binding from every module that currently shares
   * the group of the passed-in module id. Lets the user break a locked
   * arrangement and reposition the members freely. No-op if the module
   * isn't in a group.
   */
  unlockGroup: (id: string) => void;

  /**
   * Active snap guides — non-null only while a module drag/resize is in
   * flight AND the dragged rect's edge/centre snapped to a canvas axis.
   * The SceneCanvas reads this and overlays dashed guide lines.
   */
  snapGuides: SnapGuides | null;
  setSnapGuides: (g: SnapGuides | null) => void;
}

let transitionFrame = 0;
let transitionTarget: ModuleInstance[] | null = null;
let nextZ = 1;
const uid = () => Math.random().toString(36).slice(2, 10);

const DEFAULTS: Record<ModuleKind, Pick<ModuleInstance, 'width' | 'height' | 'options'>> = {
  annotation: {width: 960, height: 540, options: {}},
  notation: {
    width: 240,
    height: 340,
    options: {
      clefMode: 'grand',
      sizing: 'fit',
      // Full piano by default; the user trims via the Range section in the
      // Properties panel. Vertical headroom adapts so a smaller range fits
      // in a smaller module frame.
      range: [21, 108] as [number, number],
      // 8va / 8vb start off — turn either on when playing in extreme
      // registers and the ledger lines start towering.
      trebleOttava: 'none' as 'none' | '8va',
      bassOttava: 'none' as 'none' | '8vb',
      // Default to the traditional engraver's grand staff with extra
      // breathing room between treble and bass. 'centered' tightens the
      // gap so middle C lands at the same y from both clefs.
      style: 'standard' as 'standard' | 'centered',
    },
  },
  keyboard: { width: 1100, height: 180, options: { range: [21, 108], showLabels: false } },
  harmonic: { width: 520, height: 220, options: { showIntervals: true, mode: 'chord' } },
  overhead: {
    width: 1920,
    height: 200,
    options: {
      // Where the live feed comes from.
      //   'local'     — a video-capture device on this machine.
      //   'companion' — the phone-app stream via WebRTC.
      source: 'local' as 'local' | 'companion',
      deviceId: null as string | null,
      // Keystone corners in normalized 0..1 module-local coordinates,
      // TL, TR, BR, BL. Identity = no warp.
      keystone: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][],
      editKeystone: false,
      mirror: false,
      // Crop / rectification model — see perspective.ts for the geometry.
      // Five normalized 0..1 image coords + optional in-plane rotation.
      // Null until either the user crops manually OR auto-crop fires on
      // first stream-ready. Auto-crop runs inside OverheadCamera via the
      // `onCropChange` callback wired from ModuleContent.
      crop: null as {
        leftX: number;
        centerX: number;
        rightX: number;
        topY: number;
        bottomY: number;
        rotation?: number;
      } | null,
      // UI-only — true while the user is positioning the crop overlay. While
      // true the video renders un-rectified so the user can see the keyboard
      // and line the three guide lines up with A0, E4/F4, and C8.
      cropping: false,
      // Bumped by the Properties panel's "Re-run auto-crop" button. The
      // OverheadCamera watches changes to this and re-runs detection.
      autoCropToken: 0,
      // Per-source video adjustments. See cameraAdjustments.ts for the
      // full schema; absent / undefined → identity (no filter applied).
      adjustments: defaultAdjustments(),
    },
  },
  overheadVisualizer: {
    width: 1920,
    height: 380,
    options: {
      source: 'local', deviceId: null, mirror: false,
      keystone: [[0, 0], [1, 0], [1, 1], [0, 1]],
      editKeystone: false, crop: null, autoCropToken: 0,
      keyboardHeight: 220, range: [21, 108],
      adjustments: defaultAdjustments(),
    },
  },
  camera: {
    width: 640,
    height: 360,
    options: {
      // null until the user picks one from the Properties panel. We store the
      // MediaDeviceInfo.deviceId only — labels are looked up live so a device
      // can be renamed by the OS without breaking the binding.
      deviceId: null as string | null,
      mirror: false,
      adjustments: defaultAdjustments(),
    },
  },
};

export const useApp = create<AppState>((set, get) => ({
  transitionMode: 'move',
  setTransitionMode: (transitionMode) => set({ transitionMode }),
  transitionSeconds: 0.5,
  transitioning: false,
  setTransitionSeconds: (transitionSeconds) => set({ transitionSeconds }),
  key: { tonic: 'C', mode: 'major' },
  setKey: (k) => set({ key: k }),

  canvasWidth: 1920,
  canvasHeight: 1080,
  background: { type: 'solid', color: '#0C0D10' },
  setBackground: (b) => set({ background: b }),

  modules: [
    {
      // Tight notation rectangle — width sized to the content (brace, both
      // clefs, key signature, one chord column). Height carries enough
      // headroom above the treble and below the bass that A0/C8 ledger
      // lines render without clipping.
      id: uid(),
      kind: 'notation',
      x: 850,
      y: 80,
      width: 240,
      height: 340,
      baseWidth: 220,
      baseHeight: 320,
      z: nextZ++,
      visible: true,
      options: {
        clefMode: 'grand',
        sizing: 'fit',
        range: [21, 108] as [number, number],
        trebleOttava: 'none' as 'none' | '8va',
        bassOttava: 'none' as 'none' | '8vb',
        style: 'standard' as 'standard' | 'centered',
      },
    },
    {
      id: uid(),
      kind: 'harmonic',
      x: 410,
      y: 420,
      width: 520,
      height: 220,
      baseWidth: 520,
      baseHeight: 220,
      z: nextZ++,
      visible: true,
      options: { showIntervals: true, mode: 'chord' },
    },
    {
      // Full-width 88-key default: A0 (MIDI 21) at x=0, C8 (MIDI 108) at
      // x=canvasWidth. The overhead camera below shares the same x/width
      // span so a calibrated overhead feed lines up edge to edge with it.
      id: uid(),
      kind: 'keyboard',
      x: 0,
      y: 660,
      width: 1920,
      height: 220,
      baseWidth: 1920,
      baseHeight: 220,
      z: nextZ++,
      visible: true,
      options: { range: [21, 108], showLabels: false },
    },
    {
      // Default overhead-camera slot, directly below the Keyboard. Same
      // x and width so once the user crops to A0–C8 the keys line up
      // horizontally with the on-screen keyboard above.
      id: uid(),
      kind: 'overhead',
      x: 0,
      y: 880,
      width: 1920,
      height: 200,
      baseWidth: 1920,
      baseHeight: 200,
      z: nextZ++,
      visible: true,
      options: {
        source: 'local',
        deviceId: null,
        keystone: [[0, 0], [1, 0], [1, 1], [0, 1]],
        editKeystone: false,
        mirror: false,
        crop: null,
        cropping: false,
        autoCropToken: 0,
        adjustments: defaultAdjustments(),
      },
    },
  ],
  cameraSetups: {},
  selectedId: null,
  select: (id) => set({ selectedId: id }),
  addModule: (kind) => {
    nextZ = Math.max(nextZ, ...get().modules.map(m => m.z + 1));
    const def = DEFAULTS[kind];
    const id = uid();
    set({
      modules: [
        ...get().modules,
        {
          id,
          kind,
          x: 200,
          y: 200,
          width: def.width,
          height: def.height,
          baseWidth: def.width,
          baseHeight: def.height,
          z: nextZ++,
          visible: true,
          options: { ...def.options, ...(kind === 'annotation' ? {boardId:id} : {}) },
        },
      ],
      selectedId: id,
    });
  },
  removeModule: (id) =>
    set({
      modules: get().modules.filter((m) => m.id !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
    }),
  toggleVisible: (id) =>
    set({
      modules: get().modules.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)),
    }),
  updateModule: (id, patch) =>
    set((s) => {
      const target=s.modules.find(m=>m.id===id);
      const locked=target?.kind==='annotation' && lockedBoardSize(String(target.options.boardId ?? target.id));
      const safePatch={...patch};if(locked){delete safePatch.width;delete safePatch.height;delete safePatch.baseWidth;delete safePatch.baseHeight;}
      let mods = s.modules.map((m) => (m.id === id ? { ...m, ...safePatch } : m));
      // Lock-group reflow. Triggers whenever an update touches a member of
      // a group — the reflow handles vertical pinning and key-to-key
      // horizontal alignment between the locked Keyboard and Overhead
      // Camera. See `reflowLockGroup` for the rules.
      const updated = mods.find((m) => m.id === id);
      if (updated?.lockGroup) {
        mods = reflowLockGroup(mods, updated.lockGroup, id, s.canvasHeight);
      }
      return { modules: mods };
    }),
  raise: (id) =>
    set({
      modules: get().modules.map((m) => (m.id === id ? { ...m, z: nextZ++ } : m)),
    }),
  lower: (id) => {
    const minZ = Math.min(...get().modules.map((m) => m.z));
    set({
      modules: get().modules.map((m) => (m.id === id ? { ...m, z: minZ - 1 } : m)),
    });
  },
  reorderLayers: (ids) =>
    set((s) => {
      if (ids.length !== s.modules.length || new Set(ids).size !== ids.length ||
          ids.some((id) => !s.modules.some((m) => m.id === id))) return {};
      const order = new Map(ids.map((id, index) => [id, ids.length - index]));
      nextZ = Math.max(nextZ, ids.length + 1);
      return { modules: s.modules.map((m) => ({ ...m, z: order.get(m.id)! })) };
    }),
  finishTransition: () => {
    cancelAnimationFrame(transitionFrame);
    if (transitionTarget) set({ modules: transitionTarget, transitioning: false });
    transitionTarget = null;
  },
  applyPreset: (presetModules, saved) => {
    cancelAnimationFrame(transitionFrame);
    const before = get().modules;
    const duration = get().transitionSeconds * 1000;
    const mode = get().transitionMode;
    
    set({ transitioning: duration > 0 });
    set((s) => {
      // Remember each camera role even when the next layout omits it.
      // Reusing camera ids also keeps React's live stream mounted while
      // switching between layouts that contain the same camera.
      const cameraSetups = { ...s.cameraSetups };
      for (const role of ['camera', 'overhead'] as const) {
        const candidates = s.modules.filter((m) =>
          role === 'camera' ? m.kind === 'camera'
            : m.kind === 'overhead' || m.kind === 'overheadVisualizer');
        const current = candidates.find((m) => m.options.deviceId || m.options.source === 'companion') ?? candidates[0];
        if (current) {
          const options = { ...current.options };
          // Editing overlays belong to the current interaction, not setup.
          delete options.editKeystone;
          delete options.cropping;
          cameraSetups[role] = { id: current.id, options };
        }
      }
      const usedIds = new Set<string>();
      const stamped: ModuleInstance[] = presetModules.map((m, i) => {
        const role = m.kind === 'camera' ? 'camera'
          : m.kind === 'overhead' || m.kind === 'overheadVisualizer' ? 'overhead' : null;
        const setup = role ? cameraSetups[role] : undefined;
        const existing = s.modules.find((old) => old.kind === m.kind && !usedIds.has(old.id));
        const id = existing?.id ?? (setup && !usedIds.has(setup.id) ? setup.id : saved?.[i]?.id ?? uid());
        usedIds.add(id);
        return {
          ...m, ...(m.kind==='annotation' && lockedBoardSize(String(m.options.boardId ?? id)) ? {
            width:lockedBoardSize(String(m.options.boardId ?? id))![0],height:lockedBoardSize(String(m.options.boardId ?? id))![1]
          }:{}), id, z: saved?.[i]?.z ?? nextZ++ + i,
          options: saved ? { ...m.options, ...(setup ? { deviceId: setup.options.deviceId, source: setup.options.source } : {}), editKeystone: false, cropping: false }
            : setup ? { ...m.options, ...setup.options, editKeystone: false, cropping: false } : { ...m.options, ...existing?.options },
        };
      });
      // Fresh scenes place the main camera above other layers.
      // Saved scenes retain the creator's chosen stacking order.
      if (!saved) {
        nextZ = Math.max(nextZ, ...stamped.map(m => m.z + 1));
        for (const m of stamped) if (m.kind === 'camera') m.z = nextZ++;
        const keyboard = stamped.find(m => m.kind === 'keyboard');
        const overhead = stamped.find(m => m.kind === 'overhead');
        if (keyboard && overhead && keyboard.z < overhead.z) {
          [keyboard.z, overhead.z] = [overhead.z, keyboard.z];
        }
      }
      // Run reflow per distinct lock group so the preset's pinned-bottom
      // arrangement settles into the correct positions immediately even if
      // the preset author entered slightly off positions for the locked
      // members.
      const groups = new Set(
        stamped.map((m) => m.lockGroup).filter((g): g is string => !!g),
      );
      let mods = stamped;
      for (const g of groups) {
        const anyInGroup = mods.find((m) => m.lockGroup === g);
        if (anyInGroup) mods = reflowLockGroup(mods, g, anyInGroup.id, s.canvasHeight);
      }
      return { modules: mods, cameraSetups, selectedId: null };
    });
    const target = get().modules.map(m => {
      const options = { ...m.options };
      delete options.transitionOpacity;
      delete options.transitionGhost;
      return { ...m, options };
    });
    if (mode === 'dissolve' && duration) {
      // Only shared visible modules participate in the blend. Scene-only
      // modules appear/disappear immediately, exactly as in Fade.
      captureDissolve(before.filter(old => target.some(m => m.id === old.id && m.visible && old.visible)),
        { type: 'transparent', color: get().background.color });
    }
    transitionTarget = duration ? target : null;
    if (!duration) return;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const ease = progress * progress * (3 - 2 * progress);
      const animated = target.map((m) => {
        const old = before.find((item) => item.id === m.id && item.visible);
        const appears = !old || !m.visible;
        if (appears && mode !== 'move') return { ...m, options: { ...m.options, transitionOpacity: 1 } };
        if (!old) return { ...m, options: { ...m.options, transitionOpacity: mode === 'move' ? ease : 1 } };
        if (mode === 'dissolve') return m;
        if (mode === 'fade') {
          const layout = progress < 0.5 ? old : m;
          return { ...layout, z: old.z, options: { ...layout.options, transitionOpacity: Math.abs(2 * progress - 1) } };
        }
        const mix = (a: number, b: number) => a + (b - a) * ease;
        return { ...m, z: old.z, x: mix(old.x,m.x), y: mix(old.y,m.y), width: mix(old.width,m.width), height: mix(old.height,m.height), baseWidth: mix(old.baseWidth,m.baseWidth), baseHeight: mix(old.baseHeight,m.baseHeight), options: { ...m.options, transitionOpacity: 1 } };
      });
      const outgoing: ModuleInstance[] = mode === 'dissolve' ? [{
        id: 'dissolve-scene', kind: 'camera', x: 0, y: 0,
        width: get().canvasWidth, height: get().canvasHeight,
        baseWidth: get().canvasWidth, baseHeight: get().canvasHeight,
        z: Math.max(0, ...before.map(m => m.z), ...target.map(m => m.z)) + 1,
        visible: true, options: { transitionGhost: 'scene', transitionOpacity: 1 - ease },
      }] : (mode === 'move' ? before.filter(old => !target.some(m => m.id === old.id)) : [])
        .map(old => ({ ...old, options: { ...old.options, transitionOpacity: 1 - ease } }));

      if (progress < 1) { set({ modules: [...animated,...outgoing] }); transitionFrame = requestAnimationFrame(tick); }
      else { set({ modules: target, transitioning: false }); transitionFrame = 0; transitionTarget = null; }
    };
    set({ modules: before });
    transitionFrame = requestAnimationFrame(tick);
  },
  unlockGroup: (id) =>
    set((s) => {
      const target = s.modules.find((m) => m.id === id);
      if (!target?.lockGroup) return {};
      const grp = target.lockGroup;
      return {
        modules: s.modules.map((m) =>
          m.lockGroup === grp ? { ...m, lockGroup: undefined } : m,
        ),
      };
    }),

  snapGuides: null,
  setSnapGuides: (g) => set({ snapGuides: g }),
}));

// ---------------------------------------------------------------------------
// Lock-group reflow
// ---------------------------------------------------------------------------

/**
 * Reflow rules for the height-aware locked stack used by the Creator preset:
 *
 *   1. The Overhead Camera is the bottom anchor. Its `y` is recalculated so
 *      `y + height` lands exactly on the canvas bottom — any change to its
 *      height (e.g. a growing wrist area in the crop) shifts it upward to
 *      keep the bottom edge pinned.
 *
 *   2. The on-screen Keyboard sits directly above the Overhead Camera with
 *      no gap. As the Overhead grows it pushes the Keyboard upward; as it
 *      shrinks the Keyboard moves down to follow.
 *
 *   3. The pair shares horizontal extent. Whichever module the user last
 *      touched donates its `x` and `width` to its peer, so a width change
 *      on one immediately syncs the other — key-to-key alignment holds
 *      automatically. (If the user wants different widths, they unlock the
 *      group first.)
 *
 * Reflow is a pure function over the modules array; the caller wraps it in
 * a zustand `set`. If the group is missing either an Overhead or a Keyboard
 * the rule has no meaning and we return the modules untouched.
 */
function reflowLockGroup(
  modules: ModuleInstance[],
  lockGroup: string,
  changedId: string,
  canvasHeight: number,
): ModuleInstance[] {
  const overhead = modules.find((m) => m.lockGroup === lockGroup && m.kind === 'overhead');
  const keyboard = modules.find((m) => m.lockGroup === lockGroup && m.kind === 'keyboard');
  if (!overhead || !keyboard) return modules;

  // The most-recently-changed peer donates x / width. Falling back to the
  // keyboard's values when the changed module isn't a group member (e.g. a
  // height-only update from the crop modal) keeps the on-screen Keyboard
  // canonical for key positions.
  const donor =
    modules.find((m) => m.id === changedId && m.lockGroup === lockGroup) ?? keyboard;
  const x = donor.x;
  const width = donor.width;

  const overheadY = canvasHeight - overhead.height;
  const keyboardY = overheadY - keyboard.height;

  return modules.map((m) => {
    if (m.id === overhead.id) return { ...m, x, width, y: overheadY };
    if (m.id === keyboard.id) return { ...m, x, width, y: keyboardY };
    return m;
  });
}
