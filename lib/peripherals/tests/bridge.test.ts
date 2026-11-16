import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { boundedLines, decodePeripheralBridgeConfig, decodePeripheralInputMap, peripheralHelperArgs, PeripheralRelay } from '../bridge.js';
import type { PhysicalInputEvent } from '../bridge.js';
import { PHYSICAL_SWITCH_IDS } from '../../performance/model.js';

const inputMap = decodePeripheralInputMap({
	sources: [{ kind: 'linux', id: 'keys', interfaceNumber: 2, eventTypes: [0, 1], keyCodes: [41, 42], relativeAxes: [] },
		{ kind: 'linux', id: 'motion', interfaceNumber: 3, eventTypes: [0, 2], keyCodes: [], relativeAxes: [1] }],
	switches: [{ controlId: 'blue', sourceId: 'keys', type: 1, code: 41 }, { controlId: 'yellow', sourceId: 'keys', type: 1, code: 42 }],
	axis: { sourceId: 'motion', type: 2, code: 1 }, leds: [], confirmWiring: false,
});

test('bounded motion ingress retains signed travel, reversals and button order', async () => {
	const sent: PhysicalInputEvent[] = [];
	let resume: () => void = () => {};
	const blocked = new Promise<void>(resolve => { resume = resolve; });
	const relay = new PeripheralRelay(1, async control => { sent.push(control); if (sent.length === 1) await blocked; }, error => { throw error; });
	relay.start();
	relay.input({ type: 'ready', version: 2, session: 1, switches: [{ controlId: 'blue', state: 'released' }] });
	relay.input({ type: 'button', controlId: 'blue', session: 1, sequence: 1, down: true });
	for (let sequence = 2; sequence <= 100; ++sequence) relay.input({ type: 'motion', session: 1, sequence, deltaY: 1 });
	relay.input({ type: 'motion', session: 1, sequence: 101, deltaY: -1 });
	relay.input({ type: 'motion', session: 1, sequence: 102, deltaY: -2 });
	relay.input({ type: 'button', controlId: 'blue', session: 1, sequence: 103, down: false });
	resume(); await new Promise(resolve => setImmediate(resolve));
	await relay.close();
	assert.deepEqual(sent, [{ sequence: 1, input: 0, value: 1 }, { sequence: 100, input: 6, value: 99 }, { sequence: 102, input: 6, value: -3 }, { sequence: 103, input: 0, value: 0 }]);
});

test('stale, mismatched and unbounded input never becomes a musical control', async () => {
	const relay = new PeripheralRelay(1, async () => {}, () => {});
	assert.throws(() => relay.input({ type: 'button', controlId: 'blue', session: 1, sequence: 1, down: true }), /sequence/);
	relay.input({ type: 'ready', version: 2, session: 1, switches: [{ controlId: 'blue', state: 'unknown' }] });
	assert.throws(() => relay.input({ type: 'ready', version: 2, session: 1, switches: [{ controlId: 'blue', state: 'released' }] }), /Duplicate/);
	assert.throws(() => relay.input({ type: 'motion', session: 2, sequence: 1, deltaY: 1 }), /session/);
	relay.input({ type: 'motion', session: 1, sequence: 1, deltaY: 0 });
	assert.throws(() => relay.input({ type: 'motion', session: 1, sequence: 1, deltaY: 1 }), /stale/);
	assert.throws(() => relay.input({ type: 'motion', session: 1, sequence: 2, deltaY: Number.MAX_SAFE_INTEGER + 1 }));
	assert.throws(() => relay.input({ type: 'detached', session: 2 }), /session/);
	await relay.close();
});

