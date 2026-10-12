import { BrowserWindow, WebContents } from 'electron';
import * as path from 'path';

/**
 * RecordingService
 *
 * Owns a hidden 1920×1080 BrowserWindow that renders ProgramOutput — the
 * exact pixels the Record button (and the future Go Live virtual cam path)
 * needs to capture.
 *
 * Capture path (the one that actually works in Electron 32):
 *
 *   1. Renderer asks main to start a session.
 *   2. Main creates the hidden program window and waits for it to load.
 *   3. Main calls
 *        offscreenWebContents.getMediaSourceId(requestingWebContents)
 *      which returns a short-lived (~10 s) stream id naming the offscreen
 *      window AS A SOURCE the editor renderer is allowed to capture.
 *   4. Main returns that id over IPC.
 *   5. Renderer calls
 *        navigator.mediaDevices.getUserMedia({
 *          video: { mandatory: {
 *            chromeMediaSource: 'tab',
 *            chromeMediaSourceId: <id>,
 *          } },
 *          audio: false,
 *        })
 *      and receives a live MediaStream of the offscreen window's
 *      compositor output, ready to feed MediaRecorder.
 *
 * The earlier version of this file installed `setDisplayMediaRequestHandler`
 * and passed `win.webContents.mainFrame` into the `video` slot. Electron 32
 * silently coerces invalid `Streams.video` shapes into an empty stream —
 * the renderer's `getDisplayMedia` resolves with no tracks, MediaRecorder
 * runs for "a few ms of nothing," and the user gets an empty file. The
 * tab-capture path above is the documented pattern and produces a real
 * stream.
 *
 * The window also needs to RENDER something for the capture to be useful.
 * The editor publishes scene + input state over the existing IPC channels;
 * `forwardScene` / `forwardInputId` mirror those into the recording window
 * so its OutputView matches the editor's.
 *
 * Phase note (Go Live deferred): `getProgramWindow()` exposes the window
 * so the future virtual-cam path can subscribe to its frames via
 * `webContents.beginFrameSubscription`, the same pattern
 * VirtualCameraService already uses.
 */
export class RecordingService {
  private programWin: BrowserWindow | null = null;
  private preloadPath: string;
  private isDev: boolean;
  private distDir: string;

  constructor(opts: { preloadPath: string; isDev: boolean; distDir: string }) {
    this.preloadPath = opts.preloadPath;
    this.isDev = opts.isDev;
    this.distDir = opts.distDir;
  }

  /**
   * Spin up the program window and return a media-source id that the
   * requesting renderer can pass into chromeMediaSourceId. The id is
   * valid for ~10 s — the renderer should call getUserMedia immediately.
   *
   * Idempotent: re-issues a fresh id against the existing window if a
   * session is already active.
   */
  async startSession(
    requester: WebContents,
  ): Promise<{ ok: true; mediaSourceId: string } | { ok: false; message: string }> {
    try {
      if (!this.programWin || this.programWin.isDestroyed()) {
        await this.createProgramWindow();
      }
      const win = this.programWin;
      if (!win || win.isDestroyed()) throw new Error('Program window failed to open');
      const mediaSourceId = win.webContents.getMediaSourceId(requester);
      if (!mediaSourceId) throw new Error('Could not obtain media source id');
      return { ok: true, mediaSourceId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.stopSession();
      return { ok: false, message };
    }
  }

  /** Tear down the program window. Idempotent. */
  async stopSession(): Promise<void> {
    if (this.programWin && !this.programWin.isDestroyed()) {
      try {
        this.programWin.close();
      } catch {
        /* ignore */
      }
    }
    this.programWin = null;
  }

  getProgramWindow(): BrowserWindow | null {
    return this.programWin && !this.programWin.isDestroyed() ? this.programWin : null;
  }

  /**
   * Mirror scene / input state from the editor into the recording window
   * so its OutputView has something to render. Called from the same IPC
   * fan-out that already feeds VirtualCameraService.
   */
  forwardScene(payload: unknown): void {
    this.programWin?.webContents.send('pk:scene', payload);
  }
  forwardInputId(id: string | null): void {
    this.programWin?.webContents.send('pk:input-id', id);
  }

  // -------------------------------------------------------------------------
  // Window lifecycle
  // -------------------------------------------------------------------------

  private async createProgramWindow(): Promise<void> {
    // `show: false` + `paintWhenInitiallyHidden: true` + a non-throttled
    // renderer: the window never appears on screen (which was the cause
    // of the "Record navigates to a new screen" report), but the
    // compositor keeps painting so tab-capture continues to see live
    // frames. The earlier off-screen-positioning approach (-5000,-5000,
    // show: true) failed because macOS Spaces clamps off-screen windows
    // back onto the active display.
    const win = new BrowserWindow({
      width: 1920,
      height: 1080,
      show: false,
      paintWhenInitiallyHidden: true,
      frame: false,
      backgroundColor: '#000000',
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.programWin = win;
    win.webContents.setFrameRate(60);
    if (this.isDev) {
      await win.loadURL('http://localhost:5173/?view=output');
    } else {
      await win.loadFile(path.join(this.distDir, 'index.html'), { search: 'view=output' });
    }
  }
}
