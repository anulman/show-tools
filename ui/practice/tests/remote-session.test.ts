import { tunerFixture } from '../../../lib/remote-performance/tests/tuner-fixture.js';
import { lightFixture } from '../../../lib/remote-performance/tests/light-fixture.js';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadSong } from '../../../songs/index.js';
import { RemoteDesk } from '../remote-session.js';
import vm from 'node:vm';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import type { TunerCommand, TunerState } from '../../../lib/tuner/model.js';

const song = await loadSong('dance-yrself-clean');
const state = { phase: 'idle', bar: null, beat: null, countInRemaining: 0, bpm: 120, startBar: 1, endBar: 4, loop: true,
  automatic: false, click: false, selectedChannel: 'L1', runId: 'run', seq: 0,
  channels: ['L1', 'L2', 'R1', 'R2'].map(id => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })),
  looping: [], recording: null, microphone: false, error: null };
const performance = { hostEpoch: 'host', revision: '1', state, tuner: tunerFixture(), lights: lightFixture() };
const off = { serverEpoch: 'server', revision: '1', song, audio: { kind: 'off' } };
const ready = { ...off, revision: '3', audio: { kind: 'ready', attempt: 'attempt', performance } };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function fixture(run: (fixture: { desk: RemoteDesk; publish: (value: unknown) => Promise<void>; calls: { url: string; body: Record<string, unknown> }[] }) => Promise<void>) {
  const previous = globalThis.fetch;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer secret');
    if (url === '/api/session') return Response.json({ sessionId: 'session', view: off });
    if (url === '/api/events') return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    const body = JSON.parse(String(init?.body)); calls.push({ url, body });
    if (url === '/api/audio') return Response.json({ outcome: 'accepted', view: body.goal === 'on' ? { ...off, revision: '2', audio: { kind: 'starting', attempt: 'attempt' } } : { ...off, revision: '5' } });
    return Response.json({ outcome: 'applied', ...performance, revision: '2' });
  };
  const desk = await RemoteDesk.connect('secret');
  try {
    void desk.listen(); await tick();
    await run({ desk, calls, publish: async value => { stream?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)); await tick(); } });
  } finally { await desk.dispose(); stream?.close(); globalThis.fetch = previous; }
}

test('off desk enables without transport start and shares command sequencing across lifecycle cycles', async () => {
  await fixture(async ({ desk, calls, publish }) => {
    assert.equal(desk.snapshot().audio.kind, 'off');
    assert.throws(() => desk.performance(), /unavailable/);
    await desk.enableAudio(); assert.equal(desk.snapshot().audio.kind, 'starting');
    assert.equal(calls.length, 1);
    await publish({ type: 'desk', view: ready });
    const session = desk.performance();
    await session.start({ bpm: 120 }); await session.stop();
    await desk.terminateAudio();
    assert.equal(desk.snapshot().audio.kind, 'off');
    await assert.rejects(session.start(), /stale/);
    await desk.enableAudio();
    await publish({ type: 'desk', view: { ...ready, revision: '7', audio: { ...ready.audio, attempt: 'next', performance: { ...performance, hostEpoch: 'next-host' } } } });
    assert.notEqual(desk.performance(), session);
    assert.deepEqual(calls.map(call => [call.url, call.body.sequence]), [['/api/audio', 1], ['/api/command', 2], ['/api/command', 3], ['/api/audio', 4], ['/api/audio', 5]]);
    assert.deepEqual(calls[1]?.body.target, { attempt: 'attempt', hostEpoch: 'host' });
  });
});

test('role-only input commands preserve source fields and a replaced endpoint cannot revoke its successor', async () => {
  await fixture(async ({ desk, calls, publish }) => {
    await publish({ type: 'desk', view: ready });
    const session = desk.performance();
    await session.inputAttach({ kind: 'keyboard', bindingGeneration: 3, releasedMask: 0, heldMask: 0 });
    await session.inputEvent({ kind: 'keyboard', bindingGeneration: 3, sequence: 100, input: 0, value: 0 });
    await session.inputRevoke({ kind: 'keyboard' });
    assert.deepEqual(calls.map(value => value.body.command), ['inputAttach', 'inputEvent', 'inputRevoke']);
    assert.deepEqual(calls[0].body.args, { kind: 'keyboard', bindingGeneration: 3, releasedMask: 0, heldMask: 0 });
    assert.deepEqual(calls[1].body.args, { kind: 'keyboard', bindingGeneration: 3, sequence: 100, input: 0, value: 0 });
    await publish({ type: 'desk', view: { ...ready, revision: '7', audio: { ...ready.audio, attempt: 'next', performance: { ...performance, hostEpoch: 'next-host' } } } });
    await assert.rejects(session.inputRevoke({ kind: 'keyboard' }), /stale/);
    assert.equal(calls.length, 3);
    assert.notEqual(desk.performance().inputScope, session.inputScope);
  });
});

