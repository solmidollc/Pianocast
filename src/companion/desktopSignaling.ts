import { companionStatus } from './signaling';

/**
 * Desktop-side signaling client.
 *
 * Owns the RTCPeerConnection that receives the phone's overhead camera. Main
 * brokers SDP and ICE between us and the phone's WebSocket. We:
 *   1. Wait for the phone's WebRTC offer (from main).
 *   2. Answer it with a recvonly video transceiver.
 *   3. Exchange ICE candidates.
 *   4. When ontrack fires, push the MediaStream into companionStatus.
 *
 * On phone disconnect, we tear down the connection so the next pairing
 * starts clean.
 */

interface SignalMessage {
  type: string;
  [k: string]: unknown;
}

let pc: RTCPeerConnection | null = null;
let unsubMsg: (() => void) | null = null;
let started = false;

function rtcConfig(): RTCConfiguration {
  // STUN is unnecessary for same-LAN peers, but provides robustness if the
  // phone is on a different subnet (VPN, multi-NIC desktop).
  return {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };
}

function send(msg: SignalMessage) {
  window.pk?.signaling.sendToPhone(msg);
}

function reset() {
  if (pc) {
    try {
      pc.close();
    } catch {
      /* ignore */
    }
  }
  pc = null;
  companionStatus.setStream(null);
}

async function ensurePeer() {
  if (pc) return pc;
  const p = new RTCPeerConnection(rtcConfig());
  // The phone is sendonly; we only need to receive.
  p.addTransceiver('video', { direction: 'recvonly' });
  p.onicecandidate = (e) => {
    if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() });
  };
  p.ontrack = (e) => {
    const [stream] = e.streams;
    companionStatus.setStream(stream ?? new MediaStream([e.track]));
  };
  p.onconnectionstatechange = () => {
    if (
      p.connectionState === 'closed' ||
      p.connectionState === 'failed' ||
      p.connectionState === 'disconnected'
    ) {
      // Wait for the phone to renegotiate before tearing down.
      if (p.connectionState !== 'disconnected') reset();
    }
  };
  pc = p;
  return p;
}

async function onPhoneMessage(raw: unknown) {
  const msg = raw as SignalMessage;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'phone-connected') {
    // Phone reconnected; clear any old PC to renegotiate cleanly.
    reset();
    return;
  }
  if (msg.type === 'offer') {
    const p = await ensurePeer();
    await p.setRemoteDescription(new RTCSessionDescription(msg as unknown as RTCSessionDescriptionInit));
    const answer = await p.createAnswer();
    await p.setLocalDescription(answer);
    send({ type: 'answer', sdp: answer.sdp, sdpType: answer.type });
    return;
  }
  if (msg.type === 'ice' && msg.candidate && pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit));
    } catch {
      /* late candidate, ignore */
    }
    return;
  }
  if (msg.type === 'bye') {
    reset();
    return;
  }
}

export function startDesktopSignalingClient() {
  if (started) return;
  started = true;
  unsubMsg = window.pk?.signaling.onPhoneMessage(onPhoneMessage) ?? null;
}

export function stopDesktopSignalingClient() {
  unsubMsg?.();
  unsubMsg = null;
  reset();
  started = false;
}
