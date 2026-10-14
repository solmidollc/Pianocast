// Capture at the actual device rate. Keep ~170 ms for low A0, update ~43 ms.
// Pitch analysis runs in a worker; only one audio window may be in flight.
class PianoCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    const rate = typeof sampleRate === 'number' ? sampleRate : 48000;
    this.size = 2 ** Math.ceil(Math.log2(rate * .17));
    this.hop = this.size / 4;
    this.buffer = new Float32Array(this.size); this.offset = 0; this.waiting = false;
    this.port.onmessage = () => { this.waiting = false; };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      if (this.offset === this.size) {
        if (!this.waiting) { const copy = this.buffer.slice(); this.port.postMessage(copy, [copy.buffer]); this.waiting = true; }
        this.buffer.copyWithin(0, this.hop); this.offset = this.size - this.hop;
      }
    }
    return true;
  }
}
registerProcessor('piano-capture', PianoCapture);
