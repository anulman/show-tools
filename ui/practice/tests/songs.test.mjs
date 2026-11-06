import test from 'node:test';
import assert from 'node:assert/strict';
import { SONGS, loadSong } from '../../../songs/index.ts';
import { playableBars } from '../../../lib/performance/chart.ts';

test('loadable scripts keep song tempo, sheet columns, and trigger patterns separate', async () => {
  const loaded = await Promise.all(SONGS.map(entry => loadSong(entry.id)));
  assert.deepEqual(loaded.map(song => song.chart.bpm), [98, 144, 117]);
  assert.deepEqual(loaded.map(song => song.chart.bars[0].column), [3, 4, 4]);
  assert.deepEqual(loaded.map(song => song.practice.endBar), [218, 16, 16]);
  assert.deepEqual(loaded.map(song => playableBars(song.chart)), [218, 128, 169]);
  assert.equal(loaded[0].chart.sections[0].label, 'Instrumental A1');
  assert.equal(loaded[1].chart.sections[0].label, 'Intro 1');
  assert.equal(loaded[2].chart.sections[0].label, 'Intro 1');
  assert.equal(loaded[1].chart.bars[7].bar, 8, 'a starred source bar stays numbered');
  assert.equal(loaded[1].chart.bars[7].partial, false, 'starred section changes are not partial bars');
  assert.equal(loaded[1].compiled, undefined);
  assert.equal(loaded[2].compiled, undefined);
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
