import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Schema } from 'effect';
import sharp from 'sharp';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function geometry(data: Buffer, width: number, height: number) {
  type Rectangle = { x: number; y: number; w: number; h: number };
  const colors = new Map<string, Rectangle[]>(), previous = new Map<string, Rectangle>();
  for (let y = 0; y < height; y++) for (let x = 0; x < width;) {
    const at = (y * width + x) * 4;
    if (!data[at + 3]) { x++; continue; }
    const color = data.subarray(at, at + 3).toString('hex'), start = x++;
    while (x < width && data[(y * width + x) * 4 + 3] && data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3).toString('hex') === color) x++;
    const key = `${color}:${start}:${x - start}`, before = previous.get(key);
    if (before && before.y + before.h === y) before.h++;
    else {
      const rectangle = { x: start, y, w: x - start, h: 1 }, rows = colors.get(color) ?? [];
      rows.push(rectangle); colors.set(color, rows); previous.set(key, rectangle);
    }
  }
  return [...colors].map(([color, rectangles]) => `${color}:${rectangles.map(rectangle => [rectangle.x, rectangle.y, rectangle.w, rectangle.h].map(value => value.toString(36).padStart(2, '0')).join('')).join('')}`).join('|');
}
const dimension = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(512));
const image = Schema.Struct({ path: Schema.NonEmptyString, sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) });
const Spec = Schema.Struct({
  pageId: Schema.String.check(Schema.isPattern(/^\d+:\d+$/)), collectionName: Schema.NonEmptyString,
  batchSize: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(4)),
  assets: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, name: Schema.NonEmptyString,
    width: dimension, height: dimension, pivot: Schema.Struct({ x: Schema.Number, y: Schema.Number }),
    purpose: Schema.NonEmptyString, combined: image,
    layers: Schema.Array(Schema.Struct({ name: Schema.NonEmptyString, image })),
  })),
});
const [specPath, output, ...extra] = process.argv.slice(2);
if (!specPath || !output || extra.length) throw Error('Usage: prepare-story-cels.mts SPEC_JSON NEW_OUTPUT_DIRECTORY');
const input: unknown = JSON.parse(await readFile(specPath, 'utf8'));
const spec = Schema.decodeUnknownSync(Spec)(input);
if (!spec.assets.length || new Set(spec.assets.map(asset => asset.id)).size !== spec.assets.length || new Set(spec.assets.map(asset => asset.name)).size !== spec.assets.length) throw Error('Unique nonempty asset IDs and component names required');
const packed = [];
for (const [index, asset] of spec.assets.entries()) {
  const decoded = async (ref: typeof image.Type) => {
    const bytes = await readFile(ref.path);
    if (hash(bytes) !== ref.sha256) throw Error(`Changed source: ${ref.path}`);
    const result = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (result.info.width !== asset.width || result.info.height !== asset.height) throw Error(`Grid differs: ${asset.id}`);
    for (let at = 3; at < result.data.length; at += 4) if (result.data[at] !== 0 && result.data[at] !== 255) throw Error(`Partial alpha needs a separate importer: ${asset.id}`);
    return result.data;
  };
  const expected = await decoded(asset.combined), assembled = Buffer.alloc(expected.length), layers = [];
  if (!asset.layers.length || new Set(asset.layers.map(layer => layer.name)).size !== asset.layers.length) throw Error('Unique named cel layers required');
  for (const layer of asset.layers) {
    const raw = await decoded(layer.image);
    for (let at = 0; at < raw.length; at += 4) if (raw[at + 3]) raw.copy(assembled, at, at, at + 4);
    layers.push({ name: layer.name, rgbaSha256: hash(raw), geometry: geometry(raw, asset.width, asset.height) });
  }
  if (!assembled.equals(expected)) throw Error(`Declared layer order differs: ${asset.id}`);
  packed.push({ ...asset, index, layers, expectedRgbaSha256: hash(expected) });
}
await mkdir(output);
const batches: { path: string; ids: string[]; codeBytes: number }[] = [];
for (let index = 0; index < packed.length; index += spec.batchSize) {
  const assets = packed.slice(index, index + spec.batchSize);
  const code = `const p=await figma.getNodeByIdAsync(${JSON.stringify(spec.pageId)});if(!p||p.type!=='PAGE')throw Error('Missing source page');await figma.setCurrentPageAsync(p);await figma.loadFontAsync({family:'Inter',style:'Regular'});const created=[],changed=[];const name=${JSON.stringify(spec.collectionName)};const found=p.children.filter(n=>n.name===name);if(found.length>1)throw Error('Ambiguous collection');let holder=found[0];if(!holder){holder=figma.createAutoLayout('VERTICAL');p.appendChild(holder);holder.name=name;holder.fills=[];holder.itemSpacing=32;holder.x=Math.max(0,...p.children.filter(n=>n.id!==holder.id).map(n=>n.x+n.width))+128;holder.y=64;created.push(holder.id);}if(holder.type!=='FRAME')throw Error('Invalid collection');const data=${JSON.stringify(assets)};function svg(encoded,w,h){const paths=encoded?encoded.split('|').map(token=>{const[color,runs]=token.split(':');let d='';for(let i=0;i<runs.length;i+=8){const x=parseInt(runs.slice(i,i+2),36),y=parseInt(runs.slice(i+2,i+4),36),rw=parseInt(runs.slice(i+4,i+6),36),rh=parseInt(runs.slice(i+6,i+8),36);d+='M'+x+' '+y+'h'+rw+'v'+rh+'h-'+rw+'z';}return '<path fill="#'+color+'" d="'+d+'"/>';}).join(''):'';return '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'+paths+'</svg>';}const result=[];for(const asset of data){const existing=holder.findAllWithCriteria({types:['COMPONENT']}).filter(n=>n.name===asset.name);if(existing.length>1)throw Error('Ambiguous cel');let c=existing[0];if(!c){const rowName='Source row '+Math.floor(asset.index/4);let row=holder.children.find(n=>n.name===rowName);if(!row){row=figma.createAutoLayout('HORIZONTAL');holder.appendChild(row);row.name=rowName;row.fills=[];row.itemSpacing=24;created.push(row.id);}const card=figma.createAutoLayout('VERTICAL');row.appendChild(card);card.name='Cel / '+asset.id;card.fills=[];card.itemSpacing=8;created.push(card.id);const label=figma.createText();card.appendChild(label);label.name='Label';label.fontName={family:'Inter',style:'Regular'};label.fontSize=12;label.fills=[{type:'SOLID',color:{r:.65,g:.71,b:.78}}];label.characters=asset.id;created.push(label.id);c=figma.createComponent();card.appendChild(c);c.name=asset.name;c.resize(asset.width,asset.height);c.fills=[];c.clipsContent=true;c.description=asset.purpose+' Native '+asset.width+'x'+asset.height+'; pivot '+asset.pivot.x+','+asset.pivot.y+'. Preserve integer display scale and the declared layer order.';created.push(c.id);for(const layer of asset.layers){const n=figma.createNodeFromSvg(svg(layer.geometry,asset.width,asset.height));c.appendChild(n);n.name=layer.name;n.x=0;n.y=0;created.push(n.id,...n.findAll(()=>true).map(child=>child.id));}}const childLayers=c.children.map(n=>({name:n.name,nodeId:n.id,visible:n.visible}));if(childLayers.length!==asset.layers.length||childLayers.some((n,i)=>n.name!==asset.layers[i].name||!n.visible))throw Error('Unexpected direct child layers');const actualLayers=[];for(const layer of asset.layers){const n=c.children.find(n=>n.name===layer.name);if(!n)throw Error('Missing named cel layer');actualLayers.push({name:layer.name,nodeId:n.id,png:figma.base64Encode(await n.exportAsync({format:'PNG'}))});}result.push({id:asset.id,nodeId:c.id,width:c.width,height:c.height,childLayers,png:figma.base64Encode(await c.exportAsync({format:'PNG'})),layers:actualLayers});}return{collectionId:holder.id,createdNodeIds:created,mutatedNodeIds:changed,assets:result};`;
  if (Buffer.byteLength(code) > 47000) throw Error('Source batch too large; reduce batchSize');
  const path = `${output}/batch-${batches.length}.js`;
  await writeFile(path, code, { flag: 'wx' });
  batches.push({ path, ids: assets.map(asset => asset.id), codeBytes: Buffer.byteLength(code) });
}
await writeFile(`${output}/expected.json`, JSON.stringify({ specPath, assets: packed.map(({ layers, ...asset }) => ({ ...asset, layers: layers.map(({ geometry, ...layer }) => layer) })), batches }, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ output, assets: packed.length, batches })}\n`);
