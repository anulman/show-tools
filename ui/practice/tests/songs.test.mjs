import test from 'node:test';
import assert from 'node:assert/strict';
import { SONGS, loadSong } from '../../../songs/index.ts';
import { playableBars } from '../../../lib/performance/chart.ts';

test('loadable scripts keep song tempo, sheet columns, and trigger patterns separate', async () => {
  const loaded = await Promise.all(SONGS.map(entry => loadSong(entry.id)));
  assert.deepEqual(loaded.map(song => song.id), ['dance-yrself-clean', 'drunk-girls', 'i-can-change', 'tribulations', 'daft-punk', 'all-i-want', 'you-wanted-a-hit']);
  assert.deepEqual(loaded.map(song => song.chart.bpm), [98, 144, 117.1, 132, 154, 137, 127]);
  assert.deepEqual(loaded.map(song => song.chart.bars[0].column), [3, 4, 5, 3, 4, 3, 2]);
  const otherSongs = loaded.filter(song => song.id !== 'all-i-want');
  assert.deepEqual(otherSongs.map(song => song.practice.endBar), [218, 137, 169, 160, 192, 244]);
  assert.deepEqual(otherSongs.map(song => playableBars(song.chart)), [218, 137, 169, 160, 192, 244]);
  const allIWant = loaded[5];
  assert.equal(allIWant.practice.endBar, playableBars(allIWant.chart));
  assert.equal(allIWant.chart.bars[6].label, '1', 'numbered bar 1 follows six full pickup measures');
  assert.equal(allIWant.chart.bars[226].label, '221');
  assert.equal(allIWant.compiled.executable, true);
  assert.equal(allIWant.compiled.preflight.referenceMidi, 64);
  assert.deepEqual(allIWant.compiled.preflight.cues.map(cue => cue.buttonId), ['R1', 'R2']);
  assert.deepEqual(allIWant.compiled.voices.map(voice => voice.buttonId).sort(), ['L1', 'L2', 'R1', 'R2']);
  assert.equal(loaded[0].chart.sections[0].label, 'Instrumental A1');
  assert.equal(loaded[1].chart.sections[0].label, 'Intro');
  assert.equal(loaded[2].chart.sections[0].label, 'Intro 1');
  assert.equal(loaded[1].chart.bars[0].label, 'Pickup');
  assert.equal(loaded[1].chart.bars[8].label, '0.8');
  assert.equal(loaded[1].chart.bars[9].label, '1', 'numbered bar 1 follows nine full pickup measures');
  assert.equal(loaded[1].chart.bars[16].partial, false, 'starred section changes are not partial bars');
  assert.equal(loaded[1].compiled.executable, true);
  assert.equal(loaded[2].compiled.executable, true);
  assert.ok(loaded[2].compiled.cues.length > 0);
  for (const index of [4, 6]) {
    assert.equal(loaded[index].compiled?.executable, true);
    assert.deepEqual(loaded[index].compiled.cues, []);
    assert.deepEqual(loaded[index].compiled.takes, []);
    assert.ok(loaded[index].source?.values.some(row => row[0] === 'AF - Vocals' && row.slice(1).some(Boolean)));
  }
  assert.equal(loaded[3].compiled.executable, true);
  assert.equal(loaded[0].compiled.chart, loaded[0].chart, 'DYC exposes the compiled source chart');
  assert(loaded[0].compiled.cues.length > 0, 'DYC provides compiled chart instructions');
  for (const song of loaded) assert.equal(song.program.controls, undefined);
  for (const song of loaded) {
    assert.match(song.description, /chart/i);
    assert.deepEqual(song.program.events, [], 'songs do not auto-play synthetic samples');
    for (const event of song.program.events) assert(event.atBeat >= 0 && event.atBeat < song.program.lengthBeats);
  }
  await assert.rejects(loadSong('not-on-the-set-list'), /registered/);
});
