import { drawScore, prepareScoreImage, scoreBandHeight, videoRect } from './composition';
import type { Input, Output, VideoCodec, AudioCodec, VideoSample, WrappedAudioBuffer } from 'mediabunny';
import { activeSegments, editDuration, segmentWeights, timedCues, timeline, type EditDraft } from './model';

let aacFallback: Promise<void> | undefined;
export interface ExportFormat { ext: 'mp4' | 'webm'; video: VideoCodec; audio: AudioCodec }
export async function availableExportFormats(resolution: 720 | 1080 = 720): Promise<ExportFormat[]> {
  const { canEncodeVideo, canEncodeAudio } = await import('mediabunny');
  if (!await canEncodeAudio('aac', { sampleRate: 48000, numberOfChannels: 2 })) {
    aacFallback ??= import('@mediabunny/aac-encoder').then(({ registerAacEncoder }) => { registerAacEncoder(); });
    try { await aacFallback; } catch { aacFallback = undefined; /* WebM remains available. */ }
  }
  const candidates: ExportFormat[] = [{ ext: 'mp4', video: 'avc', audio: 'aac' }, { ext: 'webm', video: 'vp8', audio: 'opus' }];
  const supported = await Promise.all(candidates.map(async format =>
    await canEncodeVideo(format.video, { width: resolution * 16 / 9, height: resolution, frameRate: 30 }) &&
    await canEncodeAudio(format.audio, { sampleRate: 48000, numberOfChannels: 2 })));
  return candidates.filter((_, index) => supported[index]);
}

interface ExportOptions { resolution: 720 | 1080; format: string; signal: AbortSignal; onProgress: (value: number) => void }
class DroppedFrames extends Error {}

/** Fast encoding is checked for completeness; retry with frame-preserving encoding if a browser drops frames. */
export async function exportVideoEdit(draft: EditDraft, options: ExportOptions) {
  try { return await renderOffline(draft, options, 'realtime'); }
  catch (error) {
    options.signal.throwIfAborted();
    if (!(error instanceof DroppedFrames)) throw error;
    return renderOffline(draft, options, 'quality');
  }
}

