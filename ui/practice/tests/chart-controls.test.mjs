import test from 'node:test';
import assert from 'node:assert/strict';
import { parseControlCue } from '../../../lib/performance/chart-controls.js';
import { CONTROLS } from '../../../lib/performance/model.js';
import { loadSong } from '../../../songs/index.ts';
import { frozenCutoverMusicXml } from '../../../scripts/verify-musicxml-cutover.ts';
import { readMusicXmlSong } from '../../../lib/performance/musicxml-song.ts';

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
  assert.equal(leadIn.source.a1, 'B20');
  assert.deepEqual(leadIn.execution, { kind: 'beat', beat: 3.5 });
  assert.deepEqual(cues.filter(cue => cue.buttonId === 'R2' && (cue.bar <= 13 || cue.bar >= 78 && cue.bar <= 85))
    .map(cue => [cue.bar, cue.kind, cue.source.a1, cue.source.text, cue.execution]), [
    [7, 'arm', 'I21', 'rb', { kind: 'next-bar' }],
    [12, 'commit', 'N21', 'cxb', { kind: 'next-bar' }],
    [78, 'arm', 'CB21', 'rb', { kind: 'next-bar' }],
    [84, 'commit', 'CH21', 'cxb', { kind: 'next-bar' }],
  ]);
  for (const [button, cells] of [['R1', ['B20', 'E20']], ['L2', ['F18', 'H18']]])
    assert.deepEqual(cues.filter(cue => cue.buttonId === button && ['arm', 'commit', 'commit-arm'].includes(cue.kind))
      .map(cue => cue.source.a1), cells, 'single-take rows retain their authored arm and finish without invented doubling');
  const stop = cues.find(cue => cue.bar === 76 && cue.buttonId === 'R1');
  assert.equal(stop.kind, 'stop');
  assert.equal(stop.source.a1, 'BZ20');
  assert.deepEqual(stop.execution, { kind: 'next-bar' });
});

test('pad grid follows physical Q/W above A/S and preserves the left-hand column', () => {
  assert.deepEqual(CONTROLS.map(control => [control.id, control.shortcut]), [['L1', 'Q'], ['R1', 'W'], ['L2', 'A'], ['R2', 'S']]);
});

test('historical Cowbell chart keeps six distinct whole-bar takes linked to its capture cues', async () => {
  const { song: compiled } = await readMusicXmlSong(await frozenCutoverMusicXml());
  const song = { compiled };
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
  assert.equal(other.compiled.executable, true);
  assert.equal(other.compiled.takes.length, 7);
  assert.equal(other.program.controls, undefined);
  assert.deepEqual(other.program.events, []);
});

test('current Cowbell chart retains two parents and eleven explicit recorded-bar views', async () => {
  const { compiled } = await loadSong('dance-yrself-clean');
  const takes = compiled.takes.filter(take => take.voiceId === 'cowbell');
  assert.deepEqual(takes.map(take => [take.begin, take.captureEnd]), [
    [{ bar: 8, beat: 0 }, { bar: 13, beat: 0 }],
    [{ bar: 79, beat: 0 }, { bar: 85, beat: 0 }],
  ]);
  const views = compiled.selections.filter(selection => selection.voiceId === 'cowbell' && selection.window.kind === 'slice'
    && selection.window.endCount - selection.window.beginCount === 4);
  assert.equal(views.length, 11);
  for (const take of takes) {
    const slices = views.filter(view => view.takeIds[0] === take.id);
    assert.deepEqual(slices.map(view => [view.window.beginCount, view.window.endCount, view.window.loopCounts]),
      Array.from({ length: take.captureEnd.bar - take.begin.bar }, (_, index) => [index * 4, (index + 1) * 4, 4]));
    const commit = compiled.cues.find(cue => cue.id === take.commitCueId);
    assert.equal(commit.source.text, 'cxb');
    assert.equal(commit.launchPolicy, 'store', 'commit keeps the capture available for a later playback cue');
  }
  assert.deepEqual(compiled.takes.filter(take => take.voiceId !== 'cowbell').map(take => [take.voiceId, take.begin.bar, take.captureEnd.bar]),
    [['whistle', 44, 47], ['bing-bong', 4, 6], ['drums-claps', 0, 3]]);
});

test('pad names are loaded from the selected chart notes, with no other song names leaking in', async () => {
  const dyc = await loadSong('dance-yrself-clean');
  assert.deepEqual(dyc.chart.controlNames, { L1: 'Whistle', R1: 'Drums & Claps', L2: 'Bing Bong', R2: 'Cowbell' });
  const drunk = await loadSong('drunk-girls');
  assert.deepEqual(drunk.chart.controlNames, { L1: 'Drunk Boys', R1: 'When Day Becomes', L2: 'Guitar', R2: 'Drunk Girls' });
});
