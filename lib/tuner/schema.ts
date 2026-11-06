import { Schema } from 'effect';

const finite = Schema.Number.check(Schema.isFinite());
const uint32 = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff }));
const root = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 115 }));
const scale = Schema.Literals(['major', 'natural-minor', 'chromatic']);
const note = Schema.Struct({ midi: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 127 })),
  letter: Schema.Literals(['A', 'B', 'C', 'D', 'E', 'F', 'G']),
  accidental: Schema.Int.check(Schema.isBetween({ minimum: -2, maximum: 2 })),
  octave: Schema.Int.check(Schema.isBetween({ minimum: -1, maximum: 9 })) });
export const TunerStateSchema = Schema.Struct({
  revision: uint32, root, scale, step: Schema.Int,
  targets: Schema.Array(note).check(Schema.isMinLength(2), Schema.isMaxLength(13)), complete: Schema.Boolean, listening: Schema.Boolean,
  preview: Schema.Union([Schema.Struct({ kind: Schema.Literal('silent') }),
    Schema.Struct({ kind: Schema.Literals(['note', 'scale']), step: Schema.Int })]),
  pitch: Schema.Union([
    Schema.Struct({ kind: Schema.Literals(['off', 'microphone', 'warming', 'reference', 'unvoiced']) }),
    Schema.Struct({ kind: Schema.Literal('pitched'), frequency: finite.check(Schema.isGreaterThan(0)), midi: finite,
      cents: finite.check(Schema.isBetween({ minimum: -50, maximum: 50 })),
      confidence: finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })), rms: finite.check(Schema.isGreaterThanOrEqualTo(0)), note }),
  ]),
}).check(Schema.makeFilter(state => state.step >= 0 && state.step < state.targets.length
  && (state.preview.kind === 'silent' || (state.preview.step >= 0 && state.preview.step < state.targets.length))
  && (state.pitch.kind !== 'pitched' || (state.listening && state.preview.kind === 'silent'))
  || 'Inconsistent tuner observation'));
export const TunerCommandSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('configure'), expectedRevision: uint32, root, scale }),
  Schema.Struct({ kind: Schema.Literals(['cue', 'play-scale', 'silence', 'confirm', 'close']), expectedRevision: uint32 }),
  Schema.Struct({ kind: Schema.Literal('listen'), expectedRevision: uint32, enabled: Schema.Boolean }),
]);
