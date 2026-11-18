import { Schema } from 'effect';
import { InputAttachSchema, InputProducerKindSchema, InputRevokeSchema } from '../performance/input-bindings.js';
import { TunerStateSchema } from '../tuner/schema.js';
import { NativeEventSchema, NativeStateSchema, SongSchema, LightPublicationSchema } from './native-schema.js';

const id = Schema.NonEmptyString.check(Schema.isMaxLength(256));
const revision = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,19})$/));
const message = Schema.String.check(Schema.isMaxLength(8192));
export const AttemptSchema = id.pipe(Schema.brand('AudioAttempt'));
export const ServerEpochSchema = id.pipe(Schema.brand('DeskEpoch'));
export const NativeEpochSchema = id.pipe(Schema.brand('NativeEpoch'));
export const DeskRevisionSchema = revision.pipe(Schema.brand('DeskRevision'));
export const NativeRevisionSchema = revision.pipe(Schema.brand('NativeRevision'));
export const demoStates = ['idle', 'armed', 'recording', 'finishing', 'saved', 'failed'] as const;
const DemoStateSchema = Schema.Literals(demoStates);
export const MAX_DEMO_BYTES = 192 * 1024 * 1024 + 44;

export const NativePerformanceSchema = Schema.Struct({
  hostEpoch: NativeEpochSchema,
  revision: NativeRevisionSchema,
  state: NativeStateSchema,
  lights: LightPublicationSchema,
  tuner: TunerStateSchema,
  demo: Schema.optionalKey(DemoStateSchema),
});
export const AudioStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('off') }),
  Schema.Struct({ kind: Schema.Literal('starting'), attempt: AttemptSchema }),
  Schema.Struct({ kind: Schema.Literal('ready'), attempt: AttemptSchema, performance: NativePerformanceSchema }),
  Schema.Struct({ kind: Schema.Literal('stopping'), attempt: AttemptSchema, error: Schema.optionalKey(message) }),
  Schema.Struct({ kind: Schema.Literal('fault'), error: message }),
]);
export const DeskViewSchema = Schema.Struct({
  serverEpoch: ServerEpochSchema,
  revision: DeskRevisionSchema,
  song: SongSchema,
  audio: AudioStateSchema,
});
export const DeskPublicationSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('desk'), view: DeskViewSchema }),
  Schema.Struct({ type: Schema.Literal('native'), serverEpoch: ServerEpochSchema, revision: DeskRevisionSchema,
    attempt: AttemptSchema, performance: NativePerformanceSchema }),
  Schema.Struct({ type: Schema.Literal('event'), attempt: AttemptSchema, event: NativeEventSchema }),
  Schema.Struct({ type: Schema.Literal('gap') }),
]);
export const SongChoicesSchema = Schema.Struct({ songs: Schema.NonEmptyArray(Schema.Struct({
  id, title: Schema.NonEmptyString, packageDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
})) });
export const decodeSongChoices = Schema.decodeUnknownSync(SongChoicesSchema, { onExcessProperty: 'error' });
export const NativeTargetSchema = Schema.Struct({ attempt: AttemptSchema, hostEpoch: NativeEpochSchema });
export const AudioGoalSchema = Schema.Literals(['on', 'off']);
export const AudioDecisionSchema = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal('accepted'), view: DeskViewSchema }),
  Schema.Struct({ outcome: Schema.Literal('rejected'), error: message, view: DeskViewSchema }),
]);
export const NativeEngineRetirementProofSchema = Schema.Struct({ kind: Schema.Literal('old-engine-ended'), target: NativeTargetSchema,
  serverEpoch: ServerEpochSchema, retirementDeskRevision: DeskRevisionSchema });
export type NativeEngineRetirementProof = typeof NativeEngineRetirementProofSchema.Type;
export const InputIntentIdSchema = id;
export const InputLeaseReceiptSchema = Schema.Struct({ target: NativeTargetSchema, ...InputRevokeSchema.fields,
  kind: InputProducerKindSchema, bindingGeneration: InputAttachSchema.fields.bindingGeneration, admissionRevision: NativeRevisionSchema });
