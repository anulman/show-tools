import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSong, canonicalSongJson, decodeCompiledSong, inspectCompiledSong, parseArrangementHits } from '../compiled-song.js';
import type { SongMapping } from '../compiled-song.js';
import type { SongSource } from '../song-source.js';

function fixture(): { source: SongSource; mapping: SongMapping } {
  const values = Array.from({ length: 24 }, () => Array<string>(6).fill(''));
  values[0][1] = 'Fixture song'; values[1][5] = '98'; values[3][2] = 'A';
  values[4] = ['Bar', '', '1', '2', '3', '4'];
  values[17][1] = 'rb'; values[17][3] = 'crb'; values[17][5] = 'cb';
  values[9] = ['Drums', '', '-', '-', "-'", "-'"];
  return {
    source: { sourceVersion: 1, spreadsheetId: 'abcdefghijklmnopqrstuv', sheetId: 101, sheetName: 'Fixture', range: 'A1:F24', values,
      notes: { A18: 'Drums', A19: 'Cowbell', A20: 'Whistle', A21: 'Synth' } },
    mapping: { mappingVersion: 1, notationVersion: 'dyc-v1', songId: 'fixture', spreadsheetId: 'abcdefghijklmnopqrstuv', sheetId: 101, sheetName: 'Fixture', titleCell: 'B1', bpmCell: 'F2', sectionRow: 4, barRow: 5,
      leadInColumn: 2, startBar: 1, endBar: 4, meter: { numerator: 4, denominator: 4 },
      controls: [
        { buttonId: 'R1', voiceId: 'drums', cueRow: 18, arrangementRow: 10, nameNoteCell: 'A18' },
        { buttonId: 'R2', voiceId: 'cowbell', cueRow: 19, arrangementRow: 11, nameNoteCell: 'A19' },
        { buttonId: 'L1', voiceId: 'whistle', cueRow: 20, arrangementRow: 13, nameNoteCell: 'A20' },
        { buttonId: 'L2', voiceId: 'synth', cueRow: 21, arrangementRow: 12, nameNoteCell: 'A21' },
      ], cueWindow: { earlyBeats: .25, lateBeats: .125 }, capturePolicies: [{ voiceId: 'drums', retention: 'layer', gain: .5 }], variantRules: [], overrides: [], deferredRows: [] },
  };
}

test('known capture cues retain source identity and immutable layered takes', async () => {
  const { source, mapping } = fixture();
  const song = await compileSong(source, mapping);
  assert.equal(song.executable, true);
  assert.deepEqual(song.diagnostics, []);
  assert.equal(song.chart.leadInColumn, 2);
  assert.equal(song.chart.controlNames.R1, 'Drums');
  assert.deepEqual(song.takes.map(t => [t.begin, t.end]), [
    [{ bar: 1, beat: 0 }, { bar: 3, beat: 0 }],
    [{ bar: 3, beat: 0 }, { bar: 5, beat: 0 }],
  ]);
  assert.equal(song.takes[0].phrase, '-|-');
  assert.equal(song.takes[1].phrase, '-|-');
  assert.notEqual(song.takes[0].id, song.takes[1].id);
  assert.deepEqual(song.selections.map(s => s.takeIds), [[song.takes[0].id], [song.takes[0].id, song.takes[1].id]]);
  const replacement = song.cues.find(c => c.source.a1 === 'D18');
  assert.equal(replacement?.commitTakeId, song.takes[0].id);
  assert.equal(replacement?.takeId, song.takes[1].id);
  assert.equal(replacement?.selectionId, song.selections[0].id);
});

test('fractional stop separates applicability from execution and preserves source note', async () => {
  const { source, mapping } = fixture();
  const values = source.values.map(row => [...row]); values[18][4] = '4xe';
  const song = await compileSong({ ...source, values, notes: { ...source.notes, E19: 'Exit after beat four' } }, mapping);
  const cue = song.cues.find(c => c.source.a1 === 'E19');
  assert.equal(cue?.cueBeat, 3);
  assert.deepEqual(cue?.execution, { kind: 'beat', beat: 3.25 });
  assert.equal(cue?.kind, 'stop');
  assert.equal(cue?.source.note, 'Exit after beat four');
  assert.equal(cue?.voiceId, 'cowbell');
  assert.equal(cue?.buttonId, 'R2');
});

test('unknown action syntax and unbound knob spans block execution without discarding known cues', async () => {
  const { source, mapping } = fixture();
  const values = source.values.map(row => [...row]);
  values[18][3] = '2c3'; values[18][4] = '1p*'; values[16][2] = '[4d-';
  const song = await compileSong({ ...source, values }, mapping);
  assert.equal(song.executable, false);
  assert.equal(song.cues.filter(c => c.buttonId === 'R1').length, 3);
  assert.deepEqual(song.diagnostics.filter(d => d.code === 'unknown-cue').map(d => d.source.a1), ['D19', 'E19']);
  assert(song.diagnostics.some(d => d.code === 'unbound-control' && d.source.a1 === 'C17'));
  assert.match(inspectCompiledSong(song), /BLOCKED/);
  assert.match(inspectCompiledSong(song), /D19\s+"2c3"/);
});

