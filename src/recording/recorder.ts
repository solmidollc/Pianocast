/**
 * Recorder
 *
 * Combines the program output video (1920×1080 @ 60 fps) with the audio
 * mix (piano + processed mic) into one MediaStream, encodes it via
 * MediaRecorder, and offers the result as a downloadable file when
 * stopped. Entirely in-app — no external software.
 *
 * Capture targets:
 *
 *   - Video    via main-process RecordingService. Main opens a hidden
 *              1920×1080 BrowserWindow rendering ProgramOutput and
 *              installs `setDisplayMediaRequestHandler`; we then call
 *              `getDisplayMedia({ video: true })` and receive that
 *              window's stream with no system picker.
 *
 *   - Audio    via the `getProgramStream()` taps the piano engine and
 *              audio-input engine already expose. Each tap is a
 *              MediaStream with the full master / output-gain signal.
 *              We mix them in a recorder-local AudioContext through a
 *              `MediaStreamAudioDestinationNode` so MediaRecorder sees
 *              one stereo track.
 *
 * Encoding: MP4 (H.264 + AAC) when the browser advertises it, otherwise
 * WebM (VP9 + Opus). MP4 is the safer deliverable per the spec; WebM
 * still plays in everything modern (Chrome, Firefox, VLC, OBS) and any
 * conversion is a one-line ffmpeg job.
 *
 * Live render path is never touched. The Recorder reads from the
 * already-running pipelines; nothing in pianoEngine / audioInput / the
 * scene canvas has to do anything different when recording is active.
 */

import { pianoEngine } from '../audio/pianoEngine';
import { audioInput } from '../audio/audioInput';
import { createSceneCapture } from './sceneCapture';

export interface RecorderSnapshot {
  status: 'idle' | 'starting' | 'recording' | 'stopping' | 'error';
  /** ms since `start()` resolved; 0 when not recording. */
  elapsedMs: number;
  /** Last error message, if any. */
  error: string | null;
  /** Filename of the most recent download (informational). */
  lastFileName: string | null;
  /**
   * Audio delay in ms applied inside the recording mix. Compensates for
   * tab-capture video latency: Chromium's tab-capture compositor runs
   * 50–100 ms behind the audio clock, so without this the saved file
   * has mic/piano landing ahead of the hands in the camera. Positive
   * values push audio LATER in the file.
   *
   * Persisted so the user doesn't have to re-tune every session.
   */
  audioDelayMs: number;
}

class Recorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private sceneCapture: Awaited<ReturnType<typeof createSceneCapture>> | null = null;
  private videoStream: MediaStream | null = null;
  private mixCtx: AudioContext | null = null;
  private mixDest: MediaStreamAudioDestinationNode | null = null;
  private combinedStream: MediaStream | null = null;
  /**
   * Edges we add to the shared AudioContext for the duration of a
   * recording. On stop we disconnect each so the engines return to their
   * pre-recording graph (preventing leaks and double-mixing on the next
   * record).
   */
  private mixConnections: Array<{ from: AudioNode; to: AudioNode }> = [];
  /** DelayNode spliced into the mix for AV-sync compensation. Rebuilt
   *  on each recording start so the slider is live-settable while idle
   *  and locks in at Start. */
  private delayNode: DelayNode | null = null;
  private startedAt = 0;
  private elapsedTimer: number | null = null;
  private chosenMime: string = 'video/webm';
  private chosenExt: string = 'webm';
  private static STORAGE_KEY = 'pk.recorder.v1';

  private state: RecorderSnapshot = {
    status: 'idle',
    elapsedMs: 0,
    error: null,
    lastFileName: null,
    audioDelayMs: typeof window !== 'undefined' && window.pk?.recording ? 80 : 0,
  };
  private listeners = new Set<() => void>();

  constructor() {
    this.restore();
  }

  private restore() {
    try {
      const raw =
        typeof localStorage !== 'undefined' && localStorage.getItem(Recorder.STORAGE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as Partial<RecorderSnapshot>;
      if (typeof j.audioDelayMs === 'number') {
        this.state.audioDelayMs = Math.max(0, Math.min(500, j.audioDelayMs));
      }
    } catch { /* fresh state */ }
  }

  private persist() {
    try {
      localStorage.setItem(
        Recorder.STORAGE_KEY,
        JSON.stringify({ audioDelayMs: this.state.audioDelayMs }),
      );
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Snapshot + subscription
  // -------------------------------------------------------------------------

  getSnapshot(): RecorderSnapshot {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<RecorderSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
    if ('audioDelayMs' in patch) this.persist();
  }

  /**
   * Set the audio-delay compensation in ms. Takes effect live while
   * recording (the DelayNode's delayTime ramps to the new value) and
   * is remembered for the next session.
   */
  setAudioDelayMs(ms: number): void {
    const clamped = Math.max(0, Math.min(500, ms));
    this.update({ audioDelayMs: clamped });
    if (this.delayNode && this.mixCtx) {
      this.delayNode.delayTime.setTargetAtTime(clamped / 1000, this.mixCtx.currentTime, 0.03);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start recording. Resolves once MediaRecorder is collecting chunks.
   * Rejects with a user-readable string on any failure (no window, no
   * encoder, permission denied, etc.).
   */
  async start(): Promise<void> {
    if (this.state.status === 'recording' || this.state.status === 'starting' || this.state.status === 'stopping') return;
    this.update({ status: 'starting', error: null });

    try {
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('Recording is unavailable in this browser. Try desktop Chrome or Edge.');
      }
      // 1. Ask main to spin up the hidden 1920×1080 ProgramOutput window.
      //    Main returns a media-source id naming that window as a capture
      //    target the editor renderer is authorised to read.
      const desktop = !!window.pk?.recording;
      if (!desktop) {
        this.sceneCapture = await createSceneCapture((message) => this.failWith(message));
        this.videoStream = this.sceneCapture.stream;
      } else {
      const result = await window.pk!.recording.startSession();
      if (!result.ok) throw new Error(result.message || 'Could not start recording session');

      // 2. Pull the video stream via `getUserMedia` + Electron's
      //    chromeMediaSource: 'tab' constraint. This is the canonical
      //    capture pattern in Electron 32 — `getDisplayMedia` with a
      //    `setDisplayMediaRequestHandler` returning a WebFrameMain is
      //    silently coerced to an empty stream, which is why the earlier
      //    file produced "a few ms of nothing." The mandatory-constraints
      //    block isn't in the standard `MediaTrackConstraints` typing, so
      //    we cast through `unknown`.
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: result.mediaSourceId,
            minWidth: 1920,
            maxWidth: 1920,
            minHeight: 1080,
            maxHeight: 1080,
            minFrameRate: 30,
            maxFrameRate: 60,
          },
        } as unknown as MediaTrackConstraints,
      });

      }

      await pianoEngine.init();
      await audioInput.init();

      // 3. Confirm the stream actually came up live. If the tab-capture
      //    handshake succeeded but the source is dead, MediaRecorder
      //    would emit a zero-byte file — fail fast with a useful message.
      const liveVideo = this.videoStream
        .getVideoTracks()
        .some((t) => t.readyState === 'live' && (!desktop || !t.muted));
      if (!liveVideo) {
        throw new Error('Program-output video stream is not live');
      }

      // 4. Build the audio mix inside the SHARED AudioContext that
      //    pianoEngine and audioInput both run on. Previous attempts
      //    created a recorder-owned AudioContext and tried to pull via
      //    `createMediaStreamSource(getProgramStream())` or
      //    `<audio>.srcObject + createMediaElementSource`; both produce
      //    silence against streams from MediaStreamAudioDestinationNodes
      //    in another context (known Chromium quirk — local-loopback
      //    MediaStreams don't traverse the media pipeline).
      //
      //    By connecting each engine's output AudioNode directly into a
      //    MediaStreamAudioDestinationNode we create in the SAME
      //    context, every edge stays intra-context and the mix is real.
      const sharedCtx = pianoEngine.getAudioContext();
      if (!sharedCtx) {
        throw new Error('Audio engine not initialised');
      }
      if (sharedCtx.state === 'suspended') {
        try { await sharedCtx.resume(); } catch { /* needs gesture */ }
      }
      this.mixCtx = sharedCtx;
      this.mixDest = sharedCtx.createMediaStreamDestination();

      // AV-sync compensation. Chromium's tab-capture video runs 50–100 ms
      // behind the Web Audio clock; without delay here, voice/piano land
      // ahead of hands in the recording. The DelayNode sits between the
      // mix sources and the destination so the user-adjustable slider
      // (persisted in audioDelayMs) shifts audio relative to video.
      // maxDelayTime=1 s is plenty of headroom and cheap in memory.
      this.delayNode = sharedCtx.createDelay(1.0);
      this.delayNode.delayTime.value = this.state.audioDelayMs / 1000;
      this.delayNode.connect(this.mixDest);
      this.mixConnections.push({ from: this.delayNode, to: this.mixDest });

      const pianoNode = pianoEngine.getProgramNode();
      const micNode = audioInput.getProgramNode();
      if (pianoNode) {
        pianoNode.connect(this.delayNode);
        this.mixConnections.push({ from: pianoNode, to: this.delayNode });
      }
      if (micNode) {
        micNode.connect(this.delayNode);
        this.mixConnections.push({ from: micNode, to: this.delayNode });
      }

      // 5. Combine video + mixed audio into one MediaStream and confirm
      //    every track we hand to MediaRecorder is live. The video track
      //    was checked above; we also check the audio track here so a
      //    busted MediaStreamSource doesn't silently produce a video-
      //    only output.
      const videoTrack = this.videoStream.getVideoTracks()[0];
      videoTrack.onended = () => { void this.stop(); };
      const audioTrack = this.mixDest.stream.getAudioTracks()[0];
      if (audioTrack && audioTrack.readyState !== 'live') {
        console.warn('[Recorder] mixed audio track is not live', audioTrack);
      }
      this.combinedStream = new MediaStream(
        audioTrack ? [videoTrack, audioTrack] : [videoTrack],
      );

      // 6. Pick the best container the browser advertises. MP4 is the
      //    safer deliverable when it's supported; WebM (VP9 + Opus) is
      //    the universal fallback every Chromium build can encode.
      const { mime, ext } = pickContainer();
      this.chosenMime = mime;
      this.chosenExt = ext;

      // 7. Spin up the encoder.
      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(this.combinedStream, {
        mimeType: mime,
        // Preserve native scene resolution, with ample bitrate for moving hands and fine notation.
        videoBitsPerSecond: Math.max(24_000_000, Math.round(
          (videoTrack.getSettings().width ?? 1920) * (videoTrack.getSettings().height ?? 1080)
          * (videoTrack.getSettings().frameRate ?? 60) * 0.2)),
        audioBitsPerSecond: 320_000,
      });
      this.mediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
      };
      this.mediaRecorder.onerror = (ev) => {
        const e = (ev as unknown as { error?: Error }).error;
        this.failWith(e?.message ?? 'MediaRecorder error');
      };
      this.mediaRecorder.onstop = () => {
        if (this.state.status === 'recording') {
          this.update({ status: 'stopping' });
          this.stopElapsedTimer();
        }
        void this.handleStop();
      };
      // Collect every 1s — gives a chunk to land even if the user
      // catastrophically closes the app mid-record; some chunks recover
      // in WebM even with an unwritten footer.
      this.mediaRecorder.start(1000);
      this.startedAt = performance.now();
      this.startElapsedTimer();
      this.update({ status: 'recording', elapsedMs: 0 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.cleanupStreams();
      try { await window.pk?.recording.stopSession(); } catch { /* ignore */ }
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        this.update({ status: 'idle', error: null, elapsedMs: 0 });
      } else {
        this.update({ status: 'error', error: message });
      }
    }
  }

  /**
   * Stop recording. The actual file write happens in `handleStop` once
   * MediaRecorder has flushed its tail.
   */
  async stop(): Promise<void> {
    if (this.state.status !== 'recording') return;
    this.update({ status: 'stopping' });
    this.stopElapsedTimer();
    try {
      this.mediaRecorder?.stop();
    } catch {
      // Force the cleanup path if the recorder rejects the stop call.
      await this.handleStop();
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async handleStop(): Promise<void> {
    try {
      const blob = new Blob(this.chunks, { type: this.chosenMime });
      if (!blob.size) throw new Error('No video was captured. Please try recording again.');
      const url = URL.createObjectURL(blob);
      const name = makeFileName(this.chosenExt);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Defer cleanup so the browser has time to open the download.
      window.setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 5_000);
      await this.cleanupStreams();
      try { await window.pk?.recording.stopSession(); } catch { /* ignore */ }
      this.update({ status: 'idle', elapsedMs: 0, lastFileName: name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.update({ status: 'error', error: message });
    } finally {
      await this.cleanupStreams();
      try { await window.pk?.recording.stopSession(); } catch { /* ignore */ }
    }
  }

  private failWith(message: string) {
    this.stopElapsedTimer();
    this.update({ status: 'error', error: message });
    void this.cleanupStreams();
    void window.pk?.recording.stopSession();
  }

  private async cleanupStreams() {
    this.stopElapsedTimer();
    if (this.mediaRecorder) {
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.onerror = null;
      this.mediaRecorder.ondataavailable = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch { /* ignore */ }
    }
    this.mediaRecorder = null;
    if (this.videoStream) {
      for (const t of this.videoStream.getTracks()) {
        t.onended = null;
        try { t.stop(); } catch { /* ignore */ }
      }
    }
    this.videoStream = null;
    this.sceneCapture?.dispose();
    this.sceneCapture = null;
    if (this.combinedStream) {
      for (const t of this.combinedStream.getTracks()) {
        try { t.stop(); } catch { /* ignore */ }
      }
    }
    this.combinedStream = null;
    for (const { from, to } of this.mixConnections) {
      try { from.disconnect(to); } catch { /* ignore */ }
    }
    this.mixConnections = [];
    this.delayNode = null;
    // The mix context is now the SHARED pianoEngine/audioInput context —
    // the Recorder does not own its lifecycle. Just drop references.
    this.mixCtx = null;
    this.mixDest = null;
  }

  private startElapsedTimer() {
    this.stopElapsedTimer();
    const tick = () => {
      this.update({ elapsedMs: performance.now() - this.startedAt });
      this.elapsedTimer = window.setTimeout(tick, 250);
    };
    this.elapsedTimer = window.setTimeout(tick, 250);
  }

  private stopElapsedTimer() {
    if (this.elapsedTimer != null) {
      clearTimeout(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }
}

/**
 * Pick the best container + codec the browser advertises. MP4 first
 * (safer deliverable; H.264 + AAC plays everywhere), then WebM (VP9 +
 * Opus). The MediaRecorder spec requires `isTypeSupported` to be honest
 * about what the encoder can actually produce, so we trust it.
 */
function pickContainer(): { mime: string; ext: string } {
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: 'video/mp4;codecs="avc1.64002a,mp4a.40.2"', ext: 'mp4' }, // H.264 High + AAC LC
    { mime: 'video/mp4;codecs=avc1,mp4a', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) {
      return c;
    }
  }
  // If nothing is supported the constructor itself will throw with a
  // useful message — we let that bubble up rather than guessing.
  return { mime: 'video/webm', ext: 'webm' };
}

function makeFileName(ext: string): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `piano-keys-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

export const recorder = new Recorder();
