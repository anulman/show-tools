import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import registry from '../../../docs/video-directors/registry.json' with { type: 'json' };

export class SceneAuthoringError extends Error {
  constructor(readonly code: string, message: string, readonly locations: string[] = []) {
    super(message);
    this.name = 'SceneAuthoringError';
  }
}

const registeredSongs = new Set(registry.sessions.map(session => session.songId));
const id = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/));
const songId = id.check(Schema.makeFilter(value => registeredSongs.has(value) || 'Unknown song ID; use a registered director song'));
const text = Schema.String.check(Schema.isMaxLength(1_000_000));
const nonblank = Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(4096));
const integer = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const finite = Schema.Number.check(Schema.isFinite());
const sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const uuid = Schema.String.check(Schema.isUUID());
const unique = (values: readonly string[]) => new Set(values).size === values.length;

export type SongId = typeof songId.Type;
export type SceneId = typeof id.Type;
export type StageId = typeof id.Type;
export type InputId = typeof id.Type;

export const AuthoringStampSchema = Schema.Struct({ databaseId: uuid, generationId: uuid, revision: integer });
export type AuthoringStamp = typeof AuthoringStampSchema.Type;
export const ChartFactsSchema = Schema.Struct({ songId, semanticSha256: sha256, xmlSha256: sha256,
  measureCount: positive, meter: Schema.Struct({ numerator: positive, denominator: positive }) });
export type ChartFacts = typeof ChartFactsSchema.Type;
const chartBinding = Schema.Union([Schema.Struct({ kind: Schema.Literal('unbound') }),
  Schema.Struct({ kind: Schema.Literal('bound'), ...ChartFactsSchema.fields })]);
export type ChartBinding = typeof chartBinding.Type;
const barRange = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('known'), startBar: positive, endBar: positive })
    .check(Schema.makeFilter(range => range.startBar <= range.endBar || 'Known bar range must have startBar <= endBar')),
  Schema.Struct({ kind: Schema.Literal('unresolved'), text }),
]);
export type BarRange = typeof barRange.Type;
const stageBinding = Schema.Union([Schema.Struct({ kind: Schema.Literal('unbound') }),
  Schema.Struct({ kind: Schema.Literal('reference'), id, revision: positive })]);
export type StageBinding = typeof stageBinding.Type;
const occurrence = Schema.Struct({ id, label: nonblank, description: text, range: barRange, stage: stageBinding,
  sourceInputIds: Schema.Array(id).check(Schema.isMaxLength(4096), Schema.makeFilter(unique)) });
export type SceneOccurrence = typeof occurrence.Type;
export const OperatorInputSchema = Schema.Struct({ id, operatorText: text, origin: nonblank });
export type OperatorInput = typeof OperatorInputSchema.Type;
export const SceneDocumentSchema = Schema.Struct({ songId, chart: chartBinding,
  scenes: Schema.Array(occurrence).check(Schema.isMaxLength(10000),
    Schema.makeFilter(scenes => unique(scenes.map(scene => scene.id)) || 'Scene IDs must be unique')),
}).check(Schema.makeFilter(document => document.chart.kind === 'unbound' || document.chart.songId === document.songId
  || 'Chart binding must identify the same song as the scene document'));
export type SceneDocument = typeof SceneDocumentSchema.Type;

const layerSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('unverified'), nodeId: nonblank }),
  Schema.Struct({ kind: Schema.Literal('pinned'), nodeId: nonblank, sha256, nativeGrid: positive, width: positive, height: positive,
    registration: Schema.Struct({ x: finite, y: finite }) }),
]);
const layer = Schema.Struct({ id, role: Schema.Literals(['world','props','foreground','actors','fx']), source: layerSource });
export type LayerRef = typeof layer.Type;
const aspect = Schema.Struct({ aspect: Schema.Literals(['16:9','4:3']), frameNodeId: nonblank,
  fit: Schema.Union([Schema.Struct({ kind: Schema.Literal('pending') }),
    Schema.Struct({ kind: Schema.Literal('verified'), receiptSha256: sha256 })]) });
