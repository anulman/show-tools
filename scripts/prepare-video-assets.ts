import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Schema } from 'effect';

const Input = Schema.Struct({ id: Schema.NonEmptyString, character: Schema.Literals(['gator', 'tapir']), treatment: Schema.Literals(['original', '8bit', '16bit', 'tex-avery']), path: Schema.NonEmptyString, prompt: Schema.String });
const inputs = Schema.decodeUnknownSync(Schema.Array(Input))(JSON.parse(await readFile(process.argv[2], 'utf8')));
const output = resolve('assets/video');
await mkdir(resolve(output, 'source-strips'), { recursive: true });
await mkdir(resolve(output, 'poses'), { recursive: true });
const models = [];
for (const input of inputs) {
  const { data, info } = await sharp(input.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const labels = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(labels.length);
  const components: { id: number; size: number; x: number; y: number; right: number; bottom: number }[] = [];
  for (let pixel = 0; pixel < labels.length; pixel++) {
    if (labels[pixel] !== -1 || data[pixel * 4 + 3] < 9) continue;
    const id = components.length;
    let head = 0, tail = 1;
    queue[0] = pixel; labels[pixel] = id;
    const component = { id, size: 0, x: width, y: height, right: 0, bottom: 0 };
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      component.size++; component.x = Math.min(component.x, x); component.y = Math.min(component.y, y);
      component.right = Math.max(component.right, x); component.bottom = Math.max(component.bottom, y);
      for (const next of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (next >= 0 && labels[next] === -1 && data[next * 4 + 3] >= 9) { labels[next] = id; queue[tail++] = next; }
      }
    }
    components.push(component);
  }
  const figures = [...components].sort((a, b) => b.size - a.size).slice(0, 3).sort((a, b) => a.x - b.x);
  if (figures.length !== 3 || figures.some(f => f.size < 10000)) throw new Error(`${input.id}: expected three isolated full figures`);
  const owner = components.map(component => {
    const x = (component.x + component.right) / 2, y = (component.y + component.bottom) / 2;
    const distance = (f: typeof component) => Math.max(f.x - x, 0, x - f.right) ** 2 + Math.max(f.y - y, 0, y - f.bottom) ** 2;
    return figures.reduce((best, f, index) => distance(f) < distance(figures[best]) ? index : best, 0);
  });
  const bounds = figures.map((_, index) => components.filter(c => owner[c.id] === index && c.size > 4).reduce((box, c) => ({ x: Math.min(box.x, c.x), y: Math.min(box.y, c.y), right: Math.max(box.right, c.right), bottom: Math.max(box.bottom, c.bottom) }), { x: width, y: height, right: 0, bottom: 0 }));
  const scale = Math.min(608 / Math.max(...bounds.map(b => b.right - b.x + 1)), 752 / Math.max(...bounds.map(b => b.bottom - b.y + 1)));
  const poses = [];
  for (let index = 0; index < 3; index++) {
    const b = bounds[index], w = b.right - b.x + 1, h = b.bottom - b.y + 1;
    const pixels = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (b.y + y) * width + b.x + x;
      if (labels[p] >= 0 && owner[labels[p]] === index) data.copy(pixels, (y * w + x) * 4, p * 4, p * 4 + 4);
    }
    const scaledWidth = Math.round(w * scale), scaledHeight = Math.round(h * scale);
    const sprite = await sharp(pixels, { raw: { width: w, height: h, channels: 4 } }).resize(scaledWidth, scaledHeight, { kernel: input.treatment === 'tex-avery' ? 'lanczos3' : 'nearest' }).png().toBuffer();
    const filename = `${input.id}-${index}.png`;
    await sharp({ create: { width: 640, height: 800, channels: 4, background: '#00000000' } }).composite([{ input: sprite, left: Math.round((640 - scaledWidth) / 2), top: 776 - scaledHeight }]).png().toFile(resolve(output, 'poses', filename));
    poses.push(`/assets/video/poses/${filename}`);
  }
  await copyFile(input.path, resolve(output, 'source-strips', `${input.id}.png`));
  const digest = createHash('sha256').update(await readFile(input.path)).digest('hex');
  models.push({ id: input.id, character: input.character, treatment: input.treatment, poses, sourcePage: input.character === 'gator' ? 8 : 30, sourceStrip: `source-strips/${input.id}.png`, sha256: digest, prompt: input.prompt, generator: 'built-in image_gen', originalTreatment: input.treatment === 'original' ? 'Generated cleanup matching the source treatment; intact PDF page retained as reference' : undefined });
}
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ version: 1, canvas: { width: 640, height: 800, baseline: 776 }, publication: 'All assets cleared for publication by operator in PR4 discussion_r4386243860', source: { file: 'Old TV Character ideas-1.pdf', sha256: 'dd3e61e0a655564d098ecdb0fa14767370df2589fd5472d1cc497f3a68eacbb7', originals: 'Preserved unchanged in operator Dropbox; selected page renders in references/' }, models }, null, 2) + '\n');
process.stdout.write(`Prepared ${models.length} models and ${models.length * 3} registered poses.\n`);
