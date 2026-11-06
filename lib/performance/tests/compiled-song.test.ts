import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSheetsSong, canonicalSongJson, decodeCompiledSong, inspectCompiledSong, parseArrangementHits } from '../compiled-song.js';
import type { SongMapping } from '../compiled-song.js';
import type { SongSource } from '../song-source.js';
import dycSource from '../../../songs/dance-yrself-clean.source.json';
import dycMapping from '../../../songs/dance-yrself-clean.mapping.json';
import { encodeCompiledProgram } from '../compiled-native.js';
import { PF } from '../wasm-abi.js';

function fixture(): { source: SongSource; mapping: SongMapping } {
  const values = Array.from({ length: 24 }, () => Array<string>(6).fill(''));
  values[0][1] = 'Fixture song'; values[1][5] = '98'; values[3][2] = 'A';
  values[4] = ['Bar', '', '1', '2', '3', '4'];
  values[17][1] = 'rb'; values[17][3] = 'crb'; values[17][5] = 'cb';
  values[9] = ['Drums', '', '-', '-', "-'", "-'"];
  return {
    source: { sourceVersion: 1, spreadsheetId: 'abcdefghijklmnopqrstuv', sheetId: 101, sheetName: 'Fixture', range: 'A1:F24', values,
      notes: { A18: 'Drums', A19: 'Cowbell', A20: 'Whistle', A21: 'Synth' } },
    mapping: { mappingVersion: 5, liveParts: [], notationVersion: 'dyc-v1', songId: 'fixture', spreadsheetId: 'abcdefghijklmnopqrstuv', sheetId: 101, sheetName: 'Fixture', titleCell: 'B1', bpmCell: 'F2', sectionRow: 4, barRow: 5,
      leadInColumn: 2, startBar: 1, endBar: 4, meter: { numerator: 4, denominator: 4 },
      controls: [
        { buttonId: 'R1', voiceId: 'drums', cueRow: 18, arrangementRow: 10, nameNoteCell: 'A18' },
        { buttonId: 'R2', voiceId: 'cowbell', cueRow: 19, arrangementRow: 11, nameNoteCell: 'A19' },
        { buttonId: 'L1', voiceId: 'whistle', cueRow: 20, arrangementRow: 13, nameNoteCell: 'A20' },
        { buttonId: 'L2', voiceId: 'synth', cueRow: 21, arrangementRow: 12, nameNoteCell: 'A21' },
      ], cueWindow: { earlyMs: 25, lateMs: 12.5, ties: 'reject' }, capturePolicies: [{ voiceId: 'drums', retention: 'layer', gain: .5 }],
      layerGroups: [{ id: 'drums-main', voiceId: 'drums', armCells: ['B18', 'D18'] }], variantRules: [], variantReuses: [], overrides: [], deferredRows: [] },
  };
}

