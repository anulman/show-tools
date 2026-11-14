import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetCues } from '../sheet-cues.js';
import { compileSheetsSong, decodeCompiledSong, inspectCompiledSong } from '../compiled-song.js';
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
  assert.equal(expected.cues.filter(cue => cue.buttonId === mapping.controls[0].buttonId).length, 2);
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
  assert.throws(() => decodeCompiledSong({ ...expected, executable: true, diagnostics: [] }), /capabilities/);
  const forged = { ...expected, authoredCues: expected.authoredCues?.map((cell, index) => index ? cell : { ...cell, actions: cell.actions.map((action, i) => i ? action : { ...action, pressBeat: 0 }) }) };
  assert.throws(() => decodeCompiledSong(forged), /semantics disagree/);
});
