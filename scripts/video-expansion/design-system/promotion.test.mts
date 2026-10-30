import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeFromCanonical, verifyTiming } from './promotion.mjs';
import { verifyPublished } from './published.mjs';

const publication = await verifyPublished('assets/video/published/C06-default/promotion.json');
function timeline() {
  return {
    rootNodeId: publication.canonical.timelineRootId,
    duration: publication.reexport.durationSeconds,
    tracks: publication.drawings.map(drawing => ({
      componentId: drawing.nodeId,
      track: { keyframes: Array.from({ length: 65 }, (_, sample) => {
        const time = sample / 8, beat = sample === 64 ? 0 : time * 2 % publication.cycleBeats;
        const key = [...publication.keyframes].reverse().find(key => key.atBeat <= beat);
        return { timelinePosition: time, easing: { type: 'HOLD' }, value: { value: key?.pose === drawing.index ? 1 : 0 } };
      }) },
    })),
  };
}

test('canonical HOLD timing is checked at every declared change and closure', () => {
  assert.equal(verifyTiming(publication, timeline()), 65);
  const wrong = timeline(); wrong.tracks[0].track.keyframes[0].value.value = 0;
  assert.throws(() => verifyTiming(publication, wrong), /HOLD timing failed/);
  const fade = timeline(); fade.tracks[1].track.keyframes[0].value.value = .5;
  assert.throws(() => verifyTiming(publication, fade));
});

test('a short unintended blink between review samples cannot pass', () => {
  const wrong = timeline();
  wrong.tracks[0].track.keyframes.splice(1, 0,
    { timelinePosition: .01, easing: { type: 'HOLD' }, value: { value: 0 } },
    { timelinePosition: .02, easing: { type: 'HOLD' }, value: { value: 1 } });
  assert.throws(() => verifyTiming(publication, wrong), /HOLD timing failed/);
});

test('canonical pixel sampling preserves scale, registration and transparent background', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canonical-pixel-'));
  try {
    const path = join(root, 'pose.svg');
    await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="6"><path fill="#ff0000" d="M0 2h2v2H0z"/></svg>');
    const input = { ...publication, nativeGrid: { width: 2, height: 2 }, nativeToFigma: [[2, 0, 0], [0, 2, 2]] };
    const pixels = await nativeFromCanonical(path, input);
    assert.deepEqual([...pixels], [255, 0, 0, 255, ...Array<number>(12).fill(0)]);
    await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="6"><path fill="#f5f5f5" d="M0 0h4v6H0z"/><path fill="#ff0000" d="M0 2h2v2H0z"/></svg>');
    assert.notDeepEqual(await nativeFromCanonical(path, input), pixels);
  } finally { await rm(root, { recursive: true, force: true }); }
});
