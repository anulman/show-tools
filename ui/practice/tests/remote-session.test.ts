import { tunerFixture } from '../../../lib/remote-performance/tests/tuner-fixture.js';
import { lightFixture } from '../../../lib/remote-performance/tests/light-fixture.js';
import { test } from 'node:test';
import { Schema } from 'effect';
import { NativeTargetSchema } from '../../../lib/remote-performance/session-schema.js';
import { strict as assert } from 'node:assert';
import { chartMetadata } from '../../../lib/performance/chart.js';
import { loadSong } from '../../../songs/index.js';
import { createMusicalInputProducer } from '../peripheral-input.js';
import { RemoteDesk, RemoteSession } from '../remote-session.js';
import { createChartFollower } from '../open-chart.js';
import vm from 'node:vm';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import type { TunerCommand, TunerState } from '../../../lib/tuner/model.js';

const song = await loadSong('dance-yrself-clean');
const state = { phase: 'idle', bar: null, beat: null, countInRemaining: 0, bpm: 120, startBar: 1, endBar: 4, loop: true,
  automatic: false, click: false, selectedChannel: 'L1', runId: 'run', seq: 0,
  channels: ['L1', 'L2', 'R1', 'R2'].map(id => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })),
  inputRouting: { bindingGeneration: 1, sessionHighWatermark: 0, panicMask: 0, producers: [] },
  looping: [], recording: null, microphone: false, error: null };
const performance = { hostEpoch: 'host', revision: '1', state, tuner: tunerFixture(), lights: lightFixture() };
const off = { serverEpoch: 'server', revision: '1', song, audio: { kind: 'off' } };
const ready = { ...off, revision: '3', audio: { kind: 'ready', attempt: 'attempt', performance } };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function fixture(run: (fixture: { desk: RemoteDesk; publish: (value: unknown) => Promise<void>; calls: { url: string; body: Record<string, unknown> }[]; setInputStatus: (value: unknown) => void }) => Promise<void>) {
  const previous = globalThis.fetch;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let inputStatus: unknown = { kind: 'unknown' };
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer secret');
    if (url === '/api/session') return Response.json({ sessionId: 'session', inputOwnerToken: 'original-input-owner', view: off });
    if (url === '/api/input-intent-status') return Response.json(inputStatus);
    if (url === '/api/events') return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    const body = JSON.parse(String(init?.body)); calls.push({ url, body });
    if (url === '/api/audio') return Response.json({ outcome: 'accepted', view: body.goal === 'on' ? { ...off, revision: '2', audio: { kind: 'starting', attempt: 'attempt' } } : { ...off, revision: '5' } });
    const revision = String(calls.length + 1);
    const receipt = body.command === 'inputAttach' ? { target: body.target, producer: 0, session: 1, kind: body.args.kind, bindingGeneration: body.args.bindingGeneration, admissionRevision: revision } : undefined;
    return Response.json({ outcome: 'applied', ...performance, revision, ...(receipt ? { receipt, state: { ...state, inputRouting: { ...state.inputRouting, bindingGeneration: receipt.bindingGeneration, sessionHighWatermark: 1,
      producers: [{ producer: 0, session: 1, kind: receipt.kind, releasedMask: 0, heldMask: 0, lastSequence: 0 }] } } } : {}) });
  };
  const desk = await RemoteDesk.connect('secret');
  try {
    void desk.listen(); await tick();
    await run({ desk, calls, setInputStatus: value => { inputStatus = value; }, publish: async value => { stream?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)); await tick(); } });
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
    assert.partialDeepStrictEqual(calls[0].body.args, { kind: 'keyboard', bindingGeneration: 3, releasedMask: 0, heldMask: 0 });
    assert.match(JSON.stringify(calls[0].body.args), /"intentId":"[^"]+"/);
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

