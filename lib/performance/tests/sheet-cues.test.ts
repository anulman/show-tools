import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetCues } from '../sheet-cues.js';
import { compileSheetsSong, decodeCompiledSong, inspectCompiledSong, type SongMapping } from '../compiled-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../musicxml-song.js';
import { readFile } from 'node:fs/promises';

test('real Drunk Girls cues separate silent press anchors, source names and execution', () => {
  assert.deepEqual(parseSheetCues('(3)&r4 (4)&cr1'), { kind: 'parsed', actions: [
    { operation: 'r', pressBeat: 2.5, sourceName: null, execution: { kind: 'beat', beat: 3, barOffset: 0 } },
    { operation: 'cr', pressBeat: 3.5, sourceName: null, execution: { kind: 'beat', beat: 0, barOffset: 1 } },
  ] });
  assert.deepEqual(parseSheetCues('&cx2'), { kind: 'parsed', actions: [
    { operation: 'cx', pressBeat: .5, sourceName: null, execution: { kind: 'beat', beat: 1, barOffset: 0 } },
  ] });
  const cues = ['4r(lead)b', '(4)&cx(lead)b', 'p(lead)b', '4er(day)&', '4ec(day)&', 'x(lead)b', 'x(day)3', '1p &p 2p &p 3p &p 4p &p', '1p 2p 3h', '1g', '(3)&r', 'cb', '4x', '1x'];
  for (const cue of cues) assert.equal(parseSheetCues(cue).kind, 'parsed', cue);
  for (const cue of ['0p', '5p', '(5)&r', 'r()', 'r(3)', 'rr', 'cxx', '1p&p', '1p*', 'clb', '(3)4r', 'r(lead day)', '1.5p', '1pb2']) assert.equal(parseSheetCues(cue).kind, 'invalid', cue);
  assert.deepEqual(parseSheetCues('4p &p'), { kind: 'parsed', actions: [
    { operation: 'p', pressBeat: 3, sourceName: null, execution: { kind: 'now' } },
    { operation: 'p', pressBeat: 3.5, sourceName: null, execution: { kind: 'now' } },
  ] });
  const fresh = parseSheetCues('&p');
  assert.equal(fresh.kind === 'parsed' && fresh.actions[0].pressBeat, .5);
});

test('bar-end padding requires an explicit in-bar commit beat', () => {
  for (const cue of ['cx(strum)4~b', 'c(strum)4&~b']) assert.equal(parseSheetCues(cue).kind, 'parsed', cue);
  for (const cue of ['r4~b', 'cr4~b', 'p4~b', 'cx~b', 'cxb~b', 'cx1~b', 'cx4~1..3~b']) {
    assert.equal(parseSheetCues(cue).kind, 'invalid', cue);
  }
});