export const InputIntentStatusSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(['pending', 'unknown']) }),
  Schema.Struct({ kind: Schema.Literal('admitted'), receipt: InputLeaseReceiptSchema }),
  Schema.Struct({ kind: Schema.Literal('retired'), proof: Schema.Union([
    Schema.Struct({ ...NativeEngineRetirementProofSchema.fields, kindOfProducer: InputProducerKindSchema,
      bindingGeneration: InputAttachSchema.fields.bindingGeneration }),
    Schema.Struct({ kind: Schema.Literal('rejected-before-admission'), target: NativeTargetSchema,
      kindOfProducer: InputProducerKindSchema, bindingGeneration: InputAttachSchema.fields.bindingGeneration }),
    Schema.Struct({ kind: Schema.Literal('exact-revoke-applied'), receipt: InputLeaseReceiptSchema, revocationRevision: NativeRevisionSchema }),
    Schema.Struct({ kind: Schema.Literal('binding-generation-retired'), target: NativeTargetSchema, serverEpoch: ServerEpochSchema,
      kindOfProducer: InputProducerKindSchema, bindingGeneration: InputAttachSchema.fields.bindingGeneration,
      currentBindingGeneration: InputAttachSchema.fields.bindingGeneration, replacementRevision: NativeRevisionSchema }),
  ]) }),
]);
export const InputIntentStatusRequestSchema = Schema.Struct({ inputOwnerToken: id, intentId: InputIntentIdSchema });
export const DeskBootstrapSchema = Schema.Struct({ sessionId: id, inputOwnerToken: id, view: DeskViewSchema });
export const NativeOutcomeSchema = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal('applied'), ...NativePerformanceSchema.fields }),
  Schema.Struct({ outcome: Schema.Literals(['rejected', 'unknown']), error: Schema.optionalKey(message) }),
]);

export const InputAttachOutcomeSchema = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal('applied'), ...NativePerformanceSchema.fields, receipt: InputLeaseReceiptSchema }),
  Schema.Struct({ outcome: Schema.Literals(['rejected', 'unknown']), error: Schema.optionalKey(message) }),
]);
export type InputIntentStatus = typeof InputIntentStatusSchema.Type;
export type InputLeaseReceipt = typeof InputLeaseReceiptSchema.Type;
export type InputAttachOutcome = typeof InputAttachOutcomeSchema.Type;
export const decodeInputIntentStatus = Schema.decodeUnknownSync(InputIntentStatusSchema);
export const decodeInputAttachOutcome = Schema.decodeUnknownSync(InputAttachOutcomeSchema);

export type AudioState = typeof AudioStateSchema.Type;
export type AudioGoal = typeof AudioGoalSchema.Type;
export type AudioDecision = typeof AudioDecisionSchema.Type;
export type DeskView = typeof DeskViewSchema.Type;
export type DeskPublication = typeof DeskPublicationSchema.Type;
export type NativePerformance = typeof NativePerformanceSchema.Type;
export type NativeTarget = typeof NativeTargetSchema.Type;
export type NativeOutcome = typeof NativeOutcomeSchema.Type;
export const decodeDeskBootstrap = Schema.decodeUnknownSync(DeskBootstrapSchema);
export const decodeDeskPublication = Schema.decodeUnknownSync(DeskPublicationSchema);
export const decodeAudioDecision = Schema.decodeUnknownSync(AudioDecisionSchema);
export const decodeNativeOutcome = Schema.decodeUnknownSync(NativeOutcomeSchema);

export interface DeskController {
  snapshot(): DeskView;
  subscribe(listener: (publication: DeskPublication) => void): () => void;
  setAudio(goal: AudioGoal): AudioDecision;
  command(target: NativeTarget, input: unknown): Promise<NativeOutcome>;
  takeAudio?(target: NativeTarget, request: import('../performance/take-audio.js').TakeAudioRequest): Promise<Uint8Array>;
  openDemo?(): Promise<{ file: import('node:fs/promises').FileHandle; bytes: number } | null>;
  confirmedRetirement?(target: NativeTarget): NativeEngineRetirementProof | null;
  close(): Promise<void>;
}
