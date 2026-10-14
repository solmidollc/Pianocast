// Lightweight audio-thread capture. Pitch analysis runs in a separate worker.
class PianoCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.offset = 0; this.waiting = false;
    this.port.onmessage = () => { this.waiting = false; };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      if (this.offset === 2048) {
        if (!this.waiting) { const copy = this.buffer.slice(); this.port.postMessage(copy, [copy.buffer]); this.waiting = true; }
        this.buffer.copyWithin(0, 1024); this.offset = 1024;
      }
    }
    return true;
  }
}
registerProcessor('piano-capture', PianoCapture);
