import test from 'node:test';
import assert from 'node:assert/strict';
import { PracticeAudio } from '../audio.ts';
import { BeatTracker } from '../runtime/beat-tracker.js';
import { compiledCaptureFixture } from '../../../lib/performance/tests/fixtures/compiled-capture.ts';

function audioNode(value = [0, 0]) {
  return {
    inputs: new Set(), outputs: new Set(), value,
    channelCount: 2, channelCountMode: 'explicit', gain: { value: 1 },
    connect(target) { this.outputs.add(target); target.inputs.add(this); },
    disconnect() { for (const target of this.outputs) target.inputs.delete(this); this.outputs.clear(); },
    read() {
      const inputs = [this.value, ...[...this.inputs].map(input => input.read())];
      return [0, 1].map(channel => inputs.reduce((sum, input) => sum + (input[channel] || 0), 0) * this.gain.value);
    },
  };
}

function harness(initialStream = null, compiled) {
  const speaker = audioNode();
  const buses = [audioNode([0.5, 0.125]), audioNode()];
  const worklet = {
    connect(target, output = 0) { buses[output].connect(target); },
    disconnect() { for (const bus of buses) bus.disconnect(); },
  };
  const recording = Object.assign(audioNode(), { stream: { getTracks: () => [] } });
  const gains = [];
  const deviceListeners = new Map();
  const listeners = new Set();
  let rawSourceCalls = 0;
  const context = {
    destination: speaker,
    addEventListener(type, listener) { deviceListeners.set(type, listener); },
    removeEventListener(type) { deviceListeners.delete(type); },
    createMediaStreamDestination: () => recording,
    createMediaStreamSource() { rawSourceCalls++; throw new Error('The recorder must not read raw microphone input'); },
    createGain() { const node = audioNode(); gains.push(node); return node; },
  };
  const tracker = {
    context, node: worklet, lifecycle: 'running', microphoneStream: initialStream,
    subscribe(listener) { listeners.add(listener); this.publish(); return () => listeners.delete(listener); },
    publish() { for (const listener of listeners) listener({ source: { kind: this.microphoneStream ? 'microphone' : 'off' }, lifecycle: this.lifecycle }); },
    async startListening() { this.microphoneStream ||= { rawChannels: [0.8] }; this.publish(); },
    async stopListening() { this.microphoneStream = null; this.publish(); },
    async dispose() { await this.stopListening(); this.node.disconnect(); },
  };
  worklet.connect(speaker);
  const stateListeners = new Set();
  const requests = [];
  const endpoint = { port: { addEventListener() {}, removeEventListener() {} },
    subscribe(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener); },
    async request(command, payload) { requests.push({ command, payload }); }, dispose() {} };
  const audio = new PracticeAudio({ tracker, endpoint, compiled,
    chart: { bpm: 98, bars: [{ column: 3 }], spreadsheetId: 'chart', sheetId: 101, leadInColumn: 2 }, sessionId: 'voice-test' });
  function nativeLive(channels, active = true) {
    buses[1].value = channels;
    const practice = { ...audio.latest, phase: active ? 'playing' : 'idle',
      liveEffects: { prepared: true, active, revision: 2, stageCount: 1, captureSupported: false } };
    for (const listener of stateListeners) listener({ practice });
  }
  return { audio, tracker, speaker, recording, gains, buses, endpoint, requests, nativeLive, deviceListeners, get rawSourceCalls() { return rawSourceCalls; } };
}

test('queued capture rejection gains source context without closing live audio or transport', async () => {
  const compiled = await compiledCaptureFixture();
  const h = harness(null, compiled);
  try {
    await h.audio.enableMicrophone();
    h.nativeLive([.2, .4]);
    h.audio.setMonitoringRelationship('different-devices');
    const events = [];
    h.audio.onEvent(event => events.push(event));
    h.audio.onMessage({ data: { event: { v: 1, runId: 'queued', seq: 1, type: 'control', state: h.audio.latest,
      cueIndex: 1, applied: false, error: 'Another recording is active.' } } });
    assert.match(events[0].error, /^C18 crb: Another recording is active/);
    assert.equal(h.audio.latest.phase, 'playing');
    assert(h.tracker.microphoneStream);
    assert.deepEqual(h.speaker.read(), [.7, .525]);
  } finally { await h.audio.dispose(); }
});