/** Offline decoding/encoding: never plays or records the preview. */
async function renderOffline(draft: EditDraft, options: ExportOptions, latencyMode: 'realtime' | 'quality') {
  const duration = editDuration(draft.clips), cues = timedCues(draft);
  if (!duration) throw new Error('Import a video before exporting.');
  if (draft.systems.length && !cues.length) throw new Error('Align the first score system before exporting, or remove the unused systems.');
  const check = () => options.signal.throwIfAborted();
  check();
  const format = (await availableExportFormats(options.resolution)).find(f => f.ext === options.format);
  if (!format) throw new Error('Fast export is unavailable for this format in your browser. Try Chrome or Edge.');
  const { Input, BlobSource, ALL_FORMATS, VideoSampleSink, AudioBufferSink, Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource, AudioBufferSource } = await import('mediabunny');
  const width = options.resolution * 16 / 9, height = options.resolution, fps = 30, sampleRate = 48000;
  const segments = timeline(draft.clips), frames = Math.ceil(duration * fps);
  const makeCanvas = (w: number, h: number) => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const result = document.createElement('canvas'); result.width = w; result.height = h; return result;
  };
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const blendCanvas = makeCanvas(width, height);
  const blendCtx = blendCanvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  // Keep the score pixels in the output canvas; only repaint them at cue boundaries.
  const inputs = new Map<string, Input>(), videos = new Map<string, { iterator: AsyncGenerator<VideoSample>; current?: VideoSample; next?: VideoSample; done?: boolean }>();
  const audios = new Map<string, { iterator: AsyncGenerator<WrappedAudioBuffer>; current?: WrappedAudioBuffer; done?: boolean }>();
  const images = new Map<string, ImageBitmap>();
  let output: Output | undefined, canceled: Promise<void> | undefined;
  const abort = () => {
    for (const input of inputs.values()) input.dispose();
    if (output && output.state !== 'finalized' && output.state !== 'canceled') canceled = output.cancel().catch(() => {});
  };
  options.signal.addEventListener('abort', abort, { once: true });
  try {
    for (const [index, segment] of segments.entries()) {
      check();
      const asset = draft.assets.find(a => a.id === segment.clip.assetId);
      if (!asset) throw new Error('A source video is missing. Import it again.');
      let input = inputs.get(asset.id);
      if (!input) { input = new Input({ source: new BlobSource(asset.blob), formats: ALL_FORMATS }); inputs.set(asset.id, input); }
      const video = await input.getPrimaryVideoTrack();
      if (!video || !await video.canDecode()) throw new Error(`Cannot decode “${asset.name}”. Try an MP4 (H.264) or WebM video.`);
      const sink = new VideoSampleSink(video);
      videos.set(segment.clip.id, { iterator: sink.samples(segment.clip.in, segment.clip.out) });
      const audio = await input.getPrimaryAudioTrack();
      if (audio) {
        if (!await audio.canDecode()) throw new Error(`Cannot decode the audio in “${asset.name}”. Try an MP4 (H.264/AAC) or WebM video.`);
        audios.set(segment.clip.id, { iterator: new AudioBufferSink(audio).buffers(segment.clip.in, segment.clip.out) });
      }
      options.onProgress(0.02 * (index + 1) / segments.length);
    }
    for (const system of draft.systems) { check(); images.set(system.id, await prepareScoreImage(system.image)); }
    check();
    const target = new BufferTarget();
    output = new Output({ target, format: format.ext === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat() });
    let encodedFrames = 0;
    const videoSource = new CanvasSource(canvas, { codec: format.video, bitrate: height === 1080 ? 6_000_000 : 4_000_000, latencyMode, keyFrameInterval: 2, onEncodedPacket: () => { encodedFrames++; } });
    output.addVideoTrack(videoSource, { frameRate: fps });
    const audioSource = audios.size ? new AudioBufferSource({ codec: format.audio, bitrate: 192_000 }) : undefined;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();
    let cueIndex = -1, lastScore: string | undefined, lastBand = -1;
    for (let chunk = 0; chunk < Math.ceil(duration); chunk++) {
      check();
      // Interleave one second of video and audio to bound decoded data and muxer buffering.
      for (let frame = chunk * fps; frame < Math.min(frames, (chunk + 1) * fps); frame++) {
        check();
        const time = frame / fps;
        while (cues[cueIndex + 1]?.time <= time + 0.001) cueIndex++;
        const systemId = cues[cueIndex]?.systemId, image = systemId ? images.get(systemId) : undefined;
        const band = cues.length ? scoreBandHeight(image || images.get(draft.systems[0]?.id || ''), width, height) : 0;
        const scoreChanged = frame === 0 || lastScore !== systemId || lastBand !== band;
        ctx.globalAlpha = 1; ctx.fillStyle = '#0c0d10';
        ctx.fillRect(0, band !== lastBand ? 0 : band, width, band !== lastBand ? height : height - band);
        ctx.save();
        if (band) { ctx.beginPath(); ctx.rect(0, band, width, height - band); ctx.clip(); }
        for (const active of activeSegments(draft.clips, time)) {
          const cursor = videos.get(active.clip.id)!;
          if (!cursor.current && !cursor.done) { const first = await cursor.iterator.next(); cursor.current = first.value; cursor.done = !!first.done; }
          if (!cursor.next && !cursor.done) { const next = await cursor.iterator.next(); cursor.next = next.value; cursor.done = !!next.done; }
          while (cursor.next && cursor.next.timestamp <= active.sourceTime + 1e-6) {
            cursor.current?.close(); cursor.current = cursor.next;
            const next = await cursor.iterator.next(); cursor.next = next.value; cursor.done = !!next.done;
          }
          const sample = cursor.current;
          if (sample && sample.timestamp <= active.sourceTime + 1e-6) {
            const rect = videoRect(draft, width, height, sample.displayWidth, sample.displayHeight, band);
            if (active.opacity === 1) sample.draw(ctx, rect.x, rect.y, rect.width, rect.height);
            else {
              blendCtx.fillStyle = '#0c0d10'; blendCtx.fillRect(0, 0, width, height);
              sample.draw(blendCtx, rect.x, rect.y, rect.width, rect.height);
              ctx.globalAlpha = active.opacity; ctx.drawImage(blendCanvas, 0, 0); ctx.globalAlpha = 1;
            }
          }
        }
        ctx.restore(); ctx.globalAlpha = 1;
        if (scoreChanged) drawScore(ctx, image, width, band);
        lastScore = systemId; lastBand = band;
        await videoSource.add(time, Math.min(1 / fps, duration - time));
        if (frame % 6 === 0) options.onProgress(0.02 + 0.94 * (frame + 1) / frames);
      }
      if (audioSource) {
        const chunkStart = chunk * sampleRate, chunkEnd = Math.min(Math.round(duration * sampleRate), (chunk + 1) * sampleRate);
        const mixed = new AudioBuffer({ length: chunkEnd - chunkStart, numberOfChannels: 2, sampleRate });
        const channels = [mixed.getChannelData(0), mixed.getChannelData(1)];
        for (const [index, segment] of segments.entries()) {
          const cursor = audios.get(segment.clip.id);
          if (!cursor || segment.start >= chunkEnd / sampleRate || segment.end <= chunk) continue;
          const sourceStart = segment.clip.in + Math.max(chunk, segment.start) - segment.start;
          const sourceEnd = segment.clip.in + Math.min(chunkEnd / sampleRate, segment.end) - segment.start;
          while (!cursor.done) {
            check();
            if (!cursor.current) { const next = await cursor.iterator.next(); cursor.current = next.value; cursor.done = !!next.done; }
            const value = cursor.current; if (!value) break;
            if (value.timestamp >= sourceEnd) break;
            if (value.timestamp + value.duration <= sourceStart) { cursor.current = undefined; continue; }
            const first = Math.max(chunkStart, Math.ceil((segment.start + Math.max(segment.clip.in, value.timestamp) - segment.clip.in) * sampleRate));
            const last = Math.min(chunkEnd, Math.ceil(segment.end * sampleRate), Math.ceil((segment.start + value.timestamp + value.duration - segment.clip.in) * sampleRate));
            const sourceChannels = [value.buffer.getChannelData(0), value.buffer.getChannelData(Math.min(1, value.buffer.numberOfChannels - 1))];
            for (let frame = first; frame < last; frame++) {
              const t = frame / sampleRate, offset = (segment.clip.in + t - segment.start - value.timestamp) * value.buffer.sampleRate;
              const a = Math.max(0, Math.min(value.buffer.length - 1, Math.floor(offset))), b = Math.min(value.buffer.length - 1, a + 1), fraction = Math.max(0, offset - a);
              const gain = segmentWeights(segments, index, t).gain;
              for (let channel = 0; channel < 2; channel++) channels[channel][frame - chunkStart] += (sourceChannels[channel][a] * (1 - fraction) + sourceChannels[channel][b] * fraction) * gain;
            }
            if (value.timestamp + value.duration > sourceEnd) break;
            cursor.current = undefined;
          }
        }
        check(); await audioSource.add(mixed);
      }
      // Let input, progress and cancellation events run even with very fast encoders.
      await new Promise<void>(resolve => {
        // Timers can be throttled to one second in background tabs. Message tasks are not.
        const channel = new MessageChannel();
        channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
        channel.port2.postMessage(null);
      });
    }
    check(); options.onProgress(0.97); await output.finalize(); check();
    if (encodedFrames !== frames) {
      if (latencyMode === 'realtime') throw new DroppedFrames();
      throw new Error('The encoder did not preserve every frame. Try another export format.');
    }
    if (!target.buffer) throw new Error('The export did not produce a video. Please try again.');
    options.onProgress(1);
    return { blob: new Blob([target.buffer], { type: format.ext === 'mp4' ? 'video/mp4' : 'video/webm' }), extension: format.ext };
  } catch (error) { check(); throw error; }
  finally {
    options.signal.removeEventListener('abort', abort);
    // Dispose first to interrupt any decoder work before closing the iterators.
    for (const input of inputs.values()) input.dispose();
    await Promise.allSettled([...videos.values()].map(cursor => cursor.iterator.return(undefined)));
    for (const cursor of videos.values()) { cursor.current?.close(); cursor.next?.close(); }
    await Promise.allSettled([...audios.values()].map(cursor => cursor.iterator.return(undefined)));
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
    await canceled;
    for (const image of images.values()) image.close();
  }
}
