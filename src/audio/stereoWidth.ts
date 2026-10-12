/**
 * Mid/Side stereo width.
 *
 *      L                       (M + width·S)  ← out.L
 *       \                     /
 *        ┬─► M = (L + R) / 2 ─┤
 *       / \                   \
 *      R   └─► S = (L − R)/2─►(M − width·S)   ← out.R
 *
 *   width = 0 → mono   (S * 0 → both outputs = M)
 *   width = 1 → identity (M + S = L, M − S = R)
 *   width = 2 → exaggerated stereo (S doubled)
 *
 * Implemented with plain GainNodes + a ChannelSplitter / Merger. No
 * AudioWorklet, no per-frame CPU. The width gain has setValueAtTime exposed
 * via `setWidth` so the UI slider can ramp without zipper noise.
 */

export class StereoWidth {
  readonly input: AudioNode;
  readonly output: AudioNode;
  private widthGain: GainNode;
  private widthGainNeg: GainNode;
  private ctx: AudioContext;

  constructor(ctx: AudioContext, initialWidth = 1) {
    this.ctx = ctx;
    const splitter = ctx.createChannelSplitter(2);

    // Per-channel buffers — needed because ChannelSplitter outputs are
    // monaural and feeding the same output into multiple summers is the
    // standard pattern.
    const Lin = ctx.createGain();
    const Rin = ctx.createGain();
    Lin.gain.value = 1;
    Rin.gain.value = 1;
    splitter.connect(Lin, 0);
    splitter.connect(Rin, 1);

    // Mid = (L + R) * 0.5 — both inputs sum into one gain at 0.5.
    const midSum = ctx.createGain();
    midSum.gain.value = 0.5;
    Lin.connect(midSum);
    Rin.connect(midSum);

    // Side = (L - R) * 0.5. Invert R via a gain of -1, then sum like Mid.
    const Rinv = ctx.createGain();
    Rinv.gain.value = -1;
    Rin.connect(Rinv);
    const sideSum = ctx.createGain();
    sideSum.gain.value = 0.5;
    Lin.connect(sideSum);
    Rinv.connect(sideSum);

    // Scale Side by width.
    this.widthGain = ctx.createGain();
    this.widthGain.gain.value = initialWidth;
    sideSum.connect(this.widthGain);

    // For R out we need -S; mirror the scaled Side through a -1 gain.
    this.widthGainNeg = ctx.createGain();
    this.widthGainNeg.gain.value = -initialWidth;
    sideSum.connect(this.widthGainNeg);

    // Out L = M + S', Out R = M - S'. Two summing gains, recombined with
    // ChannelMerger so downstream sees a real stereo signal again.
    const Lout = ctx.createGain();
    const Rout = ctx.createGain();
    midSum.connect(Lout);
    this.widthGain.connect(Lout);
    midSum.connect(Rout);
    this.widthGainNeg.connect(Rout);

    const merger = ctx.createChannelMerger(2);
    Lout.connect(merger, 0, 0);
    Rout.connect(merger, 0, 1);

    this.input = splitter;
    this.output = merger;
  }

  setWidth(width: number) {
    const t = this.ctx.currentTime;
    this.widthGain.gain.setTargetAtTime(width, t, 0.02);
    this.widthGainNeg.gain.setTargetAtTime(-width, t, 0.02);
  }
}
