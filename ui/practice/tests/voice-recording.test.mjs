import test from 'node:test';
import assert from 'node:assert/strict';
import { PracticeAudio } from '../audio.ts';
import { BeatTracker } from '../runtime/beat-tracker.js';

function audioNode(value = 0) {
  return {
    inputs: new Set(), outputs: new Set(), value,
    connect(target) { this.outputs.add(target); target.inputs.add(this); },
    disconnect() { for (const target of this.outputs) target.inputs.delete(this); this.outputs.clear(); },
    read() { return this.value + [...this.inputs].reduce((sum, input) => sum + input.read(), 0); },
  };
}

function harness(initialStream = null) {
  const speaker = audioNode();
  const worklet = audioNode(0.5);
  const recording = Object.assign(audioNode(), { stream: { getTracks: () => [] } });
  const sources = [];
  const listeners = new Set();
  const context = {
    destination: speaker,
    createMediaStreamDestination: () => recording,
    createMediaStreamSource(stream) {
      const node = audioNode(stream.value);
      sources.push(node);
      return node;
    },
  };
  const tracker = {
    context, node: worklet, lifecycle: 'running', microphoneStream: initialStream,
    subscribe(listener) { listeners.add(listener); this.publish(); return () => listeners.delete(listener); },
    publish() { for (const listener of listeners) listener({ source: { kind: this.microphoneStream ? 'microphone' : 'off' }, lifecycle: this.lifecycle }); },
    async startListening() { this.microphoneStream ||= { value: 0.25 }; this.publish(); },
    async stopListening() { this.microphoneStream = null; this.publish(); },
    async dispose() { await this.stopListening(); this.node.disconnect(); },
  };
  worklet.connect(speaker);
  const endpoint = { port: { addEventListener() {}, removeEventListener() {} },
    subscribe: () => () => {}, request: async () => {}, dispose() {} };
  const audio = new PracticeAudio({ tracker, endpoint,
    chart: { bpm: 98, bars: [{ column: 3 }], spreadsheetId: 'chart', sheetId: 101, leadInColumn: 2 }, sessionId: 'voice-test' });
  return { audio, tracker, speaker, recording, sources };
}

test('recording mixes live voice and sampler output while speakers receive only sampler output', async () => {
  const { audio, tracker, speaker, recording, sources } = harness();
  assert(audio.snapshot().channels.every(channel => channel.gain === 1));
  assert.equal(audio.outputStream, recording.stream);
  assert.equal(recording.read(), 0.5);
  await audio.enableMicrophone();
  assert.equal(recording.read(), 0.75, 'download mix includes the unity-gain voice channel');
  assert.equal(speaker.read(), 0.5, 'live voice is not routed to speakers');
  await audio.enableMicrophone();
  tracker.publish();
  assert.equal(sources.length, 1, 'repeated microphone activation cannot double the voice');
  assert.equal(recording.read(), 0.75);
  await audio.disableMicrophone();
  assert.equal(recording.read(), 0.5);
  assert.equal(sources[0].outputs.size, 0);
  await audio.dispose();
});

test('recording voice follows microphone replacement and releases on failure and disposal', async () => {
  const { audio, tracker, recording, sources } = harness({ value: 0.25 });
  assert.equal(recording.read(), 0.75, 'already-active input can connect during synchronous subscription');
  tracker.microphoneStream = { value: 0.125 };
  tracker.publish();
  assert.equal(recording.read(), 0.625);
  assert.equal(sources[0].outputs.size, 0);
  tracker.microphoneStream = null;
  tracker.lifecycle = 'faulted';
  tracker.publish();
  assert.equal(recording.read(), 0.5);
  assert.equal(sources[1].outputs.size, 0);
  tracker.lifecycle = 'running';
  await audio.enableMicrophone();
  assert.equal(recording.read(), 0.75);
  await audio.dispose();
  assert(sources.every(node => node.outputs.size === 0));
  assert.equal(recording.read(), 0);
});

test('tracker exposes only the active microphone stream, never fixture input', () => {
  const getter = Object.getOwnPropertyDescriptor(BeatTracker.prototype, 'microphoneStream').get;
  const stream = {};
  assert.equal(getter.call({ source: { kind: 'microphone', stream } }), stream);
  for (const kind of ['off', 'requesting', 'fixture', 'test']) assert.equal(getter.call({ source: { kind, stream } }), null);
});
