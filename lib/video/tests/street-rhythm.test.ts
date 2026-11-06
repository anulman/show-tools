import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSheetStageCell } from '../../performance/sheet-stage-notation.js';
import { importSheetMusicXml } from '../../performance/sheet-musicxml.js';
import { readMusicXmlSong } from '../../performance/musicxml-song.js';
import { parseSongSource } from '../../performance/song-source.js';
import { discoverSheetVoices } from '../../voice-catalog/sheet-voices.js';
import sourceInput from '../../../songs/dance-yrself-clean.source.json';
import mapping from '../../../songs/dance-yrself-clean.cutover.mapping.json';

const forms = ['-', "-'", "-'4]", '-4]', '(4)&a', '(4)&', '4', "(4)&'", "4'", '[2!-', "(4)&a'", '&e3a&', '&e3a&a', '&e3a', '&e3e', "&e3a&'", "&e3a&a'", "&e3a'", "&e3e'", '2 4', '2 4e&a', '&e3e&a', '2 4&a', '234&a', '2 4&', '2', '1', "1'", "-'!", '!', '!!', '!-', '4e&a]', '-4!', '-2!', '!4!!', '!2!!', '4e&a', '[3!', '1!]', '[4-', '-1]', '-3][4-', '-3]', '[1-', '-3] &'];
test('all actual compact notation families classify with literal max emphasis', () => {
  for (const form of forms) assert.doesNotThrow(() => parseSheetStageCell(form, 4), form);
  assert.equal(parseSheetStageCell('!4!!', 4).emphasis, 'ultra');
  assert.equal(parseSheetStageCell('-4!', 4).emphasis, 'special');
  assert.deepEqual(parseSheetStageCell('-', 4), { active: true, emphasis: 'normal', sampled: false, accents: [], anchor: null });
  assert.equal(parseSheetStageCell('', 4).active, false);
  for (const text of ["-'", "1'", "-'!", "4'", "(4)&a'"]) assert.equal(parseSheetStageCell(text, 4, true).sampled, true, text);
  for (const text of ["We've got to… '", "Don't you want me to wake up...'", "We've got to… -'"]) assert.equal(parseSheetStageCell(text, 4, true).sampled, true, text);
});
test('forward earliest subdivisions retain every accent', () => {
  for (const [text, expected] of [ ['&e3a&', [.5, 1.25, 2, 2.75, 3.5]], ['&e3a&a', [.5, 1.25, 2, 2.75, 3.5, 3.75]], ['&e3e', [.5, 1.25, 2, 2.25]], ['(4)&a', [3.5, 3.75]], ['1&a', [0, .5, .75]], ['1 3', [0, 2]] ] satisfies Array<[string, number[]]>) assert.deepEqual(parseSheetStageCell(text, 4).accents, expected);
  assert.deepEqual(parseSheetStageCell("4We've got to…", 4, true).accents, [3]);
  for (const text of ['31', '4&e', '5', '?', 'word']) assert.throws(() => parseSheetStageCell(text, 4), text);
});
test('every nonblank cell of all eight current DYC rows is classified', async () => {
  const source = parseSongSource(sourceInput);
const { xml: musicxml } = await importSheetMusicXml({ source, mapping });
const { song: compiled } = await readMusicXmlSong(musicxml);
  const rows = discoverSheetVoices(compiled, source);
  assert.equal(rows.length, 8); assert.equal(compiled.chart.bars.length, 218); assert.equal(compiled.diagnostics.length, 0);
  for (const row of rows) for (const cue of row.cues) assert.doesNotThrow(() => parseSheetStageCell(cue.text, 4, compiled.parts.find(part => part.id === row.partId)?.role.kind === 'default-live'), `${cue.cell}: ${cue.text}`);
  const main = rows.find(row => compiled.parts.find(part => part.id === row.partId)?.role.kind === 'default-live');
  assert(main);
  const contractions = main.cues.filter(cue => /[A-Za-z]'[A-Za-z]/.test(cue.text));
  assert.deepEqual(contractions.map(cue => cue.cell), ['CI8', 'CQ8', 'CY8', 'EY8', 'FW8']);
  for (const cue of contractions) assert.equal(parseSheetStageCell(cue.text, 4, true).sampled, false, `${cue.cell}: ${cue.text}`);
});


test('anchors identify the first beat rather than its first subdivision hit', () => {
  assert.equal(parseSheetStageCell('&e3a&', 4).anchor, 0);
  assert.equal(parseSheetStageCell('(4)&a', 4).anchor, 3);
  assert.equal(parseSheetStageCell('2 4', 4).anchor, 1);
});
