import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileStreetScore, parseStreetScene, type PreparedStreetScene, type StreetActor, type StreetWindow } from '../street-score.js';
import { createStreetSampler } from '../street-sampler.js';
import { grayscaleRgba } from '../presentation.js';

function actor(role: StreetActor['role'], ultra = true): StreetActor {
  return { characterId: role, role, placement: { x: 0, y: 0, scale: 1, depth: 0 },
    clips: (ultra ? ['simple', 'vigorous', 'special', 'ultra'] : ['simple', 'vigorous', 'special']).map((tier, i) => ({
      id: `${role}-${tier}`, tier: tier === 'simple' ? 'simple' : tier === 'vigorous' ? 'vigorous' : tier === 'special' ? 'special' : 'ultra',
      cycleQuarters: 2, actionQuarters: i > 1 ? 1 : null, nativeGrid: { width: 64, height: 80 }, sourceOffset: { x: 32, y: 24 },
      keys: [0, .25, .5, .75, 2].map((atQuarter, i) => ({ atQuarter, pose: i % 4 })),
      drawings: [0, 1, 2, 3].map(pose => ({ path: `pose-${pose}.png`, pivot: { x: 64, y: 101 } })),
    })),
  };
}
function state(start: number, end: number, patch: Partial<StreetWindow> = {}): StreetWindow {
  return { start, end, active: true, emphasis: 'normal', source: 'live', specialIndex: 0, ultraIndex: 0, ...patch };
}
function input(actors: readonly StreetActor[] = [actor('instrument')]) {
  const scene: PreparedStreetScene = { version: 1, kind: 'authored-street-preview', width: 1280, height: 720, background: 'street.png', previewCountsPerSecond: 2, durationCounts: 2, countedBeatUnit: 4, actors, tracks: [], provenance: { source: 'synthetic', assetsDigest: 'fixture', scoreDigest: 'fixture' } };
  return { scene, opportunities: [0, .25, .5, .75, 1, 1.25, 1.5, 1.75], downbeats: [0], windows: actors.map((_, actor) => ({ actor, states: [state(0, 2)] })) };
}
const bytes = await readFile(new URL('../../../ui/video/wasm/video-scene.wasm', import.meta.url));

test('Street sampler is standalone with no host imports', async () => {
  assert.deepEqual(WebAssembly.Module.imports(await WebAssembly.compile(bytes)), []);
});

test('half-count initial hold, quarter-count later transitions, direct seeks use the shared C++ WASM table', async () => {
  const scene = compileStreetScore(input());
  const sampler = await createStreetSampler(bytes, scene);
  try {
    for (const [position, pose] of [[.75, 3], [0, 0], [.499999, 0], [.5, 2], [.749999, 2]]) assert.equal(sampler.sample(position)[0].pose, pose);
    const direct = sampler.sample(.75);
    for (let i = 0; i < 1000; i++) sampler.sample(i % 2);
    assert.deepEqual(sampler.sample(.75), direct);
    assert.throws(() => sampler.sample(NaN));
  } finally { sampler.dispose(); }
});

test('source presentation changes independently inside a pose hold', async () => {
  const authored = input();
  authored.windows[0].states = [state(0, .25), state(.25, 2, { source: 'sampled' })];
  const sampler = await createStreetSampler(bytes, compileStreetScore(authored));
  try { assert.deepEqual(sampler.sample(.25)[0], { actor: 0, clip: 1, pose: 0, grayscale: true }); } finally { sampler.dispose(); }
});

test('main singer stays color and returns to simple while actual backup activity is supplied', async () => {
  const authored = input([actor('main-vocals'), actor('backup-vocals')]);
  authored.windows[0].states = [state(0, 2, { source: 'sampled', emphasis: 'ultra' })];
  authored.windows[1].states = [state(0, 1, { active: false }), state(1, 2)];
  const sampler = await createStreetSampler(bytes, compileStreetScore(authored));
  try {
    assert.deepEqual(sampler.sample(.75).map(frame => [frame.clip, frame.grayscale]), [[3, false], [0, false]]);
    assert.deepEqual(sampler.sample(1).map(frame => [frame.clip, frame.grayscale]), [[0, false], [1, false]]);
    assert.equal(sampler.sample(1).length, 2);
  } finally { sampler.dispose(); }
});

test('ultra fallback occurs only for an empty verified ultra set', () => {
  const fallback = input([actor('instrument', false)]); fallback.windows[0].states = [state(0, 2, { emphasis: 'ultra' })];
  assert.equal(compileStreetScore(fallback).tracks[0].keys[0].clip, 2);
  const available = input(); available.windows[0].states = [state(0, 2, { emphasis: 'ultra', ultraIndex: 99 })];
  assert.throws(() => compileStreetScore(available), /missing requested ultra/);
});

test('reject overlapping anchors, missing vigorous, invalid direct input and incomplete state coverage', () => {
  assert.throws(() => compileStreetScore({ ...input(), downbeats: [0, .25] }), /half-count hold/);
  const authored = input(); authored.windows[0].states = [state(0, 1)];
  assert.throws(() => compileStreetScore(authored), /complete preview/);
  const prepared = compileStreetScore(input());
  assert.throws(() => parseStreetScene({ ...prepared, actors: [{ ...prepared.actors[0], clips: prepared.actors[0].clips.filter(clip => clip.tier !== 'vigorous') }] }), /no vigorous/);
});

test('grayscale preserves alpha exactly, native geometry and neutral channels', () => {
  const rgba = Uint8Array.from([255, 0, 0, 123, 0, 255, 0, 0, 17, 17, 17, 255]);
  grayscaleRgba(rgba);
  assert.deepEqual([...rgba], [54, 54, 54, 123, 182, 182, 182, 0, 17, 17, 17, 255]);
});
