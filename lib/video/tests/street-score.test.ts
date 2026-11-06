import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileStreetScore, parseStreetScene, type PreparedStreetScene, type StreetActor, type StreetWindow } from '../street-score.js';
import { createStreetSampler } from '../street-sampler.js';
import { parseSheetStageCell } from '../../performance/sheet-stage-notation.js';
import { grayscaleRgba } from '../presentation.js';

function actor(role: StreetActor['role'], ultra = true): StreetActor {
  return { characterId: role, role, placement: { x: 0, y: 0, scale: 1, depth: 0 },
    clips: (ultra ? ['simple', 'vigorous', 'special', 'ultra'] : ['simple', 'vigorous', 'special']).map((tier, i) => ({
      id: `${role}-${tier}`, tier: tier === 'simple' ? 'simple' : tier === 'vigorous' ? 'vigorous' : tier === 'special' ? 'special' : 'ultra',
      cycleQuarters: 2, actionQuarters: i > 1 ? 1 : null, nativeGrid: { width: 64, height: 80 }, sourceOffset: { x: 32, y: 24 },
      keys: [0, .25, .5, .75, 2].map((atQuarter, i) => ({ atQuarter, pose: i % 4 })),
      drawings: [0, 1, 2, 3].map(pose => ({ path: `pose-${pose}.png`, sha256: '0'.repeat(64), pivot: { x: 64, y: 101 } })),
    })),
  };
}
function state(start: number, end: number, patch: Partial<StreetWindow> = {}): StreetWindow {
  return { start, end, active: true, emphasis: 'normal', source: 'live', specialIndex: 0, ultraIndex: 0, ...patch };
}
function input(actors: readonly StreetActor[] = [actor('instrument')]) {
  const scene: PreparedStreetScene = { version: 2, kind: 'authored-street-preview', staging: { kind: 'all-present' }, width: 1280, height: 720, background: { path: 'street.png', sha256: '0'.repeat(64) }, previewCountsPerSecond: 2, durationCounts: 2, countedBeatUnit: 4, actors, tracks: [], provenance: { source: 'synthetic', assetsDigest: 'fixture', scoreDigest: 'fixture' } };
  return { scene, windows: actors.map((_, actor) => ({ actor, states: [state(0, 2)], accents: [0, .25, .5, .75, 1, 1.25, 1.5, 1.75], downbeats: [0] })) };
}
const bytes = await readFile(new URL('../../../ui/video/wasm/video-scene.wasm', import.meta.url));

test('Street sampler is standalone with no host imports', async () => {
  assert.deepEqual(WebAssembly.Module.imports(await WebAssembly.compile(bytes)), []);
});

test('native presence and effect HOLD lane seeks independently of frozen body poses', async () => {
  const body = compileStreetScore(input());
  const scene = parseStreetScene({ ...body, staging: { kind: 'poof', effects: [{ id: 'synthetic',
    nativeGrid: { width: 128, height: 128 }, pivot: { x: 64, y: 106 },
    drawings: Array.from({ length: 6 }, (_, index) => ({ path: `effect-${index}.png`, sha256: '0'.repeat(64) })) }],
  tracks: [{ actor: 0, keys: [
    { at: 0, visible: false, poof: null },
    { at: .25, visible: false, poof: { effect: 0, pose: 0 } },
    { at: .5, visible: true, poof: { effect: 0, pose: 2 } },
    { at: .75, visible: true, poof: { effect: 0, pose: 3 } },
    { at: 1, visible: false, poof: { effect: 0, pose: 2 } },
    { at: 1.5, visible: false, poof: null },
  ] }] } });
  const sampler = await createStreetSampler(bytes, scene), original = await createStreetSampler(bytes, body);
  try {
    const at = [-1, 0, .24999, .25, .49999, .5, .75, .99999, 1, 1.5, 1.99];
    const forward = at.map(count => sampler.sample(count));
    for (const index of [10, 5, 0, 8, 3, 1, 9, 2, 7, 6, 4]) {
      const frame = sampler.sample(at[index])[0];
      assert.deepEqual([frame], forward[index]);
      const old = original.sample(at[index])[0];
      assert.deepEqual([frame.clip, frame.pose, frame.grayscale], [old.clip, old.pose, old.grayscale]);
    }
    assert.deepEqual(forward[3][0].poof, { effect: 0, pose: 0 });
    assert.equal(forward[4][0].visible, false);
    assert.equal(forward[5][0].visible, true);
    assert.equal(forward[8][0].visible, false);
    assert.deepEqual(forward[8][0].poof, { effect: 0, pose: 2 });
    assert.equal(forward[9][0].poof, null);
    assert.throws(() => parseStreetScene({ ...scene, staging: { ...scene.staging, tracks: [] } }), /presence track/);
    const { staging, ...legacy } = body;
    assert.deepEqual(parseStreetScene(legacy).staging, { kind: 'all-present' });
  } finally { sampler.dispose(); original.dispose(); }
});

