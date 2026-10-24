import test from 'node:test';
import assert from 'node:assert/strict';
import { parseControlCue, compileChartControls } from '../../../lib/performance/chart-controls.js';
import { CONTROLS } from '../../../lib/performance/model.js';
import { loadSong } from '../../../songs/index.ts';

test('sheet legend maps capture, commit, rearm, stop, and play without inventing blank-cell actions', () => {
  for (const [notation, kind] of [['r', 'arm'], ['c', 'commit'], ['cr', 'commit-arm'], ['x', 'stop'], ['p', 'play']]) {
    assert.deepEqual(parseControlCue(notation), { kind, timing: 'now' });
    assert.deepEqual(parseControlCue(notation + 'b'), { kind, timing: 'bar' });
  }
  assert.deepEqual(parseControlCue(''), { kind: 'none' });
  assert.deepEqual(parseControlCue('unrecognized'), { kind: 'unsupported', notation: 'unrecognized' });
  assert.deepEqual(parseControlCue('&a]'), { kind: 'tap', notation: '&a]', beats: [3.5, 3.75] });
  assert.deepEqual(parseControlCue("&]'"), { kind: 'tap', notation: "&]'", beats: [3.5] });
  assert.deepEqual(parseControlCue('4e&a'), { kind: 'tap', notation: '4e&a', beats: [3, 3.25, 3.5, 3.75] });
});

test('Dance Yrself Clean pad routes come from its actual active columns, including lead-in', async () => {
  const song = await loadSong('dance-yrself-clean');
  const controls = compileChartControls(song.chart);
  assert.deepEqual(controls.leadIn.R1, { kind: 'arm', timing: 'bar' });
  assert.deepEqual(controls.bars[0].R1, { kind: 'none' });
  assert.deepEqual(controls.bars[1].R1, { kind: 'commit', timing: 'bar' });
  assert.deepEqual(controls.bars[1].R2, { kind: 'arm', timing: 'bar' });
  assert.deepEqual(controls.bars[2].R2, { kind: 'commit-arm', timing: 'bar' });
  assert.deepEqual(controls.bars[3].R2, { kind: 'commit', timing: 'bar' });
  assert.deepEqual(controls.bars[10].R2, { kind: 'stop', timing: 'now' });
  assert.deepEqual(controls.bars[75].R1, { kind: 'stop', timing: 'bar' });
});

test('pad grid follows physical Q/W above A/S and preserves the left-hand column', () => {
  assert.deepEqual(CONTROLS.map(control => [control.id, control.shortcut]), [['L1', 'Q'], ['R1', 'W'], ['L2', 'A'], ['R2', 'S']]);
});

test('cowbell uses whole-bar takes and automatic chart playback in its loadable script', async () => {
  const song = await loadSong('dance-yrself-clean');
  const controls = song.program.controls;
  const capture = { kind: 'bar', variantKey: 'cowbell-double' };
  assert.deepEqual(controls.bars[1].R2.capture, capture);
  assert.deepEqual(controls.bars[2].R2.capture, { kind: 'bar', variantKey: 'cowbell-single' });
  assert.equal(controls.bars[3].R2.capture, undefined);
  assert.equal(controls.leadIn.R1.capture, undefined);
  assert.deepEqual(song.program.barPlayback.filter(cue => cue.variantKey === 'cowbell-double').map(cue => cue.bar), [8, 10]);
  assert.equal(controls.bars[7].R2.kind, 'none');
  assert.equal(controls.bars[9].R2.kind, 'none');
  assert.equal(controls.bars[10].R2.kind, 'stop');
  const other = await loadSong('drunk-girls');
  assert(!other.program.controls.bars.some(row => Object.values(row).some(cue => cue.capture)));
});

test('pad names are loaded from the selected chart notes, with no other song names leaking in', async () => {
  const dyc = await loadSong('dance-yrself-clean');
  assert.deepEqual(dyc.chart.controlNames, { L1: 'Whistle', R1: 'Drums & Claps', L2: 'Bing Bong', R2: 'Cowbell' });
  const drunk = await loadSong('drunk-girls');
  assert.deepEqual(drunk.chart.controlNames, { L1: 'L1', R1: 'R1', L2: 'L2', R2: 'R2' });
});
