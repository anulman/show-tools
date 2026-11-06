import { Schema } from 'effect';

const text = Schema.NonEmptyString.check(Schema.isMaxLength(4096));
export const HashSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const revision = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/));
const port = Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 }));
export const TargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('live') }),
  Schema.Struct({ kind: Schema.Literal('preview'), worktree: text, worktreeKey: HashSchema, session: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/)) }),
]);
export type Target = typeof TargetSchema.Type;
export const SourceSchema = Schema.Struct({ revision, tree: revision, dirty: Schema.Boolean });
export const BuildInfoSchema = Schema.Struct({ version: Schema.Literal(1), source: SourceSchema });
export const ManifestSchema = Schema.Struct({ cacheId: HashSchema, files: Schema.Array(text) });
export const SnapshotSchema = Schema.Struct({ version: Schema.Literal(1), id: HashSchema, cacheId: HashSchema,
  source: SourceSchema, artifactDigest: HashSchema });
export type Snapshot = typeof SnapshotSchema.Type;
export const RegistrationSchema = Schema.Struct({ id: HashSchema, target: TargetSchema, port,
  current: Schema.NullOr(HashSchema), history: Schema.Array(HashSchema), enabled: Schema.Boolean });
export type Registration = typeof RegistrationSchema.Type;
export const RegistrySchema = Schema.Struct({ version: Schema.Literal(1), repository: text,
  registrations: Schema.Array(RegistrationSchema) });
export type Registry = typeof RegistrySchema.Type;
export const ConfigSchema = Schema.Struct({ version: Schema.Literal(1), repository: text, stateRoot: text,
  controlDirectory: text, livePort: port, previewFirst: port, previewLast: port });
export type Config = typeof ConfigSchema.Type;
export const OwnerSchema = Schema.Struct({ version: Schema.Literal(1), nonce: text, pid: Schema.Int.check(Schema.isGreaterThan(0)) });
export type Owner = typeof OwnerSchema.Type;
export const RequestSchema = Schema.Union([
  Schema.Struct({ command: Schema.Literal('status') }),
  Schema.Struct({ command: Schema.Literal('serve'), target: TargetSchema, snapshot: HashSchema }),
  Schema.Struct({ command: Schema.Literal('stop'), id: HashSchema }),
  Schema.Struct({ command: Schema.Literal('shutdown') }),
]);
export type Request = typeof RequestSchema.Type;
export const StatusSchema = Schema.Struct({ registration: RegistrationSchema,
  runtime: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('serving'), build: SnapshotSchema }),
    Schema.Struct({ kind: Schema.Literal('stopped') }),
    Schema.Struct({ kind: Schema.Literal('blocked'), error: text }),
  ]) });
export type Status = typeof StatusSchema.Type;
export const ResponseSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), owner: OwnerSchema, statuses: Schema.Array(StatusSchema) }),
  Schema.Struct({ ok: Schema.Literal(false), error: text }),
]);
export type Response = typeof ResponseSchema.Type;
export const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown) => Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(input);