test('complete terse language survives canonical MusicXML with capability blocks and no source archive', async () => {
  const source = JSON.parse(await readFile(new URL('../../../songs/dance-yrself-clean.source.json', import.meta.url), 'utf8'));
  const mapping = JSON.parse(await readFile(new URL('../../../songs/dance-yrself-clean.cutover.mapping.json', import.meta.url), 'utf8'));
  mapping.notationVersion = 'terse-v2'; mapping.overrides = []; mapping.variantReuses = [];
  for (const control of mapping.controls) source.values[control.cueRow - 1].fill('', mapping.leadInColumn - 1);
  source.values[mapping.controls[0].cueRow - 1][mapping.leadInColumn] = '(3)&r4 (4)&cr1';
  source.values[mapping.controls[0].cueRow - 1][mapping.leadInColumn + 1] = '&cx2';
  source.values[mapping.controls[1].cueRow - 1][mapping.leadInColumn] = '(4)&cx(lead)b';
  source.values[mapping.controls[2].cueRow - 1][mapping.leadInColumn] = '1p 2p 3h';
  source.values[mapping.controls[3].cueRow - 1][mapping.leadInColumn] = '1g';
  const expected = await compileSheetsSong(source, mapping);
  assert.equal(expected.notationVersion, 'terse-v2'); assert.equal(expected.executable, false);
  assert.equal(expected.authoredCues?.length, 5);
  assert.equal(expected.cues.filter(cue => cue.buttonId === mapping.controls[0].buttonId).length, 3);
  assert.notEqual(expected.cues[0].id, expected.cues[1].id);
  const imported = await importSheetMusicXml({ source, mapping });
  const first = await readMusicXmlSong(imported.xml);
  const standalone = await writeMusicXmlSong({ song: first.song, report: first.report });
  const second = await readMusicXmlSong(standalone);
  assert.equal(second.source, null); assert.equal(second.mapping, null);
  assert.deepEqual(second.song.authoredCues, expected.authoredCues);
  assert.equal(second.song.executable, false);
  assert.match(inspectCompiledSong(second.song), /AUTHORED[^\n]*cx\(lead\)/);
  assert.match(inspectCompiledSong(second.song), /AUTHORED[^\n]*h\(default\)/);
  assert.throws(() => decodeCompiledSong({ ...expected, authoredCues: [] }), /cell is missing/);
  const blank = { L1: '', L2: '', R1: '', R2: '' };
  const corrupted = { ...expected, authoredCues: [], diagnostics: [], executable: true,
    chart: { ...expected.chart, leadInCues: blank, bars: expected.chart.bars.map((bar, index) => ({ ...bar, cues: { ...blank, R1: index === 0 ? 'gibberish' : '' } })) } };
  assert.throws(() => decodeCompiledSong(corrupted), /Invalid authored cue/);
  const changed = standalone.replace(/(<words id="command-R1-1">)[^<]+(<\/words>)/, '$1x$2');
  assert.notEqual(changed, standalone);
  await assert.rejects(readMusicXmlSong(changed), /display or semantics disagree/);
  assert.throws(() => decodeCompiledSong({ ...expected, executable: true, diagnostics: [] }), /Authored cues|Invalid executable|capture|errors/);
  const forged = { ...expected, authoredCues: expected.authoredCues?.map((cell, index) => index ? cell : { ...cell, actions: cell.actions.map((action, i) => i ? action : { ...action, pressBeat: 0 }) }) };
  assert.throws(() => decodeCompiledSong(forged), /semantics disagree/);
});

test('grouped actions share one press and retain independently authored boundaries', () => {
  const parsed = parseSheetCues('4c(pick)b+p(strum)b');
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') return;
  assert.deepEqual(parsed.actions.map(action => [action.pressBeat, action.operation, action.sourceName, action.execution, action.group]), [
    [3, 'c', 'pick', { kind: 'next-bar' }, 1], [3, 'p', 'strum', { kind: 'next-bar' }, 1],
  ]);
  assert.deepEqual(parseSheetCues('x(drum+spit)b'), parseSheetCues('x(drum)b+x(spit)b'));
  for (const token of ['p+', '+p', 'p++x', '1p+2x', 'p(lead+day)']) assert.equal(parseSheetCues(token).kind, 'invalid', token);
});

