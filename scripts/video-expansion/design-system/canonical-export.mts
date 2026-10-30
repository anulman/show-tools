import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Schema } from 'effect';
import { digest, normalizedPixels, verifyPublished, Published, CanonicalViolation } from './published.mjs';

const Live = Schema.Struct({
  rootNodeId: Schema.String,
  duration: Schema.Number,
  scene: Schema.Record(Schema.String, Schema.Unknown),
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
  if (matrix.length !== 2 || matrix.some(row => row.length !== 3 || row.some(value => !Number.isInteger(value))) || matrix[0][1] || matrix[1][0] || matrix[0][0] <= 0 || matrix[1][1] <= 0) throw new CanonicalViolation('Unsupported canonical pixel transform');
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor((x + .5) * matrix[0][0] + matrix[0][2]);
    const sy = Math.floor((y + .5) * matrix[1][1] + matrix[1][2]);
    if (sx >= 0 && sy >= 0 && sx < source.width && sy < source.height) {
      const at = (sy * source.width + sx) * 4;
      source.data.copy(result, (y * width + x) * 4, at, at + 4);
    }
    if (result[(y * width + x) * 4 + 3] && (x * matrix[0][0] + matrix[0][2] < 0 || y * matrix[1][1] + matrix[1][2] < 0 || (x + 1) * matrix[0][0] + matrix[0][2] > source.width || (y + 1) * matrix[1][1] + matrix[1][2] > source.height)) throw new CanonicalViolation('Occupied native pixel cell is clipped by the canonical canvas');
  }
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const nx = Math.floor((x - matrix[0][2]) / matrix[0][0]);
    const ny = Math.floor((y - matrix[1][2]) / matrix[1][1]);
    const inside = nx >= 0 && ny >= 0 && nx < width && ny < height;
    for (let channel = 0; channel < 4; channel++) {
      const expected = inside ? result[(ny * width + nx) * 4 + channel] : 0;
      if (source.data[(y * source.width + x) * 4 + channel] !== expected) throw new CanonicalViolation('Canonical geometry differs inside native pixel cells or registration margins');
    }
  }
  return result;
}

