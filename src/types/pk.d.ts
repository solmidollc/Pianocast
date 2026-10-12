// Renderer-side ambient types for the preload bridge defined in
// electron/preload.ts. Keep both files in sync.
//
// This file is a global declaration script (no top-level imports/exports),
// so its interfaces are visible everywhere in the renderer without import.

type PkUnsub = () => void;

interface PkScenePayload {
  modules: unknown;
  background: unknown;
  canvasWidth: number;
  canvasHeight: number;
  key: unknown;
}

interface PkLatencyStats {
  inputToFrameMs: number;
  inputToFrameAvgMs: number;
  fps: number;
}

interface PkVcamStatus {
  running: boolean;
  bound: boolean;
  socketPath: string | null;
  consumerConnected: boolean;
  latency: PkLatencyStats;
  systemExtensionState: 'unknown' | 'requested' | 'activated' | 'failed';
}

interface PkPairingInfo {
  code: string;
  url: string;
  host: string;
  port: number;
}

interface PkApi {
  platform: NodeJS.Platform;
  ping: () => Promise<string>;
  editor: {
    publishScene: (s: PkScenePayload) => void;
    publishInputId: (id: string | null) => void;
    publishInputTick: (t: number) => void;
    onResyncRequest: (fn: () => void) => PkUnsub;
  };
  output: {
    onSceneState: (fn: (s: PkScenePayload) => void) => PkUnsub;
    onInputId: (fn: (id: string | null) => void) => PkUnsub;
    requestSync: () => void;
  };
  vcam: {
    start: () => Promise<PkVcamStatus>;
    stop: () => Promise<PkVcamStatus>;
    status: () => Promise<PkVcamStatus>;
    onStatus: (fn: (s: PkVcamStatus) => void) => PkUnsub;
    installSystemExtension: () => Promise<{ ok: boolean; message: string }>;
  };
  recording: {
    startSession: () => Promise<
      { ok: true; mediaSourceId: string } | { ok: false; message: string }
    >;
    stopSession: () => Promise<void>;
  };
  signaling: {
    start: () => Promise<PkPairingInfo>;
    stop: () => Promise<void>;
    status: () => Promise<PkPairingInfo | null>;
    onPhoneMessage: (fn: (msg: unknown) => void) => PkUnsub;
    sendToPhone: (msg: unknown) => void;
  };
}

interface Window {
  pk?: PkApi;
}
