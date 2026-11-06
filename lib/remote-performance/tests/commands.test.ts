import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeInitialProfiles } from '../commands.js';
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
