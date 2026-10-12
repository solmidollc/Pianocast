import { useEffect, useState } from 'react';

interface LatencyStats {
  inputToFrameMs: number;
  inputToFrameAvgMs: number;
  fps: number;
}
interface VcamStatus {
  running: boolean;
  bound: boolean;
  socketPath: string | null;
  consumerConnected: boolean;
  latency: LatencyStats;
  systemExtensionState: 'unknown' | 'requested' | 'activated' | 'failed';
}

const ZERO: VcamStatus = {
  running: false,
  bound: false,
  socketPath: null,
  consumerConnected: false,
  latency: { inputToFrameMs: 0, inputToFrameAvgMs: 0, fps: 0 },
  systemExtensionState: 'unknown',
};

export function VirtualCameraPanel() {
  const [status, setStatus] = useState<VcamStatus>(ZERO);
  const [busy, setBusy] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!window.pk) return;
    let cancelled = false;
    window.pk.vcam.status().then((s) => {
      if (!cancelled) setStatus(s);
    });
    const unsub = window.pk.vcam.onStatus((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const s = await window.pk!.vcam.start();
      setStatus(s);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    try {
      const s = await window.pk!.vcam.stop();
      setStatus(s);
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    setBusy(true);
    try {
      const r = await window.pk!.vcam.installSystemExtension();
      setInstallMsg(r.message);
    } finally {
      setBusy(false);
    }
  };

  const running = status.running;
  const consumer = status.consumerConnected;
  const noElectron = !window.pk;

  if (noElectron) {
    return (
      <div className="px-4 pb-3 text-[11px] text-ink-400 leading-relaxed">
        Browser preview — virtual camera is Electron-only. Run{' '}
        <span className="font-mono text-ink-200">npm run dev</span> to enable.
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dot state={running ? (consumer ? 'live' : 'standby') : 'off'} />
          <span className="text-xs text-ink-200">
            {running ? (consumer ? 'Broadcasting' : 'Waiting for consumer') : 'Stopped'}
          </span>
        </div>
        <button
          onClick={running ? stop : start}
          disabled={busy}
          className={`text-xs px-3 py-1 rounded border transition-colors ${
            running
              ? 'border-white/10 text-ink-200 hover:border-white/20'
              : 'border-accent bg-accent/15 text-ink-50 hover:bg-accent/25'
          } disabled:opacity-50`}
        >
          {running ? 'Stop' : 'Start'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="Input → Frame" value={`${status.latency.inputToFrameMs.toFixed(0)} ms`} />
        <Stat label="Avg (2s)" value={`${status.latency.inputToFrameAvgMs.toFixed(0)} ms`} />
        <Stat label="FPS" value={status.latency.fps.toFixed(0)} />
      </div>

      {status.socketPath && (
        <div className="text-[10px] text-ink-500 font-mono break-all">
          {status.socketPath}
        </div>
      )}

      <div className="border-t border-white/5 pt-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 mb-2">
          Native helper
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-300">
            {consumer
              ? 'Connected'
              : status.systemExtensionState === 'requested'
                ? 'Install requested'
                : 'Not installed'}
          </span>
          <button
            onClick={install}
            disabled={busy}
            className="text-[11px] px-2 py-1 rounded border border-white/10 hover:border-white/20 text-ink-200 disabled:opacity-50"
          >
            Install
          </button>
        </div>
        {installMsg && (
          <div className="mt-2 text-[10px] text-ink-400 leading-relaxed">{installMsg}</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-800/60 rounded px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.16em] text-ink-500">{label}</div>
      <div className="text-ink-100 tabular-nums">{value}</div>
    </div>
  );
}

function Dot({ state }: { state: 'live' | 'standby' | 'off' }) {
  const color =
    state === 'live' ? '#4ADE80' : state === 'standby' ? '#FACC15' : '#52555E';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color,
        boxShadow: state === 'live' ? `0 0 6px ${color}` : 'none',
      }}
    />
  );
}