test('native patches retain song, reject old revisions and filter stale attempt events', async () => {
  await fixture(async ({ desk, publish }) => {
    await publish({ type: 'desk', view: ready });
    const session = desk.performance();
    let events = 0; session.onEvent(() => events++);
    await publish({ type: 'native', serverEpoch: 'server', revision: '4', attempt: 'attempt', performance: { ...performance, revision: '4', state: { ...state, bpm: 150 } } });
    await publish({ type: 'native', serverEpoch: 'server', revision: '3', attempt: 'attempt', performance: { ...performance, revision: '3', state: { ...state, bpm: 130 } } });
    assert.equal(session.snapshot().bpm, 150); assert.equal(desk.snapshot().song.id, song.id);
    await publish({ type: 'event', attempt: 'stale', event: { v: 1, runId: 'run', seq: 1, type: 'state', state } });
    assert.equal(events, 0);
    await publish({ type: 'gap' });
    await assert.rejects(session.stop(), /stale/);
    assert.equal(desk.snapshot().audio.kind, 'ready');
    assert.equal(desk.connection.kind, 'disconnected');
    await assert.rejects(desk.terminateAudio(), /disconnected/);
  });
});

test('fault and off publications keep lifecycle commands available; detach sends no mutation', async () => {
  await fixture(async ({ desk, calls, publish }) => {
    await publish({ type: 'desk', view: { ...off, revision: '2', audio: { kind: 'fault', error: 'Device unavailable' } } });
    await desk.enableAudio();
    await desk.dispose();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, '/api/audio');
  });
});

test('invalid bootstrap fails before any performance adapter exists', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ sessionId: 'session', view: { ...ready, audio: { ...ready.audio, performance: { ...performance, state: { ...state, bpm: 'fast' } } } } });
  try { await assert.rejects(RemoteDesk.connect('secret')); } finally { globalThis.fetch = previous; }
});

test('editing one ready remote profile uses its observed revision without replacing other profiles', async () => {
  await fixture(async ({ desk, calls, publish }) => {
    const voiceEffects = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: [], prepared: true, revision: profile + 1, activity: 'standby', rotationEligible: false, rotationRemainingBeats: 0 }));
    await publish({ type: 'desk', view: { ...ready, audio: { ...ready.audio, performance: { ...performance, state: { ...state, voiceEffects } } } } });
    const effects = [{ kind: 'chorus' as const, rateHz: 1, depthMs: 2, baseDelayMs: 20, wet: .3 }];
    await desk.performance().configureVoiceProfile(1, effects);
    assert.deepEqual(calls[0]?.body.args, { profile: 1, effects, expectedRevision: 2 });
  });
});

