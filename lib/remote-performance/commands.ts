import { Schema } from 'effect';
import { CONTROL_IDS, type PracticeState, type VoiceEffectsState } from '../performance/model.js';
import { PF } from '../performance/wasm-abi.js';

const Finite = Schema.Number.check(Schema.isFinite());
const Channel = Schema.Literals(['L1', 'L2', 'R1', 'R2']);
const Effect = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('slapback'), delayMs: Finite, feedback: Finite, wet: Finite }),
	Schema.Struct({ kind: Schema.Literal('chorus'), rateHz: Finite, depthMs: Finite, baseDelayMs: Finite, wet: Finite }),
]);
const Commands = Schema.Union([
	Schema.Struct({ command: Schema.Literal('configureJiggle'), args: Schema.Struct({ minimumTravel: Finite, minimumReversal: Finite }) }),
	Schema.Struct({ command: Schema.Literal('start'), args: Schema.Struct({ bpm: Schema.optionalKey(Finite), countInBars: Schema.optionalKey(Schema.Int), startBar: Schema.optionalKey(Schema.Int), endBar: Schema.optionalKey(Schema.Int), loop: Schema.optionalKey(Schema.Boolean), automatic: Schema.optionalKey(Schema.Boolean), runId: Schema.optionalKey(Schema.String) }) }),
	Schema.Struct({ command: Schema.Literal('stop'), args: Schema.Struct({}) }),
	Schema.Struct({ command: Schema.Literal('control'), args: Schema.Struct({ control: Schema.Union([Schema.Struct({ id: Schema.Literals(['L1', 'L2', 'R1', 'R2', 'mushroom', 'tempo']) }), Schema.Struct({ id: Schema.Literal('knob'), value: Finite }), Schema.Struct({ id: Schema.Literal('cueButton'), value: Schema.Literals([0, 1]) })]), commandId: Schema.optionalKey(Schema.String) }) }),
	Schema.Struct({ command: Schema.Literal('selectChannel'), args: Schema.Struct({ channelId: Channel }) }),
	Schema.Struct({ command: Schema.Literal('setChannel'), args: Schema.Struct({ channelId: Channel, settings: Schema.Struct({ gain: Schema.optionalKey(Finite), muted: Schema.optionalKey(Schema.Boolean) }) }) }),
	Schema.Struct({ command: Schema.Literal('setClick'), args: Schema.Struct({ enabled: Schema.Boolean }) }),
	Schema.Struct({ command: Schema.Literal('configureVoiceProfile'), args: Schema.Struct({ profile: Schema.Int, expectedRevision: Schema.Int, effects: Schema.Array(Effect) }) }),
	Schema.Struct({ command: Schema.Literal('configureVoiceEffects'), args: Schema.Struct({ configurations: Schema.Array(Schema.Struct({ profile: Schema.Int, effects: Schema.Array(Effect) })) }) }),
]);
const decode = Schema.decodeUnknownSync(Commands);
const parse = Schema.decodeUnknownOption(Commands);

export function isPriorityCommand(input: unknown): boolean {
	const result = parse(input);
	if (result._tag === 'None') return false;
	const command = result.value;
	return command.command === 'stop' || (command.command === 'control' && command.args.control.id === 'mushroom');
}

function numeric(opcode: number, values: number[] = []) {
	const bytes = Buffer.alloc(2 + values.length * 8);
	bytes.writeUInt16LE(opcode);
	values.forEach((value, i) => bytes.writeDoubleLE(value, 2 + i * 8));
	return bytes;
}

