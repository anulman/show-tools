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
