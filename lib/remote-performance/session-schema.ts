import { Schema } from 'effect';
import { NativeEventSchema, NativeStateSchema, SongSchema, LightPublicationSchema } from './native-schema.js';

const id = Schema.NonEmptyString.check(Schema.isMaxLength(256));
const revision = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,19})$/));
const message = Schema.String.check(Schema.isMaxLength(8192));
export const AttemptSchema = id.pipe(Schema.brand('AudioAttempt'));
export const ServerEpochSchema = id.pipe(Schema.brand('DeskEpoch'));
export const NativeEpochSchema = id.pipe(Schema.brand('NativeEpoch'));
export const DeskRevisionSchema = revision.pipe(Schema.brand('DeskRevision'));
export const NativeRevisionSchema = revision.pipe(Schema.brand('NativeRevision'));
export const NativePerformanceSchema = Schema.Struct({
  hostEpoch: NativeEpochSchema,
  revision: NativeRevisionSchema,
  state: NativeStateSchema,
  lights: LightPublicationSchema,
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
export const NativeTargetSchema = Schema.Struct({ attempt: AttemptSchema, hostEpoch: NativeEpochSchema });
export const AudioGoalSchema = Schema.Literals(['on', 'off']);
export const AudioDecisionSchema = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal('accepted'), view: DeskViewSchema }),
  Schema.Struct({ outcome: Schema.Literal('rejected'), error: message, view: DeskViewSchema }),
]);
export const DeskBootstrapSchema = Schema.Struct({ sessionId: id, view: DeskViewSchema });
export const NativeOutcomeSchema = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal('applied'), ...NativePerformanceSchema.fields }),
  Schema.Struct({ outcome: Schema.Literals(['rejected', 'unknown']), error: Schema.optionalKey(message) }),
]);

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
  close(): Promise<void>;
}
