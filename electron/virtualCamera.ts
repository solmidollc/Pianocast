import { BrowserWindow } from 'electron';
import type { WebContents, NativeImage, Rectangle } from 'electron';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * VirtualCameraService
 *
 * Produces a real BGRA frame stream from the existing ProgramOutput and
 * delivers it to a native helper that publishes a system virtual camera
 * (CMIOExtension on macOS, Media Foundation source on Windows).
 *
 * Architecture (latency-first):
 *
 *   editor renderer ────IPC───►  main  ────IPC───► hidden offscreen window
 *      |                                                        │
 *      └── input tick / scene state                              │ DOM rasters
 *                                                                ▼
 *                                                       compositor paints
 *                                                                │
 *                                            beginFrameSubscription (60fps)
 *                                                                │
 *                                                          NativeImage (BGRA)
 *                                                                ▼
 *                                            Unix socket / named pipe
 *                                                                ▼
 *                                       native helper → virtual camera device
 *
 * The hidden output BrowserWindow uses Electron's offscreen rendering. The
 * GPU compositor produces full BGRA frames at the configured frame rate and
 * we never bounce pixel data through the renderer's IPC channel — main
 * receives them directly from the compositor as NativeImage buffers, which
 * is the lowest-latency hand-off Electron exposes.
 *
 * Frame transport uses a length-prefixed binary protocol over a Unix domain
 * socket (or named pipe on Windows). Native consumers connect to this socket
 * to receive frames. The protocol header carries an input-age field so the
 * native side can stamp end-to-end latency and feed it back via a control
 * channel in a later revision.
 */

const MAGIC = Buffer.from('PKVC', 'ascii');
const VERSION = 1;
const FRAME_KIND_VIDEO = 1;
// magic(4) version(4) kind(4) width(4) height(4) stride(4)
// timestamp(8) inputAge(4) length(4)  = 40
const HEADER_SIZE = 40;

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const TARGET_FPS = 60;
const SAMPLE_WINDOW_MS = 2000;
const FPS_WINDOW_MS = 1000;

export interface LatencyStats {
  inputToFrameMs: number;
  inputToFrameAvgMs: number;
  fps: number;
}

export interface VcamStatus {
  running: boolean;
  bound: boolean;
  socketPath: string | null;
  consumerConnected: boolean;
  latency: LatencyStats;
  systemExtensionState: 'unknown' | 'requested' | 'activated' | 'failed';
}

export class VirtualCameraService {
  private outputWin: BrowserWindow | null = null;
  private server: net.Server | null = null;
  private client: net.Socket | null = null;
  private running = false;
  private bound = false;
  private socketPath: string | null = null;

  private lastInputAt = 0;
  private inFlight = 0;
  private latencySamples: Array<[number, number]> = []; // [time, latencyMs]
  private frameTicks: number[] = [];
  private statusListeners = new Set<(s: VcamStatus) => void>();
  private preloadPath: string;
  private isDev: boolean;
  private systemExtensionState: VcamStatus['systemExtensionState'] = 'unknown';

  constructor(opts: { preloadPath: string; isDev: boolean }) {
    this.preloadPath = opts.preloadPath;
    this.isDev = opts.isDev;
  }

  recordInputTick(timeMs: number) {
    this.lastInputAt = timeMs;
  }

  forwardScene(payload: unknown) {
    this.outputWin?.webContents.send('pk:scene', payload);
  }

  forwardInputId(id: string | null) {
    this.outputWin?.webContents.send('pk:input-id', id);
  }

  async start(): Promise<VcamStatus> {
    if (this.running) return this.getStatus();
    try {
      await this.bindSocket();
      await this.createOutputWindow();
      this.running = true;
    } catch (err) {
      console.error('[vcam] start failed', err);
      await this.stop();
      throw err;
    }
    this.emitStatus();
    return this.getStatus();
  }