test('explicit overrides are pinned to exact source text and carry the chosen action boundary', async () => {
  const { source, mapping } = fixture();
  const values = source.values.map(row => [...row]); values[18][3] = '2c3';
  const override = { a1: 'D19', notation: '2c3', kind: 'stop', cueBeat: 1, execution: { kind: 'beat', beat: 2 } };
  const song = await compileSong({ ...source, values }, { ...mapping, overrides: [override] });
  assert.equal(song.executable, true);
  const cue = song.cues.find(c => c.source.a1 === 'D19');
  assert.equal(cue?.cueBeat, 1);
  assert.deepEqual(cue?.execution, { kind: 'beat', beat: 2 });
  values[18][3] = '2c4';
  const changed = await compileSong({ ...source, values }, { ...mapping, overrides: [override] });
  assert(changed.diagnostics.some(d => d.code === 'stale-override'));
  assert.equal(changed.executable, false);
});

test('missing approved cue and capture policies remain explicit blockers', async () => {
  const { source, mapping } = fixture();
  const song = await compileSong(source, { ...mapping, cueWindow: null, capturePolicies: [] });
  assert.equal(song.executable, false);
  assert(song.diagnostics.some(d => d.code === 'cue-window'));
  assert(song.diagnostics.some(d => d.code === 'capture-policy'));
  assert(song.takes.every(t => t.retention === 'unresolved' && t.gain === null));
});

test('operator-approved deferred controls are visible metadata, never executable actions', async () => {
  const { source, mapping } = fixture();
  const values = source.values.map(row => [...row]); values[16][2] = 'd';
  const song = await compileSong({ ...source, values }, { ...mapping, deferredRows: [{ row: 17, reason: 'Fixture explicitly defers this operation.' }] });
  assert.equal(song.executable, true);
  assert.equal(song.diagnostics[0].code, 'deferred-control');
  assert.equal(song.diagnostics[0].severity, 'info');
  assert.equal(song.cues.some(c => c.source.a1 === 'C17'), false);
});

