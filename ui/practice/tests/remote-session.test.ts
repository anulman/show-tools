import { tunerFixture } from '../../../lib/remote-performance/tests/tuner-fixture.js';
import { lightFixture } from '../../../lib/remote-performance/tests/light-fixture.js';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadSong } from '../../../songs/index.js';
import { RemoteDesk } from '../remote-session.js';

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
