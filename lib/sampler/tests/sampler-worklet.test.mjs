import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.sampleRate = 8;
globalThis.currentFrame = 1000;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.port = { messages: [], postMessage(message) { this.messages.push(message); } }; }
};
let RegisteredProcessor;
globalThis.registerProcessor = (name, processor) => {
  assert.equal(name, 'sampler');
  RegisteredProcessor = processor;
};
await import('../sampler-worklet.js');

test('standalone processor schedules context seconds and renders without state polls', () => {
  globalThis.currentFrame = 1000;
  const processor = new RegisteredProcessor();
  let id = 0;
  const command = (command, payload = {}) => {
    processor.receive({ id: ++id, command, payload });
    return processor.port.messages.at(-1);
  };
  assert.equal(processor.port.messages[0].state.sampler.ready, true);
  assert.equal(command('sample.load', { sampleId: 'tone', channels: [new Float32Array([1, 2, 3])], sampleRate: 8 }).ok, true);
  command('sample.trigger', { sampleId: 'tone', when: (1000 + 5.25) / 8, gain: 1 });
  const first = [new Float32Array(4), new Float32Array(4)];
  assert.equal(processor.process([], [first]), true);
  assert.deepEqual(Array.from(first[0]), [0, 0, 0, 0]);
  globalThis.currentFrame = 1004;
  const second = [new Float32Array(4), new Float32Array(4)];
  processor.process([], [second]);
  assert.deepEqual(Array.from(second[0]), [0, 0, 1.75, 2.75]);
  assert.deepEqual(second[0], second[1]);
  assert.equal(command('state').state.sampler.metadata.processedFrames, 1008);
  command('sample.stopAll');
  globalThis.currentFrame = 1008;
  const silence = [new Float32Array(4), new Float32Array(4)];
  processor.process([], [silence]);
  assert(silence.every(channel => channel.every(value => value === 0)));
  assert.match(command('sample.trigger', { sampleId: 'missing', when: 130 }).error, /Unknown sample/);
  assert.match(command('unknown').error, /Unknown audio command/);
  command('dispose');
  assert.equal(processor.process([], [silence]), false);
  assert.equal(processor.port.messages.at(-1).state.sampler.ready, false);
});

test('a delayed first process uses the current AudioContext frame for a future start', () => {
  globalThis.currentFrame = 0;
  const processor = new RegisteredProcessor();
  processor.receive({ id: 1, command: 'sample.load', payload: {
    sampleId: 'tone', channels: [new Float32Array([1, 2])], sampleRate: 8,
  } });
  processor.receive({ id: 2, command: 'sample.trigger', payload: { sampleId: 'tone', when: 4224 / 8 } });
  globalThis.currentFrame = 4096;
  const before = [new Float32Array(128), new Float32Array(128)];
  processor.process([], [before]);
  assert(before[0].every(value => value === 0));
  globalThis.currentFrame = 4224;
  const onset = [new Float32Array(128), new Float32Array(128)];
  processor.process([], [onset]);
  assert.deepEqual(Array.from(onset[0].subarray(0, 4)), [1, 2, 0, 0]);
});

test('a past trigger before the delayed first process starts at the next context frame', () => {
  globalThis.currentFrame = 0;
  const processor = new RegisteredProcessor();
  processor.receive({ id: 1, command: 'sample.load', payload: {
    sampleId: 'tone', channels: [new Float32Array([1, 0.5])], sampleRate: 8,
  } });
  globalThis.currentFrame = 4096;
  processor.receive({ id: 2, command: 'sample.trigger', payload: { sampleId: 'tone', when: 0 } });
  const reply = processor.port.messages.at(-1);
  assert.equal(reply.ok, true);
  assert.equal(reply.state.sampler.metadata.lateTriggers, 1);
  assert.equal(reply.state.sampler.metadata.maxLateFrames, 4096);
  const output = [new Float32Array(4), new Float32Array(4)];
  processor.process([], [output]);
  assert.deepEqual(Array.from(output[0]), [1, 0.5, 0, 0]);
  assert.deepEqual(output[0], output[1]);
});

test('standalone records its mono input without monitoring and plays the committed take', () => {
  globalThis.currentFrame = 0;
  const processor = new RegisteredProcessor();
  const send = (command, payload = {}) => {
    processor.receive({ id: 1, command, payload });
    return processor.port.messages.at(-1);
  };
  assert.equal(send('record.start', { sampleId: 'a', maxSeconds: 1 }).ok, true);
  const output = [new Float32Array(4), new Float32Array(4)];
  const input = new Float32Array([1, 0.5, -0.25, 0]);
  processor.process([[input]], [output]);
  assert(output.every(channel => channel.every(value => value === 0)));
  assert.match(send('sample.trigger', { sampleId: 'a', when: 0.5 }).error, /recording/);
  globalThis.currentFrame = 4;
  const stopped = send('record.stop', { sampleId: 'a' });
  assert.equal(stopped.state.sampler.recordings[0].frames, 4);
  assert.equal(stopped.state.sampler.recordings[0].recording, false);
  assert.equal(send('sample.trigger', { sampleId: 'a', when: 0.5 }).ok, true);
  processor.process([[new Float32Array([8, 8, 8, 8])]], [output]);
  assert.deepEqual(output[0], input);
  assert.deepEqual(output[1], input);
});

test('standalone Stop All saves an active take and silences its playback', () => {
  globalThis.currentFrame = 0;
  const processor = new RegisteredProcessor();
  processor.receive({ id: 1, command: 'record.start', payload: { sampleId: 'a' } });
  const output = [new Float32Array(2), new Float32Array(2)];
  processor.process([[new Float32Array([0.75, -0.25])]], [output]);
  globalThis.currentFrame = 2;
  processor.receive({ id: 2, command: 'sample.stopAll' });
  const state = processor.port.messages.at(-1).state.sampler;
  assert.equal(state.recordings[0].recording, false);
  assert.equal(state.samples[0].length, 2);
  assert.equal(state.activeVoices, 0);
  processor.receive({ id: 3, command: 'sample.trigger', payload: { sampleId: 'a', when: 2 / 8 } });
  processor.receive({ id: 4, command: 'sample.stopAll' });
  processor.process([[]], [output]);
  assert(output.every(channel => channel.every(value => value === 0)));
});
