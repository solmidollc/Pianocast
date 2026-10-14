import { afterEach, describe, expect, it, vi } from 'vitest';
import { acousticInput } from './input';
import { ACOUSTIC_INPUT_ID, midiEngine } from '../midi/engine';
let stopTrack: ReturnType<typeof vi.fn>, terminate: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>, context: any, worker: any, capture: any;
function setup() {
  stopTrack = vi.fn(); terminate = vi.fn(); close = vi.fn(async () => {});
  const stream = { getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [] };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', class {
    state = 'running'; sampleRate = 48000; destination = {};
    close = close; resume = vi.fn(async () => {});
    audioWorklet = { addModule: vi.fn(async () => {}) };
    createMediaStreamSource = () => ({ connect: vi.fn() });
    constructor() { context = this; }
  });
  class Capture {
    port = { onmessage: null as any, postMessage: vi.fn() }; disconnect = vi.fn(); connect = vi.fn();
    constructor() { capture = this; }
  }
  vi.stubGlobal('AudioWorkletNode', Capture); vi.stubGlobal('window', { AudioWorkletNode: Capture });
  vi.stubGlobal('Worker', class { terminate = terminate; postMessage = vi.fn(); onmessage: any; constructor() { worker = this; } });
  midiEngine.selectInput(ACOUSTIC_INPUT_ID);
  return getUserMedia;
}
afterEach(() => { acousticInput.stop(); midiEngine.selectInput(null); vi.unstubAllGlobals(); });
describe('acoustic capture lifecycle', () => {
  it('starts independent capture with voice processing disabled and cleans up fully', async () => {
    const getUserMedia = setup(); await acousticInput.start('mic-1');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-1' }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    expect(acousticInput.getSnapshot().status).toBe('listening');
    capture.port.onmessage({ data: new Float32Array(8192) });
    worker.onmessage({ data: { midi: 60, confidence: .99, rms: .1, cents: 0 } });
    worker.onmessage({ data: { midi: 60, confidence: .99, rms: .1, cents: 0 } });
    expect(midiEngine.getSnapshot().active[0].midi).toBe(60);
    acousticInput.stop();
    expect(stopTrack).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(terminate).toHaveBeenCalledOnce();
    expect(midiEngine.getSnapshot().active).toEqual([]);
  });
  it('cancels an outstanding permission request without leaving microphone active', async () => {
    const getUserMedia = setup(); let resolve!: (stream: any) => void;
    getUserMedia.mockImplementation(() => new Promise(r => { resolve = r; }));
    const opening = acousticInput.start(''); await Promise.resolve(); acousticInput.stop();
    resolve({ getTracks: () => [{ stop: stopTrack }] }); await opening;
    expect(stopTrack).toHaveBeenCalledOnce(); expect(acousticInput.getSnapshot().status).toBe('idle');
  });
  it('reports denied permission and closes the audio context', async () => {
    const getUserMedia = setup(); getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    await acousticInput.start('');
    expect(acousticInput.getSnapshot().status).toBe('error'); expect(acousticInput.getSnapshot().error).toContain('blocked');
    expect(close).toHaveBeenCalledOnce();
  });
  it('clears notes on worker failure', async () => {
    setup(); await acousticInput.start(''); midiEngine.setAcousticNote(60); worker.onerror();
    expect(midiEngine.getSnapshot().active).toEqual([]); expect(stopTrack).toHaveBeenCalledOnce();
    expect(acousticInput.getSnapshot().status).toBe('error');
  });
});
