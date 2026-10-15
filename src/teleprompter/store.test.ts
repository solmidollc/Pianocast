import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TELEPROMPTER, useTeleprompter } from './store';

afterEach(() => useTeleprompter.getState().restore(undefined));

describe('teleprompter project settings', () => {
  it('clears another project’s script when opening an older project without teleprompter data', () => {
    useTeleprompter.getState().update({ script: 'Private script', mirror: true, speed: 80 });
    useTeleprompter.getState().restore(undefined);
    expect(useTeleprompter.getState().settings).toEqual(DEFAULT_TELEPROMPTER);
  });

  it('handles malformed saved settings without non-finite layout or runaway script size', () => {
    useTeleprompter.getState().restore({ script: 'a'.repeat(60_000), speed: Infinity, fontSize: -10, mirror: 'false' });
    const settings = useTeleprompter.getState().settings;
    expect(settings.script).toHaveLength(50_000);
    expect(Number.isFinite(settings.speed)).toBe(true);
    expect(settings.fontSize).toBeGreaterThan(0);
    expect(settings.mirror).toBe(false);
  });
});
