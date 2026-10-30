import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseCommandFailure } from '../../lib/command-diagnostics.js';
import { digest } from './published.mjs';

const entry = fileURLToPath(new URL('./promotion.mts', import.meta.url));
const loader = import.meta.resolve('tsx');
function command(args: string[], script = entry) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => {
    const child = spawn(process.execPath, ['--import', loader, script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject);
    child.once('close', code => accept({ code, stdout, stderr }));
  });
}

async function fixture(root: string, suffix = '') {
  const pkg = join(root, 'package' + suffix), capture = join(root, 'capture' + suffix);
  await mkdir(pkg); await mkdir(capture);
  const scene = { fixture: 'synthetic CLI capture' };
  const ids = ['900:1', '900:2'], colors = ['#ff0000', '#00ff00'];
  const drawings = [];
  for (let index = 0; index < 2; index++) {
    const raw = Buffer.from(index ? [0, 255, 0, 255, ...Array<number>(12).fill(0)] : [255, 0, 0, 255, ...Array<number>(12).fill(0)]);
    const png = await sharp(raw, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    await writeFile(join(pkg, `pose-${index}.png`), png);
    await writeFile(join(capture, `pose-${index}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="${colors[index]}" d="M0 0h1v1H0z"/></svg>`);
    drawings.push({ index, nodeId: ids[index], path: `pose-${index}.png`, sha256: digest(png), pixelSha256: digest(raw), pivot: { x: 0, y: 1 }, layers: {} });
  }
  const motion = {
    rootNodeId: suffix ? '901:2' : '901:1', duration: 8, scene,
    tracks: ids.map((componentId, pose) => ({ componentId, track: { keyframes: Array.from({ length: 65 }, (_, sample) => ({
      timelinePosition: sample / 8, easing: { type: 'HOLD' }, value: { value: (sample === 64 ? 0 : sample / 4 % 1 >= .5 ? 1 : 0) === pose ? 1 : 0 },
    })) } })),
  };
  await writeFile(join(pkg, 'promotion.json'), JSON.stringify({
    schemaVersion: 1, toolVersion: 1, status: 'canonical-reexport-verified', motionId: 'fixture/default', characterId: 'fixture', artworkId: 'fixture/pixels',
    canonical: { store: 'Figma', fileKey: 'FixtureOnly', componentSetId: '902:1', timelineRootId: motion.rootNodeId },
    nativeGrid: { width: 2, height: 2 }, nativeToFigma: [[1, 0, 0], [0, 1, 0]], sourceOffset: { x: 0, y: 0 }, cycleBeats: 1, actionBeats: null,
    beatUnit: 'quarter-note', interpolation: 'hold', keyframes: [{ atBeat: 0, pose: 0 }, { atBeat: .5, pose: 1 }, { atBeat: 1, pose: 0 }], drawings,
    reexport: { referenceBpm: 120, durationSeconds: 8, timingSamples: 65, sceneSha256: digest(Buffer.from(JSON.stringify(scene))) },
    approval: { style: 'pass', temporal: 'pass', export: 'pass', anatomy: 'pass', approvedPixelHashes: drawings.map(drawing => drawing.pixelSha256) },
  }, null, 2) + '\n');
  await writeFile(join(capture, 'motion.json'), JSON.stringify(motion));
  return { pkg, capture, motion };
}

async function contents(directory: string) {
  return Promise.all((await readdir(directory)).sort().map(async name => [name, digest(await readFile(join(directory, name)))]));
}

test('the real CLI produces deterministic complete reads and atomic check reports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figma-cli-'));
  try {
    const { pkg, capture } = await fixture(root), first = join(root, 'first'), second = join(root, 'second');
    const a = await command(['reexport-scripts', pkg, first, '--json']);
    const b = await command(['reexport-scripts', pkg, first, '--json']);
    const c = await command(['reexport-scripts', pkg, second, '--json']);
    for (const result of [a, b, c]) assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(a.stdout, b.stdout);
    assert.deepEqual(await contents(first), await contents(second));
    assert.deepEqual((await readdir(first)).sort(), ['read-motion.txt', 'read-pose-0.txt', 'read-pose-1.txt']);
    const report = join(root, 'check.json'), args = ['check', pkg, capture, '--report', report, '--json'];
    const checked = await command(args), repeated = await command(args);
    assert.equal(checked.code, 0, checked.stdout + checked.stderr); assert.equal(repeated.code, 0, repeated.stdout + repeated.stderr);
    assert.equal(checked.stdout, repeated.stdout);
    assert.deepEqual(JSON.parse(await readFile(report, 'utf8')), JSON.parse(checked.stdout));
    assert.ok(!(await readdir(root)).some(name => name.startsWith('.figma-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid pixel, scene, HOLD and missing captures stay blocked and preserve an existing report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figma-cli-'));
  try {
    const { pkg, capture, motion } = await fixture(root), report = join(root, 'previous.json');
    await writeFile(report, 'previous verified result\n');
    const run = () => command(['check', pkg, capture, '--report', report, '--json']);
    for (const mode of ['pixels', 'scene', 'hold', 'missing']) {
      await writeFile(join(capture, 'motion.json'), JSON.stringify(motion));
      if (mode === 'pixels') await writeFile(join(capture, 'pose-0.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
      if (mode === 'scene') await writeFile(join(capture, 'motion.json'), JSON.stringify({ ...motion, scene: { changed: true } }));
      if (mode === 'hold') {
        const changed = structuredClone(motion); changed.tracks[0].track.keyframes[0].value.value = 0;
        await writeFile(join(capture, 'motion.json'), JSON.stringify(changed));
      }
      if (mode === 'missing') await rm(join(capture, 'motion.json'));
      const result = await run(), failure = parseCommandFailure(JSON.parse(result.stdout));
      assert.equal(result.code, 2, result.stdout + result.stderr); assert.equal(failure.status, 'blocked');
      assert.ok(failure.locations.includes(capture)); assert.ok(failure.nextSteps.length); assert.equal(result.stderr, '');
      assert.equal(await readFile(report, 'utf8'), 'previous verified result\n');
      await writeFile(join(capture, 'pose-0.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="#ff0000" d="M0 0h1v1H0z"/></svg>');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('human failures explain recovery without exposing malformed input or raw stacks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figma-cli-'));
  try {
    const { pkg, capture } = await fixture(root);
    await writeFile(join(capture, 'motion.json'), '{"private":"DO_NOT_PRINT_THIS"');
    const result = await command(['check', pkg, capture]);
    assert.equal(result.code, 2); assert.equal(result.stdout, '');
    assert.match(result.stderr, /Blocked \[FIGMA_CANONICAL_INPUT_BLOCKED\]/);
    assert.match(result.stderr, /Next steps:/); assert.doesNotMatch(result.stderr, /DO_NOT_PRINT_THIS|at file:|SyntaxError:/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('conflicts preserve complete output while locks and filesystem failures request Chief', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figma-cli-'));
  try {
    const { pkg } = await fixture(root), output = join(root, 'reads');
    assert.equal((await command(['reexport-scripts', pkg, output])).code, 0);
    await writeFile(join(output, 'operator-note.txt'), 'keep\n');
    const conflict = await command(['reexport-scripts', pkg, output, '--json']);
    assert.equal(conflict.code, 2); assert.equal(parseCommandFailure(JSON.parse(conflict.stdout)).code, 'FIGMA_OUTPUT_CONFLICT');
    assert.equal(await readFile(join(output, 'operator-note.txt'), 'utf8'), 'keep\n');
    await writeFile(join(root, '.locked.figma-publish.lock'), 'other session\n');
    const locked = await command(['reexport-scripts', pkg, join(root, 'locked'), '--json']);
    assert.equal(locked.code, 3); assert.equal(parseCommandFailure(JSON.parse(locked.stdout)).status, 'needs-chief');
    assert.equal(await readFile(join(root, '.locked.figma-publish.lock'), 'utf8'), 'other session\n');
    const io = await command(['reexport-scripts', pkg, join(root, 'missing-parent', 'reads'), '--json']);
    assert.equal(io.code, 3); assert.equal(parseCommandFailure(JSON.parse(io.stdout)).code, 'FIGMA_OUTPUT_IO_FAILED');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent CLI writers publish one complete set and converge on an identical retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figma-cli-'));
  try {
    const { pkg } = await fixture(root), output = join(root, 'reads');
    const args = ['reexport-scripts', pkg, output, '--json'];
    const alias = join(root, 'parent-alias'); await symlink(root, alias);
    const runs = await Promise.all([command(args), command(['reexport-scripts', pkg, join(alias, 'reads'), '--json'])]);
    assert.ok(runs.some(result => result.code === 0));
    for (const result of runs) {
      assert.ok(result.code === 0 || result.code === 3, result.stdout + result.stderr);
      if (result.code === 3) assert.equal(parseCommandFailure(JSON.parse(result.stdout)).code, 'FIGMA_PUBLICATION_LOCKED');
    }
    const before = await contents(output); assert.equal((await command(args)).code, 0);
    assert.deepEqual(await contents(output), before);
    assert.ok(!(await readdir(root)).some(name => name.startsWith('.figma-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bad arguments are product blocks and an unavailable verification runtime goes to Chief', async () => {
  const bad = await command(['check', '--unknown', '--json']);
  assert.equal(bad.code, 2); assert.equal(parseCommandFailure(JSON.parse(bad.stdout)).code, 'FIGMA_ARGUMENTS_INVALID');
  const root = await mkdtemp(join(tmpdir(), 'figma-cli-runtime-'));
  try {
    const alias = join(root, 'entry-alias.mts'); await symlink(entry, alias);
    const help = await command(['--help'], alias);
    assert.equal(help.code, 0); assert.match(help.stdout, /Usage:/);
    const isolated = join(root, 'scripts/video-expansion/design-system'); await mkdir(isolated, { recursive: true });
    await mkdir(join(root, 'scripts/lib'));
    await cp(entry, join(isolated, 'promotion.mts'));
    await cp(join(dirname(entry), 'atomic-output.mts'), join(isolated, 'atomic-output.mts'));
    await cp(resolve('scripts/lib/command-diagnostics.ts'), join(root, 'scripts/lib/command-diagnostics.ts'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    await symlink(resolve('node_modules'), join(root, 'node_modules'));
    const result = await command(['reexport-scripts', 'package', join(root, 'reads'), '--json'], join(isolated, 'promotion.mts'));
    assert.equal(result.code, 3, result.stdout + result.stderr);
    const failure = parseCommandFailure(JSON.parse(result.stdout));
    assert.equal(failure.status, 'needs-chief'); assert.equal(failure.code, 'FIGMA_RUNTIME_UNAVAILABLE');
    assert.equal(result.stderr, '');
  } finally { await rm(root, { recursive: true, force: true }); }
});
