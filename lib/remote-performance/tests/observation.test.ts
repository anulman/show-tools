import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import song from '../../../songs/dance-yrself-clean.js';
import { test } from 'node:test';
import { PF } from '../../performance/wasm-abi.js';
import { decodeSnapshot, parseManifest } from '../observation.js';

function counted(values: number[]) {
	const bytes = Buffer.alloc(4 + values.length * 8);
	bytes.writeUInt32LE(values.length);
	values.forEach((value, index) => bytes.writeDoubleLE(value, 4 + index * 8));
	return bytes;
}

test('validates manifest digest and decodes copied native arrays', async () => {
	assert.ok(song.compiled);
	const chart = song.chart;
	const manifest = Buffer.from(JSON.stringify({ id: song.id, description: '', compiled: song.compiled, practice: { startBar: 1, endBar: 10 }, takeCount: song.compiled.takes.length, packetSha256: 'x', profilesSha256: 'y' }));
	const digest = createHash('sha256').update(manifest).digest();
	assert.equal(parseManifest(manifest, digest).song.chart.title, chart.title);
	assert.deepEqual(parseManifest(manifest, digest).song.compiled?.parts, song.compiled.parts);
	assert.throws(() => parseManifest(manifest, Buffer.alloc(32)), /digest/);
	const header = Buffer.alloc(20); header.writeBigUInt64LE(1n); header.writeBigUInt64LE(2n, 8); header.writeUInt32LE(manifest.length, 16);
	const state = Array(PF.FIELDS).fill(0); state[PF.BAR_NUMBER] = -1; state[PF.BEAT_NUMBER] = -1;
	const arrays = [state, Array(PF.CHANNELS * PF.CHANNEL_FIELDS).fill(0), Array(PF.VOICE_PROFILES * PF.VOICE_FIELDS).fill(0),
		Array(PF.VOICE_PROFILES * PF.MAX_LIVE_EFFECTS * PF.VOICE_EFFECT_FIELDS).fill(0), Array(PF.LIVE_FIELDS).fill(0),
		Array(PF.COMPILED_MAX_TAKES * PF.TAKE_FIELDS).fill(0), Array(PF.TEMPO_FIELDS).fill(0)];
	const payload = Buffer.concat([header, manifest, digest, ...arrays.map(counted)]);
	const decoded = decodeSnapshot(payload, 'run');
	assert.equal(decoded?.state.channels.length, 4);
	assert.equal(decoded?.state.runId, 'run:2');
	assert.equal(decoded?.state.compiledTakes?.length, song.compiled.takes.length);
	assert.throws(() => decodeSnapshot(payload.subarray(0, -1), 'run'), /Truncated/);
});
