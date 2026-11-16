import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeInitialProfiles, isPriorityCommand, encodeCommand } from '../commands.js';
import { decodeNativeState } from '../../performance/native-observation.js';
import { PF } from '../../performance/wasm-abi.js';
import { Schema } from 'effect';
import { InputAttachSchema, InputEventSchema, InputRevokeSchema, type InputRoutingState } from '../../performance/input-bindings.js';
import { decodeClientInputCommand } from '../commands.js';
import { InputProducerRegistry, createGateway } from '../gateway.js';
import { once } from 'node:events';
import { DeskViewSchema, NativeTargetSchema, type DeskController } from '../session-schema.js';
import song from '../../../songs/dance-yrself-clean.js';
import { lightFixture } from './light-fixture.js';
import { tunerFixture } from './tuner-fixture.js';

test('encodes all profile counts, revisions, and effects in host wire order', () => {
	const configurations = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: profile === 2 ? [{ kind: 'slapback', delayMs: 100, feedback: .2, wet: .3 }] : [] }));
	const bytes = encodeInitialProfiles(configurations);
	assert.equal(bytes.readUInt16LE(0), 10);
	assert.equal(bytes.readUInt32LE(2), 1);
	assert.equal(bytes.readUInt32LE(6 + 2 * 4), 1);
	assert.equal(bytes.readUInt32LE(30 + 2 * 4), 1);
	assert.equal(bytes.readUInt32LE(54), PF.EFFECT_SLAPBACK);
	assert.equal(bytes.readDoubleLE(62), 100);
	assert.throws(() => encodeInitialProfiles(configurations.slice(1)), /six/);
	assert.throws(() => encodeInitialProfiles(configurations.map(config => config.profile === 2 ? { ...config, effects: [{ kind: 'slapback', delayMs: 1, feedback: 0, wet: 0 }] } : config)), /effect/);
});

test('reserves priority only for validated Stop and Panic commands', () => {
	assert.equal(isPriorityCommand({ command: 'stop', args: {} }), true);
	assert.equal(isPriorityCommand({ command: 'control', args: { control: { id: 'mushroom' }, commandId: 'panic-1' } }), true);
	for (const input of [
		{ command: 'control', args: { control: { id: 'mushroom' }, commandId: 1 } },
		{ command: 'control', args: { control: { id: 'R1' } } },
		{ command: 'control', args: { control: { id: 'knob', value: 1 } } },
		{ command: 'control', args: { control: 'mushroom' } },
		{ command: 'stop' },
	]) assert.equal(isPriorityCommand(input), false);
});


test('cue button uses native control 7 and admits only physical held/released values', () => {
  for (const value of [0, 1]) {
    const bytes = encodeCommand({ command: 'control', args: { control: { id: 'cueButton', value } } }, decodeNativeState(Array(PF.FIELDS).fill(0), Array(PF.CHANNELS * PF.CHANNEL_FIELDS).fill(0), 'test', String));
    assert.equal(bytes.readUInt16LE(), 3);
    assert.equal(bytes.readDoubleLE(2), 7);
    assert.equal(bytes.readDoubleLE(10), value);
  }
  for (const value of [-1, .5, 2, NaN, Infinity, true, '1', undefined]) {
    assert.throws(() => encodeCommand({ command: 'control', args: { control: { id: 'cueButton', value } } }, decodeNativeState(Array(PF.FIELDS).fill(0), Array(PF.CHANNELS * PF.CHANNEL_FIELDS).fill(0), 'test', String)));
  }
});

