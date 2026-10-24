import test from 'node:test';
import assert from 'node:assert/strict';
import { PracticeAudio } from '../audio.ts';
import { BeatTracker } from '../runtime/beat-tracker.js';

function audioNode(value = [0]) {
  return {
    inputs: new Set(), outputs: new Set(), value,
    channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers',
    connect(target) { this.outputs.add(target); target.inputs.add(this); },
    disconnect() { for (const target of this.outputs) target.inputs.delete(this); this.outputs.clear(); },
    read() {
      const inputs = [this.value, ...[...this.inputs].map(input => input.read())];
      const channels = this.channelCountMode === 'explicit' ? this.channelCount : Math.max(...inputs.map(input => input.length));
      return Array.from({ length: channels }, (_, index) => inputs.reduce((sum, input) => {
        if (channels === 1 && input.length === 2 && this.channelInterpretation === 'speakers') return sum + (input[0] + input[1]) / 2;
        return sum + (input.length === 1 && this.channelInterpretation === 'speakers' ? input[0] : input[index] || 0);
      }, 0));
    },
  };
}

function harness(initialStream = null, sampleChannels = [0.5, 0.5]) {
  const speaker = audioNode();
  const worklet = audioNode(sampleChannels);
  const recording = Object.assign(audioNode(), { stream: { getTracks: () => [] } });
  const sources = [];
  const gains = [];
  const listeners = new Set();
  const context = {
    destination: speaker,
    createMediaStreamDestination: () => recording,
    createMediaStreamSource(stream) {
      const node = audioNode(stream.channels);
      sources.push(node);
      return node;
    },
    createGain() { const node = audioNode(); gains.push(node); return node; },
  };
  const tracker = {
    context, node: worklet, lifecycle: 'running', microphoneStream: initialStream,
    subscribe(listener) { listeners.add(listener); this.publish(); return () => listeners.delete(listener); },
    publish() { for (const listener of listeners) listener({ source: { kind: this.microphoneStream ? 'microphone' : 'off' }, lifecycle: this.lifecycle }); },
    async startListening() { this.microphoneStream ||= { channels: [0.25] }; this.publish(); },
    async stopListening() { this.microphoneStream = null; this.publish(); },
    async dispose() { await this.stopListening(); this.node.disconnect(); },
  };
  worklet.connect(speaker);
  const endpoint = { port: { addEventListener() {}, removeEventListener() {} },
    subscribe: () => () => {}, request: async () => {}, dispose() {} };
  const audio = new PracticeAudio({ tracker, endpoint,
    chart: { bpm: 98, bars: [{ column: 3 }], spreadsheetId: 'chart', sheetId: 101, leadInColumn: 2 }, sessionId: 'voice-test' });
  return { audio, tracker, speaker, recording, sources, gains };
}

test('recording mixes live voice and sampler output while speakers receive only sampler output', async () => {
  const { audio, tracker, speaker, recording, sources, gains } = harness();
  assert(audio.snapshot().channels.every(channel => channel.gain === 1));
  assert.equal(audio.outputStream, recording.stream);
  assert.deepEqual(recording.read(), [0.5, 0.5]);
  await audio.enableMicrophone();
  assert.deepEqual(recording.read(), [0.75, 0.75], 'mono voice remains unity gain in both download channels');
  assert.deepEqual(speaker.read(), [0.5, 0.5], 'live voice is not routed to speakers');
  await audio.enableMicrophone();
  tracker.publish();
  assert.equal(sources.length, 1, 'repeated microphone activation cannot double the voice');
  assert.deepEqual(recording.read(), [0.75, 0.75]);
  await audio.disableMicrophone();
  assert.deepEqual(recording.read(), [0.5, 0.5]);
  assert.equal(sources[0].outputs.size, 0);
  assert(gains.every(node => node.outputs.size === 0));
  await audio.dispose();
});

for (const [name, channels, voice] of [
  ['mono', [0.25], 0.25],
  ['left-only stereo', [0.25, 0], 0.125],
  ['right-only stereo', [0, 0.25], 0.125],
  ['stereo', [0.25, 0.125], 0.1875],
]) {
  test(`${name} microphone input is centered without changing sample stereo or speaker output`, async () => {
    const { audio, recording, speaker } = harness({ channels }, [0.5, 0.125]);
    const mix = recording.read();
    assert.deepEqual(mix, [0.5 + voice, 0.125 + voice]);
    assert.equal(mix[0] - 0.5, mix[1] - 0.125, 'voice contribution is identical in left and right');
    assert.deepEqual(speaker.read(), [0.5, 0.125]);
    await audio.dispose();
  });
}

test('recording voice follows microphone replacement and releases every node on failure and disposal', async () => {
  const { audio, tracker, recording, sources, gains } = harness({ channels: [0.25] });
  assert.deepEqual(recording.read(), [0.75, 0.75], 'already-active input can connect during synchronous subscription');
  tracker.microphoneStream = { channels: [0, 0.25] };
  tracker.publish();
  assert.deepEqual(recording.read(), [0.625, 0.625]);
  assert.equal(sources[0].outputs.size, 0);
  assert.equal(gains[0].outputs.size, 0);
  tracker.microphoneStream = null;
  tracker.lifecycle = 'faulted';
  tracker.publish();
  assert.deepEqual(recording.read(), [0.5, 0.5]);
  assert.equal(sources[1].outputs.size, 0);
  assert.equal(gains[1].outputs.size, 0);
  tracker.lifecycle = 'running';
  await audio.enableMicrophone();
  assert.deepEqual(recording.read(), [0.75, 0.75]);
  await audio.dispose();
  assert(sources.every(node => node.outputs.size === 0));
  assert(gains.every(node => node.outputs.size === 0));
  assert.deepEqual(recording.read(), [0]);
});

test('tracker exposes only the active microphone stream, never fixture input', () => {
  const getter = Object.getOwnPropertyDescriptor(BeatTracker.prototype, 'microphoneStream').get;
  const stream = {};
  assert.equal(getter.call({ source: { kind: 'microphone', stream } }), stream);
  for (const kind of ['off', 'requesting', 'fixture', 'test']) assert.equal(getter.call({ source: { kind, stream } }), null);
});
