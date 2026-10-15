import { beforeAll, expect, it, vi } from 'vitest';
const offer = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => 'take-id'));
vi.mock('../editing/store', () => ({ offerRecordedTake: offer }));
vi.mock('../audio/pianoEngine', () => ({ pianoEngine: {} }));
vi.mock('../audio/audioInput', () => ({ audioInput: {} }));
let recorder: typeof import('./recorder')['recorder'];
beforeAll(async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('window', { addEventListener: vi.fn(), location: { search: '', hash: '' } });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: () => null });
  recorder = (await import('./recorder')).recorder;
});
it('offers a completed take for review without starting a download', async () => {
  const internal = recorder as any;
  internal.chunks = [new Blob(['captured video'])]; internal.takeDurationMs = 2300;
  internal.chosenMime = 'video/webm'; internal.chosenExt = 'webm';
  vi.stubGlobal('document', { createElement: () => { throw new Error('Unexpected automatic download'); } });
  await internal.handleStop();
  expect(offer).toHaveBeenCalledOnce();
  expect(offer.mock.calls[0]).toEqual([expect.any(Blob), expect.stringMatching(/\.webm$/), 2.3]);
  expect(recorder.getSnapshot()).toMatchObject({ status: 'idle', lastFileName: null, lastTakeId: 'take-id', lastTakeName: expect.stringMatching(/\.webm$/) });
});
it('does not restore the legacy automatic direct-save preference', () => {
  recorder.setOptions({ directSave: true });
  expect(recorder.getSnapshot().options.directSave).toBe(false);
});