test('hardware clock events and snapshots select the installed sheet during count-in and playing', async () => {
  await fixture(async ({ desk, publish }) => {
    await publish({ type: 'desk', view: ready });
    const session = desk.performance();
    const requests: unknown[] = [];
    const follower = createChartFollower({ fetch: async (_url, init) => {
      const input = JSON.parse(String(init?.body));
      requests.push(input);
      return Response.json({ ok: true, selectedRange: input.range, url: 'https://docs.google.com/' });
    } });
    session.onEvent(follower.receive);
    for (const [seq, phase, bar] of [[1, 'count-in', null], [2, 'playing', 2]] as const) {
      await publish({ type: 'event', attempt: 'attempt', event: { v: 1, type: 'beat', runId: 'run', seq, state: { ...state, seq, phase, bar } } });
    }
    assert.deepEqual(requests, ['B:B', 'D:D'].map(range => ({
      spreadsheetId: song.chart.spreadsheetId, sheetId: song.chart.sheetId, range, activate: false,
    })));
    assert.equal(session.snapshot().chart?.sheetId, song.chart.sheetId);
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
  globalThis.fetch = async () => Response.json({ sessionId: 'session', inputOwnerToken: 'original-input-owner', view: { ...ready, audio: { ...ready.audio, performance: { ...performance, state: { ...state, bpm: 'fast' } } } } });
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
    if (String(input) === '/api/session') return Response.json({ sessionId: 'session', inputOwnerToken: 'original-input-owner', view: playing });
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
      const tuningStart = new AbortController();
      const context = vm.createContext({ root, audio: session, tunerSession: session, tunerPort: null, tunerPanel: null,
        document: { createElement: () => new Node() }, isRunning: () => false, starting: false, outputCapture: 'idle',
        connected: reason !== 'disconnected', status: { kind: reason === 'fault' ? 'fault' : 'off' },
        createTunerDial: () => ({ element: new Node(), update() {}, dispose() { dialDisposals++; } }),
        transportGeneration: 0, phoneMotionAbort: undefined, tuningStart, releasePresses() {}, chartFollower: null, renderHardwareUnavailable() {} });
      vm.runInContext(`${panelSource}\n${wrapper}\n
        tunerPort = sharedTuner(audio);
        tunerPanel = mountTuner(root, { connect: async () => tunerPort });
        tunerPanel.setSession(tunerPort);
        function disconnect() { ${unavailable} }
      `, context);
      const closing = pendingClose ? vm.runInContext('tunerPanel.close()', context) : null;
      if (pendingClose) await new Promise(resolve => setImmediate(resolve));
      vm.runInContext('disconnect()', context);
      assert.equal(tuningStart.signal.aborted, true);
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

for (const outcome of ['applied', 'rejected', 'unknown']) test(`same-engine reauthentication ${outcome === 'applied' ? 'releases used roles before invalidating their client' : `retains ${outcome} ownership and discards candidate`}`, async () => {
  const previous = globalThis.fetch;
  const routing = { bindingGeneration: 1, sessionHighWatermark: 0, panicMask: 0, producers: [] };
  const native = { ...performance, state: { ...state, inputRouting: routing } };
  const view = { ...ready, audio: { ...ready.audio, performance: native } };
  const calls: { sessionId: string; command: string; args: { kind: string } }[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let sessions = 0;
  let release!: () => void;
  const acknowledgement = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (input, init) => {
    if (String(input) === '/api/session') return Response.json({ sessionId: `client-${++sessions}`, inputOwnerToken: `owner-${sessions}`, view });
    if (String(input) === '/api/input-intent-status') return Response.json({ kind: 'unknown' });
    if (String(input) === '/api/events') return new Response(new ReadableStream({ start(controller) { streams.push(controller); } }));
    assert.equal(String(input), '/api/command');
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    if (body.command === 'inputRevoke') {
      await acknowledgement;
      if (outcome !== 'applied' && body.args.kind === 'pointer') return Response.json({ outcome, error: 'Revoke unconfirmed' });
    }
    const revision = String(calls.length + 1);
    const receipt = body.command === 'inputAttach' ? { target: body.target, producer: calls.length % 32, session: calls.length, kind: body.args.kind, bindingGeneration: body.args.bindingGeneration, admissionRevision: revision } : undefined;
    return Response.json({ outcome: 'applied', ...native, revision, ...(receipt ? { receipt, state: { ...state, inputRouting: { ...routing, sessionHighWatermark: receipt.session,
      producers: [{ producer: receipt.producer, session: receipt.session, kind: receipt.kind, releasedMask: 0, heldMask: 0, lastSequence: 0 }] } } } : {}) });
  };
  const old = await RemoteDesk.connect('secret');
  const candidate = await RemoteDesk.connect('secret');
  void old.listen(); await tick();
  const context = vm.createContext({ remoteDesk: old, audio: old.performance() });
  const keyboard = createMusicalInputProducer({ kind: 'keyboard', endpoint: async () => context.remoteDesk.performance(), releasedMask: 0 });
  const pointer = createMusicalInputProducer({ kind: 'pointer', endpoint: async () => context.remoteDesk.performance(), releasedMask: 223 });
  Object.assign(context, { keyboardProducer: keyboard, pointerProducer: pointer });
  const handoff = source.slice(source.indexOf('async function replaceHardwareDesk('), source.indexOf('function renderHardwareUnavailable('));
  vm.runInContext(handoff, context);
  try {
    for (const producer of [keyboard, pointer]) { await producer.event(0, 1); await producer.event(0, 0); }
    const original = old.performance();
    const replacement = context.replaceHardwareDesk(candidate);
    void replacement.catch(() => {});
    await tick();
    const during = calls.length;
    await keyboard.event(0, 1); await pointer.event(0, 1);
    assert.equal(calls.length, during, 'no events enter either client during source cleanup');
    assert.equal(old.performance(), original, 'old endpoint remains valid while its exact revokes await acknowledgement');
    assert.equal(calls.filter(call => call.command === 'inputRevoke').length, 2);
    assert(calls.every(call => call.sessionId === 'client-1'));
    release();
    if (outcome !== 'applied') {
      await assert.rejects(replacement, /Revoke unconfirmed/);
      assert.equal(context.remoteDesk, old);
      assert.equal(candidate.connection.kind, 'disconnected');
      await assert.rejects(pointer.event(0, 1), outcome === 'unknown' ? /stale|unavailable/ : /Revoke unconfirmed/);
      assert(calls.every(call => call.sessionId === 'client-1'));
    } else {
      await replacement;
      assert.equal(context.remoteDesk, candidate);
      assert.equal(context.audio, undefined, 'UI cannot supply the invalidated old endpoint while the candidate connects');
      await assert.rejects(original.inputRevoke({ kind: 'pointer' }), /stale/);
      void candidate.listen(); await tick();
      assert.equal(original.inputScope, candidate.performance().inputScope);
      for (const producer of [keyboard, pointer]) { await producer.event(0, 1); await producer.event(0, 0); }
      assert.deepEqual(calls.slice(during).map(call => [call.sessionId, call.command]),
        ['inputAttach', 'inputEvent', 'inputEvent', 'inputAttach', 'inputEvent', 'inputEvent'].map(command => ['client-2', command]));
    }
  } finally {
    release(); await old.dispose(); await candidate.dispose();
    for (const stream of streams) stream.close();
    globalThis.fetch = previous;
  }
});

test('invalidating a used source before same-engine handoff remains fail-closed', async () => {
  const native = { state: { inputRouting: { bindingGeneration: 1, sessionHighWatermark: 0, panicMask: 0, producers: [] } } };
  const calls: string[] = [];
  const desk = { async command(_endpoint: unknown, _target: unknown, command: string) { calls.push(command); return native.state; }, async inputIntentStatus() { return { kind: 'unknown' }; } };
  const target = Schema.decodeUnknownSync(NativeTargetSchema)({ attempt: 'same-attempt', hostEpoch: 'same-engine' });
  const first = new RemoteSession(desk as never, target, native as never, chartMetadata(song.chart));
  const second = new RemoteSession(desk as never, target, native as never, chartMetadata(song.chart));
  let current = first;
  const producer = createMusicalInputProducer({ kind: 'pointer', endpoint: async () => current, releasedMask: 223 });
  await producer.event(0, 1); await producer.event(0, 0);
  first.invalidate(); current = second;
  assert.equal(first.inputScope, second.inputScope);
  await assert.rejects(producer.event(0, 1), /stale/);
  await assert.rejects(producer.event(0, 0), /stale/);
  assert.deepEqual(calls, ['inputAttach', 'inputEvent', 'inputEvent']);
});

for (const scenario of ['sse', 'blur', 'lost-attach-reply', 'pending-attach', 'pending-sse', 'pending-native-unknown', 'native-unknown', 'unknown-revoke', 'hung-revoke']) test(`original-owner intent readback through actual gateway recovers only confirmed ${scenario}`, async () => {
  const { createGateway } = await import('../../../lib/remote-performance/gateway.js');
  const { DeskViewSchema } = await import('../../../lib/remote-performance/session-schema.js');
  const { InputAttachSchema, InputRevokeSchema, InputEventSchema } = await import('../../../lib/performance/input-bindings.js');
  const { once } = await import('node:events');
  let view = Schema.decodeUnknownSync(DeskViewSchema)({ ...ready, audio: { ...ready.audio, performance: { ...performance, state: { ...state,
    inputRouting: { bindingGeneration: 1, sessionHighWatermark: 0, panicMask: 0, producers: [] } } } } });
  const listeners = new Set<(value: import('../../../lib/remote-performance/session-schema.js').DeskPublication) => void>();
  const commands: { command: string; args: object }[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const decode = Schema.decodeUnknownSync(Schema.Union([
    Schema.Struct({ command: Schema.Literal('inputAttach'), args: InputAttachSchema }),
    Schema.Struct({ command: Schema.Literal('inputEvent'), args: InputEventSchema }),
    Schema.Struct({ command: Schema.Literal('inputRevoke'), args: InputRevokeSchema }),
  ]), { onExcessProperty: 'error' });
  const controller: import('../../../lib/remote-performance/session-schema.js').DeskController = {
    snapshot: () => view, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setAudio: () => { throw new Error('Recovery cannot change audio lifecycle automatically'); }, close: async () => {},
    async command(_target, input) {
      const command = decode(input); commands.push(command);
      if (command.command === 'inputAttach' && scenario.startsWith('pending-')) await blocked;
      if (command.command === 'inputRevoke' && scenario === 'hung-revoke') await blocked;
      if (command.command === 'inputRevoke' && scenario === 'unknown-revoke') return { outcome: 'unknown' };
      if (view.audio.kind !== 'ready' || !view.audio.performance.state.inputRouting) throw new Error('Fixture lost native engine');
      const routing = view.audio.performance.state.inputRouting;
      const producers = command.command === 'inputAttach' ? [...routing.producers, { producer: command.args.producer, session: command.args.session,
        kind: command.args.kind, releasedMask: command.args.releasedMask, heldMask: command.args.heldMask, lastSequence: 0 }]
        : command.command === 'inputRevoke' ? routing.producers.filter(value => value.producer !== command.args.producer || value.session !== command.args.session) : routing.producers;
      view = Schema.decodeUnknownSync(DeskViewSchema)({ ...view, revision: String(BigInt(view.revision) + 1n), audio: { ...view.audio,
        performance: { ...view.audio.performance, revision: String(BigInt(view.audio.performance.revision) + 1n), state: { ...view.audio.performance.state,
          inputRouting: { ...routing, producers, sessionHighWatermark: Math.max(routing.sessionHighWatermark, command.command === 'inputAttach' ? command.args.session : 0) } } } } });
      for (const listener of listeners) listener({ type: 'desk', view });
      if (command.command === 'inputAttach' && ['native-unknown', 'pending-native-unknown'].includes(scenario)) return { outcome: 'unknown' };
      if (view.audio.kind !== 'ready') throw new Error('Fixture lost native engine');
      return { outcome: 'applied', ...view.audio.performance };
    },
  };
  const origin = 'http://127.0.0.1:9999', token = 'a'.repeat(32);
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, controller);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const previous = globalThis.fetch;
  let lost = false;
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const headers = new Headers(init?.headers); headers.set('origin', origin);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ path, body });
    const response = await previous(new URL(path, `http://127.0.0.1:${address.port}`), { ...init, headers });
    if (!lost && scenario === 'lost-attach-reply' && body.command === 'inputAttach') {
      lost = true; await response.json(); throw new Error('HTTP reply lost after definite gateway admission');
    }
    return response;
  };
  const old = await RemoteDesk.connect(token);
  void old.listen();
  for (let count = 0; count < 100 && old.connection.kind !== 'connected'; count++) await tick();
  assert(['connected'].includes(old.connection.kind));
  const context = vm.createContext({ remoteDesk: old, audio: old.performance() });
  const keyboard = createMusicalInputProducer({ kind: 'keyboard', endpoint: async () => context.remoteDesk.performance(), releasedMask: 0 });
  const pointer = createMusicalInputProducer({ kind: 'pointer', endpoint: async () => context.remoteDesk.performance(), releasedMask: 223 });
  Object.assign(context, { keyboardProducer: keyboard, pointerProducer: pointer });
  vm.runInContext(source.slice(source.indexOf('async function replaceHardwareDesk('), source.indexOf('function renderHardwareUnavailable(')), context);
  let candidate: RemoteDesk | undefined;
  try {
    const press = pointer.event(0, 0); void press.catch(() => {});
    if (scenario.startsWith('pending-')) {
      while (!commands.some(command => command.command === 'inputAttach')) await tick();
      if (scenario === 'pending-sse') {
        for (const listener of listeners) listener({ type: 'gap' });
        for (let count = 0; count < 100 && old.connection.kind !== 'disconnected'; count++) await tick();
      }
      candidate = await RemoteDesk.connect(token);
      const replacement = context.replaceHardwareDesk(candidate); void replacement.catch(() => {});
      await tick();
      assert.equal(context.remoteDesk, old);
      assert.equal(candidate.connection.kind, 'connecting');
      release();
      if (scenario === 'pending-native-unknown') {
        await assert.rejects(press, /unknown/);
        await assert.rejects(replacement, /cleanup is unconfirmed/);
        assert.equal(context.remoteDesk, old);
        assert.equal(candidate.connection.kind, 'disconnected');
        return;
      }
      if (scenario === 'pending-sse') await assert.rejects(press, /stale/);
      else await press;
      await replacement;
    } else {
      if (scenario === 'lost-attach-reply' || scenario === 'native-unknown') await assert.rejects(press, /unknown/);
      else await press;
      if (scenario !== 'lost-attach-reply' && scenario !== 'native-unknown') {
        await keyboard.event(0, 0);
        if (scenario === 'blur') {
          await keyboard.reset();
          assert.equal(commands.filter(command => command.command === 'inputRevoke').length, 1, 'blur retires keyboard without revoking pointer');
        }
        for (const listener of listeners) listener({ type: 'gap' });
      }
      for (let count = 0; count < 100 && old.connection.kind !== 'disconnected'; count++) await tick();
      assert.equal(old.connection.kind, 'disconnected');
      for (let count = 0; count < 100 && !commands.some(command => command.command === 'inputRevoke'); count++) await tick();
      await tick();
      candidate = await RemoteDesk.connect(token);
      const replacement = context.replaceHardwareDesk(candidate); void replacement.catch(() => {});
      if (scenario === 'hung-revoke') {
        await tick();
        assert.equal(context.remoteDesk, old);
        assert.equal(candidate.connection.kind, 'connecting', 'a pending exact cleanup acknowledgement cannot admit the candidate');
        release();
      }
      if (['native-unknown', 'unknown-revoke'].includes(scenario)) {
        await assert.rejects(replacement, /cleanup is unconfirmed|cleanup unconfirmed|Reconnect remains blocked/);
        assert.equal(context.remoteDesk, old);
        assert.equal(candidate.connection.kind, 'disconnected');
        assert(requests.some(request => request.path === '/api/input-intent-status'));
        return;
      }
      await replacement;
    }
    assert.equal(context.remoteDesk, candidate);
    void candidate!.listen();
    for (let count = 0; count < 100 && candidate!.connection.kind !== 'connected'; count++) await tick();
    assert.equal(candidate!.performance().inputScope, JSON.stringify(['attempt', 'host']));
    const before = commands.filter(command => command.command === 'inputAttach').length;
    await pointer.event(0, 0); await keyboard.event(0, 0);
    assert.equal(commands.filter(command => command.command === 'inputAttach').length, before + 2);
    assert(commands.every(command => !('intentId' in command.args)), 'intent metadata cannot enter native ABI arguments');
    const statuses = requests.filter(request => request.path === '/api/input-intent-status');
    assert(statuses.every(request => typeof request.body.inputOwnerToken === 'string' && typeof request.body.intentId === 'string'));
  } finally {
    release(); await old.dispose(); await candidate?.dispose();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    globalThis.fetch = previous;
  }
});

test('readback cannot replace a known receipt, accept stale proof or revalidate an invalid endpoint', async () => {
  await fixture(async ({ desk, publish, calls, setInputStatus }) => {
    await publish({ type: 'desk', view: ready });
    const session = desk.performance();
    await session.inputAttach({ kind: 'pointer', bindingGeneration: 1, releasedMask: 223, heldMask: 0 });
    const receipt = { target: { attempt: 'attempt', hostEpoch: 'host' }, producer: 0, session: 1, kind: 'pointer', bindingGeneration: 1, admissionRevision: '2' };
    await publish({ type: 'gap' });
    for (const status of [
      { kind: 'admitted', receipt: { ...receipt, producer: 1, session: 2 } },
      { kind: 'retired', proof: { kind: 'exact-revoke-applied', receipt: { ...receipt, producer: 1, session: 2 }, revocationRevision: '3' } },
      { kind: 'retired', proof: { kind: 'exact-revoke-applied', receipt, revocationRevision: '2' } },
      { kind: 'retired', proof: { kind: 'exact-revoke-applied', receipt: { ...receipt, target: { ...receipt.target, hostEpoch: 'other-host' } }, revocationRevision: '3' } },
      { kind: 'retired', proof: { kind: 'exact-revoke-applied', receipt: { ...receipt, bindingGeneration: 2 }, revocationRevision: '3' } },
      { kind: 'retired', proof: { kind: 'exact-revoke-applied', receipt: { ...receipt, admissionRevision: '1' }, revocationRevision: '3' } },
      { kind: 'retired', proof: { kind: 'rejected-before-admission', target: receipt.target, kindOfProducer: 'pointer', bindingGeneration: 1 } },
    ]) {
      setInputStatus(status);
      await assert.rejects(session.inputRevoke({ kind: 'pointer' }), /cleanup is unconfirmed/);
    }
    setInputStatus({ kind: 'retired', proof: { kind: 'exact-revoke-applied', receipt, revocationRevision: '3' } });
    await session.inputRevoke({ kind: 'pointer' });
    await assert.rejects(session.start(), /stale/);
    assert.equal(calls.length, 1, 'readback cannot dispatch commands or revoke via any successor');
  });
});

test('actual engine retirement uses its Desk revision domain and never revalidates stale input', async () => {
  await fixture(async ({ desk, publish, setInputStatus, calls }) => {
    await publish({ type: 'desk', view: ready });
    const session = desk.performance();
    await session.inputAttach({ kind: 'pointer', bindingGeneration: 1, releasedMask: 223, heldMask: 0 });
    await publish({ type: 'gap' });
    const proof = { kind: 'old-engine-ended', target: { attempt: 'attempt', hostEpoch: 'host' }, serverEpoch: 'server', retirementDeskRevision: '1', kindOfProducer: 'pointer', bindingGeneration: 1 };
    setInputStatus({ kind: 'retired', proof: { ...proof, serverEpoch: 'other-server' } });
    await assert.rejects(session.inputRevoke({ kind: 'pointer' }), /cleanup is unconfirmed/);
    setInputStatus({ kind: 'retired', proof });
    await session.inputRevoke({ kind: 'pointer' });
    await assert.rejects(session.start(), /stale/);
    assert.equal(calls.length, 1);
  });
});