export function verifyTiming(publication: typeof Published.Type, input: unknown) {
  const live = Schema.decodeUnknownSync(Live)(input);
  if (digest(Buffer.from(JSON.stringify(live.scene))) !== publication.reexport.sceneSha256) throw new CanonicalViolation('Canonical visible scene contract changed');
  const { durationSeconds, referenceBpm, timingSamples } = publication.reexport;
  if (live.rootNodeId !== publication.canonical.timelineRootId || live.duration !== durationSeconds || live.tracks.length !== publication.drawings.length) throw new CanonicalViolation('Canonical timeline changed');
  const ids = new Set(live.tracks.map(track => track.componentId));
  if (ids.size !== publication.drawings.length || publication.drawings.some(drawing => !ids.has(drawing.nodeId))) throw new CanonicalViolation('Canonical pose track identity changed');
  const samples = new Set(Array.from({ length: timingSamples }, (_, index) => durationSeconds * index / (timingSamples - 1)));
  for (const { track } of live.tracks) {
    if (track.keyframes[0]?.timelinePosition !== 0) throw new CanonicalViolation('Canonical track has no initial HOLD');
    for (const [index, key] of track.keyframes.entries()) {
      if (key.timelinePosition < 0 || key.timelinePosition > durationSeconds || index > 0 && key.timelinePosition <= track.keyframes[index - 1].timelinePosition) throw new CanonicalViolation('Canonical track keys are unordered or out of range');
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
    const expected = [...publication.keyframes].reverse().find(key => key.atBeat <= beat);
    const active = live.tracks.filter(({ track }) => [...track.keyframes].reverse().find(key => key.timelinePosition <= time)?.value.value === 1);
    if (!expected || active.length !== 1 || active[0].componentId !== publication.drawings[expected.pose].nodeId) throw new CanonicalViolation('Canonical re-export HOLD timing failed');
  }
  return samples.size;
}

export async function checkCanonicalExport(packageDirectory: string, exportDirectory: string) {
  const publication = await verifyPublished(join(packageDirectory, 'promotion.json'));
  let layers = 0;
  for (const drawing of publication.drawings) {
    const raw = await nativeFromCanonical(join(exportDirectory, `pose-${drawing.index}.svg`), publication);
    if (digest(raw) !== drawing.pixelSha256) throw new CanonicalViolation('Canonical re-export pixel parity failed');
    for (const [kind, layer] of Object.entries(drawing.layers)) {
      const raw = await nativeFromCanonical(join(exportDirectory, `${kind}-${drawing.index}.svg`), { ...publication, nativeToFigma: [[1, 0, 0], [0, 1, 0]] });
      if (digest(raw) !== layer.pixelSha256) throw new CanonicalViolation('Canonical layer pixel parity failed');
      layers++;
    }
  }
  const motion: unknown = JSON.parse(await readFile(join(exportDirectory, 'motion.json'), 'utf8'));
  const timingSamples = verifyTiming(publication, motion);
  return { status: 'PASS', motionId: publication.motionId, poses: publication.drawings.length, layers, timingSamples, rawApprovalDependencies: 0 };
}

export function motionReadScript(publication: typeof Published.Type) {
  const ids = publication.drawings.map(drawing => drawing.nodeId);
  const fields = ['x', 'y', 'width', 'height', 'visible', 'opacity', 'relativeTransform', 'clipsContent', 'isMask', 'maskType', 'blendMode', 'effects', 'fills', 'strokes', 'strokeWeight', 'strokeAlign', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'boundVariables', 'explicitVariableModes'];
  return `const p=await figma.getNodeByIdAsync('54:1383');await figma.setCurrentPageAsync(p);
const root=await figma.getNodeByIdAsync(${JSON.stringify(publication.canonical.timelineRootId)});if(root.parent.type!=='PAGE')throw Error('Canonical review must remain a top-level frame');const ids=${JSON.stringify(ids)};const fields=${JSON.stringify(fields)};const tracks=[],scene=[];
async function visit(n,inPose){
const master=n.type==='INSTANCE'?await n.getMainComponentAsync():null;const pose=master&&ids.includes(master.id);
if(n.type==='INSTANCE'&&!pose)throw Error('Unexpected instance in canonical review scene');
if(pose&&n.overrides.some(o=>o.overriddenFields.some(f=>!['name','boundVariables','opacity'].includes(f)||f==='opacity'&&o.id!==n.id)))throw Error('Canonical pose has a visual override');
if((pose||inPose)&&Object.keys(n.boundVariables).length)throw Error('Canonical pose has variable overrides');
const motion={...n.manualKeyframeTracks};if(pose){tracks.push({componentId:master.id,track:motion.OPACITY});delete motion.OPACITY;}
const values=fields.map(f=>n===root&&['x','y','relativeTransform'].includes(f)?null:f in n?n[f]:null);
const extra={motion,styles:n.animationStyles};if(Object.keys(n.boundVariables).length){extra.resolvedVariableModes=n.resolvedVariableModes;const aliases=new Set();function find(v){if(!v||typeof v!=='object')return;if(v.type==='VARIABLE_ALIAS')aliases.add(v.id);else for(const x of Object.values(v))find(x);}find(n.boundVariables);extra.resolvedBindings=await Promise.all([...aliases].sort().map(async id=>{const v=await figma.variables.getVariableByIdAsync(id);if(!v)throw Error('Canonical bound variable missing');return[id,v.resolveForConsumer(n)];}));}
if(pose){extra.componentId=master.id;extra.overrides=n.overrides;extra.componentProperties=n.componentProperties;extra.scaleFactor=n.scaleFactor;}
if(!pose&&!inPose){if('vectorPaths'in n)extra.vectorPaths=n.vectorPaths;if(n.type==='TEXT'){extra.characters=n.characters;extra.segments=n.getStyledTextSegments(['fontName','fontSize','fills','lineHeight','letterSpacing','textCase','textDecoration']);}}
scene.push([n.id,n===root?null:n.parent.id,n.type,values,extra]);
if('children'in n)for(const child of n.children)await visit(child,inPose||pose);
}
await visit(root,false);
const counts=new Map();for(const row of scene)for(const value of [...row[3],row[4]])if(value&&typeof value==='object'){const s=JSON.stringify(value);if(s.length>24)counts.set(s,(counts.get(s)||0)+1);}
const values=[],indices=new Map();function compact(v){if(!v||typeof v!=='object')return v;const s=JSON.stringify(v);if((counts.get(s)||0)<2)return v;if(!indices.has(s)){indices.set(s,values.length);values.push(v);}return{$:indices.get(s)};}
return{rootNodeId:root.id,duration:root.timelines[0].duration,scene:{fields,values,nodes:scene.map(row=>[row[0],row[1],row[2],row[3].map(compact),compact(row[4])])},tracks};`;
}

export async function readScripts(packageDirectory: string) {
  const publication = await verifyPublished(join(packageDirectory, 'promotion.json'));
  const files = new Map<string, string>();
  for (const drawing of publication.drawings) {
    const ids = { pose: drawing.nodeId, ...Object.fromEntries(Object.entries(drawing.layers).map(([kind, layer]) => [kind, layer.nodeId])) };
    const code = `const p=await figma.getNodeByIdAsync('31:51');await figma.setCurrentPageAsync(p);const ids=${JSON.stringify(ids)};const out={};for(const [kind,id]of Object.entries(ids)){const n=await figma.getNodeByIdAsync(id);if(!n)throw Error('Canonical node missing');out[kind]=('children'in n&&n.children.length===0&&n.fills.every(f=>f.visible===false||f.opacity===0)&&n.strokes.every(s=>s.visible===false||s.opacity===0))?'<svg xmlns="http://www.w3.org/2000/svg" width="'+n.width+'" height="'+n.height+'"/>':await n.exportAsync({format:'SVG_STRING'});}return out;`;
    files.set(`read-pose-${drawing.index}.txt`, code + '\n');
  }
  files.set('read-motion.txt', motionReadScript(publication) + '\n');
  return { fileKey: publication.canonical.fileKey, poses: publication.drawings.length, files };
}

export { CanonicalViolation };