test('terse native resources include immutable named takes, store policy, parity and grouped replacement', async () => {
  const { terseCaptureFixture } = await import('./fixtures/terse-capture.js');
  const song = await terseCaptureFixture();
  assert.equal(song.executable, true, JSON.stringify(song.diagnostics));
  assert.equal(song.schemaVersion, 7);
  const words = song.takes.filter(take => take.voiceId === 'words');
  assert.equal(words.length, 2);
  assert.deepEqual(words.map(take => take.begin), [{ bar: 1, beat: 3 }, { bar: 2, beat: 0 }]);
  const hits = song.cues.filter(cue => cue.bar === 3 && cue.kind === 'play');
  assert.deepEqual(hits.map(cue => song.selections.find(selection => selection.id === cue.selectionId)?.takeIds[0]),
    [words[1].id, words[0].id, words[1].id, words[0].id]);
  assert(hits.every(cue => cue.playbackMode === 'one-shot'));
  assert.equal(song.cues.find(cue => cue.bar === 2)?.launchPolicy, 'store');
  const grouped = song.cues.filter(cue => cue.bar === 7);
  assert.deepEqual(grouped.map(cue => [cue.kind, cue.sourceName]), [['commit', 'pick'], ['play', 'strum']]);
  assert.equal(grouped[0].groupId, grouped[1].groupId);
  const stops = song.cues.filter(cue => cue.bar === 9 && cue.buttonId === 'L1');
  assert.deepEqual(stops.map(cue => cue.voiceId), ['guitar', 'words']);
  assert(stops.every(cue => cue.selectionId !== null));
  const held = song.cues.find(cue => cue.playbackMode === 'held');
  assert.equal(song.selections.find(selection => selection.id === held?.selectionId)?.window.kind, 'slice');
  const { encodeCompiledProgram } = await import('../compiled-native.js');
  const { PF } = await import('../wasm-abi.js');
  const encoded = encodeCompiledProgram(song);
  assert.equal(encoded[1], 7);
  assert.equal(PF.COMPILED_CUE_FIELDS, 16);
  const offset = PF.COMPILED_HEADER_FIELDS + song.takes.length * PF.COMPILED_TAKE_FIELDS;
  assert.deepEqual(Array.from(encoded.slice(offset + PF.COMPILED_CUE_FIELDS * song.cues.indexOf(grouped[1]) + 11,
    offset + PF.COMPILED_CUE_FIELDS * song.cues.indexOf(grouped[1]) + 16)), [0, 0, 0, 0, 1]);
});

test('terse schema seven survives standalone canonical XML and migrates schema six explicitly', async () => {
  const { terseCaptureInput } = await import('./fixtures/terse-capture.js');
  const input = terseCaptureInput();
  const imported = await importSheetMusicXml(input);
  const first = await readMusicXmlSong(imported.xml);
  const standalone = await writeMusicXmlSong({ song: first.song, report: first.report });
  const second = await readMusicXmlSong(standalone);
  assert.equal(second.source, null);
  assert.deepEqual(second.song.cues, first.song.cues);
  assert.deepEqual(second.song.takes, first.song.takes);
  const legacy = { ...first.song, notationVersion: 'dyc-v1', schemaVersion: 6, cues: first.song.cues.map(({ captureReplacement, launchPolicy, playbackMode, groupId, sourceName, ...cue }) => cue), executable: false };
  const migrated = decodeCompiledSong(legacy);
  assert.equal(migrated.schemaVersion, 7);
  assert(migrated.cues.every(cue => cue.launchPolicy === 'autoplay' && cue.playbackMode === 'loop' && cue.groupId === null));
  const forged = { ...first.song, cues: first.song.cues.map(cue => ({ ...cue, groupId: null })) };
  assert.throws(() => decodeCompiledSong(forged), /native lowering/);
});

test('prepared external sample binding survives canonical XML and stays separate from banks', async () => {
  const { terseCaptureInput } = await import('./fixtures/terse-capture.js');
  const input = terseCaptureInput();
  const imported = await importSheetMusicXml(input);
  const current = await readMusicXmlSong(imported.xml);
  const song = decodeCompiledSong({ ...current.song, externalSamples: [{ slot: 0, voiceId: 'tambourine', begin: { bar: 8, beat: 0 }, end: { bar: 10, beat: 0 } }] });
  const standalone = await writeMusicXmlSong({ song, report: current.report });
  const second = await readMusicXmlSong(standalone);
  assert.deepEqual(second.song.externalSamples, song.externalSamples);
  const { encodeCompiledProgram } = await import('../compiled-native.js');
  const encoded = encodeCompiledProgram(second.song);
  assert.deepEqual(Array.from(encoded.slice(-7)), [0x50464531, 1, 0, 8, 0, 10, 0]);
  assert.throws(() => decodeCompiledSong({ ...song, externalSamples: [...song.externalSamples ?? [], ...song.externalSamples ?? []] }), /external sample/);
});

