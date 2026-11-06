import assert from 'node:assert/strict';
import test from 'node:test';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sourceInput from '../../../songs/dance-yrself-clean.source.json';
import mapping from '../../../songs/dance-yrself-clean.mapping.json';
import { importSheetMusicXml } from '../../performance/sheet-musicxml.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../../performance/musicxml-song.js';
import { parseSongSource } from '../../performance/song-source.js';
import { discoverSheetVoices } from '../../voice-catalog/sheet-voices.js';
import { reconcileCatalog } from '../../voice-catalog/session.js';
import { prepareStreetSong } from '../song-score.js';
import { createStreetSampler } from '../street-sampler.js';
import { publishPreparedArtifact } from '../prepared-artifact.js';
import { parseStreetScene } from '../street-score.js';
import type { PreparedStreetScene, StreetActor } from '../street-score.js';

const source = parseSongSource(sourceInput);
const { xml: musicxml } = await importSheetMusicXml({ source, mapping });
const { song: compiled } = await readMusicXmlSong(musicxml);
const rows = discoverSheetVoices(compiled, source);
let serial = 0;
const saved = reconcileCatalog({ version: 2, revision: 0, voices: [], bindings: [] }, rows, new Map(), () => `synthetic-${++serial}`);
const catalog = { ...saved, voices: saved.voices.map(voice => ({ ...voice, characterId: voice.id })) };
const assets: PreparedStreetScene = { version: 2, kind: 'authored-street-preview', staging: { kind: 'all-present' }, width: 64, height: 64, background: { path: '/background.png', sha256: '0'.repeat(64) }, durationCounts: 32, countedBeatUnit: 4, previewCountsPerSecond: 2, provenance: { source: 'synthetic', assetsDigest: 'fixture', scoreDigest: 'fixture' }, tracks: [],
  actors: catalog.voices.map(voice => ({ characterId: voice.characterId, role: 'instrument', placement: { x: 0, y: 0, depth: 0, scale: 1 }, clips: ['simple', 'vigorous', 'special', 'ultra'].map((tier, i) => ({ id: `${voice.id}-${tier}`, tier: i === 0 ? 'simple' : i === 1 ? 'vigorous' : i === 2 ? 'special' : 'ultra', cycleQuarters: 2, actionQuarters: null, nativeGrid: { width: 64, height: 64 }, sourceOffset: { x: 0, y: 0 }, keys: [0, .5, 1, 1.5].map((atQuarter, pose) => ({ atQuarter, pose })), drawings: [0, 1, 2, 3].map(i => ({ path: `/pose-${i}.png`, sha256: String(i).repeat(64), pivot: { x: 0, y: 0 } })) })) } satisfies StreetActor)) };
const input = { catalog, musicxml, assets };
const bytes = await readFile(new URL('../../../ui/video/wasm/video-scene.wasm', import.meta.url));

