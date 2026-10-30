import { Schema } from 'effect';
import { StreetAsset } from './street-assets.js';
import type { PreparedStreetScene, StreetPoofEffect } from './street-score.js';

const finite = Schema.Number.check(Schema.isFinite());
const positive = finite.check(Schema.isGreaterThan(0));
const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const nonnegative = finite.check(Schema.isGreaterThanOrEqualTo(0));
const point = Schema.Struct({ x: finite, y: finite });
const nodeId = Schema.String.check(Schema.isPattern(/^\d+:\d+$/));
const hash = StreetAsset.fields.sha256;
const bounds = Schema.Struct({ left: finite, right: finite, top: finite, bottom: finite });
const FitProfile = Schema.Struct({
  version: Schema.Literal(1), kind: Schema.Literal('poof-scene-fit-profile'),
  fileKey: Schema.NonEmptyString, sceneNodeId: nodeId, templateNodeId: nodeId, actorsNodeId: nodeId,
  width: positiveInteger, height: positiveInteger,
  offsetUnits: Schema.Literal('world-scene-pixels'), scaleUnits: Schema.Literal('world-pixels-per-native-effect-pixel'),
  bodyLayoutSha256: hash, poofCatalog: StreetAsset, characterCatalog: StreetAsset,
  actors: Schema.Array(Schema.Struct({
    code: Schema.NonEmptyString, actorNodeId: nodeId, actorRootId: nodeId,
    bodyAnchor: point, bodyScale: positive,
    bodyFrame: Schema.Struct({ x: finite, y: finite, width: positive, height: positive }),
    offset: Schema.Struct({ x: Schema.Int, y: Schema.Int }), scale: positiveInteger,
    effectOccupiedBounds: bounds, allowedEffectIds: Schema.Array(Schema.NonEmptyString),
  })),
  status: Schema.Literal('approved-source-fit'), geometrySha256: hash,
  verification: Schema.Struct({
    date: Schema.NonEmptyString, scope: Schema.NonEmptyString,
    inputDraftSha256: hash, independentReviewSha256: hash,
    nativeSamplerCommit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{7,40}$/)),
    fixtureAlternatives: Schema.Array(Schema.NonEmptyString), rawActivityEdgesPerFixture: positiveInteger,
    fixtureCount: positiveInteger, combinedSourceMaskChecks: positiveInteger, effectFrameBoundsChecks: positiveInteger,
    sourceMasks: Schema.Literal('PASS'), bounds: Schema.Literal('PASS'),
    admittedVariantsExercised: Schema.Literal('PASS'), liveFigmaBodyRegistration: Schema.Literal('PASS'),
    peakComposition: Schema.Struct({ verdict: Schema.Literal('PASS-limited'),
      evidence: Schema.Array(Schema.Struct({ actor: Schema.NonEmptyString, count: nonnegative })),
      observation: Schema.NonEmptyString }),
    reports: Schema.Array(Schema.Struct({ sha256: hash, sceneSha256: hash })),
    limits: Schema.Array(Schema.NonEmptyString),
  }),
});
export type StreetFitProfile = typeof FitProfile.Type;
export { FitProfile as StreetFitProfileSchema };
const decodeProfile = Schema.decodeUnknownSync(FitProfile);

export function parseStreetFitProfile(input: unknown, context: {
  scene: PreparedStreetScene; effects: readonly StreetPoofEffect[];
  poofCatalogSha256: string; characterCatalogSha256: string;
}): StreetFitProfile {
  const profile = decodeProfile(input);
  if (profile.poofCatalog.sha256 !== context.poofCatalogSha256 || profile.characterCatalog.sha256 !== context.characterCatalogSha256) {
    throw new Error('Street fit catalog pins differ from the supplied releases');
  }
  if (profile.width !== context.scene.width || profile.height !== context.scene.height) throw new Error('Street fit canvas differs from the scene');
  const cast = new Map(context.scene.actors.map(actor => [actor.characterId, actor]));
  if (profile.actors.length !== cast.size || new Set(profile.actors.map(actor => actor.code)).size !== cast.size) throw new Error('Street fit needs the exact unique scene cast');
  if (new Set(profile.actors.map(actor => actor.actorNodeId)).size !== profile.actors.length) throw new Error('Street fit repeats an actor node');
  const effectIds = new Set(context.effects.map(effect => effect.id));
  for (const actor of profile.actors) {
    const body = cast.get(actor.code);
    if (!body) throw new Error(`Street fit character ${actor.code} is outside the scene cast`);
    if (actor.actorRootId !== profile.actorsNodeId) throw new Error(`${actor.code}: Street fit actor root differs from the scene actor root`);
    if (actor.bodyAnchor.x !== body.placement.x || actor.bodyAnchor.y !== body.placement.y || actor.bodyScale !== body.placement.scale) {
      throw new Error(`${actor.code}: Street fit must preserve body anchor and scale`);
    }
    if (!actor.allowedEffectIds.length || new Set(actor.allowedEffectIds).size !== actor.allowedEffectIds.length || actor.allowedEffectIds.some(id => !effectIds.has(id))) {
      throw new Error(`${actor.code}: Street fit needs unique admitted effects from the supplied release`);
    }
    const occupied = actor.effectOccupiedBounds;
    if (occupied.left < 0 || occupied.top < 0 || occupied.right > profile.width || occupied.bottom > profile.height || occupied.left >= occupied.right || occupied.top >= occupied.bottom) {
      throw new Error(`${actor.code}: Street fit occupied bounds leave the scene`);
    }
  }
  return profile;
}
