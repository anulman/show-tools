import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSheetsSong } from '../compiled-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { readMusicXmlSong } from '../musicxml-song.js';
import { terseCaptureInput } from './fixtures/terse-capture.js';

test('full pickup measures keep source labels while execution remains chronological across numbered one', async () => {
  const { source, mapping } = terseCaptureInput();
  const values = source.values.map(row => [...row.slice(0, 2), ...Array<string>(9).fill(''), ...row.slice(2)]);
  values[1][5] = '120';
  for (const control of mapping.controls) values[control.cueRow - 1].fill('', 2);
  const prelude = Array.from({ length: 9 }, (_, index) => ({ label: `Pickup ${index}`, counts: 4 }));
  for (const [index, measure] of prelude.entries()) values[4][index + 2] = measure.label;
  values[3][2] = 'Pickup'; values[19][2] = '(3)&r'; values[19][9] = 'cb';
  const input = { source: { ...source, range: 'A1:U24', values }, mapping: { ...mapping, prelude,
    sourceBindings: mapping.sourceBindings?.map(binding => binding.sourceName === 'strum' ? { ...binding, loopCounts: 32 } : binding) } };
  const song = await compileSheetsSong(input.source, input.mapping);
  assert(song.executable, JSON.stringify(song.diagnostics));
  assert.equal(song.chart.bars.length, 19);
  assert.deepEqual(song.chart.bars.slice(0, 10).map(bar => [bar.bar, bar.label, bar.column]),
    [...prelude.map((measure, index) => [index + 1, measure.label, index + 3]), [10, '1', 12]]);
  assert.deepEqual(song.takes[0].begin, { bar: 1, beat: 2.5 });
  assert.deepEqual(song.takes[0].captureEnd, { bar: 9, beat: 0 });
  assert.deepEqual(song.takes[0].loopEnd, { bar: 9, beat: 2.5 });
  const xml = await importSheetMusicXml(input); assert(xml.xml.includes('measure number="Pickup 8"'));
  const restored = await readMusicXmlSong(xml.xml);
  assert.deepEqual(restored.song.chart.bars, song.chart.bars);
  assert.deepEqual(restored.song.takes, song.takes);
  const shortened = { ...input.mapping, prelude: prelude.map((measure, index) => index === 8 ? { ...measure, counts: 1 } : measure) };
  assert((await compileSheetsSong(input.source, shortened)).diagnostics.some(d => d.code === 'prelude'));
});
