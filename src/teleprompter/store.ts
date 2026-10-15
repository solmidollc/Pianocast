import { create } from 'zustand';

export interface TeleprompterSettings {
  script: string;
  speed: number;
  fontSize: number;
  mirror: boolean;
}

export const DEFAULT_TELEPROMPTER: TeleprompterSettings = {
  script: '', speed: 30, fontSize: 36, mirror: false,
};

/** Accept older projects and bound persisted settings before rendering. */
export function teleprompterSettings(value: unknown): TeleprompterSettings {
  const data = value && typeof value === 'object' ? value as Partial<TeleprompterSettings> : {};
  const number = (value: unknown, fallback: number, low: number, high: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
  return {
    script: typeof data.script === 'string' ? data.script.slice(0, 50_000) : '',
    speed: number(data.speed, 30, 5, 120),
    fontSize: number(data.fontSize, 36, 18, 96),
    mirror: data.mirror === true,
  };
}

export const useTeleprompter = create<{
  settings: TeleprompterSettings;
  update: (patch: Partial<TeleprompterSettings>) => void;
  restore: (value: unknown) => void;
}>((set) => ({
  settings: { ...DEFAULT_TELEPROMPTER },
  update: (patch) => set(state => ({ settings: teleprompterSettings({ ...state.settings, ...patch }) })),
  restore: (value) => set({ settings: teleprompterSettings(value) }),
}));