test('jiggle configuration encodes bounded ordered raw-count thresholds', () => {
	const state = decodeNativeState(Array(PF.FIELDS).fill(0), Array(PF.CHANNELS * PF.CHANNEL_FIELDS).fill(0), 'test', String);
	const bytes = encodeCommand({ command: 'configureJiggle', args: { minimumTravel: 4, minimumReversal: 2 } }, state);
	assert.equal(bytes.readUInt16LE(), 12);
	assert.equal(bytes.readDoubleLE(2), 4);
	assert.equal(bytes.readDoubleLE(10), 2);
	for (const [minimumTravel, minimumReversal] of [[0, 1], [4, 0], [4, 5], [4.5, 2], [32768, 2], [Infinity, 2]])
		assert.throws(() => encodeCommand({ command: 'configureJiggle', args: { minimumTravel, minimumReversal } }, state));
});

test('tuner commands carry native revision and validate control inputs before encoding', () => {
  const state = decodeNativeState(Array(PF.FIELDS).fill(0), Array(PF.CHANNELS * PF.CHANNEL_FIELDS).fill(0), 'run', String);
  const encoded = encodeCommand({ command: 'tuner', args: { kind: 'configure', root: 60, scale: 'natural-minor', expectedRevision: 0xffffffff } }, state);
  assert.equal(encoded.readUInt16LE(), 13);
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => encoded.readDoubleLE(2 + index * 8)), [0, 0xffffffff, 60, 1]);
  for (const args of [
    { kind: 'cue', expectedRevision: -1 },
    { kind: 'listen', expectedRevision: 0, enabled: 1 },
    { kind: 'configure', root: 116, scale: 'major', expectedRevision: 0 },
    { kind: 'confirm', expectedRevision: 0x100000000 },
  ]) assert.throws(() => encodeCommand({ command: 'tuner', args }, state));
});


test('individual pad releases preserve their edge through the native transport', () => {
  const state = decodeNativeState(Array(PF.FIELDS).fill(0), Array(PF.CHANNELS * PF.CHANNEL_FIELDS).fill(0), 'test', String);
  for (const [index, id] of ['L1', 'L2', 'R1', 'R2'].entries()) {
    const bytes = encodeCommand({ command: 'control', args: { control: { id, edge: 'release' } } }, state);
    assert.equal(bytes.readDoubleLE(2), index + 8);
  }
});


test('external manual hits use the existing native control route with bounded slot identity', () => {
  const state = decodeNativeState(Array(PF.FIELDS).fill(0), Array(PF.CHANNELS * PF.CHANNEL_FIELDS).fill(0), 'test', String);
  const bytes = encodeCommand({ command: 'control', args: { control: { id: 'external', slot: 3 } } }, state);
  assert.equal(bytes.readUInt16LE(), 3); assert.equal(bytes.readDoubleLE(2), 19);
  assert.throws(() => encodeCommand({ command: 'control', args: { control: { id: 'external', slot: 64 } } }, state));
});

test('identified inputs preserve safe integer identities and native host operation slots', () => {
  const state = decodeNativeState(Array(PF.FIELDS).fill(0), Array(PF.CHANNELS * PF.CHANNEL_FIELDS).fill(0), 'test', String);
  const attach = { producer: 31, session: Number.MAX_SAFE_INTEGER, bindingGeneration: 25, kind: 'physical', releasedMask: 3, heldMask: 4 };
  const bytes = encodeCommand({ command: 'inputAttach', args: attach }, state);
  assert.equal(bytes.readUInt16LE(), 14);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => bytes.readDoubleLE(2 + i * 8)), [31, Number.MAX_SAFE_INTEGER, 25, 0, 3, 4]);
  const event = encodeCommand({ command: 'inputEvent', args: { producer: 31, session: 5000000, bindingGeneration: 25, sequence: 100, input: 0, value: 1 } }, state);
  assert.equal(event.readUInt16LE(), 16);
  assert.equal(event.readDoubleLE(26), 100);
  assert.equal(encodeCommand({ command: 'inputRevoke', args: { producer: 31, session: 5000000 } }, state).readUInt16LE(), 17);
  for (const args of [{ ...attach, producer: 32 }, { ...attach, releasedMask: 7 }, { ...attach, heldMask: 64 }, { ...attach, session: Number.MAX_SAFE_INTEGER + 1 }])
    assert.throws(() => encodeCommand({ command: 'inputAttach', args }, state));
  assert.throws(() => decodeClientInputCommand({ command: 'inputAttach', args: { kind: 'physical', bindingGeneration: 1, releasedMask: 1, heldMask: 0, producer: 0, session: 1 } }));
});

