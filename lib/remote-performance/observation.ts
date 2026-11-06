import { decodeTunerState } from '../tuner/observation.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Schema } from 'effect';
import { CompiledSongSchema, decodeCompiledSong } from '../performance/compiled-song.js';
import { decodeNativeEvent, decodeNativeLiveEffects, decodeNativeState, decodeNativeTake, decodeNativeTempo, decodeNativeVoices } from '../performance/native-observation.js';
import type { SongScript } from '../performance/model.js';
import { PF } from '../performance/wasm-abi.js';
import { PF as LIGHT } from '../performance/light-abi.js';
import { LightPublicationSchema } from './native-schema.js';

const Manifest = Schema.Struct({
	id: Schema.String,
	description: Schema.String,
	compiled: CompiledSongSchema,
	practice: Schema.Struct({ startBar: Schema.Int, endBar: Schema.Int }),
	takeCount: Schema.Int,
	packetSha256: Schema.String,
	profilesSha256: Schema.String,
});
const decodeManifest = Schema.decodeUnknownSync(Manifest);

class Reader {
	private offset = 0;
	constructor(private readonly bytes: Buffer) {}
	take(length: number) {
		if (!Number.isSafeInteger(length) || length < 0 || length > this.bytes.length - this.offset) throw new Error('Truncated host publication');
		const value = this.bytes.subarray(this.offset, this.offset + length);
		this.offset += length;
		return value;
	}
	u32() { return this.take(4).readUInt32LE(); }
	u64() { return this.take(8).readBigUInt64LE(); }
	array(expected: number) {
		if (this.u32() !== expected) throw new Error('Invalid host array length');
		const data = this.take(expected * 8);
		return Float64Array.from({ length: expected }, (_, index) => {
			const value = data.readDoubleLE(index * 8);
			if (!Number.isFinite(value)) throw new Error('Invalid host number');
			return value;
		});
	}
	end() { if (this.offset !== this.bytes.length) throw new Error('Unexpected host publication data'); }
}

export function parseManifest(bytes: Buffer, digest: Buffer) {
	if (bytes.length > 1024 * 1024 || digest.length !== 32 || !timingSafeEqual(createHash('sha256').update(bytes).digest(), digest)) throw new Error('Invalid manifest digest');
	const manifest = decodeManifest(JSON.parse(bytes.toString('utf8')));
	const compiled = decodeCompiledSong(manifest.compiled);
	if (manifest.takeCount < 0 || manifest.takeCount > PF.COMPILED_MAX_TAKES || manifest.practice.startBar < 1 || manifest.practice.endBar < manifest.practice.startBar || manifest.practice.endBar > compiled.chart.bars.length) throw new Error('Invalid manifest range');
	if (!compiled.executable || compiled.id !== manifest.id || compiled.takes.length !== manifest.takeCount) throw new Error('Invalid manifest identity');
	const song: SongScript = { id: manifest.id, description: manifest.description, chart: compiled.chart, compiled, practice: manifest.practice, program: { lengthBeats: compiled.chart.beatsPerBar, events: [] } };
	return { song, takeCount: manifest.takeCount, packetSha256: manifest.packetSha256, profilesSha256: manifest.profilesSha256 };
}

const message = (code: number) => `Native error ${code}`;
export function decodeSnapshot(payload: Buffer, runId: string) {
	const reader = new Reader(payload);
	const revision = reader.u64();
	const run = reader.u64();
	const manifestBytes = reader.take(reader.u32());
	const digest = reader.take(32);
	const transport = reader.array(PF.FIELDS);
	const channels = reader.array(PF.CHANNELS * PF.CHANNEL_FIELDS);
	const voices = reader.array(PF.VOICE_PROFILES * PF.VOICE_FIELDS);
	const effects = reader.array(PF.VOICE_PROFILES * PF.MAX_LIVE_EFFECTS * PF.VOICE_EFFECT_FIELDS);
	const live = reader.array(PF.LIVE_FIELDS);
	const takes = reader.array(PF.COMPILED_MAX_TAKES * PF.TAKE_FIELDS);
	const tempo = reader.array(PF.TEMPO_FIELDS);
	const lightImage = reader.array(LIGHT.LIGHT_FIELDS);
	const tunerData = reader.array(PF.TUNER_FIELDS);
	reader.end();
	if (revision === 0n && manifestBytes.length === 0 && digest.every(byte => byte === 0)) return null;
	const tuner = decodeTunerState(tunerData);
	const lights = Schema.decodeUnknownSync(LightPublicationSchema)(Array.from(lightImage));
	const manifest = parseManifest(manifestBytes, digest);
	const voiceRows = Array.from({ length: PF.VOICE_PROFILES }, (_, i) => voices.subarray(i * PF.VOICE_FIELDS, (i + 1) * PF.VOICE_FIELDS));
	const effectRows = voiceRows.map((_, profile) => Array.from({ length: PF.MAX_LIVE_EFFECTS }, (_, stage) => {
		const start = (profile * PF.MAX_LIVE_EFFECTS + stage) * PF.VOICE_EFFECT_FIELDS;
		return effects.subarray(start, start + PF.VOICE_EFFECT_FIELDS);
	}));
	const state = decodeNativeState(transport, channels, `${runId}:${run}`, message);
	state.voiceEffects = decodeNativeVoices(voiceRows, effectRows);
	state.liveEffects = decodeNativeLiveEffects(live);
	state.compiledTakes = Array.from({ length: manifest.takeCount }, (_, i) => decodeNativeTake(takes.subarray(i * PF.TAKE_FIELDS, (i + 1) * PF.TAKE_FIELDS), i));
	state.tempoHits = decodeNativeTempo(tempo);
	return { revision, song: manifest.song, state, lights, tuner };
}

export function decodeEvent(payload: Buffer, runId: string) {
	const reader = new Reader(payload);
	const run = reader.u64();
	const event = decodeNativeEvent(reader.array(PF.EVENT_FIELDS), `${runId}:${run}`, message);
	reader.end();
	return event;
}
