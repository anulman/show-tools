import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Schema } from 'effect';
import sharp from 'sharp';

const Registry = Schema.Struct({ characters: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, publishedAvatarPath: Schema.NonEmptyString })) });
const Manifest = Schema.Struct({ version: Schema.Literal(1), characters: Schema.Array(Schema.Struct({
  id: Schema.NonEmptyString, path: Schema.NonEmptyString, sha256: Schema.NonEmptyString,
  width: Schema.Literal(640), height: Schema.Literal(800),
  qualityStatus: Schema.Literals(['pixel-final', 'gallery-preview']),
  figmaPoseRef: Schema.NonEmptyString,
})) });
const registry = Schema.decodeUnknownSync(Registry)(JSON.parse(await readFile('assets/video/characters.json', 'utf8')));
const manifest = Schema.decodeUnknownSync(Manifest)(JSON.parse(await readFile('assets/video/avatars/manifest.json', 'utf8')));
for (const records of [registry.characters, manifest.characters]) {
  if (records.length !== 51 || new Set(records.map(record => record.id)).size !== 51) throw new Error('Expected51unique character IDs');
}
for (const character of registry.characters) {
  const entry = manifest.characters.find(avatar => avatar.id === character.id);
  if (!entry || entry.path !== character.publishedAvatarPath || entry.path !== `assets/video/avatars/${character.id}.png`) throw new Error(`${character.id}: avatar contract mismatch`);
  const bytes = await readFile(entry.path);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`${character.id}: published pixels changed`);
  const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (pixels.info.width !== entry.width || pixels.info.height !== entry.height) throw new Error(`${character.id}: canvas mismatch`);
  let hasOpaque = false, hasTransparent = false;
  for (let offset = 3; offset < pixels.data.length; offset += 4) {
    const alpha = pixels.data[offset];
    if (alpha === 255) hasOpaque = true;
    else if (alpha === 0) hasTransparent = true;
    else throw new Error(`${character.id}: fractional alpha`);
  }
  if (!hasOpaque || !hasTransparent) throw new Error(`${character.id}: empty or opaque canvas`);
}
process.stdout.write(JSON.stringify({ avatars: manifest.characters.length, hashesVerified: true, pixelFinal: manifest.characters.filter(c => c.qualityStatus === 'pixel-final').length }));