test('recording mixes both native stereo stems once without a raw microphone branch', async () => {
  const h = harness();
  assert.deepEqual(h.recording.read(), [0.5, 0.125]);
  await h.audio.enableMicrophone();
  h.nativeLive([0.2, 0.4]);
  assert.deepEqual(h.recording.read(), [0.7, 0.525]);
  assert.deepEqual(h.speaker.read(), [0.5, 0.125], 'unknown physical setup keeps live monitoring off');
  await h.audio.enableMicrophone();
  h.tracker.publish();
  assert.equal(h.rawSourceCalls, 0);
  assert.equal(h.buses[1].outputs.size, 2, 'one recording connection and one monitor gate');
  assert.deepEqual(h.recording.read(), [0.7, 0.525], 'repeated activation cannot double the recorded stem');
  assert.equal(h.audio.outputStream, h.recording.stream);
  await h.audio.dispose();
});

for (const [relationship, expected] of [
  ['unknown', [0.5, 0.125]],
  ['different-devices', [0.7, 0.525]],
  ['same-usb-interface', [0.7, 0.525]],
  ['same-non-usb', [0.5, 0.125]],
]) {
  test(`monitoring respects confirmed ${relationship} setup while downloads keep processed stereo`, async () => {
    const h = harness({ rawChannels: [0.8] });
    h.nativeLive([0.2, 0.4]);
    h.audio.setMonitoringRelationship(relationship);
    assert.deepEqual(h.speaker.read(), expected);
    assert.deepEqual(h.recording.read(), [0.7, 0.525]);
    assert.equal(h.rawSourceCalls, 0);
    h.nativeLive([0, 0], false);
    assert.equal(h.gains[0].gain.value, 0, 'native inactive status closes the monitor gate');
    await h.audio.dispose();
  });
}

test('a monitor annotation cannot bind before an active microphone or infer device facts', async () => {
  const h = harness();
  assert.throws(() => h.audio.setMonitoringRelationship('different-devices'), /Start the microphone/);
  assert.throws(() => h.audio.setMonitoringRelationship('guessed-usb'), /Unknown monitoring/);
  assert.equal(h.audio.monitoringRelationship, 'unknown');
  await h.audio.dispose();
});

test('microphone replacement, loss, reacquisition, and faults invalidate monitoring confirmation', async () => {
  const h = harness({ rawChannels: [0.8] });
  h.nativeLive([0.2, 0.4]);
  h.audio.setMonitoringRelationship('same-usb-interface');
  assert.equal(h.gains[0].gain.value, 1);
  h.tracker.microphoneStream = { rawChannels: [0.9] };
  h.tracker.publish();
  assert.equal(h.audio.monitoringRelationship, 'unknown');
  assert.equal(h.gains[0].gain.value, 0);
  h.audio.setMonitoringRelationship('different-devices');
  await h.audio.disableMicrophone();
  assert.equal(h.gains[0].gain.value, 0);
  await h.audio.enableMicrophone();
  h.nativeLive([0.3, 0.1]);
  assert.equal(h.audio.monitoringRelationship, 'unknown');
  assert.equal(h.gains[0].gain.value, 0, 'new stream cannot reuse previous device confirmation');
  h.audio.setMonitoringRelationship('different-devices');
  h.tracker.lifecycle = 'faulted';
  h.tracker.publish();
  assert.equal(h.gains[0].gain.value, 0);
  assert.equal(h.audio.monitoringRelationship, 'unknown');
  assert.equal(h.rawSourceCalls, 0);
  await h.audio.dispose();
  assert(h.gains.every(node => node.outputs.size === 0));
  assert(h.buses.every(node => node.outputs.size === 0));
  assert.deepEqual(h.recording.read(), [0, 0]);
});

test('an output-device change closes monitoring until the physical setup is confirmed again', async () => {
  const h = harness({ rawChannels: [0.8] });
  h.nativeLive([0.2, 0.4]);
  h.audio.setMonitoringRelationship('different-devices');
  assert.equal(h.gains[0].gain.value, 1);
  h.deviceListeners.get('sinkchange')();
  assert.equal(h.gains[0].gain.value, 0);
  assert.equal(h.audio.monitoringRelationship, 'unknown');
  assert.deepEqual(h.recording.read(), [0.7, 0.525]);
  await h.audio.dispose();
  assert.equal(h.deviceListeners.size, 0);
});