function inputHost(initialSessions = 0, revokeAcknowledgement: Promise<void> = Promise.resolve()) {
  const target = Schema.decodeUnknownSync(NativeTargetSchema)({ attempt: 'input-attempt', hostEpoch: 'input-native' });
  const state = decodeNativeState(Array(PF.FIELDS).fill(0), Array(PF.CHANNELS * PF.CHANNEL_FIELDS).fill(0), 'input-test', String);
  let view = Schema.decodeUnknownSync(DeskViewSchema)({ serverEpoch: 'input-server', revision: '1', song, audio: {
    kind: 'ready', attempt: target.attempt, performance: { hostEpoch: target.hostEpoch, revision: '1', lights: lightFixture(), tuner: tunerFixture(),
      state: { ...state, inputRouting: { bindingGeneration: 7, sessionHighWatermark: initialSessions, panicMask: 2, producers: [] } } },
  } });
  const decode = Schema.decodeUnknownSync(Schema.Union([
    Schema.Struct({ command: Schema.Literal('inputAttach'), args: InputAttachSchema }),
    Schema.Struct({ command: Schema.Literal('inputEvent'), args: InputEventSchema }),
    Schema.Struct({ command: Schema.Literal('inputRevoke'), args: InputRevokeSchema }),
  ]), { onExcessProperty: 'error' });
  const calls: ReturnType<typeof decode>[] = [];
  let unknownAttach = false, unknownRevoke = false;
  function replaceRouting(inputRouting: InputRoutingState) {
    if (view.audio.kind !== 'ready') throw new Error('Test host unavailable');
    view = { ...view, audio: { ...view.audio, performance: { ...view.audio.performance,
      state: { ...view.audio.performance.state, inputRouting } } } };
  }
  const controller: DeskController = {
    snapshot: () => view, subscribe: () => () => {}, setAudio: () => ({ outcome: 'accepted', view }), close: async () => {},
    command: async (_target, input) => {
      const command = decode(input); calls.push(command);
      assert.equal(view.audio.kind, 'ready');
      if (view.audio.kind !== 'ready') throw new Error('Test host unavailable');
      const routing = view.audio.performance.state.inputRouting;
      assert(routing);
      if (command.command === 'inputAttach') {
        const a = command.args;
        replaceRouting({ ...routing, sessionHighWatermark: a.session,
          producers: [...routing.producers, { producer: a.producer, session: a.session, kind: a.kind, releasedMask: a.releasedMask, heldMask: a.heldMask, lastSequence: 0 }] });
        if (unknownAttach) return { outcome: 'unknown' };
      } else if (command.command === 'inputRevoke') {
        await revokeAcknowledgement;
        if (unknownRevoke) return { outcome: 'unknown' };
        const a = command.args;
        replaceRouting({ ...routing, producers: routing.producers.filter(value => value.producer !== a.producer || value.session !== a.session) });
      }
      return { outcome: 'applied', ...view.audio.performance };
    },
  };
  return { controller, target, calls, get view() { return view; }, replaceRouting, unknownAttach: () => { unknownAttach = true; }, unknownRevoke: () => { unknownRevoke = true; } };
}

const clientAttach = (kind = 'physical') => ({ command: 'inputAttach', args: { kind, bindingGeneration: 7, releasedMask: 3, heldMask: 0 } });
const clientEvent = (kind = 'physical', input = 0) => ({ command: 'inputEvent', args: { kind, bindingGeneration: 7, sequence: 1, input, value: 1 } });

