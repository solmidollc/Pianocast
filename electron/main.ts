import { app, BrowserWindow, ipcMain, session, systemPreferences } from 'electron';
import * as path from 'path';
import { VirtualCameraService } from './virtualCamera';
import { RecordingService } from './recording';
import { SignalingServer } from './signaling';

// Dev-only Chromium logging for the MIDI backend. Streams to stderr so
// the launch terminal shows every MidiManager / CoreMIDI step. Remove
// after the MIDI-hang investigation lands.
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('log-level', '0');
  app.commandLine.appendSwitch('vmodule', 'midi*=3,permission*=2');
}


const isDev = process.env.NODE_ENV === 'development';
const preloadPath = path.join(__dirname, 'preload.js');
const distDir = path.join(__dirname, '..', 'dist');

let editorWindow: BrowserWindow | null = null;
let vcam: VirtualCameraService | null = null;
let recording: RecordingService | null = null;
let signaling: SignalingServer | null = null;

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#070709',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Diagnostic — forward renderer console.log/warn/error to main's stdout
  // so the launch terminal carries the camera-pipeline traces the user
  // can't see otherwise. Levels: 0=verbose, 1=info, 2=warning, 3=error.
  // Filtered to the prefixes our own modules use; vite / chromium chatter
  // is dropped so the relevant lines aren't buried.
  if (isDev) {
    win.webContents.on('console-message', (_e, level, message) => {
      if (!/\[(CameraModule|useLocalCameraStream|Recorder|OverheadCamera|cameraDevices|midi|audioInput)\]/.test(message)) return;
      const tag = ['log', 'log', 'warn', 'error'][level] ?? 'log';
      // Re-emit under [editor] so concurrently still namespaces it.
      console[tag as 'log' | 'warn' | 'error'](`[editor] ${message}`);
    });
  }

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(distDir, 'index.html'));
  }

  win.on('closed', () => {
    if (editorWindow === win) editorWindow = null;
  });

  editorWindow = win;
  return win;
}

