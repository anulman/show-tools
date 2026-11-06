import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadSong } from '../../../songs/index.js';
import { RemoteSession } from '../remote-session.js';

const song = await loadSong('dance-yrself-clean');
const state = { phase: 'idle', bar: null, beat: null, countInRemaining: 0, bpm: 120, startBar: 1, endBar: 4, loop: true,
  automatic: false, click: false, selectedChannel: 'L1', runId: 'run', seq: 0,
  channels: ['L1', 'L2', 'R1', 'R2'].map(id => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })),
  looping: [], recording: null, microphone: false, error: null };
const bootstrap = { sessionId: 'session', song, state, hostEpoch: 'host', revision: '1' };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('remote commands are explicit, authenticated, and detach does not stop the host', async () => {
  const previous = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url === '/api/session') return Response.json(bootstrap);
    if (url === '/api/events') return new Response(new ReadableStream({ start() {} }));
    return Response.json({ outcome: 'applied', hostEpoch: 'host', revision: '2', state });
  };
  try {
    const session = await RemoteSession.create('secret');
    await assert.rejects(session.start(), /disconnected/);
    void session.listen(); await tick();
    await session.start({ bpm: 120 }); await session.control({ id: 'R1' }); await session.dispose();
    const commands = calls.filter(call => call.url === '/api/command').map(call => JSON.parse(String(call.init?.body)));
    assert.deepEqual(commands.map(command => [command.sequence, command.command]), [[1, 'start'], [2, 'control']]);
    assert.ok(calls.every(call => new Headers(call.init?.headers).get('Authorization') === 'Bearer secret'));
    assert.equal(new Headers(calls.find(call => call.url === '/api/events')?.init?.headers).get('X-Session-Id'), 'session');
  } finally { globalThis.fetch = previous; }
});

test('gap disconnects without publishing an undefined state or replaying actions', async () => {
  const previous = globalThis.fetch;
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let commands = 0;
  globalThis.fetch = async input => {
    if (String(input) === '/api/session') return Response.json(bootstrap);
    if (String(input) === '/api/events') return new Response(new ReadableStream({ start(value) { stream = value; } }));
    commands++; return Response.json({ outcome: 'applied', hostEpoch: 'host', revision: '2', state });
  };
  try {
    const session = await RemoteSession.create('secret');
    const observed: unknown[] = []; session.subscribe(value => observed.push(value));
    void session.listen(); await tick();
    stream?.enqueue(new TextEncoder().encode('data: {"type":"gap"}\n\n')); await tick();
    await assert.rejects(session.control({ id: 'R1' }), /disconnected/);
    assert.equal(commands, 0); assert.ok(observed.every(Boolean)); assert.match(session.snapshot().error || '', /lost/);
    await session.dispose();
  } finally { globalThis.fetch = previous; }
});

test('a late applied result cannot replace a newer host publication', async () => {
  const previous = globalThis.fetch;
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let reply: ((response: Response) => void) | undefined;
  globalThis.fetch = async input => {
    if (String(input) === '/api/session') return Response.json(bootstrap);
    if (String(input) === '/api/events') return new Response(new ReadableStream({ start(value) { stream = value; } }));
    return new Promise(resolve => { reply = resolve; });
  };
  try {
    const session = await RemoteSession.create('secret'); void session.listen(); await tick();
    const action = session.control({ id: 'R1' });
    stream?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'state', hostEpoch: 'host', revision: '3', state: { ...state, bpm: 150 } })}\n\n`));
    await tick(); reply?.(Response.json({ outcome: 'applied', hostEpoch: 'host', revision: '2', state: { ...state, bpm: 130 } }));
    await action; assert.equal(session.snapshot().bpm, 150); await session.dispose();
  } finally { globalThis.fetch = previous; }
});

test('malformed observations and command results fail closed', async () => {
  const previous = globalThis.fetch;
  let response: unknown = { ...bootstrap, state: { ...state, bpm: 'fast' } };
  globalThis.fetch = async input => {
    if (String(input) === '/api/session') return Response.json(response);
    if (String(input) === '/api/events') return new Response(new ReadableStream({ start() {} }));
    return Response.json({ outcome: 'applied', hostEpoch: 'host', revision: '2', state: { ...state, channels: [] } });
  };
  try {
    await assert.rejects(RemoteSession.create('secret'));
    response = bootstrap;
    const session = await RemoteSession.create('secret'); void session.listen(); await tick();
    await assert.rejects(session.control({ id: 'R1' }), /Invalid command result/);
    await assert.rejects(session.control({ id: 'R1' }), /disconnected/);
    await session.dispose();
  } finally { globalThis.fetch = previous; }
});

test('a closed stream or changed host prevents further commands', async () => {
  const previous = globalThis.fetch;
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let commands = 0;
  globalThis.fetch = async input => {
    if (String(input) === '/api/session') return Response.json(bootstrap);
    if (String(input) === '/api/events') return new Response(new ReadableStream({ start(value) { stream = value; } }));
    commands++; return Response.json({ outcome: 'applied', hostEpoch: 'other-host', revision: '2', state });
  };
  try {
    const session = await RemoteSession.create('secret'); void session.listen(); await tick();
    await assert.rejects(session.control({ id: 'R1' }), /host changed/i);
    await assert.rejects(session.control({ id: 'R1' }), /disconnected/);
    assert.equal(commands, 1); await session.dispose();
    const another = await RemoteSession.create('secret'); void another.listen(); await tick();
    stream?.close(); await tick();
    await assert.rejects(another.control({ id: 'R1' }), /disconnected/);
    await another.dispose();
  } finally { globalThis.fetch = previous; }
});

test('editing a remote effect preserves every other host profile', async () => {
  const previous = globalThis.fetch;
  const voices = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: profile === 0 ? [{ kind: 'slapback', delayMs: 120, feedback: 0, wet: .5 }] : [], prepared: true, revision: 1, activity: 'standby', rotationEligible: false, rotationRemainingBeats: 0 }));
  const hostState = { ...state, voiceEffects: voices };
  let sent = '';
  globalThis.fetch = async (input, init) => {
    if (String(input) === '/api/session') return Response.json({ ...bootstrap, state: hostState });
    if (String(input) === '/api/events') return new Response(new ReadableStream({ start() {} }));
    sent = String(init?.body);
    return Response.json({ outcome: 'applied', hostEpoch: 'host', revision: '2', state: hostState });
  };
  try {
    const session = await RemoteSession.create('secret'); void session.listen(); await tick();
    const effects = [{ kind: 'chorus' as const, rateHz: 1, depthMs: 2, baseDelayMs: 20, wet: .3 }];
    await session.configureVoiceProfile(1, effects);
    const command = JSON.parse(sent);
    assert.deepEqual(command.args, { profile: 1, effects, expectedRevision: 1 });
    await session.dispose();
    globalThis.fetch = async input => String(input) === '/api/session'
      ? Response.json({ ...bootstrap, state: { ...hostState, voiceEffects: voices.map(voice => ({ ...voice, prepared: voice.profile !== 0 })) } })
      : new Response(new ReadableStream({ start() {} }));
    const unprepared = await RemoteSession.create('secret'); void unprepared.listen(); await tick();
    assert.throws(() => unprepared.configureVoiceProfile(1, effects), /not ready/);
    await unprepared.dispose();
  } finally { globalThis.fetch = previous; }
});
