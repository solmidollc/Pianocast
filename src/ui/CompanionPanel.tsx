import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { companionStatus } from '../companion/signaling';

interface PairingInfo {
  code: string;
  url: string;
  host: string;
  port: number;
}

export function CompanionPanel() {
  const [info, setInfo] = useState<PairingInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [streamLive, setStreamLive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (window.pk) {
      window.pk.signaling.status().then((s) => {
        if (!cancelled && s) setInfo(s);
      });
    }
    const unsub = companionStatus.subscribe(() => {
      setStreamLive(!!companionStatus.snapshot().stream);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!info || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, info.url, {
      width: 168,
      margin: 0,
      color: {
        dark: '#ECECEF',
        light: '#0c0d10',
      },
      errorCorrectionLevel: 'M',
    }).catch(() => {
      /* render swallow */
    });
  }, [info]);

  const start = async () => {
    setBusy(true);
    try {
      const i = await window.pk!.signaling.start();
      setInfo(i);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    try {
      await window.pk!.signaling.stop();
      setInfo(null);
    } finally {
      setBusy(false);
    }
  };

  if (!window.pk) {
    return (
      <div className="px-4 pb-3 text-[11px] text-ink-400 leading-relaxed">
        Phone camera streaming requires the desktop app. In this browser, choose a connected camera in Video. Tablet drawing is available from an Annotation layer.
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 space-y-3">
      {!info && (
        <>
          <div className="text-[11px] text-ink-400 leading-relaxed">
            Pair a phone over Wi-Fi to stream an overhead view of the keyboard
            into the Overhead Camera module.
          </div>
          <button
            onClick={start}
            disabled={busy}
            className="w-full text-xs py-1.5 rounded border border-accent bg-accent/15 text-ink-50 hover:bg-accent/25 transition-colors disabled:opacity-50"
          >
            Start pairing
          </button>
        </>
      )}

      {info && (
        <>
          <div className="flex items-start gap-3">
            <canvas
              ref={canvasRef}
              width={168}
              height={168}
              className="bg-ink-950 rounded p-2 border border-white/8"
            />
            <div className="flex-1 text-[11px] space-y-2">
              <div>
                <div className="text-ink-500 uppercase tracking-[0.16em] text-[9px] mb-0.5">
                  Code
                </div>
                <div className="font-mono text-base text-ink-50 tracking-wider">
                  {info.code}
                </div>
              </div>
              <div>
                <div className="text-ink-500 uppercase tracking-[0.16em] text-[9px] mb-0.5">
                  Address
                </div>
                <div className="font-mono text-ink-200 text-[11px] break-all">
                  {info.host}:{info.port}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[11px] text-ink-300">
              <Dot live={streamLive} />
              {streamLive ? 'Streaming' : 'Waiting for phone'}
            </span>
            <button
              onClick={stop}
              disabled={busy}
              className="text-[11px] px-2 py-1 rounded border border-white/10 hover:border-white/20 text-ink-200 disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Dot({ live }: { live: boolean }) {
  const color = live ? '#4ADE80' : '#52555E';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color,
        boxShadow: live ? `0 0 6px ${color}` : 'none',
      }}
    />
  );
}

