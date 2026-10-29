import test from 'node:test';
import assert from 'node:assert/strict';
import { parseControlCue } from '../../../lib/performance/chart-controls.js';
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

test('Dance Yrself Clean compiled pad routes retain source columns and lead-in timing', async () => {
  const song = await loadSong('dance-yrself-clean');
  const cues = song.compiled.cues;
  const leadIn = cues.find(cue => cue.bar === 0 && cue.buttonId === 'R1');
  assert.equal(leadIn.kind, 'arm');
  assert.equal(leadIn.source.a1, 'B18');
  assert.deepEqual(leadIn.execution, { kind: 'next-bar' });
  assert.deepEqual(cues.filter(cue => cue.buttonId === 'R2' && cue.bar <= 12)
    .map(cue => [cue.bar, cue.kind, cue.source.a1, cue.source.text, cue.execution]), [
    [9, 'arm', 'K19', 'rb', { kind: 'next-bar' }],
    [10, 'commit-arm', 'L19', 'crb', { kind: 'next-bar' }],
    [11, 'commit-arm', 'M19', 'crb', { kind: 'next-bar' }],
    [12, 'commit', 'N19', 'cb', { kind: 'next-bar' }],
  ]);
  const stop = cues.find(cue => cue.bar === 76 && cue.buttonId === 'R1');
  assert.equal(stop.kind, 'stop');
  assert.equal(stop.source.a1, 'BZ18');
  assert.deepEqual(stop.execution, { kind: 'next-bar' });
});

test('pad grid follows physical Q/W above A/S and preserves the left-hand column', () => {
  assert.deepEqual(CONTROLS.map(control => [control.id, control.shortcut]), [['L1', 'Q'], ['R1', 'W'], ['L2', 'A'], ['R2', 'S']]);
});

test('cowbell compiles six distinct whole-bar takes linked to its capture cues', async () => {
  const song = await loadSong('dance-yrself-clean');
  const takes = song.compiled.takes.filter(take => take.voiceId === 'cowbell');
  assert.deepEqual(takes.map(take => [take.begin, take.captureEnd, take.phrase]), [
    [{ bar: 10, beat: 0 }, { bar: 11, beat: 0 }, '(4)&a'],
    [{ bar: 11, beat: 0 }, { bar: 12, beat: 0 }, '(4)&'],
    [{ bar: 12, beat: 0 }, { bar: 13, beat: 0 }, '4'],
    [{ bar: 82, beat: 0 }, { bar: 83, beat: 0 }, '&e3a&'],
    [{ bar: 83, beat: 0 }, { bar: 84, beat: 0 }, '&e3a&a'],
    [{ bar: 84, beat: 0 }, { bar: 85, beat: 0 }, '&e3e'],
  ]);
  assert.equal(new Set(takes.map(take => take.id)).size, 6);
  assert.equal(new Set(takes.map(take => take.slot)).size, 6);
  for (const take of takes) {
    const arm = song.compiled.cues.find(cue => cue.id === take.armCueId);
    const commit = song.compiled.cues.find(cue => cue.id === take.commitCueId);
    assert.equal(arm.takeId, take.id);
    assert.equal(commit.commitTakeId, take.id);
  }
  const other = await loadSong('drunk-girls');
  assert(!other.program.controls.bars.some(row => Object.values(row).some(cue => cue.capture)));
});

test('pad names are loaded from the selected chart notes, with no other song names leaking in', async () => {
  const dyc = await loadSong('dance-yrself-clean');
  assert.deepEqual(dyc.chart.controlNames, { L1: 'Whistle', R1: 'Drums & Claps', L2: 'Bing Bong', R2: 'Cowbell' });
  const drunk = await loadSong('drunk-girls');
  assert.deepEqual(drunk.chart.controlNames, { L1: 'L1', R1: 'R1', L2: 'L2', R2: 'R2' });
});
