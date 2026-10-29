import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Schema } from 'effect';
import sharp from 'sharp';

const Character = Schema.Struct({ id: Schema.NonEmptyString, label: Schema.NonEmptyString, figmaRef: Schema.NonEmptyString });
const Registry = Schema.Struct({ version: Schema.Literal(1), identityKey: Schema.Literal('id'), characters: Schema.Array(Character) });
const Pose = Schema.Struct({ path: Schema.NonEmptyString, sha256: Schema.NonEmptyString });
const Model = Schema.Struct({ code: Schema.NonEmptyString, prompt: Schema.NonEmptyString, sourceStrip: Schema.Unknown, references: Schema.Unknown, poses: Schema.Array(Pose), visualReview: Schema.Literal('passed') });
const ModelRef = Schema.Struct({ name: Schema.NonEmptyString, poses: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, name: Schema.NonEmptyString })) });
const Figma = Schema.Struct({ characters: Schema.Struct({ models: Schema.Array(ModelRef) }) });
const FinalDrawing = Schema.Struct({ path: Schema.NonEmptyString, sha256: Schema.NonEmptyString, figmaComponentId: Schema.NonEmptyString });
const FinalFamily = Schema.Struct({ code: Schema.NonEmptyString, stage: Schema.Literal('pixel-final'), drawings: Schema.Array(FinalDrawing), sourceProvenance: Schema.NonEmptyString, styleReview: Schema.Unknown });
const FinalReview = Schema.Struct({ families: Schema.Array(FinalFamily) });
const registryPath = 'assets/video/characters.json';
const directory = 'assets/video/avatars';
const registry = Schema.decodeUnknownSync(Registry)(JSON.parse(await readFile(registryPath, 'utf8')));
const figma = Schema.decodeUnknownSync(Figma)(JSON.parse(await readFile('assets/video/figma.json', 'utf8')));
const finals = Schema.decodeUnknownSync(FinalReview)(JSON.parse(await readFile('assets/video/motion/pixel-final/review.json', 'utf8')));
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
if (registry.characters.length !== 51 || new Set(registry.characters.map(c => c.id)).size !== 51) throw new Error('Expected 51 unique canonical identities');
await mkdir(directory, { recursive: true });
const entries = [];
for (const character of registry.characters) {
  const family = finals.families.find(f => f.code === character.id);
  let selection;
  if (family) {
    const drawing = family.drawings[0];
    if (!drawing) throw new Error(`${character.id}: no finished drawing`);
    selection = {
      sourcePath: drawing.path, sourceSha256: drawing.sha256, figmaPoseId: drawing.figmaComponentId,
      qualityStatus: 'pixel-final',
      provenance: { sourceDefinition: family.sourceProvenance, generation: JSON.parse(await readFile(family.sourceProvenance, 'utf8')), styleReview: family.styleReview },
    };
  } else {
    const modelPath = `assets/video/expansion/models/${character.id.toLowerCase()}-8bit-midfi.json`;
    const model = Schema.decodeUnknownSync(Model)(JSON.parse(await readFile(modelPath, 'utf8')));
    const drawing = model.poses[0];
    const component = figma.characters.models.find(m => m.name === `Actor/${character.id}/Mid-fi`)?.poses.find(p => p.name === 'Pose=0');
    if (model.code !== character.id || !drawing || !component) throw new Error(`${character.id}: missing source pose0`);
    selection = {
      sourcePath: drawing.path, sourceSha256: drawing.sha256, figmaPoseId: component.id,
      qualityStatus: 'gallery-preview',
      provenance: { sourceDefinition: modelPath, generation: { prompt: model.prompt, sourceStrip: model.sourceStrip, references: model.references }, priorReview: model.visualReview },
    };
  }
  const data = await readFile(selection.sourcePath);
  if (sha(data) !== selection.sourceSha256) throw new Error(`${character.id}: source changed`);
  const pixels = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (pixels.info.width !== 640 || pixels.info.height !== 800) throw new Error(`${character.id}: wrong source canvas`);
  let opaque = 0;
  let left = 640, top = 800, right = -1, bottom = -1;
  for (let y = 0; y < 800; y++) for (let x = 0; x < 640; x++) {
    const alpha = pixels.data[(y * 640 + x) * 4 + 3];
    if (alpha !== 0 && alpha !== 255) throw new Error(`${character.id}: source alpha not binary`);
    if (alpha === 255) { opaque++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  if (!opaque || left < 10 || top < 10 || right >= 630 || bottom >= 790) throw new Error(`${character.id}: empty or clipped artwork`);
  const path = `${directory}/${character.id}.png`;
  await writeFile(path, data);
  entries.push({ id: character.id, label: character.label, path, sha256: sha(data), width: 640, height: 800,
    ...selection, figmaPoseRef: `https://www.figma.com/design/QWreOYAnaje2LlywefJFiK?node-id=${selection.figmaPoseId.replace(':', '-')}`,
    opaqueBounds: { left, top, right, bottom },
  });
}
await writeFile(`${directory}/manifest.json`, JSON.stringify({ version: 1, usage: 'Static UI avatars only; gallery-preview is not finished sprite/video certification.', transformation: 'Byte-for-byte copies; no redraw, resize or new generation.', characters: entries }, null, 2) + '\n');
await writeFile(registryPath, JSON.stringify({ ...registry,
  artworkNote: 'Existing source-derived static UI avatars. Five repainted snapshots are pixel-final;46 gallery previews retain their earlier review and require repaint before finished sprite/video use.',
  avatarManifest: `${directory}/manifest.json`,
  characters: registry.characters.map(c => ({ ...c, publishedAvatarPath: `${directory}/${c.id}.png` })),
}, null, 2) + '\n');
for (let page = 0; page < Math.ceil(entries.length / 18); page++) {
  const group = entries.slice(page * 18, page * 18 + 18);
  const layers = [];
  for (const [index, entry] of group.entries()) {
    const x = (index % 6) * 200, y = Math.floor(index / 6) * 280;
    const image = await sharp(entry.path).resize(192, 240, { kernel: 'nearest' }).png().toBuffer();
    layers.push({ input: image, left: x + 4, top: y });
    const label = Buffer.from(`<svg width="200" height="40"><text x="8" y="15" fill="#fff" font-family="Arial" font-size="12">${entry.id} ${entry.label.replaceAll('&', '&amp;')}</text><text x="8" y="32" fill="#aaa" font-family="Arial" font-size="11">${entry.qualityStatus}</text></svg>`);
    layers.push({ input: label, left: x, top: y + 240 });
  }
  await sharp({ create: { width: 1200, height: 840, channels: 4, background: '#181b24' } }).composite(layers).png().toFile(`/private/tmp/avatar-review-${page + 1}.png`);
}
process.stdout.write(JSON.stringify({ avatars: entries.length, pixelFinal: entries.filter(e => e.qualityStatus === 'pixel-final').length, copiedExactly: true }));
