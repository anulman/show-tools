import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTanstackDeskDocument } from '../../lib/remote-performance/desk-paths.js';
import { SONGS } from '../../songs/index.js';
import { nextSetSong, SET_SONGS, songForRoute, songRoute } from '../../songs/routes.js';

test('numbered routes use the existing song registry and preserve absent slots', () => {
  assert.deepEqual(SONGS.map(song => song.id), SET_SONGS.map(song => song.id));
  assert.equal(songRoute('i-can-change'), '03-i-can-change');
  assert.equal(songRoute('tribulations'), '04-tribulations');
  assert.deepEqual(SET_SONGS.filter(song => song.previewOnly).map(song => songRoute(song.id)), [
    '03-i-can-change', '05-daft-punk', '06-all-i-want', '07-you-wanted-a-hit',
  ]);
  assert.deepEqual(SET_SONGS.filter(song => !song.previewOnly).map(song => song.id), [
    'dance-yrself-clean', 'drunk-girls', 'tribulations',
  ]);
  assert.equal(songForRoute('03-tribulations'), undefined);
  assert.equal(songForRoute('4-tribulations'), undefined);
  for (const song of SET_SONGS) {
    const route = songRoute(song.id);
    assert.ok(route);
    assert.deepEqual(songForRoute(route), song);
    assert.equal(isTanstackDeskDocument('/' + route), true);
    assert.equal(isTanstackDeskDocument('/browser/' + route), true);
  }
});

test('preload chooses one available successor and stops at the end', () => {
  const installed = ['tribulations', 'drunk-girls', 'dance-yrself-clean'];
  assert.equal(nextSetSong('dance-yrself-clean', installed)?.id, 'drunk-girls');
  assert.equal(nextSetSong('drunk-girls', installed)?.id, 'tribulations');
  assert.equal(nextSetSong('tribulations', installed), undefined);
  assert.equal(nextSetSong('unknown', installed), undefined);
});
