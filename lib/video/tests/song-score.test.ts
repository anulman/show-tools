import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import sourceInput from '../../../songs/dance-yrself-clean.source.json';
import mapping from '../../../songs/dance-yrself-clean.mapping.json';
import { compileSong } from '../../performance/compiled-song.js';
import { parseSongSource } from '../../performance/song-source.js';
import { discoverSheetVoices } from '../../voice-catalog/sheet-voices.js';
import { reconcileCatalog } from '../../voice-catalog/session.js';
import { prepareStreetSong } from '../song-score.js';
import { createStreetSampler } from '../street-sampler.js';
import type { PreparedStreetScene, StreetActor } from '../street-score.js';

const source = parseSongSource(sourceInput), compiled = await compileSong(source, mapping);
const rows = discoverSheetVoices(compiled, source);
let serial = 0;
const saved = reconcileCatalog({ version: 2, revision: 0, voices: [], bindings: [] }, rows, new Map(), () => `synthetic-${++serial}`);
const catalog = { ...saved, voices: saved.voices.map(voice => ({ ...voice, characterId: voice.id })) };
const assets: PreparedStreetScene = { version: 2, kind: 'authored-street-preview', width: 64, height: 64, background: { path: '/background.png', sha256: '0'.repeat(64) }, durationCounts: 32, countedBeatUnit: 4, previewCountsPerSecond: 2, provenance: { source: 'synthetic', assetsDigest: 'fixture', scoreDigest: 'fixture' }, tracks: [],
  actors: catalog.voices.map(voice => ({ characterId: voice.characterId, role: 'instrument', placement: { x: 0, y: 0, depth: 0, scale: 1 }, clips: ['simple', 'vigorous', 'special', 'ultra'].map((tier, i) => ({ id: `${voice.id}-${tier}`, tier: i === 0 ? 'simple' : i === 1 ? 'vigorous' : i === 2 ? 'special' : 'ultra', cycleQuarters: 2, actionQuarters: null, nativeGrid: { width: 64, height: 64 }, sourceOffset: { x: 0, y: 0 }, keys: [0, .5, 1, 1.5].map((atQuarter, pose) => ({ atQuarter, pose })), drawings: [0, 1, 2, 3].map(i => ({ path: `/pose-${i}.png`, sha256: String(i).repeat(64), pivot: { x: 0, y: 0 } })) })) } satisfies StreetActor)) };
const input = { catalog, source, mapping, assets };
const bytes = await readFile(new URL('../../../ui/video/wasm/video-scene.wasm', import.meta.url));

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
  const result = await prepareStreetSong({ ...input, source: { ...source, values } });
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
  const result = await prepareStreetSong({ ...input, source: { ...source, values } });
  assert.equal(result.kind, 'blocked'); if (result.kind !== 'blocked') return;
  assert(result.diagnostics.some(item => item.cell === `${String.fromCharCode(64 + bar.column)}10` && item.text === '?'));
});


test('unrouted reference voice obeys blank idle, dash intensity reset and sampled gray', async () => {
  const reference = rows.find(row => row.name === 'Bass'); assert(reference);
  const row = Number(reference.labelCell.match(/[0-9]+$/)?.[0]);
  const values = source.values.map(row => [...row]);
  for (const [index, text] of ['!!', '-', "-'", ''].entries()) values[row - 1][compiled.chart.bars[index].column - 1] = text;
  const result = await prepareStreetSong({ ...input, source: { ...source, values } });
  assert.equal(result.kind, 'ready'); if (result.kind !== 'ready') return;
  const actor = rows.findIndex(item => item.labelCell === reference.labelCell);
  const sampler = await createStreetSampler(bytes, result.scene);
  try {
    assert.deepEqual([0, 4, 8, 12].map(at => { const frame = sampler.sample(at)[actor]; return [frame.clip, frame.grayscale]; }), [[3, false], [1, false], [1, true], [0, false]]);
  } finally { sampler.dispose(); }
});