test('known capture cues retain source identity and immutable layered takes', async () => {
  const { source, mapping } = fixture();
  const song = await compileSheetsSong(source, mapping);
  assert.equal(song.executable, true);
  assert.deepEqual(song.diagnostics, []);
  assert.equal(song.chart.leadInColumn, 2);
  assert.equal(song.chart.controlNames.R1, 'Drums');
  assert.deepEqual(song.takes.map(t => [t.begin, t.captureEnd]), [
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
  const song = await compileSheetsSong({ ...source, values, notes: { ...source.notes, E19: 'Exit after beat four' } }, mapping);
  const cue = song.cues.find(c => c.source.a1 === 'E19');
  assert.equal(cue?.cueBeat, 3);
  assert.deepEqual(cue?.execution, { kind: 'beat', beat: 3.25 });
  assert.equal(cue?.kind, 'stop');
  assert.equal(cue?.source.note, 'Exit after beat four');
  assert.equal(cue?.voiceId, 'cowbell');
  assert.equal(cue?.buttonId, 'R2');
});

test('whitespace-only control cells stay blank in display and leave native instructions unchanged', async () => {
  const { source, mapping } = fixture();
  const baseline = await compileSheetsSong(source, mapping);
  const values = source.values.map(row => [...row]); values[18][4] = '    ';
  const spaced = await compileSheetsSong({ ...source, values }, mapping);
  assert.equal(spaced.chart.bars[2].cues.R2, '');
  assert.notEqual(spaced.source.digest, baseline.source.digest, 'provenance still preserves the actual source edit');
  assert.deepEqual(encodeCompiledProgram(spaced), encodeCompiledProgram(baseline));
});

test('unknown action syntax and unbound knob spans block execution without discarding known cues', async () => {
  const { source, mapping } = fixture();
  const values = source.values.map(row => [...row]);
  values[18][3] = '2c?'; values[18][4] = '1p?'; values[16][2] = '[4d-';
  const song = await compileSheetsSong({ ...source, values }, mapping);
  assert.equal(song.executable, false);
  assert.equal(song.cues.filter(c => c.buttonId === 'R1').length, 3);
  assert.deepEqual(song.diagnostics.filter(d => d.code === 'unknown-cue').map(d => d.source.a1), ['D19', 'E19']);
  assert(song.diagnostics.some(d => d.code === 'unbound-control' && d.source.a1 === 'C17'));
  assert.match(inspectCompiledSong(song), /BLOCKED/);
  assert.match(inspectCompiledSong(song), /D19\s+"2c\?"/);
});

test('explicit overrides are pinned to exact source text and carry the chosen action boundary', async () => {
  const { source, mapping } = fixture();
  const values = source.values.map(row => [...row]); values[18][3] = '2c3';
  const override = { a1: 'D19', notation: '2c3', kind: 'stop', cueBeat: 1, execution: { kind: 'beat', beat: 2 }, captureTail: 'none', tempoBeatHint: 0 };
  const song = await compileSheetsSong({ ...source, values }, { ...mapping, overrides: [override] });
  assert.equal(song.executable, true);
  const cue = song.cues.find(c => c.source.a1 === 'D19');
  assert.equal(cue?.cueBeat, 1);
  assert.deepEqual(cue?.execution, { kind: 'beat', beat: 2 });
  values[18][3] = '2c4';
  const changed = await compileSheetsSong({ ...source, values }, { ...mapping, overrides: [override] });
  assert(changed.diagnostics.some(d => d.code === 'stale-override'));
  assert.equal(changed.executable, false);
});

test('missing approved cue and capture policies remain explicit blockers', async () => {
  const { source, mapping } = fixture();
  const song = await compileSheetsSong(source, { ...mapping, cueWindow: null, capturePolicies: [] });
  assert.equal(song.executable, false);
  assert(song.diagnostics.some(d => d.code === 'cue-window'));
  assert(song.diagnostics.some(d => d.code === 'capture-policy'));
  assert(song.takes.every(t => t.retention === 'unresolved' && t.gain === 1));
});

test('operator-approved deferred controls are visible metadata, never executable actions', async () => {
  const { source, mapping } = fixture();
  const values = source.values.map(row => [...row]); values[16][2] = 'd';
  const song = await compileSheetsSong({ ...source, values }, { ...mapping, deferredRows: [{ row: 17, reason: 'Fixture explicitly defers this operation.' }] });
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
  const song = await compileSheetsSong({ ...source, values }, { ...mapping,
    capturePolicies: [{ voiceId: 'cowbell', retention: 'variant', gain: 1 }],
    layerGroups: [],
    variantRules: [{ voiceId: 'cowbell', row: 11, fromBar: 3, sampledOnly: true }],
  });
  assert.equal(song.executable, true);
  assert.equal(song.selections.length, 2);
  assert.deepEqual(song.playback, [
    { bar: 3, voiceId: 'cowbell', selectionId: song.selections[0].id },
    { bar: 4, voiceId: 'cowbell', selectionId: song.selections[1].id },
  ]);
});

test('current DYC compiles answered semantics and permits F21 future arming for its disjoint recording interval', async () => {
  const song = await compileSheetsSong(dycSource, dycMapping);
  assert.equal(song.executable, true);
  assert(!song.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
  assert(song.takes.every(take => take.gain === 1));
  const cowbell = song.takes.filter(take => take.voiceId === 'cowbell');
  assert.deepEqual(cowbell.map(take => [take.begin.bar, take.phrase, take.retention]), [
    [10, '(4)&a', 'variant'], [11, '(4)&', 'variant'], [12, '4', 'variant'],
    [82, '&e3a&', 'variant'], [83, '&e3a&a', 'variant'], [84, '&e3e', 'variant'],
  ]);
  assert(!song.diagnostics.some(diagnostic => diagnostic.code === 'capture-policy' && diagnostic.source.a1.endsWith('19')));
  for (const [bar, take] of [[20, cowbell[1]], [28, cowbell[2]], [36, cowbell[1]], [44, cowbell[2]]] as const) {
    const playback = song.playback.find(playback => playback.bar === bar && playback.voiceId === 'cowbell');
    const selection = song.selections.find(selection => selection.id === playback?.selectionId);
    assert.deepEqual(selection?.takeIds, [take.id]);
    assert.deepEqual(selection?.gains, [1]);
  }
  const doubled = song.takes.filter(take => take.voiceId === 'bing-bong');
  assert.deepEqual(doubled.map(take => [take.begin, take.captureEnd, take.loopEnd]), [
    [{ bar: 5, beat: 0 }, { bar: 7, beat: 0 }, { bar: 7, beat: 0 }],
    [{ bar: 7, beat: 0 }, { bar: 8, beat: 2 }, { bar: 9, beat: 0 }],
  ]);
  assert(doubled.every(take => take.groupId === 'bing-bong-main' && take.phraseAnchorTakeId === doubled[0].id));
  for (const group of dycMapping.layerGroups) {
    const takes = song.takes.filter(take => take.groupId === group.id);
    assert.equal(takes.length, 2);
    assert.equal(takes[0].phrase, takes[1].phrase);
    assert.equal(takes[1].phraseAnchorTakeId, takes[0].id);
    assert.deepEqual(song.selections.filter(selection => selection.groupId === group.id).at(-1)?.takeIds, takes.map(take => take.id));
  }
  assert.deepEqual(song.cues.filter(cue => cue.tempoBeatHint).map(cue => [cue.source.a1, cue.cueBeat, cue.execution]), [
    ['AE18', 0, { kind: 'now' }], ['AU18', 0, { kind: 'now' }],
    ['EY18', 0, { kind: 'now' }], ['GU18', 0, { kind: 'now' }],
  ]);
  assert.deepEqual(song.cueWindow, { earlyMs: 25, lateMs: 25, ties: 'reject' });
  assert.match(inspectCompiledSong(song), /H21 -> J21\tcapture 7:1\.\.8:3 \(6 counts\)\trest 8:3\.\.9:1 \(2 counts, zero source\)\tloop 7:1\.\.9:1 \(8 counts\)/);
  assert.equal(song.rotation?.windows.length, 10);
  assert(!song.diagnostics.some(diagnostic => diagnostic.code === 'deferred-control' && diagnostic.source.a1.endsWith('17')));
  assert(!song.diagnostics.some(diagnostic => diagnostic.code === 'unbound-control' && diagnostic.source.a1.endsWith('17')));
});

test('genuinely overlapping recording intervals reject without forbidding earlier arming', async () => {
  const values = dycSource.values.map(row => [...row]);
  values[20][5] = ''; values[20][4] = 'rb';
  const mapping = { ...dycMapping, layerGroups: dycMapping.layerGroups.map(group => group.voiceId === 'bing-bong' ? { ...group, armCells: ['E21', 'H21'] } : group) };
  const song = await compileSheetsSong({ ...dycSource, values }, mapping);
  assert.equal(song.executable, false);
  assert(song.diagnostics.some(diagnostic => diagnostic.code === 'capture-record-overlap' && diagnostic.source.a1 === 'E21'));
});

test('DYC source parts survive import independently of the four pad bindings', async () => {
  const song = await compileSheetsSong(dycSource, dycMapping);
  assert.equal(song.schemaVersion, 5);
  assert.equal(song.voices.length, 4);
  assert.deepEqual(song.parts.map(part => [part.id, part.name, part.source.a1, part.profile, part.role.kind]), [
    ['whistle', 'Whistle', 'A13', 0, 'pad'],
    ['bing-bong', 'Bing Bong', 'A12', 1, 'pad'],
    ['drums-claps', 'Drums & Claps', 'A10', 2, 'pad'],
    ['cowbell', 'Cowbell', 'A11', 3, 'pad'],
    ['vocals', 'Vocals', 'A8', 4, 'default-live'],
    ['backup-vocals', 'Backup Vocals', 'A9', 5, 'rotation-live'],
  ]);
  assert.deepEqual(decodeCompiledSong(JSON.parse(canonicalSongJson(song))).parts, song.parts);
  const values = dycSource.values.map(row => [...row]); values[8][0] = 'AF - Harmony';
  const renamed = await compileSheetsSong({ ...dycSource, values }, dycMapping);
  assert.equal(renamed.parts.find(part => part.id === 'backup-vocals')?.name, 'Harmony');
  assert.notEqual(renamed.source.digest, song.source.digest);
  assert.deepEqual(encodeCompiledProgram(renamed), encodeCompiledProgram(song), 'source label edits preserve musical instructions');
  const { source, mapping } = fixture();
  const legacy = await compileSheetsSong(source, mapping);
  assert.equal(legacy.parts.length, 4);
  assert(legacy.parts.every(part => part.role.kind === 'pad'));
  assert.equal(legacy.rotation, null);
});

test('actual DYC rotation windows preserve written half-open beat boundaries and source cells', async () => {
  const song = await compileSheetsSong(dycSource, dycMapping);
  assert.equal(song.rotation?.voiceId, 'backup-vocals');
  assert.equal(song.rotation?.releaseGridBeats, .25);
  assert.deepEqual(song.rotation?.windows.map(window => [window.begin.bar, window.begin.beat, window.end.bar, window.end.beat, window.source.a1, window.endSource.a1]), [
    [20, 3, 22, 0, 'V17', 'X17'], [24, 3, 26, 0, 'Z17', 'AB17'],
    [36, 3, 38, 0, 'AL17', 'AN17'], [40, 3, 42, 0, 'AP17', 'AR17'],
    [60, 3, 62, 0, 'BJ17', 'BL17'], [64, 3, 66, 0, 'BN17', 'BP17'],
    [68, 3, 70, 2, 'BR17', 'BT17'], [70, 3, 72, 2, 'BT17', 'BV17'],
    [72, 3, 74, 2, 'BV17', 'BX17'], [74, 3, 76, 2, 'BX17', 'BZ17'],
  ]);
  assert.deepEqual(song.rotation?.windows[0].sources.map(source => source.a1), ['V17', 'W17', 'X17']);
  assert.equal(song.chart.bars.length, 218);
  assert.equal(song.chart.sections.length, 27);
  assert.equal(song.takes.length, 12); assert.equal(song.cues.length, 62);
  const table = encodeCompiledProgram(song);
  const rotationStart = table.indexOf(PF.COMPILED_ROTATION_MAGIC);
  assert.deepEqual(Array.from(table.slice(rotationStart, rotationStart + 7)), [PF.COMPILED_ROTATION_MAGIC, 10, .25, 20, 3, 22, 0]);
  assert.match(inspectCompiledSong(song), /PART\tA9\tBackup Vocals.*profile 5\trotation-live/);
  assert.match(inspectCompiledSong(song), /ROTATION\tbackup-vocals\trelease at the next 0.25 counted-beat grid boundary/);
  assert.match(inspectCompiledSong(song), /ROTATION WINDOW\tBT17 -> BV17\t70:4\.\.72:3\thalf-open/);
});

test('full DYC play cues select the Cowbell identity written at their execution bar', async () => {
  const song = await compileSheetsSong(dycSource, dycMapping);
  for (const a1 of ['V19', 'AL19', 'BB19', 'BJ19', 'CQ19', 'DO19', 'FG19', 'FW19', 'GL19']) {
    const cue = song.cues.find(cue => cue.source.a1 === a1);
    assert(cue, a1);
    const bar = cue.execution.kind === 'next-bar' ? cue.bar + 1 : cue.bar;
    const written = song.playback.find(entry => entry.voiceId === cue.voiceId && entry.bar === bar);
    assert(written, a1);
    assert.equal(cue.selectionId, written.selectionId, `${a1} uses the written variant at bar ${bar}`);
  }
});

test('quarter-grid authoring and imports reject old inactivity artifacts and invalid count grids', async () => {
  const song = await compileSheetsSong(dycSource, dycMapping);
  assert.throws(() => decodeCompiledSong({ ...song, schemaVersion: 3 }));
  await assert.rejects(() => compileSheetsSong(dycSource, { ...dycMapping, mappingVersion: 3 }));
  const rule = dycMapping.rotationRule;
  for (const releaseGridBeats of [0, -1, 1.25, .0001]) {
    const rejected = await compileSheetsSong(dycSource, { ...dycMapping, rotationRule: { ...rule, releaseGridBeats } });
    assert.equal(rejected.executable, false);
    assert(rejected.diagnostics.some(diagnostic => diagnostic.code === 'rotation-rule' && diagnostic.source.a1 === 'A17'));
    assert.throws(() => encodeCompiledProgram(rejected));
    assert.throws(() => decodeCompiledSong({ ...song, rotation: { ...song.rotation, releaseGridBeats } }));
  }
  assert.deepEqual(decodeCompiledSong(JSON.parse(canonicalSongJson(song))).rotation, song.rotation);
});

test('rotation source edits produce exact boundary changes and malformed spans block with source diagnostics', async () => {
  const values = dycSource.values.map(row => [...row]); values[16][23] = '-2d]';
  const moved = await compileSheetsSong({ ...dycSource, values }, dycMapping);
  assert.equal(moved.executable, true);
  assert.deepEqual(moved.rotation?.windows[0].end, { bar: 22, beat: 1 });
  const malformed = dycSource.values.map(row => [...row]); malformed[16][22] = 'twiddle'; malformed[16][77] = '';
  const rejected = await compileSheetsSong({ ...dycSource, values: malformed }, dycMapping);
  assert.equal(rejected.executable, false);
  assert(rejected.diagnostics.some(diagnostic => diagnostic.code === 'rotation-notation' && diagnostic.source.a1 === 'W17'));
  assert(rejected.diagnostics.some(diagnostic => diagnostic.code === 'rotation-unclosed' && diagnostic.source.a1 === 'BX17'));
  const missing = dycSource.values.map(row => [...row]); missing[16][22] = '';
  assert((await compileSheetsSong({ ...dycSource, values: missing }, dycMapping)).diagnostics.some(diagnostic => diagnostic.code === 'rotation-continuation' && diagnostic.source.a1 === 'W17'));
  const leadIn = dycSource.values.map(row => [...row]); leadIn[16][1] = 'd';
  assert((await compileSheetsSong({ ...dycSource, values: leadIn }, dycMapping)).diagnostics.some(diagnostic => diagnostic.code === 'rotation-lead-in' && diagnostic.source.a1 === 'B17'));
});

test('executable imports reject forged source profiles and overlapping or unbound rotation windows', async () => {
  const song = await compileSheetsSong(dycSource, dycMapping);
  const rotation = song.rotation;
  assert(rotation);
  const first = rotation.windows[0];
  for (const changed of [
    { ...song, parts: song.parts.map(part => part.profile === 5 ? { ...part, profile: 4 } : part) },
    { ...song, parts: song.parts.map(part => part.profile === 5 ? { ...part, name: 'Forged label' } : part) },
    { ...song, rotation: { ...rotation, voiceId: 'whistle' } },
    { ...song, rotation: { ...rotation, releaseGridBeats: 0 } },
    { ...song, rotation: { ...rotation, windows: [first, first] } },
    { ...song, rotation: { ...rotation, windows: [{ ...first, end: first.begin }] } },
    { ...song, rotation: { ...rotation, windows: [{ ...first, source: { ...first.source, sheetId: 0 } }] } },
  ]) assert.throws(() => decodeCompiledSong(changed));
});

test('declared layer groups fail on source phrase or period edits instead of regrouping or resizing', async () => {
  const { source, mapping } = fixture();
  const changedPhrase = source.values.map(row => [...row]);
  changedPhrase[9][4] = 'different';
  const phrase = await compileSheetsSong({ ...source, values: changedPhrase }, mapping);
  assert.equal(phrase.executable, false);
  assert(phrase.diagnostics.some(diagnostic => diagnostic.code === 'doubling-invariant' && diagnostic.source.a1 === 'D18'));
  const changedPeriod = source.values.map(row => [...row]);
  changedPeriod[17][3] = ''; changedPeriod[17][4] = 'crb';
  const period = await compileSheetsSong({ ...source, values: changedPeriod }, { ...mapping, layerGroups: [{ ...mapping.layerGroups[0], armCells: ['B18', 'E18'] }] });
  assert.equal(period.executable, false);
  assert(period.diagnostics.some(diagnostic => diagnostic.code === 'doubling-invariant' && /12 counted beats/.test(diagnostic.message) && /and 4\./.test(diagnostic.message)));
  const baseline = await compileSheetsSong(source, mapping);
  assert.throws(() => decodeCompiledSong({ ...baseline, takes: [{ ...baseline.takes[0], phraseAnchorTakeId: 'missing' }, ...baseline.takes.slice(1)] }), /phrase group/);
});

test('repeated frozen compilation produces byte-identical artifacts and SHA-256 provenance', async () => {
  const { source, mapping } = fixture();
  const first = await compileSheetsSong(source, mapping);
  const second = await compileSheetsSong({ ...source, notes: { A21: 'Synth', A20: 'Whistle', A19: 'Cowbell', A18: 'Drums' } }, mapping);
  assert.equal(canonicalSongJson(first), canonicalSongJson(second));
  assert.match(first.source.digest, /^[a-f0-9]{64}$/);
  assert.match(first.mappingDigest, /^[a-f0-9]{64}$/);
  const changed = await compileSheetsSong(source, { ...mapping, cueWindow: { earlyMs: 50, lateMs: 12.5, ties: 'reject' } });
  assert.notEqual(first.mappingDigest, changed.mappingDigest);
  assert.equal(first.source.digest, changed.source.digest);
  assert.deepEqual(decodeCompiledSong(JSON.parse(canonicalSongJson(first))), first);
});

test('malformed mappings, bar gaps, duplicate IDs, and invalid timing do not become executable songs', async () => {
  const { source, mapping } = fixture();
  await assert.rejects(compileSheetsSong(source, { ...mapping, notationVersion: 'legacy' }));
  const values = source.values.map(row => [...row]); values[4][3] = '3';
  const song = await compileSheetsSong({ ...source, values }, { ...mapping, controls: [mapping.controls[0], mapping.controls[0]] });
  assert.equal(song.executable, false);
  assert(song.diagnostics.some(d => d.code === 'bindings'));
  assert(song.diagnostics.some(d => d.code === 'duplicate-bar'));
  assert(song.diagnostics.some(d => d.code === 'missing-bar'));
  const invalid = await compileSheetsSong(source, { ...mapping, cueWindow: { earlyMs: -1, lateMs: 0, ties: 'reject' } });
  assert(invalid.diagnostics.some(d => d.code === 'cue-window'));
});

test('take admission and imported executable references are checked before loading', async () => {
  const { source, mapping } = fixture();
  const values = Array.from({ length: 24 }, () => Array<string>(31).fill(''));
  values[0][1] = 'Fixture song'; values[1][5] = '98'; values[3][2] = 'A';
  values[17][1] = 'rb';
  for (let bar = 1; bar <= 29; bar++) { values[4][bar + 1] = String(bar); values[9][bar + 1] = '-'; values[17][bar + 1] = bar === 29 ? 'cb' : 'crb'; }
  const draft = await compileSheetsSong({ ...source, range: 'A1:AE24', values }, { ...mapping, endBar: 29 });
  assert.equal(draft.takes.length, 29);
  assert.equal(draft.executable, false);
  assert(draft.diagnostics.some(d => d.code === 'take-limit'));
  assert.throws(() => decodeCompiledSong({ ...draft, executable: true }), /unresolved|errors/);
  const song = await compileSheetsSong(source, mapping);
  assert.throws(() => decodeCompiledSong({ ...song, cues: [{ ...song.cues[0], takeId: 'missing-take' }] }), /reference/);
  assert.throws(() => decodeCompiledSong({ ...song, selections: [{ ...song.selections[0], takeIds: ['missing-take'] }] }), /selection/);
});

test('imported executable programs reject forged timing, bindings, and gains', async () => {
  const { source, mapping } = fixture();
  const song = await compileSheetsSong(source, mapping);
  for (const changed of [
    { ...song, cueWindow: { earlyMs: -1, lateMs: 0, ties: 'reject' } },
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
  const song = await compileSheetsSong({ ...source, values }, mapping);
  assert.equal(song.executable, false);
  assert(song.diagnostics.some(d => d.source.a1 === 'E19' && d.code === 'manual-tap-capability'));
  assert(!song.diagnostics.some(d => d.source.a1 === 'E19' && d.code === 'unknown-cue'));
});

test('immediate lead-in capture is blocked before runtime preparation', async () => {
  const { source, mapping } = fixture();
  const baseline = await compileSheetsSong(source, mapping);
  const values = source.values.map(row => [...row]);
  values[17][1] = 'r';
  const draft = await compileSheetsSong({ ...source, values }, mapping);
  assert.equal(draft.executable, false);
  assert(draft.diagnostics.some(diagnostic => diagnostic.code === 'lead-in-capture-capability' && diagnostic.source.a1 === 'B18'));
  assert.throws(() => decodeCompiledSong({ ...baseline, cues: [{ ...baseline.cues[0], execution: { kind: 'now' } }, ...baseline.cues.slice(1)] }), /lead-in capture/);
});

test('imported capture graph preserves each unique arm, commit, and boundary', async () => {
  const { source, mapping } = fixture();
  const song = await compileSheetsSong(source, mapping);
  for (const changed of [
    { ...song, cues: [{ ...song.cues[0], takeId: song.takes[1].id }, ...song.cues.slice(1)] },
    { ...song, cues: song.cues.slice(1) },
    { ...song, cues: [...song.cues, { ...song.cues[0], id: 'extra-arm' }] },
    { ...song, takes: [{ ...song.takes[0], armCueId: 'missing' }, ...song.takes.slice(1)] },
    { ...song, takes: [{ ...song.takes[0], commitCueId: 'missing' }, ...song.takes.slice(1)] },
    { ...song, takes: [{ ...song.takes[0], captureEnd: { bar: 2, beat: 0 } }, ...song.takes.slice(1)] },
    { ...song, selections: [{ ...song.selections[0], takeIds: song.takes.map(take => take.id), gains: song.takes.map(() => 1) }, ...song.selections.slice(1)] },
    { ...song, playback: [{ bar: 1, voiceId: song.takes[0].voiceId, selectionId: song.selections[0].id }] },
    { ...song, chart: { ...song.chart, bars: song.chart.bars.map((bar, index) => index === 1 ? { ...bar, column: song.chart.bars[0].column } : bar) } },
  ]) assert.throws(() => decodeCompiledSong(changed));
});