test('manual revoke and disconnect share one in-flight request for the same lease', async () => {
  let acknowledge: () => void = () => {};
  const blocked = new Promise<void>(resolve => { acknowledge = resolve; });
  const host = inputHost(0, blocked), registry = new InputProducerRegistry(host.controller);
  const first = {}, second = {};
  await registry.command(first, host.target, clientAttach());
  await registry.command(second, host.target, clientAttach('keyboard'));
  const manual = registry.command(first, host.target, { command: 'inputRevoke', args: { kind: 'physical' } });
  await new Promise(resolve => setImmediate(resolve));
  const disconnected = registry.close(first);
  const unrelated = registry.command(second, host.target, { command: 'inputRevoke', args: { kind: 'keyboard' } });
  await new Promise(resolve => setImmediate(resolve));
  const revokes = host.calls.filter(value => value.command === 'inputRevoke').map(value => value.args);
  acknowledge();
  await Promise.all([manual, disconnected, unrelated]);
  assert.deepEqual(revokes, [{ producer: 0, session: 1 }, { producer: 1, session: 2 }]);
  assert.equal((await registry.command(second, host.target, clientAttach('keyboard'))).outcome, 'applied');
});

test('gateway assigns distinct producer leases and cannot release another client or role', async () => {
  const host = inputHost(40), registry = new InputProducerRegistry(host.controller);
  const laptop = {}, hardware = {};
  assert.equal((await registry.command(laptop, host.target, clientAttach('keyboard'))).outcome, 'applied');
  assert.equal((await registry.command(hardware, host.target, clientAttach())).outcome, 'applied');
  assert.equal((await registry.command(laptop, host.target, clientAttach('pointer'))).outcome, 'applied');
  assert.deepEqual(host.calls.filter(value => value.command === 'inputAttach').map(value => [value.args.producer, value.args.session]), [[0, 41], [1, 42], [2, 43]]);
  assert.equal((await registry.command(hardware, host.target, clientEvent('keyboard'))).outcome, 'rejected');
  assert.equal((await registry.command(hardware, host.target, { command: 'inputEvent', args: { ...clientEvent().args, producer: 0, session: 41 } })).outcome, 'rejected');
  assert.equal((await registry.command(hardware, host.target, clientEvent())).outcome, 'applied');
  await registry.close(hardware);
  assert.deepEqual(host.calls.filter(value => value.command === 'inputRevoke').map(value => value.args), [{ producer: 1, session: 42 }]);
  assert.equal((await registry.command(laptop, host.target, clientEvent('keyboard'))).outcome, 'applied');
  assert.equal((await registry.command(hardware, host.target, clientAttach())).outcome, 'rejected');
});

test('gateway uses native watermark after reconnect and quarantines unconfirmed cleanup', async () => {
  const host = inputHost(200), first = new InputProducerRegistry(host.controller), owner = {};
  await first.command(owner, host.target, clientAttach());
  await first.close(owner);
  const restarted = new InputProducerRegistry(host.controller);
  await restarted.command({}, host.target, clientAttach());
  assert.deepEqual(host.calls.filter(value => value.command === 'inputAttach').map(value => value.args.session), [201, 202]);
  const uncertain = {}, registry = new InputProducerRegistry(host.controller);
  host.unknownAttach(); host.unknownRevoke();
  assert.equal((await registry.command(uncertain, host.target, clientAttach())).outcome, 'unknown');
  await registry.close(uncertain);
  assert.equal((await registry.command({}, host.target, clientAttach())).outcome, 'unknown');
  const slots = host.calls.filter(value => value.command === 'inputAttach').map(value => value.args.producer);
  assert.deepEqual(slots, [0, 0, 1, 2]);
});

