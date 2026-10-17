import { activeSegments, editDuration, scoreAt, timeline, type EditDraft } from './model';
import { mediaEvent, seekMedia } from './media';
import { drawCompositionScore, prepareScoreImage, compositionBand, scoreAspect, videoRect } from './composition';

interface Source { video: HTMLVideoElement; url: string; gain: GainNode; node: MediaElementAudioSourceNode }
interface RendererOptions { onTime?: (time: number) => void; onEnd?: () => void; onError?: (error: Error) => void; exporting?: boolean }

/** Interactive preview; offline export uses the same timeline and score cues. */
export class TimelineRenderer {
  readonly audio = new AudioContext();
  private sources = new Map<string, Source>();
  private images = new Map<string, ImageBitmap>();
  private output: AudioNode;
  private frame = 0;
  private clockClipId?: string;
  private segments: ReturnType<typeof timeline>;
  private position = 0;
  private playing = false;
  private disposed = false;
  private lifetime = new AbortController();
  private previewVisible = true;
  private lastNotify = -Infinity;
  readonly duration: number;

  private scratch = document.createElement('canvas');
  private seekGeneration = 0;
  private constructor(public draft: EditDraft, readonly canvas: HTMLCanvasElement, private options: RendererOptions) {
    this.duration = editDuration(draft.clips); this.segments = timeline(draft.clips); this.output = this.audio.destination;
    document.addEventListener('visibilitychange', this.visibility);
  }
  static async create(draft: EditDraft, canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    const renderer = new TimelineRenderer(draft, canvas, options);
    try {
      await Promise.all(draft.clips.map(async clip => {
        const asset = draft.assets.find(a => a.id === clip.assetId); if (!asset) throw new Error('A source video is missing. Import it again.');
        const video = document.createElement('video'), url = URL.createObjectURL(asset.blob);
        video.playsInline = true; video.preload = 'auto';
        const gain = renderer.audio.createGain(), node = renderer.audio.createMediaElementSource(video);
        node.connect(gain); gain.connect(renderer.output); gain.gain.value = 0;
        renderer.sources.set(clip.id, { video, url, gain, node });
        const metadata = mediaEvent(video, 'loadedmetadata', 15000, renderer.lifetime.signal); video.src = url; await metadata;
        if (video.readyState < 2) await mediaEvent(video, 'loadeddata', 15000, renderer.lifetime.signal);
        await seekMedia(video, clip.in, renderer.lifetime.signal);
      }));
      await Promise.all(draft.systems.map(async system => renderer.images.set(system.id, await prepareScoreImage(system.image))));
      await renderer.seek(0); return renderer;
    } catch (error) { renderer.dispose(); throw error; }
  }
  connectAudio(destination: AudioNode) {
    for (const source of this.sources.values()) { source.gain.disconnect(); source.gain.connect(destination); }
    this.output = destination;
  }
  get currentTime() {
    if (!this.playing) return this.position;
    const segment = this.segments.find(segment => segment.clip.id === this.clockClipId), source = this.clockClipId && this.sources.get(this.clockClipId);
    if (!segment || !source || source.video.seeking) return this.position;
    const mediaTime = source.video.ended ? segment.end : segment.start + source.video.currentTime - segment.clip.in;
    return Math.max(segment.start, Math.min(segment.end, this.duration, mediaTime));
  }
  /** Snapshot what was audible at the input event, rather than its later release/render. */
  getMarkTime(eventTime = performance.now()) {
    if (!this.playing) return this.position;
    const output = this.audio.getOutputTimestamp?.();
    const latency = output?.contextTime ? this.audio.currentTime - output.contextTime : this.audio.baseLatency + (this.audio.outputLatency || 0);
    const queued = Math.max(0, Math.min(2, (performance.now() - eventTime) / 1000));
    return Math.max(0, this.currentTime - Math.max(0, Math.min(2, latency || 0)) - queued);
  }
  get isPlaying() { return this.playing; }
  getScoreImage(id: string) { return this.images.get(id); }
  setPreviewVisible(visible: boolean) { this.previewVisible = visible; if (visible) this.draw(this.currentTime); }
  updateComposition({ cues, scoreLayout, videoZoom, videoOffsetX, videoOffsetY, scoreScale, scoreSpace, scoreHeight, scoreSizing }: Pick<EditDraft, 'cues' | 'scoreLayout' | 'videoZoom' | 'videoOffsetX' | 'videoOffsetY' | 'scoreScale' | 'scoreSpace' | 'scoreHeight' | 'scoreSizing'>) {
    this.draft = { ...this.draft, cues, scoreLayout, videoZoom, videoOffsetX, videoOffsetY, scoreScale, scoreSpace, scoreHeight, scoreSizing };
    if (!this.playing) this.draw(this.position);
  }
  async seek(time: number) {
    if (this.disposed) return;
    const generation = ++this.seekGeneration;
    this.pause(); this.position = Math.max(0, Math.min(this.duration, time));
    await Promise.all(activeSegments(this.draft.clips, this.position).map(active => seekMedia(this.sources.get(active.clip.id)!.video, active.sourceTime, this.lifetime.signal)));
    if (!this.disposed && generation === this.seekGeneration) { this.draw(this.position); this.options.onTime?.(this.position); }
  }
  async play() {
    if (this.disposed || this.playing || !this.duration) return;
    await this.audio.resume();
    if (this.position >= this.duration - 0.01) await this.seek(0);
    await Promise.all(activeSegments(this.draft.clips, this.position).map(async active => {
      const video = this.sources.get(active.clip.id)!.video;
      await seekMedia(video, active.sourceTime, this.lifetime.signal); await video.play();
    }));
    if (this.disposed) return;
    this.clockClipId = activeSegments(this.draft.clips, this.position).sort((a, b) => b.gain - a.gain)[0]?.clip.id;
    this.playing = true;
    this.frame = requestAnimationFrame(this.tick);
  }
  pause() {
    this.position = this.currentTime; this.playing = false; cancelAnimationFrame(this.frame);
    for (const source of this.sources.values()) source.video.pause();
    this.options.onTime?.(this.position);
  }
  private visibility = () => {
    if (!this.playing || !document.hidden) return;
    if (this.options.exporting) this.fail(new Error('Keep this tab visible during export. Your source videos are unchanged; you can retry.'));
    else this.pause();
  };
  private fail(error: Error) { this.pause(); this.options.onError?.(error); }
  private tick = () => {
    if (!this.playing || this.disposed) return;
    const time = this.currentTime; this.position = time;
    try {
      if (time >= this.duration - 0.001) { this.draw(this.duration); this.pause(); this.position = this.duration; this.options.onTime?.(this.duration); this.options.onEnd?.(); return; }
      const active = activeSegments(this.draft.clips, time), ids = new Set(active.map(a => a.clip.id));
      if (!this.clockClipId || !ids.has(this.clockClipId)) this.clockClipId = active.slice().sort((a, b) => b.gain - a.gain)[0]?.clip.id;
      for (const [id, source] of this.sources) {
        const current = active.find(a => a.clip.id === id);
        source.gain.gain.setTargetAtTime(current?.gain ?? 0, this.audio.currentTime, 0.01);
        if (!ids.has(id)) { source.video.pause(); continue; }
        // Let the audible media drive time. Only bring newly-active/secondary clips into sync.
        if ((source.video.paused || id !== this.clockClipId) && Math.abs(source.video.currentTime - current!.sourceTime) > 0.08) source.video.currentTime = current!.sourceTime;
        if (source.video.paused && !source.video.ended) void source.video.play().catch(error => this.fail(error instanceof Error ? error : new Error(String(error))));
      }
      this.draw(time);
      if (performance.now() - this.lastNotify > 80) { this.lastNotify = performance.now(); this.options.onTime?.(time); }
      if (time >= this.duration) { this.pause(); this.position = this.duration; this.options.onTime?.(this.duration); this.options.onEnd?.(); return; }
      this.frame = requestAnimationFrame(this.tick);
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  };
  private draw(time: number) {
    if (!this.previewVisible) return;
    const ctx = this.canvas.getContext('2d')!; const { width, height } = this.canvas;
    ctx.globalAlpha = 1; ctx.fillStyle = '#0c0d10'; ctx.fillRect(0, 0, width, height);
    const system = scoreAt(this.draft, time) || (!this.draft.cues.length ? this.draft.systems[0] : undefined), image = system && this.images.get(system.id);
    const band = compositionBand(this.draft, height), top = this.draft.scoreLayout === 'below' ? 0 : band;
    if (this.scratch.width !== width || this.scratch.height !== height) { this.scratch.width = width; this.scratch.height = height; }
    const layer = this.scratch.getContext('2d')!;
    ctx.save(); ctx.beginPath(); ctx.rect(0, top, width, height - band); ctx.clip();
    for (const active of activeSegments(this.draft.clips, time)) {
      const source = this.sources.get(active.clip.id)!;
      const rect = videoRect(this.draft, width, height, source.video.videoWidth, source.video.videoHeight, band);
      layer.fillStyle = '#0c0d10'; layer.fillRect(0, 0, width, height);
      if (source.video.readyState >= 2) layer.drawImage(source.video, rect.x, rect.y, rect.width, rect.height);
      ctx.globalAlpha = active.opacity; ctx.drawImage(this.scratch, 0, 0);
    }
    ctx.restore(); ctx.globalAlpha = 1;
    drawCompositionScore(ctx, image, this.draft, width, height, scoreAspect(this.images.values()));
  }

  dispose() {
    if (this.disposed) return;
    this.pause(); this.disposed = true; this.lifetime.abort(); document.removeEventListener('visibilitychange', this.visibility);
    for (const source of this.sources.values()) { source.video.removeAttribute('src'); source.video.load(); source.node.disconnect(); source.gain.disconnect(); URL.revokeObjectURL(source.url); }
    this.sources.clear(); for (const image of this.images.values()) image.close(); this.images.clear();
    void this.audio.close().catch(() => {});
  }
}

export { availableExportFormats, exportVideoEdit } from './export';