test('closing discards queued inputs and waits for an already dispatched control', async () => {
	let resume: () => void = () => {};
	const blocked = new Promise<void>(resolve => { resume = resolve; });
	const sent: PhysicalInputEvent[] = [];
	const relay = new PeripheralRelay(1, async control => { sent.push(control); await blocked; }, () => {});
	relay.start();
	relay.input({ type: 'ready', version: 2, session: 1, switches: [{ controlId: 'blue', state: 'released' }] });
	relay.input({ type: 'button', controlId: 'blue', session: 1, sequence: 1, down: true });
	relay.input({ type: 'motion', session: 1, sequence: 2, deltaY: 3 });
	const closing = relay.close(); resume(); await closing;
	assert.deepEqual(sent, [{ sequence: 1, input: 0, value: 1 }]);
});

test('stream limits apply before newline and preserve split UTF-8 and complete records', async () => {
	const bytes = Buffer.from('a\né\n');
	const lines: string[] = [];
	for await (const line of boundedLines(Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]), 4)) lines.push(line);
	assert.deepEqual(lines, ['a', 'é']);
	await assert.rejects(async () => { for await (const _ of boundedLines(Readable.from(['12345']), 4)) {} }, /size limit/);
	await assert.rejects(async () => { for await (const _ of boundedLines(Readable.from(['12345\n']), 4)) {} }, /size limit/);
	await assert.rejects(async () => { for await (const _ of boundedLines(Readable.from(['x']), 4)) {} }, /incomplete/);
});

test('binding requires a complete explicit map and never translates legacy keys into physical identities', () => {
	const config = { version: 2, origin: 'http://127.0.0.1:9999', tokenFile: '/tmp/token', helperExecutable: '/tmp/helper', inputMap, bindingRevision: 1, jiggle: { minimumTravel: 4, minimumReversal: 2 } };
	assert.deepEqual(decodePeripheralBridgeConfig(config).inputMap.leds, []);
	assert.equal(decodePeripheralBridgeConfig({ ...config, jiggle: null }).jiggle, null);
	const { jiggle: _, ...omitted } = config;
	assert.throws(() => decodePeripheralBridgeConfig(omitted));
	assert.throws(() => decodePeripheralBridgeConfig({ ...config, version: 1, buttonKey: 'escape', sdkChannel: 0 }));
	assert.throws(() => decodePeripheralBridgeConfig({ ...config, tokenFile: 'token' }));
	assert.throws(() => decodePeripheralBridgeConfig({ ...config, extra: 'unsupported' }));
	assert.throws(() => decodePeripheralInputMap({ ...inputMap, leds: [{ controlId: 'blue', sdkChannel: 0 }] }));
	assert.throws(() => decodePeripheralInputMap({ ...inputMap, switches: [...inputMap.switches, { controlId: 'red', sourceId: 'keys', type: 1, code: 41 }] }));
	assert.throws(() => decodePeripheralInputMap({ ...inputMap, switches: [{ controlId: 'blue', sourceId: 'missing', type: 1, code: 41 }] }));
	assert.throws(() => decodePeripheralInputMap({ ...inputMap, switches: [{ controlId: 'blue', sourceId: 'keys', type: 1, code: 99 }] }));
	assert.throws(() => decodePeripheralInputMap({ ...inputMap, target: 'R1' }));
	const args = peripheralHelperArgs(7, inputMap);
	assert.deepEqual(args, ['7', '--map-version', '2', '--linux-source', 'keys', '2', '0,1', '41,42', '-',
		'--linux-source', 'motion', '3', '0,2', '-', '1', '--switch', 'blue', 'keys', '1', '41',
		'--switch', 'yellow', 'keys', '1', '42', '--axis', 'knob', 'motion', '2', '1']);
});