for (const action of ['stop', 'panic']) {
  test(`${action} closes live monitoring before an unresponsive native acknowledgment`, async () => {
    const h = harness({ rawChannels: [0.8] });
    h.nativeLive([0.2, 0.4]);
    h.audio.setMonitoringRelationship('different-devices');
    let done;
    h.endpoint.request = () => new Promise(resolve => { done = resolve; });
    const stopping = action === 'stop' ? h.audio.stop() : h.audio.control({ id: 'mushroom' });
    assert.equal(h.gains[0].gain.value, 0);
    assert.equal(h.audio.monitoringRelationship, 'unknown');
    done();
    await stopping;
    await h.audio.dispose();
  });
}

test('effect preparation requests use the shared command and do not optimistically activate', async () => {
  const h = harness();
  const effects = [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: 0.25 }];
  await h.audio.configureLiveEffects(effects);
  assert.deepEqual(h.requests, [{ command: 'practice.effects', payload: { effects } }]);
  assert.equal(h.audio.latest.liveEffects, undefined);
  await h.audio.dispose();
});

test('a rejected effect command does not close an existing valid monitoring route', async () => {
  const h = harness({ rawChannels: [0.8] });
  h.nativeLive([0.2, 0.4]);
  h.audio.setMonitoringRelationship('different-devices');
  h.endpoint.request = async () => { throw new Error('Stop before changing effects'); };
  await assert.rejects(h.audio.configureLiveEffects([]), /Stop before changing effects/);
  assert.equal(h.gains[0].gain.value, 1);
  await h.audio.dispose();
});

test('cancelled microphone acquisition cannot notify readiness after Stop', async () => {
  const h = harness();
  let acquired;
  h.tracker.startListening = () => new Promise(resolve => { acquired = resolve; });
  const enabling = h.audio.enableMicrophone();
  await h.audio.stop();
  h.tracker.microphoneStream = { rawChannels: [0.9] };
  acquired();
  await enabling;
  assert.deepEqual(h.requests.map(request => request.command), ['practice.stop']);
  await h.audio.dispose();
});

test('stale acquisition cleanup cannot stop a newer microphone stream', async () => {
  const h = harness();
  const oldGeneration = await h.audio.enableMicrophone();
  await h.audio.disableMicrophone();
  await h.audio.enableMicrophone();
  const stream = h.tracker.microphoneStream;
  h.nativeLive([0.2, 0.4]);
  h.audio.setMonitoringRelationship('different-devices');
  const commands = h.requests.length;
  await h.audio.disableMicrophone(oldGeneration);
  assert.equal(h.tracker.microphoneStream, stream);
  assert.equal(h.requests.length, commands);
  assert.equal(h.gains[0].gain.value, 1);
  await h.audio.dispose();
});

test('failed microphone readiness notification releases the acquired stream', async () => {
  const h = harness();
  h.endpoint.request = async (command, payload) => {
    h.requests.push({ command, payload });
    if (command === 'practice.microphone' && payload.enabled) throw new Error('Native readiness unavailable');
  };
  await assert.rejects(h.audio.enableMicrophone(), /Native readiness unavailable/);
  assert.equal(h.tracker.microphoneStream, null);
  assert.equal(h.audio.monitoringRelationship, 'unknown');
  assert.equal(h.requests[0].payload.enabled, true);
  assert(h.requests.slice(1).length > 0 && h.requests.slice(1).every(request => request.payload.enabled === false));
  await h.audio.dispose();
});

test('tracker exposes only the active microphone stream, never fixture input', () => {
  const getter = Object.getOwnPropertyDescriptor(BeatTracker.prototype, 'microphoneStream').get;
  const stream = {};
  assert.equal(getter.call({ source: { kind: 'microphone', stream } }), stream);
  for (const kind of ['off', 'requesting', 'fixture', 'test']) assert.equal(getter.call({ source: { kind, stream } }), null);
});
