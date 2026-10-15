import { activeSegments, editDuration, scoreAt, type EditDraft } from './model';
import { mediaEvent, seekMedia } from './media';
import { drawScore, prepareScoreImage, scoreBandHeight, videoRect } from './composition';

interface Source { video: HTMLVideoElement; url: string; gain: GainNode; node: MediaElementAudioSourceNode }
interface RendererOptions { onTime?: (time: number) => void; onEnd?: () => void; onError?: (error: Error) => void; exporting?: boolean }

/** Interactive preview; offline export uses the same timeline and score cues. */
export class TimelineRenderer {
  readonly audio = new AudioContext();
  private sources = new Map<string, Source>();
  private images = new Map<string, ImageBitmap>();
  private output: AudioNode;
  private frame = 0;
  private startTime = 0;
  private position = 0;
  private playing = false;
  private disposed = false;
  private previewVisible = true;
  private lastNotify = -Infinity;
  readonly duration: number;

  private scratch = document.createElement('canvas');
  private seekGeneration = 0;
  private constructor(public draft: EditDraft, readonly canvas: HTMLCanvasElement, private options: RendererOptions) {
    this.duration = editDuration(draft.clips); this.output = this.audio.destination;
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
        const metadata = mediaEvent(video, 'loadedmetadata'); video.src = url; await metadata;
        if (video.readyState < 2) await mediaEvent(video, 'loadeddata');
        await seekMedia(video, clip.in);
      }));
      await Promise.all(draft.systems.map(async system => renderer.images.set(system.id, await prepareScoreImage(system.image))));
      await renderer.seek(0); return renderer;
    } catch (error) { renderer.dispose(); throw error; }
  }
  connectAudio(destination: AudioNode) {
    for (const source of this.sources.values()) { source.gain.disconnect(); source.gain.connect(destination); }
    this.output = destination;
  }
  get currentTime() { return this.playing ? Math.min(this.duration, (performance.now() - this.startTime) / 1000) : this.position; }
  get isPlaying() { return this.playing; }
  getScoreImage(id: string) { return this.images.get(id); }
  setPreviewVisible(visible: boolean) { this.previewVisible = visible; if (visible) this.draw(this.currentTime); }
  updateComposition({ cues, scoreLayout, videoZoom, videoOffsetY, scoreScale }: Pick<EditDraft, 'cues' | 'scoreLayout' | 'videoZoom' | 'videoOffsetY' | 'scoreScale'>) {
    this.draft = { ...this.draft, cues, scoreLayout, videoZoom, videoOffsetY, scoreScale };
    if (!this.playing) this.draw(this.position);
  }
  async seek(time: number) {
    const generation = ++this.seekGeneration;
    this.pause(); this.position = Math.max(0, Math.min(this.duration, time));
    await Promise.all(activeSegments(this.draft.clips, this.position).map(active => seekMedia(this.sources.get(active.clip.id)!.video, active.sourceTime)));
    if (!this.disposed && generation === this.seekGeneration) { this.draw(this.position); this.options.onTime?.(this.position); }
  }
  async play() {
    if (this.disposed || this.playing || !this.duration) return;
    await this.audio.resume();
    if (this.position >= this.duration - 0.01) await this.seek(0);
    await Promise.all(activeSegments(this.draft.clips, this.position).map(async active => {
      const video = this.sources.get(active.clip.id)!.video;
      await seekMedia(video, active.sourceTime); await video.play();
    }));
    if (this.disposed) return;
    this.playing = true; this.startTime = performance.now() - this.position * 1000;
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
    const time = this.currentTime;
    try {
      const active = activeSegments(this.draft.clips, time), ids = new Set(active.map(a => a.clip.id));
      for (const [id, source] of this.sources) {
        const current = active.find(a => a.clip.id === id);
        source.gain.gain.setTargetAtTime(current?.gain ?? 0, this.audio.currentTime, 0.01);
        if (!ids.has(id)) { source.video.pause(); continue; }
        if (Math.abs(source.video.currentTime - current!.sourceTime) > 0.2) source.video.currentTime = current!.sourceTime;
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
    const hasScore = this.draft.systems.length > 0 && this.draft.cues.length > 0;
    const system = scoreAt(this.draft, time), image = system && this.images.get(system.id);
    const band = hasScore ? scoreBandHeight(image || this.images.get(this.draft.systems[0]?.id || ''), width, height, this.draft.scoreScale) : 0;
    if (this.scratch.width !== width || this.scratch.height !== height) { this.scratch.width = width; this.scratch.height = height; }
    const layer = this.scratch.getContext('2d')!;
    ctx.save(); ctx.beginPath(); ctx.rect(0, band, width, height - band); ctx.clip();
    for (const active of activeSegments(this.draft.clips, time)) {
      const source = this.sources.get(active.clip.id)!;
      const rect = videoRect(this.draft, width, height, source.video.videoWidth, source.video.videoHeight, band);
      layer.fillStyle = '#0c0d10'; layer.fillRect(0, 0, width, height);
      if (source.video.readyState >= 2) layer.drawImage(source.video, rect.x, rect.y, rect.width, rect.height);
      ctx.globalAlpha = active.opacity; ctx.drawImage(this.scratch, 0, 0);
    }
    ctx.restore(); ctx.globalAlpha = 1;
    drawScore(ctx, image, width, band, this.draft.scoreScale);
  }

  dispose() {
    if (this.disposed) return;
    this.pause(); this.disposed = true; document.removeEventListener('visibilitychange', this.visibility);
    for (const source of this.sources.values()) { source.video.removeAttribute('src'); source.video.load(); source.node.disconnect(); source.gain.disconnect(); URL.revokeObjectURL(source.url); }
    this.sources.clear(); for (const image of this.images.values()) image.close(); this.images.clear();
    void this.audio.close().catch(() => {});
  }
}

export { availableExportFormats, exportVideoEdit } from './export';