test('unprepared gating and mixed source effects block only their dependent song artifacts', async () => {
  const { terseCaptureInput } = await import('./fixtures/terse-capture.js');
  const { source, mapping } = terseCaptureInput();
  const values = source.values.map(row => [...row]); values[20][9] = '1g';
  const gated = await compileSheetsSong({ ...source, values }, mapping);
  assert.equal(gated.executable, false);
  assert(gated.diagnostics.some(diagnostic => diagnostic.code === 'play-selection'));
  assert.equal(gated.takes.length, 4);
  const mixed = await compileSheetsSong(source, { ...mapping, sourceBindings: mapping.sourceBindings?.map(binding => binding.sourceName === 'pick' ? { ...binding, voiceId: 'separate-guitar-effect' } : binding) });
  assert.equal(mixed.executable, false);
  assert(mixed.diagnostics.some(diagnostic => diagnostic.code === 'source-effects-capability'));
  assert.throws(() => decodeCompiledSong({ ...mixed, executable: true, diagnostics: [] }), /source effect profile/);
});

test('explicit per-note fixture order is canonical data and encodes manual native hits', async () => {
  const { terseCaptureInput } = await import('./fixtures/terse-capture.js');
  const imported = await importSheetMusicXml(terseCaptureInput());
  const current = await readMusicXmlSong(imported.xml);
  const song = decodeCompiledSong({ ...current.song, noteBanks: [{ buttonId: 'R2', toleranceMs: 25,
    notes: [{ slot: 8, at: { bar: 8, beat: 0 } }, { slot: 9, at: { bar: 8, beat: 1.5 } }, { slot: 8, at: { bar: 9, beat: 2 } }] }] });
  const standalone = await writeMusicXmlSong({ song, report: current.report });
  const second = await readMusicXmlSong(standalone);
  assert.deepEqual(second.song.noteBanks, song.noteBanks);
  const { encodeCompiledProgram } = await import('../compiled-native.js');
  const encoded = encodeCompiledProgram(second.song);
  assert.deepEqual(Array.from(encoded.slice(-17)), [0x50464e31, 3, 3, 8, 8, 0, 25, 3, 9, 8, 1.5, 25, 3, 8, 9, 2, 25]);
  assert.throws(() => decodeCompiledSong({ ...song, noteBanks: [{ ...song.noteBanks?.[0], notes: [{ slot: 8, at: { bar: 9, beat: 0 } }, { slot: 9, at: { bar: 8, beat: 0 } }] }] }), /note order/);
});

test('sheet tap rhythms use the declared captured notes and retain ordinary actions through MusicXML', async () => {
  const { terseCaptureInput } = await import('./fixtures/terse-capture.js');
  const { source, mapping } = terseCaptureInput();
  const values = source.values.map(row => [...row]);
  values[18][5] = '4';
  values[18][6] = '1&2&';
  values[20][6] = '(4)&';
  const capture = { profile: 0, root: 52, scale: 'major', slots: [0, 1, 2, 3, 4, 5, 6, 7] } satisfies NonNullable<SongMapping['tunedNotes']>['capture'];
  const tunedNotes = {
    capture, toleranceMs: 100,
    bindings: [
      { buttonId: 'R2', patterns: [{ notation: '4', slot: 2 }, { notation: '1&2&', slot: 3 }] },
      { buttonId: 'L2', slot: 4 },
    ],
  } satisfies NonNullable<SongMapping['tunedNotes']>;
  const authoredMapping = { ...mapping, tunedNotes };
  const imported = await importSheetMusicXml({ source: { ...source, values }, mapping: authoredMapping });
  const { song } = await readMusicXmlSong(imported.xml);
  assert.equal(song.executable, true, JSON.stringify(song.diagnostics));
  assert.deepEqual(song.noteBanks?.map(bank => [bank.buttonId, bank.notes.map(note => [note.at.bar, note.at.beat, note.slot])]), [
    ['R2', [[4, 3, 2], [5, 0, 3], [5, .5, 3], [5, 1, 3], [5, 1.5, 3]]],
    ['L2', [[5, 3.5, 4]]],
  ]);
  assert.deepEqual(song.noteBanks?.flatMap(bank => bank.capture ? [bank.capture] : []),
    [{ profile: 0, target: { root: 52, scale: 'major' }, slots: capture.slots }]);
  assert(song.cues.some(cue => cue.buttonId === 'R2' && cue.kind === 'stop'));
  await assert.rejects(readMusicXmlSong(imported.xml.replace('command-R2-4">4<', 'command-R2-4">3<')), /Authored rhythm disagrees/);

  values[18][5] = '2';
  const blocked = await compileSheetsSong({ ...source, values }, authoredMapping);
  assert.equal(blocked.executable, false);
  assert(blocked.diagnostics.some(diagnostic => diagnostic.code === 'tuned-note-pattern' && diagnostic.source.a1 === 'F19'));
});

