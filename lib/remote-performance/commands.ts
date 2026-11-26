import { InputIntentIdSchema } from './session-schema.js';
import { Schema } from 'effect';
import { RequiredTuningBankSchema, TunerCommandSchema } from '../tuner/schema.js';
import { tunerCommandValues } from '../tuner/observation.js';
import { CONTROL_IDS, type PracticeState, type VoiceEffectsState } from '../performance/model.js';
import { PF } from '../performance/wasm-abi.js';
import { VoiceEffectDefinitionSchema } from './native-schema.js';
import { InputAttachSchema, InputEventSchema, InputProducerKindSchema, InputRevokeSchema } from '../performance/input-bindings.js';

const InputClientCommandSchema = Schema.Union([
  Schema.Struct({ command: Schema.Literal('inputAttach'), args: Schema.Struct({ intentId: InputIntentIdSchema, kind: InputProducerKindSchema,
    bindingGeneration: InputAttachSchema.fields.bindingGeneration, releasedMask: InputAttachSchema.fields.releasedMask, heldMask: InputAttachSchema.fields.heldMask }) }),
  Schema.Struct({ command: Schema.Literal('inputEvent'), args: Schema.Struct({ kind: InputProducerKindSchema,
    bindingGeneration: InputEventSchema.fields.bindingGeneration, sequence: InputEventSchema.fields.sequence,
    input: InputEventSchema.fields.input, value: InputEventSchema.fields.value }) }),
  Schema.Struct({ command: Schema.Literal('inputRevoke'), args: Schema.Struct({ kind: InputProducerKindSchema }) }),
]);
export const decodeClientInputCommand = Schema.decodeUnknownSync(InputClientCommandSchema, { onExcessProperty: 'error' });
export type ClientInputCommand = typeof InputClientCommandSchema.Type;

const Finite = Schema.Number.check(Schema.isFinite());
const Channel = Schema.Literals(['L1', 'L2', 'R1', 'R2']);
const Effect = VoiceEffectDefinitionSchema;
export const TambourineAudition = Schema.Struct({
  velocity: Schema.Int.check(Schema.isBetween({ minimum: -1, maximum: 127 })),
  slot: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 63 }))),
}).check(Schema.makeFilter(({ velocity, slot }) => slot === undefined || velocity > 0));
type TuningContext = {
  readonly run: bigint;
  readonly tunerRevision: number;
  readonly compiled: import('../performance/compiled-song.js').CompiledSong | undefined;
};

const Commands = Schema.Union([
	Schema.Struct({ command: Schema.Literal('inputAttach'), args: InputAttachSchema }),
	Schema.Struct({ command: Schema.Literal('inputEvent'), args: InputEventSchema }),
	Schema.Struct({ command: Schema.Literal('inputRevoke'), args: InputRevokeSchema }),
	Schema.Struct({ command: Schema.Literal('tuner'), args: TunerCommandSchema }),
	Schema.Struct({ command: Schema.Literal('beginRequiredTuning'), args: RequiredTuningBankSchema }),
	Schema.Struct({ command: Schema.Literal('configureJiggle'), args: Schema.Struct({ minimumTravel: Finite, minimumReversal: Finite }) }),
	Schema.Struct({ command: Schema.Literal('start'), args: Schema.Struct({ bpm: Schema.optionalKey(Finite), countInBars: Schema.optionalKey(Schema.Int), startBar: Schema.optionalKey(Schema.Int), endBar: Schema.optionalKey(Schema.Int), loop: Schema.optionalKey(Schema.Boolean), automatic: Schema.optionalKey(Schema.Boolean), recordDemo: Schema.optionalKey(Schema.Boolean), runId: Schema.optionalKey(Schema.String) }) }),
	Schema.Struct({ command: Schema.Literal('stop'), args: Schema.Struct({}) }),
	Schema.Struct({ command: Schema.Literal('recordDemo'), args: Schema.Struct({ recording: Schema.Boolean }) }),
	Schema.Struct({ command: Schema.Literal('auditionTambourine'), args: TambourineAudition }),
	Schema.Struct({ command: Schema.Literal('audition'), args: Schema.Struct({ profile: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }))) }) }),
	Schema.Struct({ command: Schema.Literal('control'), args: Schema.Struct({ control: Schema.Union([Schema.Struct({ id: Schema.Literals(['L1', 'L2', 'R1', 'R2']), edge: Schema.optionalKey(Schema.Literal('release')) }), Schema.Struct({ id: Schema.Literals(['mushroom', 'tempo']) }), Schema.Struct({ id: Schema.Literal('knob'), value: Finite }), Schema.Struct({ id: Schema.Literal('cueButton'), value: Schema.Literals([0, 1]) }), Schema.Struct({ id: Schema.Literal('external'), slot: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 63 })) })]), commandId: Schema.optionalKey(Schema.String) }) }),
	Schema.Struct({ command: Schema.Literal('selectChannel'), args: Schema.Struct({ channelId: Channel }) }),
	Schema.Struct({ command: Schema.Literal('setChannel'), args: Schema.Struct({ channelId: Channel, settings: Schema.Struct({ gain: Schema.optionalKey(Finite), muted: Schema.optionalKey(Schema.Boolean) }) }) }),
	Schema.Struct({ command: Schema.Literal('setClick'), args: Schema.Struct({ enabled: Schema.Boolean }) }),
	Schema.Struct({ command: Schema.Literal('configureVoiceProfile'), args: Schema.Struct({ profile: Schema.Int, expectedRevision: Schema.Int, effects: Schema.Array(Effect) }) }),
	Schema.Struct({ command: Schema.Literal('configureVoiceEffects'), args: Schema.Struct({ configurations: Schema.Array(Schema.Struct({ profile: Schema.Int, effects: Schema.Array(Effect) })) }) }),
]);
const decode = Schema.decodeUnknownSync(Commands, { onExcessProperty: 'error' });
const parse = Schema.decodeUnknownOption(Commands, { onExcessProperty: 'error' });

