import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import song from '../../../songs/dance-yrself-clean.js';
import { createGateway } from '../gateway.js';
import { PersistentDesk } from '../controller.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';
import { PF as LIGHT } from '../../performance/light-abi.js';
import { decodeDeskPublication } from '../session-schema.js';
import { followDeskCharts } from '../../../scripts/desk-chart-follower.js';
import { ROTATION_LIVE_PROFILE, type VoiceEffectConfiguration } from '../../performance/model.js';
import { rangeForBar } from '../../performance/chart.js';

test('hardware applies full wet to an existing backup stack and keeps it fixed on edit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vox-'));
  const saved = Array.from({ length: 6 }, (_, profile): VoiceEffectConfiguration => ({
    profile,
    effects: profile === ROTATION_LIVE_PROFILE ? [{ kind: 'slapback', delayMs: 120, feedback: .1, wet: .6 }] : [],
  }));
  const controller = new PersistentDesk(sessionProfile(directory), installedPackage(song.compiled, saved).installed);
  try {
    const armed = controller.snapshot().defaultVoiceEffects?.find(item => item.profile === ROTATION_LIVE_PROFILE);
    assert.deepEqual(armed?.effects, [{ kind: 'slapback', delayMs: 120, feedback: .1, wet: 1 }]);
    assert.equal(controller.setAudio('on').outcome, 'accepted');
    const audio = await until(() => {
      const current = controller.snapshot().audio;
      if (current.kind === 'fault') throw new Error(current.error);
      if (current.kind === 'ready') return current;
    });
    const current = audio.performance.state.voiceEffects?.find(item => item.profile === ROTATION_LIVE_PROFILE);
    assert.ok(current);
    assert.deepEqual(current.effects, armed?.effects);
    const target = { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch };
    const applied = await controller.command(target, { command: 'configureVoiceProfile', args: {
      profile: ROTATION_LIVE_PROFILE, expectedRevision: current.revision,
      effects: [{ kind: 'slapback', delayMs: 140, feedback: .2, wet: .2 }],
    } });
    assert.equal(applied.outcome, 'applied');
    if (applied.outcome !== 'applied') throw new Error('Expected applied profile');
    assert.deepEqual(applied.state.voiceEffects?.find(item => item.profile === ROTATION_LIVE_PROFILE)?.effects,
      [{ kind: 'slapback', delayMs: 140, feedback: .2, wet: 1 }]);
  } finally {
    await controller.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('gateway commands reach the native engine and attachment does not stop it', async () => {
  const binary = resolve(process.env.NATIVE_FAKE_HOST ?? 'build/native-host/native_fake_host');
  await stat(binary);
  const directory = await mkdtemp(join(tmpdir(), 'remote-vertical-'));
  const controller = new PersistentDesk(sessionProfile(directory), installedPackage().installed);
  let server: ReturnType<typeof createGateway> | undefined;
  const followerAbort = new AbortController();
  let follower: Promise<void> | undefined;
  try {
    assert.equal(controller.snapshot().audio.kind, 'off');
    assert.equal(controller.setAudio('on').outcome, 'accepted');
    await until(() => controller.snapshot().audio.kind === 'ready' ? true : undefined, JSON.stringify(controller.snapshot().audio));
    const token = Buffer.from('012345678901234567890123456789ab');
    const origin = 'http://127.0.0.1';
    server = createGateway({ host: '127.0.0.1', port: 0, origin, token, staticRoot: directory }, controller);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
    const bootstrap = await (await fetch(`${base}/api/session`, { headers })).json();
    assert.equal(bootstrap.view.song.id, song.id);
    const audio = controller.snapshot().audio;
    assert.equal(audio.kind, 'ready');
    if (audio.kind !== 'ready') throw new Error('Not ready');
    const target = { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch };
    const command = async (sequence: number, name: string, args: object) => (await fetch(`${base}/api/command`, { method: 'POST', headers, body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence, target, command: name, args }) })).json();
    assert.equal(audio.performance.lights.length, LIGHT.LIGHT_FIELDS);
    const buttonEvents: unknown[] = [];
    const unsubscribe = controller.subscribe(value => {
      if (value.type === 'event' && value.event.type === 'control' && value.event.control?.id === 'cueButton') buttonEvents.push(value.event.control);
    });
    const pressed = await command(1, 'control', { control: { id: 'cueButton', value: 1 } });
    assert.equal(pressed.outcome, 'applied');
    assert.equal(pressed.lights[LIGHT.LIGHT_SAMPLES + LIGHT.LIGHT_SAMPLE_LEVEL], 1);
    const released = await command(2, 'control', { control: { id: 'cueButton', value: 0 } });
    assert.equal(released.outcome, 'applied');
    assert.equal(released.lights[LIGHT.LIGHT_SAMPLES + LIGHT.LIGHT_SAMPLE_LEVEL], 0);
    await until(() => buttonEvents.length === 2 ? true : undefined);
    assert.deepEqual(buttonEvents, [{ id: 'cueButton', value: 1 }, { id: 'cueButton', value: 0 }]);
    unsubscribe();
    const second = await (await fetch(`${base}/api/session`, { headers })).json();
    assert.equal(bootstrap.view.song.compiled.parts.length, 6);
    const slapback = [{ kind: 'slapback', delayMs: 100, feedback: .2, wet: .3 }];
    const edit = async (sessionId: string, sequence: number, profile: number, expectedRevision: number, effects: object[]) =>
      (await fetch(`${base}/api/command`, { method: 'POST', headers, body: JSON.stringify({ sessionId, sequence, target, command: 'configureVoiceProfile', args: { profile, expectedRevision, effects } }) })).json();
    assert.equal((await edit(second.sessionId, 1, 0, 1, slapback)).outcome, 'applied');
    const updated = await edit(bootstrap.sessionId, 3, 1, 1, slapback);
    assert.equal(updated.outcome, 'applied');
    assert.deepEqual(updated.state.voiceEffects[0].effects, slapback);
    assert.deepEqual(updated.state.voiceEffects[1].effects, slapback);
    assert.equal((await edit(bootstrap.sessionId, 4, 0, 1, [])).outcome, 'rejected');
    const observer = await (await fetch(`${base}/api/session`, { headers })).json();
    const stream = await fetch(`${base}/api/events`, { headers: { ...headers, 'x-session-id': observer.sessionId } });
    assert.ok(stream.body);
    const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
    const nativeEvents = (async () => {
      let pending = '';
      let beatFrame: number | undefined;
      let prediction = false;
      const inputs: string[] = [];
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Event stream ended before a fractional beat');
        pending += chunk.value;
        const messages = pending.split('\n\n');
        pending = messages.pop() ?? '';
        for (const message of messages) {
          if (!message.startsWith('data: ')) continue;
          const decoded = decodeDeskPublication(JSON.parse(message.slice(6)));
          if (decoded.type !== 'event') continue;
          const event = decoded.event;
          assert.equal(event.state.chart?.sheetId, song.chart.sheetId);
          if (event.type === 'identified-input' && event.identifiedInput) {
            inputs.push(`${event.identifiedInput.controlId}/${event.identifiedInput.edge}/${event.identifiedInput.value}`);
          }
          if (event.type === 'beat-prediction' && event.timing?.nextBeat) prediction = true;
          if (event.type === 'beat' && event.frame !== undefined && !Number.isInteger(event.frame)) {
            assert.ok(event.timing?.nextBeat && event.timing.nextBeat.frame > event.frame);
            beatFrame = event.frame;
          }
          if (prediction && beatFrame !== undefined && inputs.length >= 3) return { beatFrame, inputs };
        }
      }
    })();
    const selected: string[] = [];
    let followerReady = false;
    let followerError: unknown;
    follower = followDeskCharts({ origin: 'https://desk.test', token: token.toString(), cdp: 'fixture', signal: followerAbort.signal,
      log: line => { if (line.startsWith('Desk      following')) followerReady = true; },
      request: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Origin', origin);
        return fetch(new URL(new URL(String(url)).pathname, base), { ...init, headers });
      },
      select: async (_cdp, input) => {
        assert.ok(typeof input === 'object' && input !== null && 'spreadsheetId' in input && 'sheetId' in input
          && 'range' in input && typeof input.range === 'string');
        assert.equal(input.spreadsheetId, song.chart.spreadsheetId);
        assert.equal(input.sheetId, song.chart.sheetId);
        selected.push(input.range);
        return { ok: true, selectedRange: input.range, url: 'https://docs.google.com/' };
      },
    }).catch(error => { followerError = error; });
    await until(() => {
      if (followerError) throw followerError;
      return followerReady ? true : undefined;
    });
    const bindingGeneration = audio.performance.state.inputRouting?.bindingGeneration;
    assert.ok(bindingGeneration);
    assert.equal((await command(5, 'inputAttach', { intentId: 'vertical-board', kind: 'physical', bindingGeneration, releasedMask: 1, heldMask: 0 })).outcome, 'applied');
    for (const [sequence, input, value] of [[1, 0, 1], [2, 0, 0], [3, 7, -8]]) {
      assert.equal((await command(sequence + 5, 'inputEvent', { kind: 'physical', bindingGeneration, sequence, input, value })).outcome, 'applied');
    }
    const started = await command(9, 'start', { bpm: 134, startBar: 1, endBar: 10, countInBars: 1 });
    assert.equal(started.outcome, 'applied');
    assert.notEqual(started.state.runId, bootstrap.view.audio.performance.state.runId);
    const events = await Promise.race([nativeEvents, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Native timing or inputs did not arrive')), 5000).unref())]);
    assert.ok(events.beatFrame > 0);
    assert.deepEqual(events.inputs, ['blue/press/1', 'blue/release/0', 'knob/rotate/-8']);
    const again = await (await fetch(`${base}/api/session`, { headers })).json();
    assert.equal(again.view.audio.performance.state.runId, started.state.runId);
    const leadIn = rangeForBar(song.chart, null, 'count-in');
    const openingBar = rangeForBar(song.chart, 1);
    await until(() => selected.includes(openingBar) ? true : undefined, 'Direct Mac subscriber did not reach the first song bar');
    assert.deepEqual(selected.slice(0, 2), [leadIn, openingBar]);
    const stopped = await command(10, 'stop', {});
    assert.equal(stopped.outcome, 'applied');
    await reader.cancel();
  } finally {
    followerAbort.abort();
    await follower;
    await controller.close();
    server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