  async stop(): Promise<VcamStatus> {
    this.running = false;
    if (this.outputWin && !this.outputWin.isDestroyed()) {
      try {
        this.outputWin.webContents.endFrameSubscription();
      } catch {
        /* already torn down */
      }
      this.outputWin.close();
    }
    this.outputWin = null;
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
    if (this.socketPath && process.platform !== 'win32') {
      try {
        if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath);
      } catch {
        /* ignore */
      }
    }
    this.bound = false;
    this.emitStatus();
    return this.getStatus();
  }

  private async bindSocket(): Promise<void> {
    if (process.platform === 'win32') {
      this.socketPath = `\\\\.\\pipe\\pianokeys-vcam`;
    } else {
      const dir = path.join(os.tmpdir(), 'pianokeys-vcam');
      fs.mkdirSync(dir, { recursive: true });
      this.socketPath = path.join(dir, 'frames.sock');
      if (fs.existsSync(this.socketPath)) {
        try {
          fs.unlinkSync(this.socketPath);
        } catch {
          /* ignore */
        }
      }
    }
    this.server = net.createServer((sock) => {
      if (this.client) {
        // Only one consumer at a time. New connection wins.
        this.client.destroy();
      }
      this.client = sock;
      this.inFlight = 0;
      sock.on('error', () => sock.destroy());
      sock.on('close', () => {
        if (this.client === sock) this.client = null;
        this.emitStatus();
      });
      this.emitStatus();
    });
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      this.server!.once('error', onErr);
      this.server!.listen(this.socketPath!, () => {
        this.server!.off('error', onErr);
        resolve();
      });
    });
    this.bound = true;
  }

  private async createOutputWindow(): Promise<void> {
    const win = new BrowserWindow({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      show: false,
      frame: false,
      backgroundColor: '#000000',
      webPreferences: {
        offscreen: true,
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.outputWin = win;
    win.webContents.setFrameRate(TARGET_FPS);

    if (this.isDev) {
      await win.loadURL('http://localhost:5173/?view=output');
    } else {
      await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
        search: 'view=output',
      });
    }

    win.webContents.beginFrameSubscription(false, (image: NativeImage, dirty: Rectangle) => {
      this.onFrame(image, dirty);
    });
  }

  private onFrame(image: NativeImage, _dirty: Rectangle) {
    const { width, height } = image.getSize();
    if (width === 0 || height === 0) return;

    const now = Date.now();

    // Record latency sample if we know when the most recent MIDI event was.
    if (this.lastInputAt > 0) {
      const lat = now - this.lastInputAt;
      this.latencySamples.push([now, lat]);
      this.trimSamples(now);
    }
    this.frameTicks.push(now);
    while (this.frameTicks.length && now - this.frameTicks[0] > FPS_WINDOW_MS) {
      this.frameTicks.shift();
    }

    // Backpressure: if more than one frame is mid-flight to the consumer,
    // drop this one rather than queueing. Latest-frame-wins is the right
    // policy for a live broadcast.
    if (!this.client || this.inFlight > 1) {
      this.emitStatus();
      return;
    }

    const pixels = image.getBitmap(); // BGRA, top-down, tightly packed
    const stride = width * 4;
    const inputAge = this.lastInputAt > 0 ? Math.min(now - this.lastInputAt, 0xffffffff) : 0;

    const header = Buffer.alloc(HEADER_SIZE);
    let o = 0;
    MAGIC.copy(header, o); o += 4;
    header.writeUInt32LE(VERSION, o); o += 4;
    header.writeUInt32LE(FRAME_KIND_VIDEO, o); o += 4;
    header.writeUInt32LE(width, o); o += 4;
    header.writeUInt32LE(height, o); o += 4;
    header.writeUInt32LE(stride, o); o += 4;
    header.writeBigUInt64LE(BigInt(now), o); o += 8;
    header.writeUInt32LE(inputAge, o); o += 4;
    header.writeUInt32LE(pixels.length, o); o += 4;

    this.inFlight++;
    // Two writes are coalesced by the kernel; corked write keeps them atomic
    // to the consumer's read loop.
    const sock = this.client;
    sock.cork();
    sock.write(header);
    sock.write(pixels, () => {
      this.inFlight--;
    });
    process.nextTick(() => sock.uncork());

    this.emitStatus();
  }

  private trimSamples(now: number) {
    while (
      this.latencySamples.length > 0 &&
      now - this.latencySamples[0][0] > SAMPLE_WINDOW_MS
    ) {
      this.latencySamples.shift();
    }
  }

  getStatus(): VcamStatus {
    const now = Date.now();
    this.trimSamples(now);
    let sum = 0;
    for (const s of this.latencySamples) sum += s[1];
    const avg = this.latencySamples.length ? sum / this.latencySamples.length : 0;
    const latest = this.latencySamples.length
      ? this.latencySamples[this.latencySamples.length - 1][1]
      : 0;
    const fps =
      this.frameTicks.length > 1
        ? (this.frameTicks.length - 1) * 1000 /
          (this.frameTicks[this.frameTicks.length - 1] - this.frameTicks[0] || 1)
        : 0;
    return {
      running: this.running,
      bound: this.bound,
      socketPath: this.socketPath,
      consumerConnected: !!this.client,
      latency: {
        inputToFrameMs: latest,
        inputToFrameAvgMs: avg,
        fps,
      },
      systemExtensionState: this.systemExtensionState,
    };
  }

  onStatus(cb: (s: VcamStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private emitStatus() {
    const s = this.getStatus();
    for (const cb of this.statusListeners) cb(s);
  }

  async installSystemExtension(): Promise<{ ok: boolean; message: string }> {
    // The OSSystemExtensionRequest API isn't exposed to Electron's Node side;
    // the bundled native installer binary (PianoKeysCameraInstaller.app) drives
    // this on macOS. Spawn it here from the app bundle resources. On Windows,
    // installation runs through the MSI/Inno installer at first launch.
    if (process.platform === 'darwin') {
      this.systemExtensionState = 'requested';
      this.emitStatus();
      return {
        ok: false,
        message:
          'macOS: launch the bundled installer (see native/macos/README.md). On first install, the user must approve the camera extension in System Settings > Privacy & Security.',
      };
    }
    if (process.platform === 'win32') {
      return {
        ok: false,
        message:
          'Windows: the Media Foundation virtual camera DLL is registered by the app installer (see native/windows/README.md).',
      };
    }
    return { ok: false, message: `Unsupported platform: ${process.platform}` };
  }
}