test('arrangement subdivision anchors do not add a beat-four hit', () => {
  assert.deepEqual(parseArrangementHits('123456', 6), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(parseArrangementHits('1234'), [0, 1, 2, 3]);
  assert.deepEqual(parseArrangementHits('(4)&a'), [3.5, 3.75]);
  assert.deepEqual(parseArrangementHits("(4)&'"), [3.5]);
  assert.deepEqual(parseArrangementHits('4'), [3]);
  assert.deepEqual(parseArrangementHits('(6)&', 6), [5.5]);
  assert.equal(parseArrangementHits('&a'), null);
  assert.equal(parseArrangementHits('4&4'), null);
  assert.equal(parseArrangementHits('5'), null);
});

test('explicit variant rule selects only already-committed matching patterns', async () => {
  const { source, mapping } = fixture();
  const values = source.values.map(row => [...row]);
  values[17] = Array(6).fill('');
  values[18][1] = 'rb'; values[18][2] = 'crb'; values[18][3] = 'cb';
  values[10] = ['', '', '(4)&a', '(4)&', "(4)&a'", "(4)&'"];
  const song = await compileSong({ ...source, values }, { ...mapping,
    capturePolicies: [{ voiceId: 'cowbell', retention: 'variant', gain: 1 }],
    variantRules: [{ voiceId: 'cowbell', row: 11, fromBar: 3, sampledOnly: true }],
  });
  assert.equal(song.executable, true);
  assert.equal(song.selections.length, 2);
  assert.deepEqual(song.playback, [
    { bar: 3, voiceId: 'cowbell', selectionId: song.selections[0].id },
    { bar: 4, voiceId: 'cowbell', selectionId: song.selections[1].id },
  ]);
});

test('repeated frozen compilation produces byte-identical artifacts and SHA-256 provenance', async () => {
  const { source, mapping } = fixture();
  const first = await compileSong(source, mapping);
  const second = await compileSong({ ...source, notes: { A21: 'Synth', A20: 'Whistle', A19: 'Cowbell', A18: 'Drums' } }, mapping);
  assert.equal(canonicalSongJson(first), canonicalSongJson(second));
  assert.match(first.source.digest, /^[a-f0-9]{64}$/);
  assert.match(first.mappingDigest, /^[a-f0-9]{64}$/);
  const changed = await compileSong(source, { ...mapping, cueWindow: { earlyBeats: .5, lateBeats: .125 } });
  assert.notEqual(first.mappingDigest, changed.mappingDigest);
  assert.equal(first.source.digest, changed.source.digest);
  assert.deepEqual(decodeCompiledSong(JSON.parse(canonicalSongJson(first))), first);
});

test('malformed mappings, bar gaps, duplicate IDs, and invalid timing do not become executable songs', async () => {
  const { source, mapping } = fixture();
  await assert.rejects(compileSong(source, { ...mapping, notationVersion: 'legacy' }));
  const values = source.values.map(row => [...row]); values[4][3] = '3';
  const song = await compileSong({ ...source, values }, { ...mapping, controls: [mapping.controls[0], mapping.controls[0]] });
  assert.equal(song.executable, false);
  assert(song.diagnostics.some(d => d.code === 'bindings'));
  assert(song.diagnostics.some(d => d.code === 'duplicate-bar'));
  assert(song.diagnostics.some(d => d.code === 'missing-bar'));
  const invalid = await compileSong(source, { ...mapping, cueWindow: { earlyBeats: -1, lateBeats: 0 } });
  assert(invalid.diagnostics.some(d => d.code === 'cue-window'));
});

test('take admission and imported executable references are checked before loading', async () => {
  const { source, mapping } = fixture();
  const values = Array.from({ length: 24 }, () => Array<string>(31).fill(''));
  values[0][1] = 'Fixture song'; values[1][5] = '98'; values[3][2] = 'A';
  values[17][1] = 'rb';
  for (let bar = 1; bar <= 29; bar++) { values[4][bar + 1] = String(bar); values[9][bar + 1] = '-'; values[17][bar + 1] = bar === 29 ? 'cb' : 'crb'; }
  const draft = await compileSong({ ...source, range: 'A1:AE24', values }, { ...mapping, endBar: 29 });
  assert.equal(draft.takes.length, 29);
  assert.equal(draft.executable, false);
  assert(draft.diagnostics.some(d => d.code === 'take-limit'));
  assert.throws(() => decodeCompiledSong({ ...draft, executable: true }), /unresolved|errors/);
  const song = await compileSong(source, mapping);
  assert.throws(() => decodeCompiledSong({ ...song, cues: [{ ...song.cues[0], takeId: 'missing-take' }] }), /reference/);
  assert.throws(() => decodeCompiledSong({ ...song, selections: [{ ...song.selections[0], takeIds: ['missing-take'] }] }), /selection/);
});

test('imported executable programs reject forged timing, bindings, and gains', async () => {
  const { source, mapping } = fixture();
  const song = await compileSong(source, mapping);
  for (const changed of [
    { ...song, cueWindow: { earlyBeats: -1, lateBeats: 0 } },
    { ...song, meter: { numerator: 0, denominator: 7 } },
    { ...song, chart: { ...song.chart, beatsPerBar: 99 } },
    { ...song, chart: { ...song.chart, bpm: 0 } },
    { ...song, chart: { ...song.chart, bars: song.chart.bars.slice(1) } },
    { ...song, voices: [song.voices[0], song.voices[0]] },
    { ...song, cues: [{ ...song.cues[0], cueBeat: -0.5 }, ...song.cues.slice(1)] },
    { ...song, takes: [{ ...song.takes[0], gain: -1 }, ...song.takes.slice(1)] },
    { ...song, selections: [{ ...song.selections[0], gains: [Number.POSITIVE_INFINITY] }, ...song.selections.slice(1)] },
  ]) assert.throws(() => decodeCompiledSong(changed));
});

test('bare numbered tap controls report a known capability gap rather than unknown grammar', async () => {
  const { source, mapping } = fixture();
  const values = source.values.map(row => [...row]);
  values[18][4] = '4e&a';
  const song = await compileSong({ ...source, values }, mapping);
  assert.equal(song.executable, false);
  assert(song.diagnostics.some(d => d.source.a1 === 'E19' && d.code === 'manual-tap-capability'));
  assert(!song.diagnostics.some(d => d.source.a1 === 'E19' && d.code === 'unknown-cue'));
});

test('imported capture graph preserves each unique arm, commit, and boundary', async () => {
  const { source, mapping } = fixture();
  const song = await compileSong(source, mapping);
  for (const changed of [
    { ...song, cues: [{ ...song.cues[0], takeId: song.takes[1].id }, ...song.cues.slice(1)] },
    { ...song, cues: song.cues.slice(1) },
    { ...song, cues: [...song.cues, { ...song.cues[0], id: 'extra-arm' }] },
    { ...song, takes: [{ ...song.takes[0], armCueId: 'missing' }, ...song.takes.slice(1)] },
    { ...song, takes: [{ ...song.takes[0], commitCueId: 'missing' }, ...song.takes.slice(1)] },
    { ...song, takes: [{ ...song.takes[0], end: { bar: 2, beat: 0 } }, ...song.takes.slice(1)] },
    { ...song, selections: [{ ...song.selections[0], takeIds: song.takes.map(take => take.id), gains: song.takes.map(() => 1) }, ...song.selections.slice(1)] },
    { ...song, playback: [{ bar: 1, voiceId: song.takes[0].voiceId, selectionId: song.selections[0].id }] },
    { ...song, chart: { ...song.chart, bars: song.chart.bars.map((bar, index) => index === 1 ? { ...bar, column: song.chart.bars[0].column } : bar) } },
  ]) assert.throws(() => decodeCompiledSong(changed));
});