app.whenReady().then(() => {
  // Web MIDI and camera/microphone require explicit permission grants in
  // Electron. The companion module needs camera/mic on the phone, not here,
  // but allowing `media` keeps the door open for any future local sources.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allow = permission === 'midi' || permission === 'midiSysex' || permission === 'media';
    console.log(`[perm] request ${permission} → ${allow ? 'allow' : 'deny'}`);
    callback(allow);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    const allow = permission === 'midi' || permission === 'midiSysex' || permission === 'media';
    console.log(`[perm] check   ${permission} → ${allow ? 'allow' : 'deny'}`);
    return allow;
  });

  vcam = new VirtualCameraService({ preloadPath, isDev });
  recording = new RecordingService({ preloadPath, isDev, distDir });
  signaling = new SignalingServer({ isDev, distDir });

  // Push vcam status to the editor window whenever it changes.
  vcam.onStatus((s) => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('pk:vcam:status', s);
    }
  });

  const win = createMainWindow();

  // macOS camera/microphone TCC handshake.
  //
  // Electron's `setPermissionRequestHandler` returning true only authorises
  // the renderer; macOS still gates the device at the OS level via TCC.
  // For an UNSIGNED dev build, getUserMedia silently delivers black frames
  // when status is `not-determined` and no `askForMediaAccess` call has
  // ever fired — macOS never even shows the system prompt under that
  // combination. Calling `askForMediaAccess` once on launch flips the
  // state to either `granted` or `denied`, after which getUserMedia
  // behaves the way every documented page says it should.
  //
  // Must run with Electron in the foreground: macOS silently drops the
  // camera prompt when the requesting app is not frontmost, leaving the
  // status stuck at `not-determined`. We wait for `ready-to-show`, call
  // `app.focus({ steal: true })` to force Electron in front, and only
  // then invoke `askForMediaAccess`.
  //
  // Logged unconditionally so the launch terminal is the source of truth
  // for "what does the OS think." If the value sticks at `denied` the
  // user has to flip the toggle in System Settings → Privacy & Security →
  // Camera (and Microphone), or — for a real distribution build — the
  // app needs to be code-signed with com.apple.security.device.camera
  // and com.apple.security.device.audio-input entitlements.
  if (process.platform === 'darwin') {
    win.once('ready-to-show', () => {
      void (async () => {
        app.focus({ steal: true });
        const camBefore = systemPreferences.getMediaAccessStatus('camera');
        const micBefore = systemPreferences.getMediaAccessStatus('microphone');
        console.log(`[tcc] camera=${camBefore} microphone=${micBefore} (before askForMediaAccess)`);
        // askForMediaAccess only prompts when status === 'not-determined'.
        // For 'granted' or 'denied' it resolves immediately with the
        // existing bool. Calling it is always safe.
        const camGranted = await systemPreferences.askForMediaAccess('camera').catch(() => false);
        const micGranted = await systemPreferences.askForMediaAccess('microphone').catch(() => false);
        const camAfter = systemPreferences.getMediaAccessStatus('camera');
        const micAfter = systemPreferences.getMediaAccessStatus('microphone');
        console.log(
          `[tcc] askForMediaAccess → camera granted=${camGranted} (status=${camAfter}); ` +
          `microphone granted=${micGranted} (status=${micAfter})`,
        );
        if (camAfter === 'denied' || camAfter === 'restricted') {
          console.warn(
            '[tcc] Camera blocked at OS level. Open ' +
            'System Settings → Privacy & Security → Camera and enable "Electron".',
          );
        }
      })();
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await vcam?.stop();
  await signaling?.stop();
});

// ---------------------------------------------------------------------------
// IPC: editor → main → output window
//
// The editor publishes its scene state, MIDI input id, and input-tick
// timestamps. We forward scene + input id to the hidden output window so it
// can mirror them, and record the input tick for end-to-end latency
// measurement inside the virtual-camera service.
// ---------------------------------------------------------------------------

ipcMain.on('pk:scene', (_evt, payload) => {
  vcam?.forwardScene(payload);
  // The recording window mirrors the same ProgramOutput; without this
  // fan-out it would render an empty scene and Record would capture
  // exactly that — black frames for a few ms before MediaRecorder times
  // out on the empty stream.
  recording?.forwardScene(payload);
});
ipcMain.on('pk:input-id', (_evt, id: string | null) => {
  vcam?.forwardInputId(id);
  recording?.forwardInputId(id);
});
ipcMain.on('pk:input-tick', (_evt, t: number) => {
  vcam?.recordInputTick(t);
});
ipcMain.on('pk:resync-request', (evt) => {
  // The output window asks for a fresh state burst. Bounce the request to the
  // editor, which re-publishes.
  if (editorWindow && evt.sender !== editorWindow.webContents) {
    editorWindow.webContents.send('pk:resync-request');
  }
});

ipcMain.handle('pk:ping', () => 'pong');

// ---------------------------------------------------------------------------
// IPC: virtual camera
// ---------------------------------------------------------------------------
ipcMain.handle('pk:vcam:start', () => vcam!.start());
ipcMain.handle('pk:vcam:stop', () => vcam!.stop());
ipcMain.handle('pk:vcam:status', () => vcam!.getStatus());
ipcMain.handle('pk:vcam:install-ext', () => vcam!.installSystemExtension());

// Recording — spins up the hidden 1920×1080 ProgramOutput window and
// returns a media-source id the renderer can hand to getUserMedia
// (chromeMediaSource: 'tab'). The id is bound to the requesting renderer,
// so we pass evt.sender — Electron rejects ids issued to other frames.
ipcMain.handle('pk:recording:start-session', (evt) =>
  recording!.startSession(evt.sender),
);
ipcMain.handle('pk:recording:stop-session', () => recording!.stopSession());

// ---------------------------------------------------------------------------
// IPC: signaling for the companion phone
//
// The renderer owns the WebRTC PeerConnection (browser-only API). Main carries
// SDP / ICE messages between renderer and the phone's WebSocket.
// ---------------------------------------------------------------------------
ipcMain.handle('pk:sig:start', async () => {
  if (!signaling) throw new Error('signaling not initialized');
  const info = await signaling.start();
  signaling.onPhoneMessage((msg) => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('pk:sig:phone-msg', msg);
    }
  });
  return info;
});
ipcMain.handle('pk:sig:stop', async () => {
  await signaling?.stop();
});
ipcMain.handle('pk:sig:status', () => signaling?.info() ?? null);
ipcMain.on('pk:sig:to-phone', (_evt, msg: unknown) => {
  signaling?.sendToPhone(msg);
});
