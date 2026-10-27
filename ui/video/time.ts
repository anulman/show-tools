import { Schema } from 'effect';

const finite = Schema.Number.check(Schema.isFinite());
const nonnegative = finite.check(Schema.isGreaterThanOrEqualTo(0));
const PerformanceSample = Schema.Struct({
  engineSessionId: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  epoch: nonnegative,
  sourceSequence: nonnegative,
  loopIteration: nonnegative,
  sourceFrame: nonnegative,
  sampleRate: finite.check(Schema.isGreaterThan(0)),
  quarterPosition: finite,
  beatUnit: Schema.Literals([4, 8]),
  discontinuity: Schema.Literals(['none', 'start', 'seek', 'loop', 'resync']),
});

export type PerformanceTime = typeof PerformanceSample.Type;
export type SceneTime = { readonly kind: 'preview'; readonly seconds: number } | { readonly kind: 'performance'; readonly sample: PerformanceTime };
export const parsePerformanceTime = Schema.decodeUnknownSync(PerformanceSample);
export const parsePreviewSeconds = Schema.decodeUnknownSync(nonnegative);
export const LOOP_SECONDS = 4;

export function quarterPosition(time: SceneTime): number {
  return time.kind === 'preview' ? time.seconds * 2 : time.sample.quarterPosition;
}