test('disabled motion is validated and consumes sequence before discard; button edges remain musical', async () => {
	const sent: PhysicalInputEvent[] = [];
	const relay = new PeripheralRelay(1, async control => { sent.push(control); }, error => { throw error; }, false);
	assert.throws(() => relay.input({ type: 'motion', session: 1, sequence: 1, deltaY: 3 }), /stale/);
	relay.input({ type: 'ready', version: 2, session: 1, switches: [{ controlId: 'blue', state: 'released' }] });
	relay.start();
	relay.input({ type: 'motion', session: 1, sequence: 1, deltaY: 32767 });
	assert.throws(() => relay.input({ type: 'motion', session: 1, sequence: 1, deltaY: -1 }), /stale/);
	assert.throws(() => relay.input({ type: 'motion', session: 2, sequence: 2, deltaY: 1 }), /session/);
	assert.throws(() => relay.input({ type: 'motion', session: 1, sequence: 2, deltaY: Number.MAX_SAFE_INTEGER + 1 }));
	// Existing monotonic high-water semantics allow gaps; ignored motion still advances it.
	relay.input({ type: 'motion', session: 1, sequence: 5, deltaY: -32768 });
	assert.throws(() => relay.input({ type: 'button', controlId: 'blue', session: 1, sequence: 4, down: true }), /stale/);
	relay.input({ type: 'button', controlId: 'blue', session: 1, sequence: 6, down: true });
	relay.input({ type: 'motion', session: 1, sequence: 7, deltaY: 0 });
	relay.input({ type: 'button', controlId: 'blue', session: 1, sequence: 8, down: false });
	await new Promise(resolve => setImmediate(resolve));
	await relay.close();
	assert.deepEqual(sent, [{ sequence: 6, input: 0, value: 1 }, { sequence: 8, input: 0, value: 0 }]);
});


test('synthetic six-switch installation maps four independent LEDs including a noncontiguous channel', async () => {
  const map = decodePeripheralInputMap({
    sources: [{ kind: 'linux', id: 'keys', interfaceNumber: 2, eventTypes: [0, 1], keyCodes: [41, 42, 43, 44, 45, 46], relativeAxes: [] },
      { kind: 'linux', id: 'motion', interfaceNumber: 3, eventTypes: [0, 2], keyCodes: [], relativeAxes: [1] }],
    switches: PHYSICAL_SWITCH_IDS.map((controlId, index) => ({ controlId, sourceId: 'keys', type: 1, code: 41 + index })),
    axis: { sourceId: 'motion', type: 2, code: 1 },
    leds: [{ controlId: 'blue', sdkChannel: 0 }, { controlId: 'yellow', sdkChannel: 1 },
      { controlId: 'red', sdkChannel: 2 }, { controlId: 'green', sdkChannel: 48 }],
    confirmWiring: true,
  });
  const contiguous = decodePeripheralInputMap({ ...map, leds: [...map.leds.slice(0, 3), { controlId: 'green', sdkChannel: 3 }] });
  assert.equal(contiguous.leds[3].sdkChannel, 3);
  const args = peripheralHelperArgs(7, map);
  assert.equal(args.filter(value => value === '--switch').length, 6);
  assert.deepEqual(args.slice(-13), ['--led', 'blue', '0', '--led', 'yellow', '1', '--led', 'red', '2', '--led', 'green', '48', '--confirm-wiring']);
  assert.throws(() => decodePeripheralInputMap({ ...map, leds: [...map.leds.slice(0, 3), { controlId: 'green', sdkChannel: 2 }] }));
  const sent: PhysicalInputEvent[] = [];
  const relay = new PeripheralRelay(7, async event => { sent.push(event); }, error => { throw error; });
  relay.input({ type: 'ready', version: 2, session: 7, switches: PHYSICAL_SWITCH_IDS.map(controlId => ({ controlId, state: 'released' })) });
  relay.start();
  for (const [index, controlId] of PHYSICAL_SWITCH_IDS.entries())
    relay.input({ type: 'button', controlId, session: 7, sequence: index + 1, down: true });
  for (const [index, controlId] of PHYSICAL_SWITCH_IDS.entries())
    relay.input({ type: 'button', controlId, session: 7, sequence: index + 7, down: false });
  await new Promise(resolve => setImmediate(resolve));
  await relay.close();
  assert.deepEqual(sent, [...PHYSICAL_SWITCH_IDS.map((_, input) => ({ sequence: input + 1, input, value: 1 })),
    ...PHYSICAL_SWITCH_IDS.map((_, input) => ({ sequence: input + 7, input, value: 0 }))]);
});
