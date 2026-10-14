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
  expect(messages).toHaveLength(1); expect(messages[0]).toHaveLength(2048);
  capture.port.onmessage();
  for (let i = 0; i < 8; i++) capture.process(block);
  expect(messages).toHaveLength(2);
});