function profiles(configurations: readonly { readonly profile: number; readonly effects: readonly (typeof Effect.Type)[] }[], old: readonly VoiceEffectsState[]) {
	if (configurations.length !== PF.VOICE_PROFILES || old.length !== PF.VOICE_PROFILES) throw new Error('Configure all six voice profiles');
	const ordered = Array.from({ length: PF.VOICE_PROFILES }, (_, index) => {
		const matches = configurations.filter(value => value.profile === index);
		if (matches.length !== 1 || matches[0].effects.length > PF.MAX_LIVE_EFFECTS) throw new Error('Invalid voice profile');
		return matches[0].effects;
	});
	const count = ordered.reduce((sum, effects) => sum + effects.length, 0);
	const bytes = Buffer.alloc(2 + 4 + 6 * 4 + 6 * 4 + count * PF.EFFECT_BYTES);
	bytes.writeUInt16LE(10);
	bytes.writeUInt32LE(count, 2);
	let offset = 54;
	for (let i = 0; i < ordered.length; i++) {
		const effects = ordered[i];
		bytes.writeUInt32LE(effects.length, 6 + i * 4);
		const previous = old.find(value => value.profile === i);
		if (!previous) throw new Error('Missing voice readback');
		const unchanged = previous.prepared && JSON.stringify(previous.effects) === JSON.stringify(effects);
		const revision = unchanged ? previous.revision : previous.revision + 1;
		if (!Number.isSafeInteger(revision) || revision < 1 || revision > 0xffffffff) throw new Error('Invalid voice revision');
		bytes.writeUInt32LE(revision, 30 + i * 4);
		for (const effect of effects) {
			const values = effect.kind === 'slapback' ? [effect.delayMs, effect.feedback, effect.wet, 0] : [effect.rateHz, effect.depthMs, effect.baseDelayMs, effect.wet];
			if (effect.wet < 0 || effect.wet > 1 || (effect.kind === 'slapback' && (effect.delayMs < 40 || effect.delayMs > 250 || effect.feedback < 0 || effect.feedback > .7)) || (effect.kind === 'chorus' && (effect.rateHz < .05 || effect.rateHz > 5 || effect.depthMs < 0 || effect.depthMs > 9 || effect.baseDelayMs < 10 || effect.baseDelayMs > 40))) throw new Error('Invalid voice effect');
			bytes.writeUInt32LE(effect.kind === 'slapback' ? PF.EFFECT_SLAPBACK : PF.EFFECT_CHORUS, offset);
			bytes.writeUInt32LE(1, offset + 4);
			values.forEach((value, index) => bytes.writeDoubleLE(value, offset + 8 + index * 8));
			offset += PF.EFFECT_BYTES;
		}
	}
	return bytes;
}

export function encodeInitialProfiles(configurations: unknown) {
	const command = decode({ command: 'configureVoiceEffects', args: { configurations } });
	if (command.command !== 'configureVoiceEffects') throw new Error('Invalid voice profiles');
	const voices: VoiceEffectsState[] = Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [], prepared: false, revision: 0, activity: 'standby', rotationEligible: false, rotationRemainingBeats: 0 }));
	return profiles(command.args.configurations, voices);
}

export function encodeCommand(input: unknown, state: PracticeState) {
	const command = decode(input);
	switch (command.command) {
		case 'configureJiggle': {
			const { minimumTravel, minimumReversal } = command.args;
			if (!Number.isInteger(minimumTravel) || !Number.isInteger(minimumReversal) || minimumTravel < 1 || minimumTravel > 32767 || minimumReversal < 1 || minimumReversal > minimumTravel) throw new Error('Invalid jiggle thresholds');
			return numeric(12, [minimumTravel, minimumReversal]);
		}
		case 'start': {
			const { bpm = state.bpm, countInBars = 1, startBar = 1, endBar = state.endBar, loop = true, automatic = false } = command.args;
			if (bpm < 40 || bpm > 240 || countInBars < 0 || countInBars > 4 || startBar < 1 || endBar < startBar) throw new Error('Invalid start options');
			return numeric(1, [bpm, countInBars, startBar, endBar, Number(loop), Number(automatic)]);
		}
		case 'stop': return numeric(2);
		case 'control': {
			const control = command.args.control;
			const id = ['L1', 'L2', 'R1', 'R2', 'mushroom', 'knob', 'tempo', 'cueButton'].indexOf(control.id);
			return numeric(3, [id, control.id === 'knob' || control.id === 'cueButton' ? control.value : 0]);
		}
		case 'selectChannel': return numeric(4, [CONTROL_IDS.indexOf(command.args.channelId)]);
		case 'setChannel': {
			const index = CONTROL_IDS.indexOf(command.args.channelId);
			const current = state.channels[index];
			const gain = command.args.settings.gain ?? current.gain;
			if (gain < 0 || gain > 4) throw new Error('Invalid channel gain');
			return numeric(5, [index, gain, Number(command.args.settings.muted ?? current.muted)]);
		}
		case 'setClick': return numeric(7, [Number(command.args.enabled)]);
		case 'configureVoiceEffects': throw new Error('Use a selected voice profile');
		case 'configureVoiceProfile': {
			const voices = state.voiceEffects ?? [];
			const selected = voices.find(voice => voice.profile === command.args.profile);
			if (!selected || !selected.prepared || selected.revision !== command.args.expectedRevision) throw new Error('Voice profile changed; refresh and retry');
			return profiles(voices.map(voice => ({ profile: voice.profile, effects: voice.profile === selected.profile ? command.args.effects : voice.effects })), voices);
		}
	}
}
