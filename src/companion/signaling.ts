/**
 * Companion phone-app signaling.
 *
 * The phone companion is a separate web app that opens in mobile Safari/Chrome
 * over the local network. It scans a pairing code from the desktop app, then
 * negotiates a WebRTC session that streams its rear camera back. The desktop
 * receives the camera as a MediaStreamTrack and feeds it into the
 * OverheadCamera module.
 *
 * This file holds the surface area for that flow. The actual transport (a
 * lightweight signaling server bound to the LAN, or BroadcastChannel-over-mDNS)
 * will be implemented in the next phase. The shape is fixed now so the rest of
 * the app can be built against it.
 */

interface CompanionSnapshot {
  pairingCode: string | null;
  paired: boolean;
  stream: MediaStream | null;
}

type Listener = () => void;

class CompanionStatus {
  private state: CompanionSnapshot = {
    pairingCode: null,
    paired: false,
    stream: null,
  };
  private listeners = new Set<Listener>();

  snapshot(): CompanionSnapshot {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called by the main process once a signaling server is bound. */
  setPairingCode(code: string) {
    this.state = { ...this.state, pairingCode: code };
    this.emit();
  }

  /** Called when WebRTC negotiation completes with the phone. */
  setStream(stream: MediaStream | null) {
    this.state = { ...this.state, stream, paired: !!stream };
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

export const companionStatus = new CompanionStatus();