test('pickup source instructions fail visibly until their chart timeline is represented', async () => {
  const { terseCaptureInput } = await import('./fixtures/terse-capture.js');
  const { source, mapping } = terseCaptureInput();
  const values = source.values.map(row => [...row]);
  values[4].splice(2, 0, 'Pickup 0');
  for (let row = 0; row < values.length; row++) if (row !== 4) values[row].splice(2, 0, '');
  values[19][2] = '(3)&r';
  const song = await compileSheetsSong({ ...source, values }, mapping);
  assert.equal(song.executable, false);
  assert(song.diagnostics.some(diagnostic => diagnostic.code === 'cue-timeline' && diagnostic.source.a1 === 'C20'));
});

test('release capture and ordered paired playback have separate auditable source actions', () => {
  assert.deepEqual(parseSheetCues('4ru(drunk)'), { kind: 'parsed', actions: [
    { operation: 'ru', pressBeat: 3, sourceName: 'drunk', execution: { kind: 'now' } },
  ] });
  assert.deepEqual(parseSheetCues('1cx(drunk)+1ru(girls) 2cx(girls)'), { kind: 'parsed', actions: [
    { operation: 'cx', pressBeat: 0, sourceName: 'drunk', execution: { kind: 'now' }, group: 1 },
    { operation: 'ru', pressBeat: 0, sourceName: 'girls', execution: { kind: 'now' }, group: 1 },
    { operation: 'cx', pressBeat: 1, sourceName: 'girls', execution: { kind: 'now' } },
  ] });
  assert.deepEqual(parseSheetCues('4pp(drunk+girls)'), { kind: 'parsed', actions: [
    { operation: 'pp', pressBeat: 3, sourceName: 'drunk+girls', execution: { kind: 'now' } },
  ] });
  for (const cell of ['4ru', 'ru(drunk)', '4ru(drunk)b', '4ru(drunk+girls)', 'pp(drunk+girls)', '4pp(drunk)',
    '4pp(drunk+drunk)', '4pp(drunk+girls+boys)', '4pp(drunk+girls)b', '4pp(drunk+girls)+4x'])
    assert.equal(parseSheetCues(cell).kind, 'invalid', cell);
});

async function edgeCaptureInput() {
  const { terseCaptureInput } = await import('./fixtures/terse-capture.js');
  const { source, mapping } = terseCaptureInput();
  const values = source.values.map(row => [...row]);
  values[17].fill('');
  values[17][2] = '4ru(drunk)';
  values[17][3] = '1cx(drunk)+1ru(girls) 2cx(girls)';
  values[17][4] = '4pp(drunk+girls)';
  values[17][6] = '2pp(drunk+girls)';
  values[19][10] = '1x(strum+girls)';
  return { source: { ...source, values }, mapping: { ...mapping, sourceBindings: [
    ...mapping.sourceBindings ?? [],
    { buttonId: 'R1', sourceName: 'drunk', playbackMode: 'one-shot' },
    { buttonId: 'R1', sourceName: 'girls', playbackMode: 'one-shot' },
  ] } satisfies SongMapping };
}