test('half-count initial hold, quarter-count later transitions, direct seeks use the shared C++ WASM table', async () => {
  const scene = compileStreetScore(input());
  const sampler = await createStreetSampler(bytes, scene);
  try {
    for (const [position, pose] of [[.75, 2], [0, 0], [.499999, 0], [.5, 1], [.749999, 1]]) assert.equal(sampler.sample(position)[0].pose, pose);
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
  try { assert.deepEqual(sampler.sample(.25)[0], { actor: 0, clip: 1, pose: 0, grayscale: true, visible: true, poof: null }); } finally { sampler.dispose(); }
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

test('overlapping anchors extend holds; reject missing vigorous and incomplete state coverage', () => {
  const overlapping = input(); overlapping.windows[0].downbeats = [0, .25];
  assert.equal(compileStreetScore(overlapping).tracks[0].keys[1].at, .75);
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

test('1&a advances successive source keys, while 1 3 keeps dancing between hits', () => {
  const authored = input();
  authored.windows[0].accents = [0, .5, .75];
  const keys = compileStreetScore(authored).tracks[0].keys;
  assert.deepEqual(keys.slice(0, 3).map(key => [key.at, key.pose]), [[0, 0], [.5, 1], [.75, 2]]);
  authored.windows[0].accents = [0];
  assert.deepEqual(compileStreetScore(authored).tracks[0].keys.slice(0, 3).map(key => [key.at, key.pose]), [[0, 0], [.5, 1], [.75, 2]]);
});

test('other actors accents and presentation boundaries do not advance this actor', () => {
  const authored = input([actor('main-vocals'), actor('instrument')]);
  authored.windows[0].accents = [0]; authored.windows[0].downbeats = [0];
  const baseline = compileStreetScore(authored).tracks[0];
  authored.windows[1].accents = [0, .75, 1.25]; authored.windows[1].downbeats = [.75];
  authored.windows[1].states = [state(0, .25), state(.25, 2, { source: 'sampled', emphasis: 'special' })];
  assert.deepEqual(compileStreetScore(authored).tracks[0], baseline);
});

test('coincident tier, anchor, and natural deadline emit entry once then honor its hold', () => {
  const authored = input();
  authored.windows[0].states = [state(0, .5), state(.5, 2, { emphasis: 'special' })];
  authored.windows[0].downbeats = [0, .5];
  const keys = compileStreetScore(authored).tracks[0].keys;
  assert.deepEqual(keys.slice(0, 3).map(key => [key.at, key.clip, key.pose]), [[0, 1, 0], [.5, 2, 0], [1, 2, 1]]);
});

test('special action repetition requires matching closing pixels and pivot, otherwise authored cycle remains', async () => {
  const { streetClipPlayback } = await import('../street-score.js');
  const clip = actor('instrument').clips[2];
  const closed = { ...clip, keys: [{ atQuarter: 0, pose: 0 }, { atQuarter: .5, pose: 1 }, { atQuarter: 1, pose: 0 }, { atQuarter: 2, pose: 0 }] };
  assert.equal(streetClipPlayback(closed).durationQuarters, 1);
  assert.equal(streetClipPlayback(closed).actionClosureVerified, true);
  for (const pivot of [{ x: 42, y: 77 }, { x: 32, y: 87 }]) {
    const shifted = { ...closed, drawings: closed.drawings.map((drawing, i) => ({ ...drawing, pivot: i === 2 ? pivot : { x: 32, y: 77 } })), keys: [{ atQuarter: 0, pose: 0 }, { atQuarter: .5, pose: 1 }, { atQuarter: 1, pose: 2 }, { atQuarter: 2, pose: 0 }] };
    const playback = streetClipPlayback(shifted);
    assert.equal(playback.durationQuarters, 2);
    assert.equal(playback.actionClosureVerified, false);
    assert(playback.keys.some(key => key.atQuarter === 1));
  }
  const open = { ...closed, drawings: closed.drawings.map((drawing, i) => ({ ...drawing, sha256: String(i).repeat(64) })), keys: [{ atQuarter: 0, pose: 0 }, { atQuarter: .5, pose: 1 }, { atQuarter: 1, pose: 2 }, { atQuarter: 2, pose: 0 }] };
  assert.equal(streetClipPlayback(open).durationQuarters, 2);
  assert.equal(streetClipPlayback(open).actionClosureVerified, false);
});


test('silent beat-4 anchor permits successive drawings on 4& and 4a', () => {
  const authored = input();
  const cell = parseSheetStageCell('(4)&a', 4);
  authored.scene = { ...authored.scene, durationCounts: 4, actors: authored.scene.actors.map(actor => ({ ...actor, clips: actor.clips.map(clip => ({ ...clip, keys: [0, .5, 1, 1.5].map((atQuarter, pose) => ({ atQuarter, pose })) })) })) };
  authored.windows[0].states = [state(0, 4)];
  authored.windows[0].accents = [...cell.accents]; authored.windows[0].downbeats = [cell.anchor ?? 0];
  assert.deepEqual(compileStreetScore(authored).tracks[0].keys.filter(key => key.at >= 3).map(key => [key.at, key.pose]), [[3, 2], [3.5, 3], [3.75, 0]]);
});

test('leading subdivision Cowbell anchors beat 1 and accents ongoing sequential drawings', () => {
  const authored = input();
  const cell = parseSheetStageCell('&e3a&', 4);
  authored.scene = { ...authored.scene, durationCounts: 4, actors: authored.scene.actors.map(actor => ({ ...actor, clips: actor.clips.map(clip => ({ ...clip, keys: [0, .5, 1, 1.5].map((atQuarter, pose) => ({ atQuarter, pose })) })) })) };
  authored.windows[0].states = [state(0, 4)];
  authored.windows[0].accents = [...cell.accents]; authored.windows[0].downbeats = [cell.anchor ?? 0];
  assert.deepEqual(compileStreetScore(authored).tracks[0].keys.map(key => [key.at, key.pose]), [[0, 0], [.5, 1], [1, 2], [1.25, 3], [1.75, 0], [2, 1], [2.5, 2], [2.75, 3], [3.25, 0], [3.5, 1]]);
});
