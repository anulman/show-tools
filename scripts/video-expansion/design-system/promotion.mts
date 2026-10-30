import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { digest, normalizedPixels, verifyPublished, Published } from './published.mjs';

const Live = Schema.Struct({
  rootNodeId: Schema.String,
  duration: Schema.Number,
  tracks: Schema.Array(Schema.Struct({
    componentId: Schema.String,
    track: Schema.Struct({ keyframes: Schema.Array(Schema.Struct({
      timelinePosition: Schema.Number,
      easing: Schema.Struct({ type: Schema.Literal('HOLD') }),
      value: Schema.Struct({ value: Schema.Literals([0, 1]) }),
    })) }),
  })),
});

export async function nativeFromCanonical(path: string, publication: typeof Published.Type) {
  const { width, height } = publication.nativeGrid;
  const matrix = publication.nativeToFigma;
  const source = await normalizedPixels(path), result = Buffer.alloc(width * height * 4);
  if (matrix.length !== 2 || matrix.some(row => row.length !== 3) || matrix[0][1] || matrix[1][0] || matrix[0][0] <= 0 || matrix[1][1] <= 0) throw new Error('Unsupported canonical pixel transform');
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor((x + .5) * matrix[0][0] + matrix[0][2]);
    const sy = Math.floor((y + .5) * matrix[1][1] + matrix[1][2]);
    if (sx >= 0 && sy >= 0 && sx < source.width && sy < source.height) {
      const at = (sy * source.width + sx) * 4;
      source.data.copy(result, (y * width + x) * 4, at, at + 4);
    }
  }
  return result;
}

export function verifyTiming(publication: typeof Published.Type, input: unknown) {
  const live = Schema.decodeUnknownSync(Live)(input);
  const { durationSeconds, referenceBpm, timingSamples } = publication.reexport;
  if (live.rootNodeId !== publication.canonical.timelineRootId || live.duration !== durationSeconds || live.tracks.length !== publication.drawings.length) throw new Error('Canonical timeline changed');
  const ids = new Set(live.tracks.map(track => track.componentId));
  if (ids.size !== publication.drawings.length || publication.drawings.some(drawing => !ids.has(drawing.nodeId))) throw new Error('Canonical pose track identity changed');
  const samples = new Set(Array.from({ length: timingSamples }, (_, index) => durationSeconds * index / (timingSamples - 1)));
  for (const { track } of live.tracks) {
    if (track.keyframes[0]?.timelinePosition !== 0) throw new Error('Canonical track has no initial HOLD');
    for (const [index, key] of track.keyframes.entries()) {
      if (key.timelinePosition < 0 || key.timelinePosition > durationSeconds || index > 0 && key.timelinePosition <= track.keyframes[index - 1].timelinePosition) throw new Error('Canonical track keys are unordered or out of range');
      samples.add(key.timelinePosition);
    }
  }
  for (let cycle = 0; cycle * publication.cycleBeats * 60 / referenceBpm < durationSeconds; cycle++) {
    for (const key of publication.keyframes) {
      const time = (cycle * publication.cycleBeats + key.atBeat) * 60 / referenceBpm;
      if (time <= durationSeconds) samples.add(time);
    }
  }
  for (const time of samples) {
    const beat = time === durationSeconds ? 0 : time * referenceBpm / 60 % publication.cycleBeats;
    const expected = [...publication.keyframes].reverse().find(key => key.atBeat <= beat + 1e-6);
    const active = live.tracks.filter(({ track }) => [...track.keyframes].reverse().find(key => key.timelinePosition <= time + 1e-6)?.value.value === 1);
    if (!expected || active.length !== 1 || active[0].componentId !== publication.drawings[expected.pose].nodeId) throw new Error('Canonical re-export HOLD timing failed');
  }
  return samples.size;
}

export async function checkCanonicalExport(packageDirectory: string, exportDirectory: string) {
  const publication = await verifyPublished(join(packageDirectory, 'promotion.json'));
  let layers = 0;
  for (const drawing of publication.drawings) {
    const raw = await nativeFromCanonical(join(exportDirectory, `pose-${drawing.index}.svg`), publication);
    if (digest(raw) !== drawing.pixelSha256) throw new Error('Canonical re-export pixel parity failed');
    for (const [kind, layer] of Object.entries(drawing.layers)) {
      const raw = await nativeFromCanonical(join(exportDirectory, `${kind}-${drawing.index}.svg`), { ...publication, nativeToFigma: [[1, 0, 0], [0, 1, 0]] });
      if (digest(raw) !== layer.pixelSha256) throw new Error('Canonical layer pixel parity failed');
      layers++;
    }
  }
  const motion: unknown = JSON.parse(await readFile(join(exportDirectory, 'motion.json'), 'utf8'));
  const timingSamples = verifyTiming(publication, motion);
  return { status: 'PASS', motionId: publication.motionId, poses: publication.drawings.length, layers, timingSamples, rawApprovalDependencies: 0 };
}

async function reexportScripts(packageDirectory: string, outputDirectory: string) {
  const publication = await verifyPublished(join(packageDirectory, 'promotion.json'));
  await mkdir(outputDirectory, { recursive: true });
  for (const drawing of publication.drawings) {
    const ids = { pose: drawing.nodeId, ...Object.fromEntries(Object.entries(drawing.layers).map(([kind, layer]) => [kind, layer.nodeId])) };
    const code = `const p=await figma.getNodeByIdAsync('31:51');await figma.setCurrentPageAsync(p);const ids=${JSON.stringify(ids)};const out={};for(const [kind,id]of Object.entries(ids)){const n=await figma.getNodeByIdAsync(id);if(!n)throw Error('Canonical node missing');out[kind]=('children'in n&&n.children.length===0&&n.fills.every(f=>f.visible===false||f.opacity===0)&&n.strokes.every(s=>s.visible===false||s.opacity===0))?'<svg xmlns="http://www.w3.org/2000/svg" width="'+n.width+'" height="'+n.height+'"/>':await n.exportAsync({format:'SVG_STRING'});}return out;`;
    await writeFile(join(outputDirectory, `read-pose-${drawing.index}.txt`), code + '\n');
  }
  const ids = publication.drawings.map(drawing => drawing.nodeId);
  const code = `const p=await figma.getNodeByIdAsync('54:1383');await figma.setCurrentPageAsync(p);const root=await figma.getNodeByIdAsync('${publication.canonical.timelineRootId}');const ids=${JSON.stringify(ids)};const instances=root.findAllWithCriteria({types:['INSTANCE']});const masters=await Promise.all(instances.map(n=>n.getMainComponentAsync()));return{rootNodeId:root.id,duration:root.timelines[0].duration,tracks:instances.flatMap((n,i)=>masters[i]&&ids.includes(masters[i].id)?[{componentId:masters[i].id,track:n.manualKeyframeTracks.OPACITY}]:[])};`;
  await writeFile(join(outputDirectory, 'read-motion.txt'), code + '\n');
  return { fileKey: publication.canonical.fileKey, outputDirectory, poses: publication.drawings.length };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const [operation, packageDirectory, outputDirectory] = process.argv.slice(2);
  if (!packageDirectory || !outputDirectory) throw new Error('Usage: promotion.mts reexport-scripts|check PACKAGE_DIRECTORY TEMP_EXPORT_DIRECTORY');
  const result = operation === 'reexport-scripts' ? await reexportScripts(packageDirectory, outputDirectory)
    : operation === 'check' ? await checkCanonicalExport(packageDirectory, outputDirectory)
    : (() => { throw new Error('Expected reexport-scripts or check'); })();
  process.stdout.write(JSON.stringify(result) + '\n');
}
