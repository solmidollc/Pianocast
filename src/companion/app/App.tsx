import { useEffect, useMemo, useRef } from 'react';
import { DrawingBoard } from '../../annotation/DrawingBoard';
import { usePeer } from './usePeer';

/**
 * Companion App
 *
 * One screen. One job: aim the phone at the keyboard, confirm pairing, stream.
 *
 * The UI shows the live camera preview fullscreen so the user can frame the
 * keyboard. A small status pill at the top reflects connection state — that's
 * the only chrome. No menus, no settings.
 */

export function CompanionApp() {
  if (new URLSearchParams(window.location.search).get('mode') === 'annotation') return <DrawingBoard />;
  return <CameraCompanion />;
}

function CameraCompanion() {
  const wsUrl = useMemo(() => buildWsUrl(), []);
  const { stage, error, stream } = usePeer({ wsUrl });
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#070709',
        color: '#ECECEF',
        fontFamily: 'Arial, Helvetica, sans-serif',
        overflow: 'hidden',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          background: '#000',
        }}
      />

      {/* Aim guide: a centered rectangle to help the user line up the keyboard. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: '78%',
            height: '32%',
            border: '1px solid rgba(255,255,255,0.35)',
            borderRadius: 4,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.18)',
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 18px)',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <StatusPill stage={stage} error={error} />
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.55)',
          }}
        >
          {stage === 'streaming' ? 'Streaming overhead view' : 'Aim at the keyboard'}
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  stage,
  error,
}: {
  stage: ReturnType<typeof usePeer>['stage'];
  error: string | null;
}) {
  const palette = {
    connecting: { bg: 'rgba(0,0,0,0.45)', dot: '#FACC15', label: 'Connecting' },
    'requesting-camera': {
      bg: 'rgba(0,0,0,0.45)',
      dot: '#FACC15',
      label: 'Requesting camera',
    },
    pairing: { bg: 'rgba(0,0,0,0.45)', dot: '#FACC15', label: 'Pairing' },
    streaming: { bg: 'rgba(0,0,0,0.45)', dot: '#4ADE80', label: 'Live' },
    error: { bg: 'rgba(120,0,0,0.55)', dot: '#F87171', label: error ?? 'Error' },
  } as const;
  const p = palette[stage];
  return (
    <div
      style={{
        background: p.bg,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        padding: '8px 14px',
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        letterSpacing: '0.04em',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: p.dot,
          boxShadow: stage === 'streaming' ? `0 0 6px ${p.dot}` : 'none',
        }}
      />
      <span>{p.label}</span>
    </div>
  );
}

function buildWsUrl(): string {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code') ?? '';
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${url.host}/ws?code=${encodeURIComponent(code)}`;
}
