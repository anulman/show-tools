import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeInitialProfiles, isPriorityCommand, encodeCommand } from '../commands.js';
import { decodeNativeState } from '../../performance/native-observation.js';
import { PF } from '../../performance/wasm-abi.js';

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