export type AspectRef = typeof aspect.Type;
export const StageDefinitionSchema = Schema.Struct({ id, label: nonblank, description: text,
  art: Schema.Union([Schema.Struct({ kind: Schema.Literal('unbound') }),
    Schema.Struct({ kind: Schema.Literal('figma'), fileKey: nonblank, rootNodeId: nonblank,
      layers: Schema.Array(layer).check(Schema.isMaxLength(4096),
        Schema.makeFilter(layers => unique(layers.map(layer => layer.id)) || 'Layer IDs must be unique')),
      aspects: Schema.Array(aspect).check(Schema.isMaxLength(2),
        Schema.makeFilter(aspects => unique(aspects.map(aspect => aspect.aspect)) || 'Aspect references must be unique')) })]),
});
export type StageDefinition = typeof StageDefinitionSchema.Type;
export const StageSnapshotSchema = Schema.Struct({ definition: StageDefinitionSchema, revision: positive, digest: sha256 });
export type StageSnapshot = typeof StageSnapshotSchema.Type;
export const SongSnapshotSchema = Schema.Struct({ stamp: AuthoringStampSchema, document: SceneDocumentSchema,
  inputs: Schema.Array(OperatorInputSchema).check(Schema.isMaxLength(10000),
    Schema.makeFilter(inputs => unique(inputs.map(input => input.id)) || 'Operator input IDs must be unique')),
  stages: Schema.Array(StageSnapshotSchema).check(Schema.isMaxLength(10000)),
  review: Schema.Struct({ kind: Schema.Literal('draft') }),
  runtime: Schema.Struct({ kind: Schema.Literal('not-admitted') }),
});
export type SongSnapshot = typeof SongSnapshotSchema.Type;
export const IngestRequestSchema = Schema.Struct({ operationId: id, songId, base: AuthoringStampSchema,
  input: Schema.Union([Schema.Struct({ kind: Schema.Literal('new'), value: OperatorInputSchema }),
    Schema.Struct({ kind: Schema.Literal('existing'), id })]),
  scenes: Schema.Array(occurrence).check(Schema.isMaxLength(10000),
    Schema.makeFilter(scenes => unique(scenes.map(scene => scene.id)) || 'An ingest cannot update a scene ID twice')),
});
export type IngestRequest = typeof IngestRequestSchema.Type;
export const StageRequestSchema = Schema.Struct({ operationId: id, base: AuthoringStampSchema, definition: StageDefinitionSchema });
export type StageRequest = typeof StageRequestSchema.Type;

function parser<S extends Schema.ConstraintDecoder<unknown>>(schema: S, location: string) {
  const decode = Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' });
  return (input: unknown): S['Type'] => {
    try { return decode(input); }
    catch (error) {
      throw new SceneAuthoringError('SCENE_AUTHORING_INVALID_INPUT',
        `${location}: ${error instanceof Error ? error.message : String(error)}`, [location]);
    }
  };
}
export const parseSongId = parser(songId, 'songId');
export const parseSceneId = parser(id, 'sceneId');
export const parseStageId = parser(id, 'stageId');
export const parseInputId = parser(id, 'inputId');
export const parseIngestRequest = parser(IngestRequestSchema, 'ingest');
export const parseStageRequest = parser(StageRequestSchema, 'stage');
export const parseSceneDocument = parser(SceneDocumentSchema, 'document');
export const parseOperatorInput = parser(OperatorInputSchema, 'input');
export const parseStageDefinition = parser(StageDefinitionSchema, 'stage.definition');
export const parseChartFacts = parser(ChartFactsSchema, 'chart');
export const parseStamp = parser(AuthoringStampSchema, 'stamp');
const decodeSnapshot = parser(SongSnapshotSchema, 'snapshot');
const decodeStageSnapshot = parser(StageSnapshotSchema, 'stage.snapshot');

function canonicalJson(value: Schema.Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const entries: (readonly [string, Schema.Json])[] = Object.entries(value);
  entries.sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
  return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
}
export function contentDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(Schema.decodeUnknownSync(Schema.Json)(value))).digest('hex');
}
export function parseStageSnapshot(value: unknown): StageSnapshot {
  const snapshot = decodeStageSnapshot(value);
  if (snapshot.digest !== contentDigest(snapshot.definition)) {
    throw new SceneAuthoringError('SCENE_AUTHORING_DIGEST_MISMATCH', 'Stage snapshot does not match its content digest', ['stage.snapshot.digest']);
  }
  return snapshot;
}
export function parseSnapshot(value: unknown): SongSnapshot {
  const snapshot = decodeSnapshot(value);
  for (const stage of snapshot.stages) parseStageSnapshot(stage);
  const inputs = new Set(snapshot.inputs.map(input => input.id));
  for (const scene of snapshot.document.scenes) for (const inputId of scene.sourceInputIds) {
    if (!inputs.has(inputId)) throw new SceneAuthoringError('SCENE_AUTHORING_MISSING_INPUT',
      `Scene ${scene.id} references absent operator input ${inputId}`, [`scenes.${scene.id}.sourceInputIds`]);
  }
  return snapshot;
}
