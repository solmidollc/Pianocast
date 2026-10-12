import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Companion-side WebRTC peer.
 *
 * Lifecycle:
 *   1. Open WS to the desktop signaling server.
 *   2. getUserMedia({ video: { facingMode: 'environment' } }) for the rear cam.
 *   3. Create RTCPeerConnection, add the track sendonly.
 *   4. Create offer, set local, send to desktop over WS.
 *   5. Receive answer, set remote.
 *   6. Trickle ICE in both directions.
 *
 * The desktop's RTCPeerConnection is set up with a recvonly video transceiver,
 * matching us.
 *
 * We prefer 720p video at 30fps — high enough to read keys clearly, low
 * enough that the encoder doesn't add visible latency on phone hardware.
 */

type Stage =
  | 'connecting'
  | 'requesting-camera'
  | 'pairing'
  | 'streaming'
  | 'error';

interface UsePeerOpts {
  wsUrl: string;
}

export function usePeer(opts: UsePeerOpts) {
  const [stage, setStage] = useState<Stage>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    try { pcRef.current?.close(); } catch { /* ignore */ }
    pcRef.current = null;
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  const send = (msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        const ws = new WebSocket(opts.wsUrl);
        wsRef.current = ws;

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error('Could not reach the desktop. Same Wi-Fi?'));
          ws.onclose = (ev) => reject(new Error(ev.reason || 'WebSocket closed.'));
        });
        if (cancelled) return;
        setStage('requesting-camera');

        const media = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        });
        if (cancelled) {
          for (const t of media.getTracks()) t.stop();
          return;
        }
        streamRef.current = media;
        setStream(media);

        setStage('pairing');
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        pcRef.current = pc;

        for (const track of media.getVideoTracks()) {
          pc.addTransceiver(track, {
            direction: 'sendonly',
            sendEncodings: [
              {
                maxBitrate: 2_500_000, // 2.5 Mbps is plenty for 720p30 line of keys
                maxFramerate: 30,
              },
            ],
          });
        }

        pc.onicecandidate = (e) => {
          if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() });
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') setStage('streaming');
          if (pc.connectionState === 'failed') {
            setStage('error');
            setError('Connection failed.');
          }
        };

        ws.onmessage = async (ev) => {
          try {
            const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
            if (msg.type === 'answer') {
              await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
            } else if (msg.type === 'ice' && msg.candidate) {
              try { await pc.addIceCandidate(msg.candidate); } catch { /* ignore */ }
            }
          } catch {
            /* ignore */
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: 'offer', sdp: offer.sdp });
      } catch (err) {
        if (cancelled) return;
        setStage('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [opts.wsUrl, cleanup]);

  return { stage, error, stream };
}
