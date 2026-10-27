import { Schema } from 'effect';

const channelId = Schema.Literals(['L1', 'L2', 'R1', 'R2']);
const nonnegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const positiveInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const gain = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const identifier = Schema.String.check(Schema.isPattern(/^[\w-]{8,128}$/));
export const ControlSchema = Schema.Union([
  Schema.Struct({ id: Schema.Literals(['L1', 'L2', 'R1', 'R2', 'mushroom', 'tempo']) }),
  Schema.Struct({ id: Schema.Literal('knob'), value: Schema.Number.check(Schema.isFinite()) }),
]);
export const ControlMessageSchema = Schema.Struct({ commandId: identifier, control: ControlSchema });
export const ProducerSchema = Schema.Struct({ producerId: identifier });
const chart = Schema.Struct({ spreadsheetId: Schema.NonEmptyString, sheetId: nonnegativeInteger,
  columns: Schema.Array(positiveInteger), leadInColumn: positiveInteger });
const light = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(['off', 'cue', 'steady']) }),
  Schema.Struct({ kind: Schema.Literal('releasing'), remainingMs: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)) }),
]);
export const StateSchema = Schema.Struct({
  phase: Schema.Literals(['idle', 'count-in', 'playing', 'ended']),
  bar: Schema.NullOr(positiveInteger), beat: Schema.NullOr(positiveInteger), countInRemaining: nonnegativeInteger,
  bpm: Schema.Number.check(Schema.isBetween({ minimum: 40, maximum: 240 })),
  startBar: positiveInteger, endBar: positiveInteger, loop: Schema.Boolean, automatic: Schema.Boolean,
  click: Schema.Boolean, selectedChannel: channelId, runId: Schema.NonEmptyString, seq: nonnegativeInteger,
  channels: Schema.Array(Schema.Struct({ id: channelId, gain, muted: Schema.Boolean, looping: Schema.Boolean, ready: Schema.Boolean, status: Schema.Literals(['empty', 'ready', 'armed', 'recording', 'stopping', 'looping']), light })),
  looping: Schema.Array(channelId), recording: Schema.NullOr(Schema.Struct({ id: channelId, status: Schema.Literals(['armed', 'recording', 'stopping']) })),
  microphone: Schema.Boolean, error: Schema.NullOr(Schema.String),
  lifecycle: Schema.optionalKey(Schema.String), chart: Schema.optionalKey(chart),
});
export const EnvelopeSchema = Schema.Struct({
  v: Schema.Literal(1), runId: Schema.NonEmptyString, seq: nonnegativeInteger,
  type: Schema.Literals(['state', 'beat', 'control', 'fault', 'tempo-hit']), state: StateSchema,
  frame: Schema.optionalKey(Schema.Number), sampleRate: Schema.optionalKey(Schema.Number),
  commandId: Schema.optionalKey(Schema.String), control: Schema.optionalKey(ControlSchema),
  applied: Schema.optionalKey(Schema.Boolean), error: Schema.optionalKey(Schema.String),
  tempoHit: Schema.optionalKey(Schema.Struct({ beatHint: Schema.NullOr(Schema.Literal(1)), source: Schema.Literals(['pedal', 'chart']), estimated: Schema.Boolean })),
  cueIndex: Schema.optionalKey(nonnegativeInteger),
});
export type PerformanceEnvelope = typeof EnvelopeSchema.Type;
export const validateEnvelope = Schema.decodeUnknownSync(EnvelopeSchema);
export const parseControlMessage = Schema.decodeUnknownSync(ControlMessageSchema);
export const parseProducer = Schema.decodeUnknownSync(ProducerSchema);
