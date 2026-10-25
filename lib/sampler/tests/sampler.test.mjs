import assert from 'node:assert/strict';
import test from 'node:test';
import { Sampler } from '../sampler.js';
import { SampleEngine } from './support/wasm-runtime.ts';

function sharedRuntime() {
  const engine = new SampleEngine({ sampleRate: 8 });
  const listeners = new Set();
  const endpoint = {
    disposed: false,
    commands: [],
    subscribe(listener) { listeners.add(listener); listener({ sampler: engine.snapshot() }); return () => listeners.delete(listener); },
    async request(command, payload = {}, transfer = []) {
      this.commands.push(command);
      payload = structuredClone(payload, { transfer });
      this.lastPayload = payload;
      if (command === 'sample.load') engine.load(payload.sampleId, payload.channels, payload.sampleRate);
      else if (command === 'sample.trigger') engine.trigger(payload.sampleId, payload.when * 8, payload.gain);
      else if (command === 'sample.stop') engine.stop(payload.sampleId);
      else if (command === 'sample.volume') engine.setVolume(payload.volume);
      else if (command === 'sample.stopAll' || command === 'performance.stopAll') engine.stopAll();
      const state = { sampler: engine.snapshot() };
      for (const listener of listeners) listener(state);
      return state;
    },
    dispose() { this.disposed = true; },
  };
  const context = { currentTime: 0.25, closed: false, close() { this.closed = true; } };
  return { engine, endpoint, context, sampler: new Sampler({ audioContext: context, endpoint }) };
}

test('loadPCM copies transferred buffers and acknowledged state is visible to callers', async () => {
  const { sampler, endpoint } = sharedRuntime();
  const pcm = new Float32Array([1, 2, 3]);
  const observed = [];
  sampler.subscribe(state => observed.push(state.samples.length));
  const state = await sampler.loadPCM('tone', [pcm], 8);
  assert.deepEqual(Array.from(pcm), [1, 2, 3]);
  assert.notEqual(endpoint.lastPayload.channels[0].buffer, pcm.buffer);
  assert.equal(state.samples[0].id, 'tone');
  assert.deepEqual(observed, [0, 1]);
  await sampler.trigger('tone');
  assert.equal(endpoint.lastPayload.when, 0.25);
  assert.equal(sampler.snapshot().activeVoices, 1);
  await sampler.stop('tone');
  assert.deepEqual(endpoint.lastPayload, { sampleId: 'tone' });
  assert.equal(sampler.snapshot().activeVoices, 0);
  await sampler.stopAll();
  await assert.rejects(sampler.trigger('missing'), /Unknown sample/);
  await sampler.dispose();
});

test('AudioBuffer and File loading use the shared decoder without detaching source PCM', async () => {
  const { sampler, context } = sharedRuntime();
  const pcm = new Float32Array([1, 2]);
  const audio = { numberOfChannels: 1, sampleRate: 8, getChannelData() { return pcm; } };
  await sampler.load('buffer', audio);
  let decoded;
  context.decodeAudioData = async bytes => { decoded = bytes; return audio; };
  const bytes = new ArrayBuffer(12);
  await sampler.loadFile('file', { arrayBuffer: async () => bytes });
  assert.equal(decoded, bytes);
  assert.equal(pcm.byteLength, 8);
  assert.deepEqual(sampler.snapshot().samples.map(sample => sample.id), ['buffer', 'file']);
  await sampler.dispose();
});

test('recording client sends immediate acknowledged start and stop commands', async () => {
  const { sampler, endpoint } = sharedRuntime();
  await sampler.startRecording('a', { maxSeconds: 12 });
  assert.deepEqual(endpoint.lastPayload, { sampleId: 'a', maxSeconds: 12 });
  await sampler.stopRecording('a');
  assert.deepEqual(endpoint.commands, ['record.start', 'record.stop']);
  assert.deepEqual(endpoint.lastPayload, { sampleId: 'a' });
  await sampler.dispose();
});

test('disposing an attached sampler rejects its pending work and leaves shared resources usable', async () => {
  const { sampler, endpoint, context } = sharedRuntime();
  endpoint.request = () => new Promise(() => {});
  const request = sampler.stopAll();
  const rejected = assert.rejects(request, /disposed/);
  await Promise.resolve();
  await sampler.dispose();
  await rejected;
  assert.equal(endpoint.disposed, false);
  assert.equal(context.closed, false);
  await assert.rejects(sampler.setVolume(1), /disposed/);
});

test('a trigger immediately followed by sequencer Stop All preserves command order and renders silence', async () => {
  const { sampler, endpoint, engine } = sharedRuntime();
  await sampler.loadPCM('kick', [new Float32Array([1, 1, 1, 1])], 8);
  endpoint.commands.length = 0;
  const hit = sampler.trigger('kick');
  const stop = endpoint.request('performance.stopAll');
  await Promise.all([hit, stop]);
  assert.deepEqual(endpoint.commands, ['sample.trigger', 'performance.stopAll']);
  const output = [new Float32Array(8), new Float32Array(8)];
  engine.render(output, 0, 0, 8);
  assert(output.every(channel => channel.every(sample => sample === 0)));
  assert.equal(engine.snapshot().activeVoices, 0);
  await sampler.dispose();
});
