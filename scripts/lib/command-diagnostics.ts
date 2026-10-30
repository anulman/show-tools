import { Schema } from 'effect';

const nonblank = Schema.String.check(Schema.isPattern(/\S/));
const details = {
  code: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]*$/)),
  message: nonblank,
  nextSteps: Schema.NonEmptyArray(nonblank),
  locations: Schema.Array(nonblank),
};

const ProductFailureSchema = Schema.Struct({ schemaVersion: Schema.Literal(1), status: Schema.Literal('blocked'), ...details });
const ChiefHandoffSchema = Schema.Struct({ schemaVersion: Schema.Literal(1), status: Schema.Literal('needs-chief'), ...details });
export const CommandFailureSchema = Schema.Union([ProductFailureSchema, ChiefHandoffSchema]);
export type CommandFailure = typeof CommandFailureSchema.Type;
export type FailureDetails = Pick<CommandFailure, 'code' | 'message' | 'nextSteps' | 'locations'>;
export const parseCommandFailure = Schema.decodeUnknownSync(CommandFailureSchema);

export function productFailure(input: FailureDetails): typeof ProductFailureSchema.Type {
  return Schema.decodeUnknownSync(ProductFailureSchema)({ schemaVersion: 1, status: 'blocked', ...input });
}

export function chiefHandoff(input: FailureDetails): typeof ChiefHandoffSchema.Type {
  return Schema.decodeUnknownSync(ChiefHandoffSchema)({ schemaVersion: 1, status: 'needs-chief', ...input });
}

export function commandFailureExitCode(failure: CommandFailure): 2 | 3 {
  return failure.status === 'blocked' ? 2 : 3;
}

export function formatCommandFailure(failure: CommandFailure, format: 'human' | 'json'): string {
  if (format === 'json') return JSON.stringify(failure) + '\n';
  const heading = failure.status === 'blocked' ? 'Blocked' : 'Chief handoff required';
  const locations = failure.locations.map(location => `Location: ${location}\n`).join('');
  return `${heading} [${failure.code}]: ${failure.message}\n${locations}Next steps:\n`
    + failure.nextSteps.map(step => `- ${step}\n`).join('');
}
