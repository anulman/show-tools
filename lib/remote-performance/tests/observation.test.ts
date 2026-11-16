import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import song from '../../../songs/dance-yrself-clean.js';
import { test } from 'node:test';
import { PF } from '../../performance/wasm-abi.js';
import { PF as LIGHT } from '../../performance/light-abi.js';
import { tunerImageFixture } from './tuner-fixture.js';
import { lightFixture } from './light-fixture.js';
import { decodeSnapshot, parseManifest, parseManifestProgram } from '../observation.js';

function counted(values: number[]) {
	const bytes = Buffer.alloc(4 + values.length * 8);
	bytes.writeUInt32LE(values.length);
	values.forEach((value, index) => bytes.writeDoubleLE(value, 4 + index * 8));
	return bytes;
}

test('an unprepared native host has no tuner observation yet', () => {
  const arrays = [PF.FIELDS, PF.CHANNELS * PF.CHANNEL_FIELDS, PF.VOICE_PROFILES * PF.VOICE_FIELDS,
    PF.VOICE_PROFILES * PF.MAX_LIVE_EFFECTS * PF.VOICE_EFFECT_FIELDS, PF.LIVE_FIELDS,
    PF.COMPILED_MAX_TAKES * PF.TAKE_FIELDS, PF.TEMPO_FIELDS, LIGHT.LIGHT_FIELDS, PF.TUNER_FIELDS, PF.INPUT_INFO_FIELDS];
  const payload = Buffer.concat([Buffer.alloc(52), ...arrays.map(length => counted(Array(length).fill(0)))]);
  assert.equal(decodeSnapshot(payload, 'unprepared'), null);
});

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
	const lights = lightFixture(.7);
	const inputs = Array(PF.INPUT_INFO_FIELDS).fill(0);
	inputs[PF.INPUT_GENERATION] = 9; inputs[PF.INPUT_COUNT] = 1;
	inputs[PF.INPUT_SESSION_HIGH_WATERMARK] = 5000000; inputs[PF.INPUT_PANIC_MASK] = 2;
	inputs.splice(PF.INPUT_RECORDS, PF.INPUT_PRODUCER_FIELDS, 3, 5000000, PF.INPUT_PHYSICAL, 1, 2, 100);
	const arrays = [state, Array(PF.CHANNELS * PF.CHANNEL_FIELDS).fill(0), Array(PF.VOICE_PROFILES * PF.VOICE_FIELDS).fill(0),
		Array(PF.VOICE_PROFILES * PF.MAX_LIVE_EFFECTS * PF.VOICE_EFFECT_FIELDS).fill(0), Array(PF.LIVE_FIELDS).fill(0),
		Array(PF.COMPILED_MAX_TAKES * PF.TAKE_FIELDS).fill(0), Array(PF.TEMPO_FIELDS).fill(0), lights, tunerImageFixture(), inputs];
	const payload = Buffer.concat([header, manifest, digest, ...arrays.map(counted)]);
	const decoded = decodeSnapshot(payload, 'run');
	assert.deepEqual(decoded?.lights, lights);
	assert.equal(decoded?.state.channels.length, 4);
	assert.equal(decoded?.state.runId, 'run:2');
	assert.equal(decoded?.state.compiledTakes?.length, song.compiled.takes.length);
	assert.deepEqual(decoded?.state.inputRouting, { bindingGeneration: 9, sessionHighWatermark: 5000000, panicMask: 2,
		producers: [{ producer: 3, session: 5000000, kind: 'physical', releasedMask: 1, heldMask: 2, lastSequence: 100 }] });
	const { NativeStateSchema } = await import('../native-schema.js');
	const { Schema } = await import('effect');
	assert.deepEqual(Schema.decodeUnknownSync(NativeStateSchema)(JSON.parse(JSON.stringify(decoded?.state))).inputRouting, decoded?.state.inputRouting);
	assert.throws(() => decodeSnapshot(payload.subarray(0, -1), 'run'), /Truncated/);
});

test('light image schema rejects malformed complete publications without altering valid values', async () => {
  const { Schema } = await import('effect');
  const { LightPublicationSchema } = await import('../native-schema.js');
  const decode = Schema.decodeUnknownSync(LightPublicationSchema);
  assert.deepEqual(decode(lightFixture(.7)), lightFixture(.7));
  for (const change of [
    (image: number[]) => image.pop(),
    (image: number[]) => image.push(0),
    (image: number[]) => { image[LIGHT.LIGHT_FORMAT] = 2; },
    (image: number[]) => { image[LIGHT.LIGHT_RATE] = 0; },
    (image: number[]) => { image[LIGHT.LIGHT_SEQUENCE] = .5; },
    (image: number[]) => { image[LIGHT.LIGHT_COUNT_BEAT] = NaN; },
    (image: number[]) => { image[LIGHT.LIGHT_SAMPLES + LIGHT.LIGHT_SAMPLE_LEVEL] = 1.1; },
    (image: number[]) => { image[LIGHT.LIGHT_SAMPLES + LIGHT.LIGHT_SAMPLE_FIELDS] = 2; },
    (image: number[]) => { image[LIGHT.LIGHT_COUNT] = 2; image[LIGHT.LIGHT_SAMPLES + LIGHT.LIGHT_SAMPLE_FIELDS] = 1; },
    (image: number[]) => { image[LIGHT.LIGHT_SEQUENCE] = Number.MAX_SAFE_INTEGER; image[LIGHT.LIGHT_PENDING] = 1; },
  ]) {
    const image = lightFixture(); change(image);
    assert.throws(() => decode(image));
  }
  const terminal = lightFixture(); terminal[LIGHT.LIGHT_SEQUENCE] = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(decode(terminal), terminal);
});

test('both manifest readers reject malformed nested compiled songs', () => {
  assert.ok(song.compiled);
  for (const compiled of [null, { ...song.compiled, schemaVersion: 6 }, { ...song.compiled, schemaVersion: 999 },
    { ...song.compiled, chart: { ...song.compiled.chart, beatsPerBar: 99 } },
    { ...song.compiled, unexpected: true },
    { ...song.compiled, executable: false }]) {
    const bytes = Buffer.from(JSON.stringify({ id: song.id, description: '', compiled,
      practice: { startBar: 1, endBar: 10 }, takeCount: song.compiled.takes.length,
      packetSha256: 'x', profilesSha256: 'y' }));
    const digest = createHash('sha256').update(bytes).digest();
    for (const read of [parseManifest, parseManifestProgram]) assert.throws(() => read(bytes, digest));
  }
});
