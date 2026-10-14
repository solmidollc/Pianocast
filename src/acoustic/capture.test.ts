import { expect, it } from 'vitest';
import source from './capture.worklet.js?raw';
it('bounds pending audio to one window and emits no monitor audio', () => {
  let Processor: any;
  const messages: Float32Array[] = [];
  class Base { port = { onmessage: null as any, postMessage: (message: Float32Array) => messages.push(message) }; }
  new Function('AudioWorkletProcessor', 'registerProcessor', source)(Base, (_name: string, value: any) => { Processor = value; });
  const capture = new Processor();
  const block = [ [new Float32Array(128).fill(.1)] ];
  for (let i = 0; i < 200; i++) expect(capture.process(block)).toBe(true);
  expect(messages).toHaveLength(1); expect(messages[0]).toHaveLength(8192);
  capture.port.onmessage();
  for (let i = 0; i < 16; i++) capture.process(block);
  expect(messages).toHaveLength(2);
});
it('keeps enough bass cycles at different actual device sample rates', () => {
  for (const rate of [44100, 48000, 96000]) {
    let Processor: any; const messages: Float32Array[] = [];
    class Base { port = { onmessage: null as any, postMessage: (message: Float32Array) => messages.push(message) }; }
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(Base, (_: string, value: any) => { Processor = value; }, rate);
    const capture = new Processor();
    for (let i = 0; i < 256; i++) capture.process([[new Float32Array(128)]]);
    expect(messages).toHaveLength(1);
    expect(messages[0].length / rate).toBeGreaterThanOrEqual(.17);
    expect(messages[0].length / rate).toBeLessThan(.34);
  }
});
