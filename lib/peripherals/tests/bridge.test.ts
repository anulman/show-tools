import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { boundedLines, decodePeripheralBridgeConfig, PeripheralRelay } from '../bridge.js';
import type { Control } from '../../performance/model.js';

test('bounded motion ingress retains signed travel, reversals and button order', async () => {
	const sent: Control[] = [];
	let resume: () => void = () => {};
	const blocked = new Promise<void>(resolve => { resume = resolve; });
	const relay = new PeripheralRelay(1, async control => { sent.push(control); if (sent.length === 1) await blocked; }, error => { throw error; });
	relay.start();
	relay.input({ type: 'ready', version: 1, session: 1, released: true });
	relay.input({ type: 'button', session: 1, sequence: 1, down: true });
	for (let sequence = 2; sequence <= 100; ++sequence) relay.input({ type: 'motion', session: 1, sequence, deltaY: 1 });
	relay.input({ type: 'motion', session: 1, sequence: 101, deltaY: -1 });
	relay.input({ type: 'motion', session: 1, sequence: 102, deltaY: -2 });
	relay.input({ type: 'button', session: 1, sequence: 103, down: false });
	resume(); await new Promise(resolve => setImmediate(resolve));
	await relay.close();
	assert.deepEqual(sent, [{ id: 'cueButton', value: 1 }, { id: 'knob', value: 99 }, { id: 'knob', value: -3 }, { id: 'cueButton', value: 0 }]);
});

test('stale, mismatched and unbounded input never becomes a musical control', async () => {
	const relay = new PeripheralRelay(1, async () => {}, () => {});
	assert.throws(() => relay.input({ type: 'button', session: 1, sequence: 1, down: true }), /sequence/);
	relay.input({ type: 'ready', version: 1, session: 1, released: false });
	assert.throws(() => relay.input({ type: 'ready', version: 1, session: 1, released: true }), /Duplicate/);
	assert.throws(() => relay.input({ type: 'motion', session: 2, sequence: 1, deltaY: 1 }), /session/);
	relay.input({ type: 'motion', session: 1, sequence: 1, deltaY: 0 });
	assert.throws(() => relay.input({ type: 'motion', session: 1, sequence: 1, deltaY: 1 }), /stale/);
	assert.throws(() => relay.input({ type: 'motion', session: 1, sequence: 2, deltaY: 32768 }));
	assert.throws(() => relay.input({ type: 'detached', session: 2 }), /session/);
	await relay.close();
});

test('closing discards queued inputs and waits for an already dispatched control', async () => {
	let resume: () => void = () => {};
	const blocked = new Promise<void>(resolve => { resume = resolve; });
	const sent: Control[] = [];
	const relay = new PeripheralRelay(1, async control => { sent.push(control); await blocked; }, () => {});
	relay.start();
	relay.input({ type: 'ready', version: 1, session: 1, released: true });
	relay.input({ type: 'button', session: 1, sequence: 1, down: true });
	relay.input({ type: 'motion', session: 1, sequence: 2, deltaY: 3 });
	const closing = relay.close(); resume(); await closing;
	assert.deepEqual(sent, [{ id: 'cueButton', value: 1 }]);
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

test('binding validates explicit output and private absolute credential paths', () => {
	const config = { version: 1, origin: 'http://127.0.0.1:9999', tokenFile: '/tmp/token', helperExecutable: '/tmp/helper', sdkChannel: 0, bindingRevision: 1, jiggle: { minimumTravel: 4, minimumReversal: 2 } };
	assert.equal(decodePeripheralBridgeConfig(config).sdkChannel, 0);
	assert.equal(decodePeripheralBridgeConfig({ ...config, jiggle: null }).jiggle, null);
	const { jiggle: _, ...omitted } = config;
	assert.throws(() => decodePeripheralBridgeConfig(omitted));
	assert.equal(decodePeripheralBridgeConfig(config).buttonKey, undefined);
	for (const buttonKey of ['tab', 'escape']) assert.equal(decodePeripheralBridgeConfig({ ...config, buttonKey }).buttonKey, buttonKey);
	for (const buttonKey of ['Escape', 'enter', 1, null, '', '--button-key escape']) assert.throws(() => decodePeripheralBridgeConfig({ ...config, buttonKey }));
	assert.throws(() => decodePeripheralBridgeConfig({ ...config, sdkChannel: 96 }));
	assert.throws(() => decodePeripheralBridgeConfig({ ...config, tokenFile: 'token' }));
	assert.throws(() => decodePeripheralBridgeConfig({ ...config, extra: 'unsupported' }));
});


test('disabled motion is validated and consumes sequence before discard; button edges remain musical', async () => {
	const sent: Control[] = [];
	const relay = new PeripheralRelay(1, async control => { sent.push(control); }, error => { throw error; }, false);
	assert.throws(() => relay.input({ type: 'motion', session: 1, sequence: 1, deltaY: 3 }), /stale/);
	relay.input({ type: 'ready', version: 1, session: 1, released: true });
	relay.start();
	relay.input({ type: 'motion', session: 1, sequence: 1, deltaY: 32767 });
	assert.throws(() => relay.input({ type: 'motion', session: 1, sequence: 1, deltaY: -1 }), /stale/);
	assert.throws(() => relay.input({ type: 'motion', session: 2, sequence: 2, deltaY: 1 }), /session/);
	assert.throws(() => relay.input({ type: 'motion', session: 1, sequence: 2, deltaY: 32768 }));
	// Existing monotonic high-water semantics allow gaps; ignored motion still advances it.
	relay.input({ type: 'motion', session: 1, sequence: 5, deltaY: -32768 });
	assert.throws(() => relay.input({ type: 'button', session: 1, sequence: 4, down: true }), /stale/);
	relay.input({ type: 'button', session: 1, sequence: 6, down: true });
	relay.input({ type: 'motion', session: 1, sequence: 7, deltaY: 0 });
	relay.input({ type: 'button', session: 1, sequence: 8, down: false });
	await new Promise(resolve => setImmediate(resolve));
	await relay.close();
	assert.deepEqual(sent, [{ id: 'cueButton', value: 1 }, { id: 'cueButton', value: 0 }]);
});