export function isPriorityCommand(input: unknown, state?: PracticeState): boolean {
	const result = parse(input);
	if (result._tag === 'None') return false;
	const command = result.value;
	if (command.command === 'inputEvent') {
		const routing = state?.inputRouting;
		const event = command.args;
		if (!routing || routing.bindingGeneration !== event.bindingGeneration || event.value !== 1) return false;
		const producer = routing.producers.find(value => value.producer === event.producer && value.session === event.session);
		if (!producer || event.sequence <= producer.lastSequence || !(producer.releasedMask & 1 << event.input)
			|| producer.heldMask & 1 << event.input) return false;
		return producer.kind === 'physical' ? event.input < 6 && !!(routing.panicMask & 1 << event.input) : event.input === 4;
	}
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

export function prepareInitialProfiles(input: unknown) {
	const command = decode({ command: 'configureVoiceEffects', args: { configurations: input } });
	if (command.command !== 'configureVoiceEffects') throw new Error('Invalid voice profiles');
	const configurations = [...command.args.configurations].sort((left, right) => left.profile - right.profile);
	const voices: VoiceEffectsState[] = Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [], prepared: false, revision: 0, activity: 'standby', rotationEligible: false, rotationRemainingBeats: 0 }));
	return { configurations, bytes: profiles(configurations, voices) };
}
export function encodeInitialProfiles(configurations: unknown) {
	return prepareInitialProfiles(configurations).bytes;
}

export function encodeCommand(input: unknown, state: PracticeState, songId?: string, tuning?: TuningContext) {
	const command = decode(input);
	switch (command.command) {
		case 'inputAttach': {
			const a = command.args;
			return numeric(14, [a.producer, a.session, a.bindingGeneration, InputProducerKindSchema.literals.indexOf(a.kind), a.releasedMask, a.heldMask]);
		}
		case 'inputEvent': {
			const a = command.args;
			return numeric(16, [a.producer, a.session, a.bindingGeneration, a.sequence, a.input, a.value]);
		}
		case 'inputRevoke': return numeric(17, [command.args.producer, command.args.session]);
		case 'tuner': return numeric(13, [...tunerCommandValues(command.args)]);
		case 'beginRequiredTuning': {
			const { profile, slots, target } = command.args;
			if (state.phase !== 'idle' && state.phase !== 'ended') throw new Error('Stop the song before recording the tuning scale');
			if (!tuning || tuning.run > BigInt(Number.MAX_SAFE_INTEGER)
				|| !tuning.compiled?.noteBanks?.some(({ capture }) => capture?.requiredBeforeStart && capture.profile === profile
					&& capture.target?.root === target.root && capture.target.scale === target.scale
					&& capture.slots.length === slots.length && capture.slots.every((slot, index) => slot === slots[index])))
				throw new Error('The requested tuning bank does not match the loaded chart');
			const [, revision, root, scale] = tunerCommandValues({ kind: 'configure', expectedRevision: tuning.tunerRevision, ...target });
			return numeric(24, [Number(tuning.run), revision, profile, root, scale, ...slots]);
		}
		case 'configureJiggle': {
			const { minimumTravel, minimumReversal } = command.args;
			if (!Number.isInteger(minimumTravel) || !Number.isInteger(minimumReversal) || minimumTravel < 1 || minimumTravel > 32767 || minimumReversal < 1 || minimumReversal > minimumTravel) throw new Error('Invalid jiggle thresholds');
			return numeric(12, [minimumTravel, minimumReversal]);
		}
		case 'start': {
			const { bpm = state.bpm, countInBars = 1, startBar = 1, endBar = state.endBar, loop = false, automatic = false } = command.args;
			if (bpm < 40 || bpm > 240 || countInBars < 0 || countInBars > 4 || startBar < 1 || endBar < startBar) throw new Error('Invalid start options');
			return numeric(command.args.recordDemo ? 21 : 1, [bpm, countInBars, startBar, endBar, Number(loop), Number(automatic)]);
		}
		case 'stop': return numeric(2);
		case 'recordDemo': return numeric(command.args.recording ? 19 : 20);
		case 'audition': return numeric(22, [command.args.profile ?? -1]);
		case 'auditionTambourine':
			if (songId !== 'tribulations') throw new Error('Tambourine audition is available in Tribulations');
			return numeric(23, [command.args.velocity, command.args.slot ?? -1]);
		case 'control': {
			const control = command.args.control;
			const id = control.id === 'external' ? control.slot + 16 : 'edge' in control && control.edge === 'release' ? CONTROL_IDS.indexOf(control.id) + 8
        : ['L1', 'L2', 'R1', 'R2', 'mushroom', 'knob', 'tempo', 'cueButton'].indexOf(control.id);
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
