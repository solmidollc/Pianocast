import { defaultAdjustments } from '../modules/cameraAdjustments';
import type { ModuleInstance } from './store';

/**
 * A scene preset is a complete description of the canvas — every module,
 * its position, size, options, and (where relevant) lock-group membership.
 * `applyPreset` in the store re-stamps ids + z-indices and runs the lock-
 * group reflow so even sloppy author values settle into the correct
 * arrangement on first apply.
 *
 * Keep presets to a couple — one is enough to start. They're scene
 * templates, not infinitely-parameterised layouts; the right place to
 * customise is the scene editor itself, after applying.
 */
export interface ScenePreset {
  id: string;
  label: string;
  description: string;
  build: (canvasWidth: number, canvasHeight: number) => Omit<ModuleInstance, 'id' | 'z'>[];
}

/**
 * Creator preset. Designed for the streaming / recording use case:
 *
 *   ┌─────────────────────┬────────────────────────────────┐
 *   │                     │  Notation                      │
 *   │  Camera             ├────────────────────────────────┤
 *   │                     │  Harmonic readout              │
 *   ├─────────────────────┴────────────────────────────────┤
 *   │  Keyboard visualiser (full width)                    │
 *   ├──────────────────────────────────────────────────────┤
 *   │  Overhead camera (cropped) — same width, key-aligned │
 *   └──────────────────────────────────────────────────────┘
 *
 * The keyboard and overhead camera start aligned but move independently.
 * The separate Overhead Camera with Visualizer preset preserves the locked stack.
 */
const overheadCreatorPreset: ScenePreset = {
  id: 'overhead-creator',
  label: 'Pro Creator',
  description:
    'Streaming layout: camera top-left, notation + harmonic top-right, keyboard and overhead along the bottom, freely adjustable.',
  build: (cw, ch) => {
    // Geometry (all canvas pixels):
    //   - Bottom band height: overhead (160 px) + keyboard (220 px) = 380.
    //     The lock-group reflow pins the overhead to y = ch - 160 and
    //     stacks the keyboard at y = ch - 380.
    //   - Top band: ch - 380 = 700 px tall (at 1080).
    //     Split L/R 60/40-ish: camera 1120×630, right column 800-wide.
    //     Right column: notation 270 px tall on top, harmonic fills below.
    //   - Side margins are inset 16 px for breathing room.
    const margin = 16;
    const keyboardH = 220;
    const overheadH = 160;
    const bottomBandTop = ch - keyboardH - overheadH;

    const topBandH = bottomBandTop - margin;
    const topBandTop = margin;

    // Right column: width ~ 720, notation on top, harmonic below.
    const rightW = 720;
    const cameraW = cw - rightW - margin * 3; // margin between camera + right col
    const cameraX = margin;
    const cameraY = topBandTop;
    const cameraH = topBandH - margin;

    const rightX = cameraX + cameraW + margin;
    const notationH = 340;
    const notationY = topBandTop;
    const harmonicY = notationY + notationH + margin;
    const harmonicH = topBandH - notationH - margin - margin;

    return [
      // ---- Camera (top-left) ----
      {
        kind: 'camera',
        x: cameraX,
        y: cameraY,
        width: cameraW,
        height: cameraH,
        baseWidth: cameraW,
        baseHeight: cameraH,
        visible: true,
        options: {
          deviceId: null,
          mirror: false,
          adjustments: defaultAdjustments(),
        },
      },
      // ---- Notation (top-right) ----
      {
        kind: 'notation',
        x: rightX + (rightW - 240) / 2,
        y: notationY,
        width: 240,
        height: notationH,
        baseWidth: 240,
        baseHeight: 320,
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
      // ---- Harmonic readout (under notation) ----
      {
        kind: 'harmonic',
        x: rightX,
        y: harmonicY,
        width: rightW,
        height: harmonicH,
        baseWidth: 520,
        baseHeight: 220,
        visible: true,
        options: { showIntervals: true, mode: 'chord' },
      },
      // ---- Keyboard (independently movable) ----
      {
        kind: 'keyboard',
        x: 0,
        y: ch - overheadH - keyboardH,
        width: cw,
        height: keyboardH,
        baseWidth: cw,
        baseHeight: keyboardH,
        visible: true,
        options: { range: [21, 108], showLabels: false },
      },
      // ---- Overhead camera (independently movable) ----
      {
        kind: 'overhead',
        x: 0,
        y: ch - overheadH,
        width: cw,
        height: overheadH,
        baseWidth: cw,
        baseHeight: overheadH,
        visible: true,
        options: {
          source: 'local',
          deviceId: null,
          keystone: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][],
          editKeystone: false,
          mirror: false,
          crop: null,
          cropping: false,
          autoCropToken: 0,
          adjustments: defaultAdjustments(),
        },
      },
    ];
  },
};

const creatorPreset: ScenePreset = {
  id: 'creator',
  label: 'Stage Left',
  description: 'Camera left, notation and harmony right, keyboard below.',
  build: (cw, ch) => overheadCreatorPreset.build(cw, ch)
    .filter((module) => module.kind !== 'overhead')
    .map((module) => module.kind === 'keyboard'
      ? { ...module, y: ch - module.height }
      : module.kind === 'camera' || module.kind === 'harmonic'
        ? { ...module, height: module.height + 160,
            ...(module.kind === 'camera' ? { baseHeight: module.height + 160 } : {}) }
        : module),
};

const creatorRightPreset: ScenePreset = {
  id: 'creator-right',
  label: 'Stage Right',
  description: 'Camera right, notation and harmony left, keyboard below.',
  build: (cw, ch) => creatorPreset.build(cw, ch).map((module) =>
    ({ ...module, x: cw - module.x - module.width })),
};

const headshotPreset: ScenePreset = {
  id: 'headshot',
  label: 'Spotlight',
  description: 'Camera above, keyboard below.',
  build: (cw, ch) => {
    const modules = creatorPreset.build(cw, ch);
    const keyboard = modules.find((module) => module.kind === 'keyboard')!;
    const camera = modules.find((module) => module.kind === 'camera')!;
    return [
      { ...camera, x: 0, y: 0, width: cw, height: ch - keyboard.height,
        baseWidth: cw, baseHeight: ch - keyboard.height },
      keyboard,
    ];
  },
};

export const SCENE_PRESETS: ReadonlyArray<ScenePreset> = [
  creatorPreset,
  creatorRightPreset,
  headshotPreset,
  overheadCreatorPreset,
];