test('identified Panic priority requires current native binding and owned fresh producer', async () => {
  const host = inputHost(), registry = new InputProducerRegistry(host.controller), owner = {};
  await registry.command(owner, host.target, clientAttach());
  assert.equal(registry.priority(owner, host.target, clientEvent('physical', 1)), true);
  assert.equal(registry.priority(owner, host.target, clientEvent()), false);
  assert.equal(registry.priority({}, host.target, clientEvent('physical', 1)), false);
  assert.equal(registry.priority(owner, host.target, { command: 'inputEvent', args: { ...clientEvent('physical', 1).args, bindingGeneration: 6 } }), false);
  if (host.view.audio.kind !== 'ready') throw new Error('Test host unavailable');
  const routing = host.view.audio.performance.state.inputRouting;
  assert(routing);
  host.replaceRouting({ ...routing, panicMask: 0 });
  assert.equal(registry.priority(owner, host.target, clientEvent('physical', 1)), false);
});

test('producer capacity rejects admission without evicting an existing owner', async () => {
  const host = inputHost(), registry = new InputProducerRegistry(host.controller);
  const owners = Array.from({ length: 32 }, () => ({}));
  for (const owner of owners) assert.equal((await registry.command(owner, host.target, clientAttach())).outcome, 'applied');
  assert.equal((await registry.command({}, host.target, clientAttach())).outcome, 'rejected');
  assert.equal(host.calls.filter(value => value.command === 'inputAttach').length, 32);
  assert.equal((await registry.command(owners[0], host.target, clientEvent())).outcome, 'applied');
  await Promise.all([registry.close(owners[1]), registry.close(owners[1])]);
  assert.equal(host.calls.filter(value => value.command === 'inputRevoke').length, 1);
  assert.equal((await registry.command({}, host.target, clientAttach())).outcome, 'applied');
  const latest = host.calls.at(-1);
  assert(latest?.command === 'inputAttach');
  assert.equal(latest.args.producer, 1);
  assert.equal(latest.args.session, 33);
});

test('HTTP input ownership survives another authenticated client disconnecting', async () => {
  const host = inputHost(), token = '0123456789abcdef0123456789abcdef', origin = 'http://127.0.0.1:9999';
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, host.controller);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`, headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
  const session = Schema.decodeUnknownSync(Schema.Struct({ sessionId: Schema.NonEmptyString }));
  const first = session(await (await fetch(`${base}/api/session`, { headers })).json());
  const second = session(await (await fetch(`${base}/api/session`, { headers })).json());
  const a = new AbortController(), b = new AbortController();
  const send = async (sessionId: string, sequence: number, command: object) => {
    const response = await fetch(`${base}/api/command`, { method: 'POST', headers, body: JSON.stringify({ sessionId, sequence, target: host.target, ...command }) });
    assert.equal(response.status, 200);
    return Schema.decodeUnknownSync(Schema.Struct({ outcome: Schema.String }))(await response.json()).outcome;
  };
  try {
    assert.equal(await send(first.sessionId, 1, clientAttach('keyboard')), 'applied');
    assert.equal(await send(second.sessionId, 1, clientAttach()), 'applied');
    assert.equal(await send(second.sessionId, 2, { command: 'inputRevoke', args: { kind: 'physical', producer: 0, session: 1 } }), 'rejected');
    const firstStream = await fetch(`${base}/api/events`, { headers: { ...headers, 'x-session-id': first.sessionId }, signal: a.signal });
    const secondStream = await fetch(`${base}/api/events`, { headers: { ...headers, 'x-session-id': second.sessionId }, signal: b.signal });
    await firstStream.body?.getReader().read(); await secondStream.body?.getReader().read();
    b.abort();
    for (let attempt = 0; attempt < 200 && !host.calls.some(value => value.command === 'inputRevoke'); attempt++)
      await new Promise(resolve => setTimeout(resolve, 1));
    assert.deepEqual(host.calls.filter(value => value.command === 'inputRevoke').map(value => value.args), [{ producer: 1, session: 2 }]);
    assert.equal(await send(first.sessionId, 2, clientEvent('keyboard')), 'applied');
  } finally {
    a.abort(); b.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