test('CLI publishes a complete scene and receipt together despite an unusable legacy sidecar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'street-publication-'));
  try {
    const paths = [join(root, 'catalog.json'), join(root, 'song.musicxml'), join(root, 'assets.json')];
    await Promise.all(paths.map((path, index) => writeFile(path, [JSON.stringify(catalog), musicxml, JSON.stringify(assets)][index])));
    const output = join(root, 'scene.json');
    await writeFile(output, 'previous scene');
    await mkdir(`${output}.receipt.json`);
    const command = new URL('../../../scripts/prepare-street-song.ts', import.meta.url);
    const run = spawnSync(process.execPath, ['--import', 'tsx', command.pathname, ...paths, output], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const artifact = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(parseStreetScene(artifact).durationCounts, 872);
    assert.equal(artifact.preparationReceipt.cells.length, 1744);
    assert.equal(artifact.preparationReceipt.durationCounts, 872);
    assert.deepEqual(await readdir(`${output}.receipt.json`), []);
    const originalAssets = await readFile(paths[2], 'utf8');
    const alias = spawnSync(process.execPath, ['--import', 'tsx', command.pathname, ...paths, paths[2]], { encoding: 'utf8' });
    assert.notEqual(alias.status, 0);
    assert.match(alias.stderr, /aliases an input/);
    assert.equal(await readFile(paths[2], 'utf8'), originalAssets);
    assert(!(await readdir(root)).some(name => name.startsWith('.prepared-scene-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('publication rejects every source alias and preserves old output on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'street-publication-alias-'));
  try {
    const inputs = ['catalog', 'source', 'mapping', 'assets'].map(name => join(root, `${name}.json`));
    await Promise.all(inputs.map(path => writeFile(path, 'original input')));
    const parentAlias = `${root}-alias`;
    await symlink(root, parentAlias);
    try {
      for (const [index, path] of inputs.entries()) {
        const hard = join(root, `hard-${index}`), soft = join(root, `soft-${index}`);
        await link(path, hard); await symlink(path, soft);
        for (const output of [path, hard, soft, join(parentAlias, `${['catalog', 'source', 'mapping', 'assets'][index]}.json`)]) {
          await assert.rejects(publishPreparedArtifact({ output, inputs, artifact: { replacement: true } }), /aliases an input/);
          assert.equal(await readFile(path, 'utf8'), 'original input');
        }
      }
    } finally { await rm(parentAlias); }
    const output = join(root, 'previous.json');
    await writeFile(output, 'previous complete artifact');
    await assert.rejects(publishPreparedArtifact({ output, inputs, artifact: { unserializable: 1n } }), /BigInt/);
    assert.equal(await readFile(output, 'utf8'), 'previous complete artifact');
    const directory = join(root, 'directory.json');
    await mkdir(directory); await writeFile(join(directory, 'previous'), 'preserved');
    await assert.rejects(publishPreparedArtifact({ output: directory, inputs, artifact: {} }), /regular file/);
    assert.equal(await readFile(join(directory, 'previous'), 'utf8'), 'preserved');
    assert(!(await readdir(root)).some(name => name.startsWith('.prepared-scene-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('complete chart prepares all eight actors, all cells and exact duration; native reverse seeks agree', async () => {
  const result = await prepareStreetSong(input);
  assert.equal(result.kind, 'ready'); if (result.kind !== 'ready') return;
  assert.equal(result.scene.durationCounts, 872); assert.equal(result.scene.previewCountsPerSecond, 98 / 60);
  assert.equal(result.receipt.cells.length, 8 * 218);
  assert.equal(result.receipt.mainVocalSections.filter(section => section.eligibility.kind === 'lyric').length, 18);
  const sampler = await createStreetSampler(bytes, result.scene);
  try {
    const forward = [0, .5, 1, 52, 100, 800, 871.75].map(at => sampler.sample(at));
    for (const [index, at] of [0, .5, 1, 52, 100, 800, 871.75].entries()) assert.deepEqual(sampler.sample(at), forward[index]);
    for (let i = forward.length - 1; i >= 0; i--) assert.deepEqual(sampler.sample([0, .5, 1, 52, 100, 800, 871.75][i]), forward[i]);
  } finally { sampler.dispose(); }
  assert.deepEqual(await prepareStreetSong(input), result);
});

test('blank backup inside written eligibility restores main', async () => {
  const values = source.values.map(row => [...row]);
  const backup = rows.find(row => compiled.parts.find(part => part.id === row.partId)?.role.kind === 'rotation-live'); assert(backup);
  const span = compiled.rotation?.windows.find(window => window.begin.bar >= 13); assert(span);
  const bar = compiled.chart.bars.find(bar => bar.bar === span.begin.bar); assert(bar);
  const backupRow = Number(backup.labelCell.match(/[0-9]+$/)?.[0]);
  values[backupRow - 1][bar.column - 1] = '';
  const result = await prepareStreetSong({ ...input, musicxml: (await importSheetMusicXml({ source: { ...source, values }, mapping })).xml });
  assert.equal(result.kind, 'ready'); if (result.kind !== 'ready') return;
  const backupIndex = result.scene.actors.findIndex(actor => actor.role === 'backup-vocals');
  const start = (bar.bar - 1) * 4;
  assert(result.receipt.windows[backupIndex].states.filter(state => state.start >= start && state.end <= start + 4).every(state => !state.active));
  const mainIndex = result.scene.actors.findIndex(actor => actor.role === 'main-vocals');
  const sampler = await createStreetSampler(bytes, result.scene);
  try { assert.equal(sampler.sample(start + span.begin.beat)[mainIndex].clip, 1); } finally { sampler.dispose(); }
});

test('unknown notation blocks with exact source cell', async () => {
  const values = source.values.map(row => [...row]);
  const bar = compiled.chart.bars[0]; values[9][bar.column - 1] = '?';
  const result = await prepareStreetSong({ ...input, musicxml: (await importSheetMusicXml({ source: { ...source, values }, mapping })).xml });
  assert.equal(result.kind, 'blocked'); if (result.kind !== 'blocked') return;
  assert(result.diagnostics.some(item => item.cell === `${String.fromCharCode(64 + bar.column)}10` && item.text === '?'));
});


test('unrouted reference voice obeys blank idle, dash intensity reset and sampled gray', async () => {
  const reference = rows.find(row => row.name === 'Bass'); assert(reference);
  const row = Number(reference.labelCell.match(/[0-9]+$/)?.[0]);
  const values = source.values.map(row => [...row]);
  for (const [index, text] of ['!!', '-', "-'", ''].entries()) values[row - 1][compiled.chart.bars[index].column - 1] = text;
  const result = await prepareStreetSong({ ...input, musicxml: (await importSheetMusicXml({ source: { ...source, values }, mapping })).xml });
  assert.equal(result.kind, 'ready'); if (result.kind !== 'ready') return;
  const actor = rows.findIndex(item => item.labelCell === reference.labelCell);
  const sampler = await createStreetSampler(bytes, result.scene);
  try {
    assert.deepEqual([0, 4, 8, 12].map(at => { const frame = sampler.sample(at)[actor]; return [frame.clip, frame.grayscale]; }), [[3, false], [1, false], [1, true], [0, false]]);
  } finally { sampler.dispose(); }
});


test('standalone MusicXML uses canonical activity and portable cast without a saved authoring snapshot', async () => {
  const document = await readMusicXmlSong(musicxml);
  const standalone = await writeMusicXmlSong({ song: document.song, report: document.report, voices: catalog });
  const decoded = await readMusicXmlSong(standalone);
  assert.equal(decoded.source, null);
  assert.equal(decoded.mapping, null);
  const result = await prepareStreetSong({ ...input, catalog: { invalid: 'ignored because an explicit portable cast exists' }, musicxml: standalone });
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  const original = await prepareStreetSong(input);
  assert.equal(original.kind, 'ready');
  if (original.kind !== 'ready') return;
  assert.deepEqual(result.scene, original.scene);
  assert.deepEqual(result.receipt.savedBindings, original.receipt.savedBindings);
  assert.deepEqual(result.receipt.windows, original.receipt.windows);
});

test('standard lyric text edits preserve explicitly authored section eligibility', async () => {
  const edited = musicxml.replace('>Show.</words>', '>???</words>');
  assert.notEqual(edited, musicxml);
  const result = await prepareStreetSong({ ...input, musicxml: edited });
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  const section = result.receipt.mainVocalSections.find(section => section.startBar === 201);
  assert.equal(section?.source.text, '???');
  assert.equal(section?.eligibility.kind, 'lyric');
});


test('authored preview CLI accepts canonical MusicXML and records its provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'street-preview-xml-'));
  try {
    const paths = [join(root, 'catalog.json'), join(root, 'song.musicxml'), join(root, 'assets.json')];
    await Promise.all(paths.map((path, index) => writeFile(path, [JSON.stringify(catalog), musicxml, JSON.stringify(assets)][index])));
    const output = join(root, 'preview.json');
    const command = new URL('../../../scripts/prepare-street-preview.ts', import.meta.url);
    const run = spawnSync(process.execPath, ['--import', 'tsx', command.pathname, ...paths, output], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const scene = parseStreetScene(JSON.parse(await readFile(output, 'utf8')));
    assert.equal(scene.durationCounts, 32);
    assert.equal(scene.actors.length, 8);
    const receipt = JSON.parse(await readFile(`${output}.receipt.json`, 'utf8'));
    assert.match(receipt.musicXmlSha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.sourceSha256, undefined);
    assert.equal(receipt.mappingSha256, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('both CLIs prepare embedded-catalog MusicXML without opening an unused fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'street-portable-cli-'));
  try {
    const document = await readMusicXmlSong(musicxml);
    const portable = await writeMusicXmlSong({ song: document.song, report: document.report, voices: catalog });
    const xmlPath = join(root, 'song.musicxml'), assetsPath = join(root, 'assets.json');
    await Promise.all([writeFile(xmlPath, portable), writeFile(assetsPath, JSON.stringify(assets))]);
    for (const name of ['song', 'preview']) {
      const command = new URL(`../../../scripts/prepare-street-${name}.ts`, import.meta.url);
      for (const fallback of [[], [join(root, 'nonexistent-catalog.json')]]) {
        const output = join(root, `${name}-${fallback.length}.json`);
        const run = spawnSync(process.execPath, ['--import', 'tsx', command.pathname, ...fallback, xmlPath, assetsPath, output], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        assert.equal(parseStreetScene(JSON.parse(await readFile(output, 'utf8'))).actors.length, 8);
      }
      await writeFile(xmlPath, musicxml);
      const output = join(root, `${name}-missing.json`);
      const missing = spawnSync(process.execPath, ['--import', 'tsx', command.pathname, xmlPath, assetsPath, output], { encoding: 'utf8' });
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /MusicXML has no portable voice catalog; supply catalog.json/);
      assert(!(await readdir(root)).includes(`${name}-missing.json`));
      await writeFile(xmlPath, portable);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
