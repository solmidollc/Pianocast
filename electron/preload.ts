import { contextBridge, ipcRenderer } from 'electron';

type Unsub = () => void;

interface ScenePayload {
  modules: unknown;
  background: unknown;
  canvasWidth: number;
  canvasHeight: number;
  key: unknown;
}

interface LatencyStats {
  /** Wall-clock ms between MIDI event and the most recent captured frame. */
  inputToFrameMs: number;
  /** Rolling average over a 2-second window. */
  inputToFrameAvgMs: number;
  /** Frames pushed to the native helper per second. */
  fps: number;
}

interface VcamStatus {
  running: boolean;
  bound: boolean;
  socketPath: string | null;
  /** True when a native helper has connected to the socket. */
  consumerConnected: boolean;
  latency: LatencyStats;
  /** OSSystemExtension state on macOS. */
  systemExtensionState: 'unknown' | 'requested' | 'activated' | 'failed';
}

interface PairingInfo {
  /** Six-character display code, e.g. "K7-92Q". */
  code: string;
  /** Full URL the phone connects to, suitable for QR encoding. */
  url: string;
  /** LAN host + port the signaling server is bound to. */
  host: string;
  port: number;
}

contextBridge.exposeInMainWorld('pk', {
  platform: process.platform,
  ping: () => ipcRenderer.invoke('pk:ping'),

  editor: {
    publishScene: (s: ScenePayload) => ipcRenderer.send('pk:scene', s),
    publishInputId: (id: string | null) => ipcRenderer.send('pk:input-id', id),
    publishInputTick: (t: number) => ipcRenderer.send('pk:input-tick', t),
    onResyncRequest: (fn: () => void): Unsub => {
      const h = () => fn();
      ipcRenderer.on('pk:resync-request', h);
      return () => ipcRenderer.removeListener('pk:resync-request', h);
    },
  },

  output: {
    onSceneState: (fn: (s: ScenePayload) => void): Unsub => {
      const h = (_e: unknown, s: ScenePayload) => fn(s);
      ipcRenderer.on('pk:scene', h);
      return () => ipcRenderer.removeListener('pk:scene', h);
    },
    onInputId: (fn: (id: string | null) => void): Unsub => {
      const h = (_e: unknown, id: string | null) => fn(id);
      ipcRenderer.on('pk:input-id', h);
      return () => ipcRenderer.removeListener('pk:input-id', h);
    },
    requestSync: () => ipcRenderer.send('pk:resync-request'),
  },

  vcam: {
    start: (): Promise<VcamStatus> => ipcRenderer.invoke('pk:vcam:start'),
    stop: (): Promise<VcamStatus> => ipcRenderer.invoke('pk:vcam:stop'),
    status: (): Promise<VcamStatus> => ipcRenderer.invoke('pk:vcam:status'),
    onStatus: (fn: (s: VcamStatus) => void): Unsub => {
      const h = (_e: unknown, s: VcamStatus) => fn(s);
      ipcRenderer.on('pk:vcam:status', h);
      return () => ipcRenderer.removeListener('pk:vcam:status', h);
    },
    installSystemExtension: (): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('pk:vcam:install-ext'),
  },

  recording: {
    /**
     * Spin up the hidden 1920×1080 ProgramOutput window and return a
     * media-source id. The renderer immediately follows up with
     * `navigator.mediaDevices.getUserMedia({ video: { mandatory: {
     * chromeMediaSource: 'tab', chromeMediaSourceId: id } } })` to
     * receive a live stream of that window. The id is valid for ~10 s,
     * so the renderer should not delay between resolving and the
     * getUserMedia call.
     */
    startSession: (): Promise<
      { ok: true; mediaSourceId: string } | { ok: false; message: string }
    > => ipcRenderer.invoke('pk:recording:start-session'),
    stopSession: (): Promise<void> => ipcRenderer.invoke('pk:recording:stop-session'),
  },

  signaling: {
    start: (): Promise<PairingInfo> => ipcRenderer.invoke('pk:sig:start'),
    stop: (): Promise<void> => ipcRenderer.invoke('pk:sig:stop'),
    status: (): Promise<PairingInfo | null> => ipcRenderer.invoke('pk:sig:status'),
    /** Renderer-side WebRTC requires the SDP exchange to be in the renderer
     * itself (RTCPeerConnection only exists in the renderer process). Main
     * forwards signaling messages to/from the phone via these channels. */
    onPhoneMessage: (fn: (msg: unknown) => void): Unsub => {
      const h = (_e: unknown, msg: unknown) => fn(msg);
      ipcRenderer.on('pk:sig:phone-msg', h);
      return () => ipcRenderer.removeListener('pk:sig:phone-msg', h);
    },
    sendToPhone: (msg: unknown) => ipcRenderer.send('pk:sig:to-phone', msg),
  },
});

declare global {
  interface Window {
    pk: {
      platform: NodeJS.Platform;
      ping: () => Promise<string>;
      editor: {
        publishScene: (s: ScenePayload) => void;
        publishInputId: (id: string | null) => void;
        publishInputTick: (t: number) => void;
        onResyncRequest: (fn: () => void) => Unsub;
      };
      output: {
        onSceneState: (fn: (s: ScenePayload) => void) => Unsub;
        onInputId: (fn: (id: string | null) => void) => Unsub;
        requestSync: () => void;
      };
      vcam: {
        start: () => Promise<VcamStatus>;
        stop: () => Promise<VcamStatus>;
        status: () => Promise<VcamStatus>;
        onStatus: (fn: (s: VcamStatus) => void) => Unsub;
        installSystemExtension: () => Promise<{ ok: boolean; message: string }>;
      };
      recording: {
        startSession: () => Promise<{ ok: true } | { ok: false; message: string }>;
        stopSession: () => Promise<void>;
      };
      signaling: {
        start: () => Promise<PairingInfo>;
        stop: () => Promise<void>;
        status: () => Promise<PairingInfo | null>;
        onPhoneMessage: (fn: (msg: unknown) => void) => Unsub;
        sendToPhone: (msg: unknown) => void;
      };
    };
  }
}

export {};