test('opening an already playing desk observes current state without changing audio or transport', async () => {
  const previous = globalThis.fetch;
  const playing = { ...ready, audio: { ...ready.audio, performance: { ...performance, state: { ...state, phase: 'playing', bar: 2, beat: 3 } } } };
  const requests: string[] = [];
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  globalThis.fetch = async (input, init) => {
    requests.push(`${init?.method ?? 'GET'} ${input}`);
    if (String(input) === '/api/session') return Response.json({ sessionId: 'session', view: playing });
    if (String(input) === '/api/events') return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    assert.fail('Opening the desk must not send a mutation');
  };
  const desk = await RemoteDesk.connect('secret');
  try {
    assert.equal(desk.connection.kind, 'connecting');
    const observed: string[] = [];
    desk.subscribe(() => observed.push(desk.connection.kind));
    void desk.listen(); await tick();
    const session = desk.performance();
    assert.equal(session.snapshot().phase, 'playing');
    assert.equal(session.snapshot().bar, 2);
    stream?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'native', serverEpoch: 'server', revision: '4', attempt: 'attempt', performance: { ...playing.audio.performance, revision: '2', state: { ...playing.audio.performance.state, beat: 4 } } })}\n\n`));
    await tick();
    assert.equal(desk.performance(), session);
    assert.equal(session.snapshot().beat, 4);
    assert.deepEqual(requests, ['GET /api/session', 'GET /api/events']);
    const lastObserved = desk.snapshot();
    stream?.close(); await tick();
    assert.equal(desk.snapshot(), lastObserved);
    assert.equal(desk.snapshot().audio.kind, 'ready');
    assert.equal(session.snapshot().phase, 'playing');
    assert.equal(desk.connection.kind, 'disconnected');
    assert.deepEqual(observed, ['connecting', 'connected', 'connected', 'disconnected']);
    assert.throws(() => desk.performance(), /unavailable/);
    await assert.rejects(session.stop(), /stale/);
    await assert.rejects(desk.enableAudio(), /disconnected/);
    await assert.rejects(desk.terminateAudio(), /disconnected/);
    assert.deepEqual(requests, ['GET /api/session', 'GET /api/events']);
  } finally { await desk.dispose(); globalThis.fetch = previous; }
});


test('tuner telemetry publishes independently of practice state and invalidation fences commands', async () => {
  await fixture(async ({ desk, publish, calls }) => {
    await publish({ type: 'desk', view: ready });
    const session = desk.performance();
    const seen: boolean[] = [];
    session.tuner.subscribe(value => seen.push(value.listening));
    const tuner = { ...performance.tuner, revision: 1, listening: true, pitch: { kind: 'unvoiced' } };
    await publish({ type: 'native', serverEpoch: 'server', revision: '4', attempt: 'attempt', performance: { ...performance, revision: '4', tuner } });
    assert.deepEqual(seen, [false, true]);
    assert.equal(session.snapshot().phase, 'idle');
    assert.equal(session.tuner.snapshot().revision, 1);
    await session.tuner.command({ kind: 'listen', expectedRevision: 1, enabled: false });
    assert.equal(calls.at(-1)?.body.command, 'tuner');
    assert.deepEqual(calls.at(-1)?.body.args, { kind: 'listen', expectedRevision: 1, enabled: false });
    await publish({ type: 'desk', view: { ...off, revision: '5' } });
    await assert.rejects(session.tuner.command({ kind: 'cue', expectedRevision: 1 }), /stale/);
    assert.throws(() => session.tuner.snapshot(), /stale/);
    assert.throws(() => session.tuner.subscribe(() => {}), /stale/);
  });
});

class Node {
  children: Node[] = [];
  parent: Node | null = null;
  style = { left: '' };
  classList = { add() {} };
  textContent = '';
  value = '';
  hidden = false;
  disabled = false;
  append(...nodes: Node[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: Node[]) { this.children = []; this.append(...nodes); }
  setAttribute() {}
  addEventListener() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
}

const source = await sourceForVM(new URL('../app.ts', import.meta.url));
const wrapper = source.slice(source.indexOf('function sharedTuner('), source.indexOf('requiredElement("#open-tuner"'));
const unavailableStart = source.indexOf('if (!connected || status.kind !== "ready")');
assert.ok(unavailableStart >= 0);
const unavailable = source.slice(unavailableStart, source.indexOf('let session;', unavailableStart));
const panelSource = (await sourceForVM(new URL('../../tuner/panel.ts', import.meta.url)))
  .replace(/^import .*createTunerDial.*;\n/m, '')
  .replace('export function mountTuner', 'function mountTuner');

for (const reason of ['off', 'fault', 'disconnected']) {
  for (const pendingClose of [false, true]) {
    test(`tuner detaches and closes when remote audio is ${reason}${pendingClose ? ' during close' : ''}`, async () => {
      const state: TunerState = { revision: 1, root: 48, scale: 'major', step: 0,
        targets: [{ midi: 48, letter: 'C', accidental: 0, octave: 3 }], complete: false,
        listening: true, preview: { kind: 'silent' }, pitch: { kind: 'warming' } };
      let subscriptions = 0;
      let closeCommands = 0;
      let dialDisposals = 0;
      const session = { tuner: {
        snapshot: () => state,
        subscribe(listener: (value: TunerState) => void) { subscriptions++; listener(state); return () => { subscriptions--; }; },
        command(command: TunerCommand) {
          assert.equal(command.kind, 'close');
          closeCommands++;
          return new Promise<TunerState>(() => {});
        },
      } };
      const root = new Node();
      const context = vm.createContext({ root, audio: session, tunerSession: session, tunerPort: null, tunerPanel: null,
        document: { createElement: () => new Node() }, isRunning: () => false, starting: false, outputCapture: 'idle',
        connected: reason !== 'disconnected', status: { kind: reason === 'fault' ? 'fault' : 'off' },
        createTunerDial: () => ({ element: new Node(), update() {}, dispose() { dialDisposals++; } }),
        transportGeneration: 0, releasePresses() {}, chartFollower: null, renderHardwareUnavailable() {} });
      vm.runInContext(`${panelSource}\n${wrapper}\n
        tunerPort = sharedTuner(audio);
        tunerPanel = mountTuner(root, { connect: async () => tunerPort });
        tunerPanel.setSession(tunerPort);
        function disconnect() { ${unavailable} }
      `, context);
      const closing = pendingClose ? vm.runInContext('tunerPanel.close()', context) : null;
      if (pendingClose) await new Promise(resolve => setImmediate(resolve));
      vm.runInContext('disconnect()', context);
      const closed = closing ?? vm.runInContext('tunerPanel.close()', context);
      const result = await Promise.race([Promise.resolve(closed).then(() => 'closed'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 100))]);
      assert.equal(result, 'closed');
      assert.equal(context.audio, undefined);
      assert.equal(root.children.length, 0);
      assert.equal(subscriptions, 0);
      assert.equal(dialDisposals, 1);
      assert.equal(closeCommands, pendingClose ? 1 : 0, 'unavailable sessions receive no new close command');
    });
  }
}