test('release and paired playback survive standalone MusicXML and encode exact native references', async () => {
  const { encodeCompiledProgram } = await import('../compiled-native.js');
  const { PF } = await import('../wasm-abi.js');
  const input = await edgeCaptureInput();
  const compiled = await compileSheetsSong(input.source, input.mapping);
  assert(compiled.executable, JSON.stringify(compiled.diagnostics));
  const [drunk, girls] = compiled.takes.filter(take => take.voiceId === 'words');
  for (const take of [drunk, girls]) assert.equal(compiled.cues.find(cue => cue.id === take.commitCueId)?.launchPolicy, 'store');
  const [firstSelection, secondSelection] = [drunk, girls].map(take => compiled.selections.find(selection => selection.takeIds[0] === take.id));
  assert(firstSelection && secondSelection);
  assert.deepEqual(compiled.releaseCapturePairs, [{ firstTakeId: drunk.id, secondTakeId: girls.id }]);
  assert.deepEqual(compiled.playbackPairs, [{ bar: 3, beat: 3 }, { bar: 5, beat: 1 }].map(first => ({
    buttonId: 'R1', first, firstSelectionId: firstSelection.id, secondSelectionId: secondSelection.id,
  })));
  assert(!compiled.cues.some(cue => cue.source.text.includes('pp(')));
  const { song, report } = await readMusicXmlSong((await importSheetMusicXml(input)).xml);
  const standalone = await readMusicXmlSong(await writeMusicXmlSong({ song, report }));
  assert.equal(standalone.source, null);
  assert.equal(standalone.song.chart.bars[2].cues.R1, '4pp(drunk+girls)');
  assert.deepEqual(standalone.song.releaseCapturePairs, compiled.releaseCapturePairs);
  assert.deepEqual(standalone.song.playbackPairs, compiled.playbackPairs);
  const packet = Array.from(encodeCompiledProgram(standalone.song));
  assert.deepEqual(packet.slice(packet.indexOf(PF.COMPILED_EDGE_MAGIC)), [
    PF.COMPILED_EDGE_MAGIC, 1, 2, 0, 1, 2, 3, 3, 0, 1, 2, 5, 1, 0, 1,
  ]);
  assert.throws(() => decodeCompiledSong({ ...compiled, releaseCapturePairs: [] }), /disagree with compiled pairs/);
  assert.throws(() => decodeCompiledSong({ ...compiled, playbackPairs: [] }), /disagree with compiled pairs/);
});

test('edge imports reject missing cuts, unbound clips, and overlapping or incomplete playback pairs', async () => {
  for (const [column, replacement, a1] of [
    [3, '1c(drunk)+1ru(girls) 2cx(girls)', 'C18'],
    [3, '1cx(drunk)+1ru(girls) cx(girls)', 'C18'],
    [3, '1cx(drunk)+1ru(girls)', 'C18'],
    [4, '4pp(drunk+unknown)', 'E18'],
    [5, '1pp(drunk+girls)', 'F18'],
    [4, '3ap(girls) 4pp(drunk+girls)', 'E18'],
    [5, '1p(girls)', 'E18'],
    [5, '1ep(girls)', 'E18'],
    [11, '4pp(drunk+girls)', 'L18'],
  ] satisfies [number, string, string][]) {
    const { source, mapping } = await edgeCaptureInput();
    source.values[17][column] = replacement;
    const compiled = await compileSheetsSong(source, mapping);
    assert.equal(compiled.executable, false, replacement);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.source.a1 === a1 && diagnostic.code === 'edge-cue'), JSON.stringify(compiled.diagnostics));
  }
});
