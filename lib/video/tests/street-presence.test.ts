import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Schema } from 'effect';
import fitInput from '../../../assets/video/motion/poof/scene-fits/street.json';
import { StreetFitProfileSchema } from '../street-fit.js';
import { prepareStreetPresence, type StreetPresenceAssets } from '../street-presence.js';
import { prepareStreetScore, type ActorFrame, type PreparedStreetScene, type StreetActor, type StreetPoofEffect, type StreetWindow } from '../street-score.js';
import { createStreetSampler } from '../street-sampler.js';

const fitProfile = Schema.decodeUnknownSync(StreetFitProfileSchema)(fitInput);
const wasm = await readFile(new URL('../../../ui/video/wasm/video-scene.wasm', import.meta.url));
const dummyHash = 'a'.repeat(64);
type Span = { start: number; end: number };
type CastSpec = { code: string; role: StreetActor['role']; active: readonly Span[]; sampled?: boolean };
const effects: StreetPoofEffect[] = ['soft', 'pixel', 'star'].map(id => ({
  id, nativeGrid: { width: 128, height: 128 }, pivot: { x: 64, y: 106 },
  drawings: Array.from({ length: 6 }, (_, pose) => ({ path: `${id}/${pose}.png`, sha256: dummyHash })),
}));

function stateWindows(duration: number, spans: readonly Span[], sampled: boolean): StreetWindow[] {
  const boundaries = [...new Set([0, duration, ...spans.flatMap(span => [span.start, span.end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => ({
    start, end: boundaries[index + 1], active: spans.some(span => span.start <= start && start < span.end),
    emphasis: 'normal', source: sampled ? 'sampled' : 'live', specialIndex: 0, ultraIndex: 0,
  }));
}

function fixture({ cast, duration = 16, sections = [{ start: 0, end: duration }], meter = 4 }: {
  cast: readonly CastSpec[]; duration?: number; sections?: readonly Span[]; meter?: 4 | 8;
}) {
  const actors: StreetActor[] = cast.map(spec => {
    const fit = fitProfile.actors.find(actor => actor.code === spec.code);
    assert(fit, `Missing tracked fit for ${spec.code}`);
    return {
      characterId: spec.code, role: spec.role,
      placement: { ...fit.bodyAnchor, scale: fit.bodyScale, depth: 0 },
      clips: ['simple', 'vigorous', 'special'].map((tier, index) => ({
        id: `${spec.code}-${tier}`, tier: index === 0 ? 'simple' : index === 1 ? 'vigorous' : 'special',
        cycleQuarters: 2, actionQuarters: null, nativeGrid: { width: 64, height: 80 }, sourceOffset: { x: 0, y: 0 },
        keys: [0, .5, 1, 1.5].map((atQuarter, pose) => ({ atQuarter, pose })),
        drawings: Array.from({ length: 4 }, (_, pose) => ({ path: `${spec.code}/${tier}/${pose}.png`, sha256: dummyHash, pivot: { x: 32, y: 77 } })),
      })),
    };
  });
  const windows = cast.map((spec, actor) => ({ actor, states: stateWindows(duration, spec.active, spec.sampled ?? false), accents: [], downbeats: [] }));
  const raw: PreparedStreetScene = {
    version: 2, kind: 'authored-street-preview', width: fitProfile.width, height: fitProfile.height,
    background: { path: 'synthetic-background.png', sha256: dummyHash },
    previewCountsPerSecond: 2, durationCounts: duration, countedBeatUnit: meter, actors, tracks: [], staging: { kind: 'all-present' },
    provenance: { source: 'synthetic-presence-policy', assetsDigest: dummyHash, scoreDigest: dummyHash },
  };
  const body = prepareStreetScore({ scene: raw, windows }).scene;
  const assets: StreetPresenceAssets = {
    effects, fitProfile: { ...fitProfile, actors: fitProfile.actors.filter(actor => cast.some(spec => spec.code === actor.code)) },
    poofCatalogSha256: fitProfile.poofCatalog.sha256, fitProfileSha256: dummyHash,
  };
  const prepared = prepareStreetPresence({ scene: body, windows, sections, assets });
  assert.deepEqual(prepared.scene.tracks, body.tracks, 'Presence preparation must not insert or retime dance poses');
  assert.deepEqual(prepared.scene.actors, body.actors, 'Presence preparation must not alter frozen character clips or body placements');
  return { ...prepared, body, assets, windows, sections };
}

function namedFrame(scene: PreparedStreetScene, frames: readonly ActorFrame[], code: string): ActorFrame {
  const actor = scene.actors.findIndex(actor => actor.characterId === code);
  assert(actor >= 0, `Unknown fixture character ${code}`);
  const frame = frames.find(frame => frame.actor === actor);
  assert(frame, `Missing sampled frame for ${code}`);
  return frame;
}

test('singer remains colored and present without poofs; backup stays through gaps until each section ends', async () => {
  const prepared = fixture({ cast: [
    { code: 'A07', role: 'main-vocals', active: [{ start: 0, end: 8 }], sampled: true },
    { code: 'A02', role: 'backup-vocals', active: [{ start: 3, end: 4 }, { start: 6, end: 6.5 }, { start: 11, end: 12 }] },
  ], sections: [{ start: 0, end: 8 }, { start: 8, end: 16 }] });
  assert.deepEqual(prepared.presenceRanges, [
    { characterId: 'A07', ranges: [{ start: 0, end: 16 }] },
    { characterId: 'A02', ranges: [{ start: 3, end: 8 }, { start: 11, end: 16 }] },
  ]);
  assert(!prepared.decisions.some(decision => decision.characterId === 'A07'));
  const staging = prepared.scene.staging;
  assert.equal(staging.kind, 'poof'); if (staging.kind !== 'poof') return;
  assert.equal(staging.tracks[0].initiallyPresent, true, 'Singer is already onstage before the song begins');
  assert.equal(staging.tracks[1].initiallyPresent, false, 'Backup starts offstage until its first cue');
  assert.deepEqual(staging.tracks[0].keys, [{ at: 0, visible: true, poof: null }]);
  const sampler = await createStreetSampler(wasm, prepared.scene);
  try {
    for (const at of [0, 2.999999, 3, 4.5, 6.25, 8, 10.999999, 11, 15.999999]) {
      const singer = namedFrame(prepared.scene, sampler.sample(at), 'A07');
      assert.equal(singer.visible, true, `Singer presence at ${at}`);
      assert.equal(singer.poof, null);
      assert.equal(singer.grayscale, false);
    }
    for (const [at, visible] of [[0, false], [2.999999, false], [3, true], [4.5, true], [6.75, true], [7.999999, true], [8, false], [10.999999, false], [11, true], [15.999999, true]]) {
      assert.equal(namedFrame(prepared.scene, sampler.sample(Number(at)), 'A02').visible, visible, `Backup presence at ${at}`);
    }
    const backupGap = namedFrame(prepared.scene, sampler.sample(4.5), 'A02');
    assert.equal(backupGap.clip, 0, 'Present backup uses simple dance between activity gaps');
    assert.equal(namedFrame(prepared.scene, sampler.sample(3.25), 'A02').clip, 1);
    assert.equal(namedFrame(prepared.scene, sampler.sample(3.25), 'A07').clip, 0, 'Singer stays present/simple during actual backup activity');
    assert.equal(namedFrame(prepared.scene, sampler.sample(4.5), 'A07').clip, 1, 'Singer resumes normal dance after the backup cue');
    assert.equal(namedFrame(prepared.scene, sampler.sample(12.5), 'A07').clip, 0, 'Singer remains present/simple outside active lyric sections');
  } finally { sampler.dispose(); }
});

test('adjacent backup sections retain their exit and entry under one peak without a visible absence', async () => {
  const prepared = fixture({ cast: [
    { code: 'A07', role: 'main-vocals', active: [] },
    { code: 'A02', role: 'backup-vocals', active: [{ start: 3.5, end: 4.5 }] },
  ], duration: 8, sections: [{ start: 0, end: 4 }, { start: 4, end: 8 }] });
  assert.deepEqual(prepared.presenceRanges.find(actor => actor.characterId === 'A02')?.ranges, [{ start: 3.5, end: 8 }],
    'Touching section spans represent continuous visible presence');
  const firstCloud = prepared.decisions.find(decision => decision.characterId === 'A02');
  assert(firstCloud);
  assert.deepEqual(firstCloud.flips, [
    { at: 3.5, visible: true }, { at: 4, visible: false }, { at: 4, visible: true },
  ], 'Section-end exit and next-section entry must remain authored events even when their count is equal');
  assert.equal(firstCloud.firstFlip, 3.5);
  assert.equal(firstCloud.lastFlip, 4);
  assert.equal(firstCloud.end, 5);
  const sampler = await createStreetSampler(wasm, prepared.scene);
  try {
    for (const at of [3.5, 3.999999, 4, 4.000001, 4.249999]) {
      const frame = namedFrame(prepared.scene, sampler.sample(at), 'A02');
      assert.equal(frame.visible, true, `No rendered offstage gap at the section handoff: ${at}`);
      assert.equal(frame.poof?.pose, 2, `Merged cloud holds its opaque peak across both section edges: ${at}`);
    }
    assert.equal(namedFrame(prepared.scene, sampler.sample(4.25), 'A02').poof?.pose, 3);
    assert.equal(namedFrame(prepared.scene, sampler.sample(5), 'A02').poof, null);
    assert.equal(namedFrame(prepared.scene, sampler.sample(5), 'A02').clip, 0, 'Backup remains visible/simple after its next-section cue ends');
    assert.equal(namedFrame(prepared.scene, sampler.sample(7.999999), 'A02').visible, true);
    for (const at of [0, 3.5, 4, 7.999999]) {
      const singer = namedFrame(prepared.scene, sampler.sample(at), 'A07');
      assert.equal(singer.visible, true);
      assert.equal(singer.poof, null, 'An inactive singer still has no entrance or section poof');
    }
  } finally { sampler.dispose(); }
});

test('rapid activity reversals share one cloud while visibility flips exactly and peak holds until the last flip', async () => {
  const prepared = fixture({ cast: [{ code: 'A29', role: 'instrument', active: [{ start: 2, end: 2.5 }, { start: 3, end: 3.5 }] }], duration: 8 });
  assert.equal(prepared.decisions.length, 1, 'Overlapping effect spans must merge into one cloud');
  assert.deepEqual(prepared.decisions[0].flips, [
    { at: 2, visible: true }, { at: 2.5, visible: false }, { at: 3, visible: true }, { at: 3.5, visible: false },
  ]);
  assert.equal(prepared.decisions[0].start, 1.5);
  assert.equal(prepared.decisions[0].end, 4.5);
  const sampler = await createStreetSampler(wasm, prepared.scene);
  try {
    for (const [at, expected] of [[1.499999, null], [1.5, 0], [1.75, 1], [2, 2], [2.5, 2], [3, 2], [3.5, 2], [3.749999, 2], [3.75, 3], [4, 4], [4.25, 5], [4.5, null]]) {
      assert.equal(sampler.sample(Number(at))[0].poof?.pose ?? null, expected, `Poof pose at ${at}`);
    }
    for (const [edge, incoming] of [[2, true], [2.5, false], [3, true], [3.5, false]]) {
      const at = Number(edge);
      assert.equal(sampler.sample(at - .000001)[0].visible, !incoming);
      assert.equal(sampler.sample(at)[0].visible, incoming);
      assert.equal(sampler.sample(at)[0].poof?.pose, 2, 'Every body switch happens under the opaque peak');
    }
    assert.equal(sampler.sample(6)[0].visible, false, 'Blank activity removes the instrument instead of keeping an idle actor onstage');
  } finally { sampler.dispose(); }
});

test('quarter-note poof lead and drawing holds convert to eighth-note counted positions', async () => {
  const prepared = fixture({ cast: [{ code: 'A04', role: 'instrument', active: [{ start: 4, end: 8 }] }], duration: 12, meter: 8 });
  assert.equal(prepared.decisions[0].start, 3, 'Half a quarter-note lead equals one eighth-note count');
  assert.equal(prepared.decisions[0].end, 6);
  const sampler = await createStreetSampler(wasm, prepared.scene);
  try {
    for (const [at, pose] of [[2.999999, null], [3, 0], [3.5, 1], [4, 2], [4.5, 3], [5, 4], [5.5, 5], [6, null], [7, 0], [7.5, 1], [8, 2]]) {
      assert.equal(sampler.sample(Number(at))[0].poof?.pose ?? null, pose, `Eighth-count poof pose at ${at}`);
    }
    assert.equal(sampler.sample(3.999999)[0].visible, false);
    assert.equal(sampler.sample(4)[0].visible, true);
    assert.equal(sampler.sample(8)[0].visible, false);
  } finally { sampler.dispose(); }
});

test('initial active instruments begin at opaque peak and final effects stop at the half-open song boundary', async () => {
  const prepared = fixture({ cast: [{ code: 'A26', role: 'instrument', active: [{ start: 0, end: 4 }] }], duration: 4 });
  assert.equal(prepared.scene.durationCounts, 4, 'Effect tail must not extend the song');
  const staging = prepared.scene.staging;
  assert.equal(staging.kind, 'poof'); if (staging.kind !== 'poof') return;
  assert.equal(staging.tracks[0].initiallyPresent, false, 'Active-at-zero instruments still enter under an initial cloud');
  assert(staging.tracks[0].keys.every(key => key.at >= 0 && key.at < 4));
  assert.equal(staging.tracks[0].keys[0].poof?.pose, 2, 'The clipped entrance starts under Frame2, not an exposed body or a new pre-roll');
  const sampler = await createStreetSampler(wasm, prepared.scene);
  try {
    assert.equal(sampler.sample(0)[0].visible, true);
    assert.equal(sampler.sample(0)[0].poof?.pose, 2);
    assert.equal(sampler.sample(.25)[0].poof?.pose, 3);
    assert.equal(sampler.sample(1)[0].poof, null);
    assert.equal(sampler.sample(3.5)[0].poof?.pose, 0);
    assert.equal(sampler.sample(3.75)[0].poof?.pose, 1);
    assert.equal(sampler.sample(3.999999)[0].visible, true);
  } finally { sampler.dispose(); }
});

test('variant selection is stable across actor ordering and obeys each tracked fit admission', () => {
  const active = Array.from({ length: 8 }, (_, index) => ({ start: index * 4 + 2, end: index * 4 + 3 }));
  const cast: CastSpec[] = [
    { code: 'A29', role: 'instrument', active },
    { code: 'A04', role: 'instrument', active },
    { code: 'A10', role: 'instrument', active },
  ];
  const forward = fixture({ cast, duration: 36 });
  const reversed = fixture({ cast: [...cast].reverse(), duration: 36 });
  const signature = (result: ReturnType<typeof fixture>) => result.decisions.map(decision => ({
    code: decision.characterId, at: decision.firstFlip, effect: decision.effectId,
  })).sort((a, b) => a.code.localeCompare(b.code) || a.at - b.at);
  assert.deepEqual(signature(forward), signature(reversed));
  assert.deepEqual(signature(forward), signature(fixture({ cast, duration: 36 })), 'Repeat preparation must not depend on process randomness');
  for (const decision of forward.decisions) {
    const fit = fitProfile.actors.find(actor => actor.code === decision.characterId);
    assert(fit);
    assert(fit.allowedEffectIds.includes(decision.effectId));
    if (decision.characterId === 'A29') assert.notEqual(decision.effectId, 'pixel', 'Tapir pixel-pop was not admitted at this fit');
  }
  const staging = forward.scene.staging;
  assert.equal(staging.kind, 'poof'); if (staging.kind !== 'poof') return;
  for (const track of staging.tracks) {
    const fit = fitProfile.actors.find(actor => actor.code === forward.scene.actors[track.actor].characterId);
    assert(fit);
    assert.deepEqual(track.offset, fit.offset);
    assert.equal(track.scale, fit.scale);
  }
});

test('presence is independent of dance cadence and native samples are identical under backward and unrelated seeks', async () => {
  const prepared = fixture({ cast: [
    { code: 'A07', role: 'main-vocals', active: [{ start: 0, end: 8 }] },
    { code: 'A02', role: 'backup-vocals', active: [{ start: 2, end: 2.5 }, { start: 5, end: 6 }] },
    { code: 'B23', role: 'instrument', active: [{ start: 2, end: 2.5 }, { start: 3, end: 3.5 }], sampled: true },
  ], duration: 8 });
  const sampler = await createStreetSampler(wasm, prepared.scene);
  const bodySampler = await createStreetSampler(wasm, prepared.body);
  const bodyOnly = (frames: readonly ActorFrame[]) => frames.map(({ visible, poof, ...body }) => body);
  try {
    const points = [...new Set([0, 7.999999, ...Array.from({ length: 32 }, (_, index) => index / 4),
      1.499999, 1.749999, 1.999999, 2.499999, 2.999999, 3.499999, 3.749999])].sort((a, b) => a - b);
    const expected = new Map(points.map(at => [at, sampler.sample(at)]));
    for (const at of [...points].reverse()) {
      assert.deepEqual(sampler.sample(at), expected.get(at), `Backward seek at ${at}`);
      assert.deepEqual(bodyOnly(sampler.sample(at)), bodyOnly(bodySampler.sample(at)), `Presence must not create a dance pose change at ${at}`);
    }
    for (let index = 0; index < 100; index++) sampler.sample((index * 17 % 32) / 4);
    for (const at of points) assert.deepEqual(sampler.sample(at), expected.get(at));
    const sampled = namedFrame(prepared.scene, sampler.sample(2), 'B23');
    assert.equal(sampled.grayscale, true);
    assert.equal(sampled.poof?.pose, 2);
    assert.equal(sampled.visible, true);
  } finally { sampler.dispose(); bodySampler.dispose(); }
});
