import { access, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { verifyPublished } from './published.mjs';

export const Artifact = Schema.Struct({
  path: Schema.String,
  kind: Schema.Literals(['prototype', 'process-evidence', 'runtime', 'code', 'regression-fixture']),
  state: Schema.Literals(['active', 'awaiting-promotion', 'abandoned', 'completed']),
  owners: Schema.Array(Schema.String),
  lessonsPath: Schema.String,
  requiredBy: Schema.Array(Schema.String),
  referencesReviewed: Schema.Boolean,
});

const DependencyInventory = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  protectedPaths: Schema.Array(Schema.Struct({ path: Schema.String, requiredBy: Schema.Array(Schema.String) })),
});

function overlaps(first: string, second: string) {
  const a = resolve(first), b = resolve(second);
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
}

export function expiryDecision(artifact: typeof Artifact.Type, context: {
  promoted: ReadonlySet<string>;
  protectedPaths: ReadonlySet<string>;
  lessonsAvailable: boolean;
}) {
  const reasons = [];
  if (artifact.kind === 'runtime' || artifact.kind === 'code' || artifact.kind === 'regression-fixture' || overlaps(artifact.path, 'assets/video/published')) reasons.push('Retained runtime/code/meaningful regression artifact');
  if (artifact.state === 'active' || artifact.state === 'awaiting-promotion') reasons.push('Active or unpromoted work');
  if (!artifact.referencesReviewed || artifact.requiredBy.length || [...context.protectedPaths].some(path => overlaps(artifact.path, path))) reasons.push('Still required by tooling or a pinned release, or dependencies not reviewed');
  if (!context.lessonsAvailable) reasons.push('Durable lesson not recorded');
  if (artifact.kind === 'process-evidence' && (!artifact.owners.length || artifact.owners.some(owner => !context.promoted.has(owner)))) reasons.push('Every selected owner needs a verified canonical handoff');
  if (artifact.kind === 'prototype' && artifact.state !== 'abandoned') reasons.push('Prototype has not been intentionally abandoned');
  return { path: artifact.path, eligible: reasons.length === 0, reasons };
}

export async function planExpiry(artifactsPath: string, inventoryPath: string) {
  const input: unknown = JSON.parse(await readFile(artifactsPath, 'utf8'));
  const artifacts = Schema.decodeUnknownSync(Schema.Array(Artifact))(input);
  const dependencyInput: unknown = JSON.parse(await readFile(inventoryPath, 'utf8'));
  const inventory = Schema.decodeUnknownSync(DependencyInventory)(dependencyInput);
  if (inventory.protectedPaths.some(entry => !entry.requiredBy.length)) throw new Error('Protected dependencies require an owner');
  const indexInput: unknown = JSON.parse(await readFile('assets/video/published/index.json', 'utf8'));
  const index = Schema.decodeUnknownSync(Schema.Struct({ publications: Schema.Array(Schema.Struct({ manifest: Schema.String })) }))(indexInput);
  const publications = await Promise.all(index.publications.map(item => verifyPublished(item.manifest)));
  const promoted = new Set(publications.map(publication => publication.motionId));
  const protectedPaths = new Set(inventory.protectedPaths.map(entry => entry.path));
  const decisions = await Promise.all(artifacts.map(async artifact => {
    const lessonsAvailable = await access(artifact.lessonsPath).then(() => true, () => false);
    return expiryDecision(artifact, { promoted, protectedPaths, lessonsAvailable });
  }));
  return { mode: 'plan-only', deleted: 0, decisions };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const [artifactsPath, inventoryPath] = process.argv.slice(2);
  if (!artifactsPath || !inventoryPath) throw new Error('Usage: retention.mts ARTIFACT_LIST.json DEPENDENCY_INVENTORY.json (plan only; deletes nothing)');
  process.stdout.write(JSON.stringify(await planExpiry(artifactsPath, inventoryPath), null, 2) + '\n');
}
