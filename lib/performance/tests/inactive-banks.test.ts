import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSheetsSong } from '../compiled-song.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { readMusicXmlSong } from '../musicxml-song.js';
import { terseCaptureInput } from './fixtures/terse-capture.js';

function threeControls() {
  const base = terseCaptureInput();
  const input = { source: { ...base.source, values: base.source.values.map(row => [...row]) }, mapping: { ...base.mapping, controls: [...base.mapping.controls] } };
  input.mapping.controls = input.mapping.controls.filter(control => control.buttonId !== 'R2');
  input.source.values[18].fill('');
  input.source.values[18][0] = 'R2';
  return input;
}

test('unused hardware banks do not require invented voices or effect profiles', async () => {
  const input = threeControls();
  const song = await compileSheetsSong(input.source, input.mapping);
  assert.equal(song.executable, true, JSON.stringify(song.diagnostics));
  assert.deepEqual(song.voices.map(voice => voice.buttonId), ['R1', 'L1', 'L2']);
  assert.equal(song.parts.length, 3);
  assert.equal(song.parts.some(part => part.id === 'dry'), false);
  assert.equal(song.chart.controlNames.R2, 'R2');
  assert.equal(song.parts.some(part => part.role.kind === 'pad' && part.role.buttonId === 'R2'), false);
  const packet = encodeCompiledProgram(song);
  assert.equal(new Set(packet.slice(12, 16)).size, 4, 'all native banks still have one hardware binding');
  assert.deepEqual([...packet.slice(12, 16)].sort(), [0, 1, 2, 3]);
  const { xml } = await importSheetMusicXml(input);
  const canonical = await readMusicXmlSong(xml);
  assert.equal(canonical.song.executable, true);
  assert.equal(canonical.song.voices.length, 3);
  assert.equal(canonical.song.parts.length, 3);
  assert.deepEqual(encodeCompiledProgram(canonical.song), packet);
});

test('a written cue on an unassigned button cannot disappear during import', async () => {
  const input = threeControls();
  input.source.values[18][4] = '1p';
  const song = await compileSheetsSong(input.source, input.mapping);
  assert.equal(song.executable, false);
  assert(song.diagnostics.some(diagnostic => diagnostic.severity === 'error' && diagnostic.source.a1 === 'E19'));
  assert.throws(() => encodeCompiledProgram(song));
});

test('the active control set cannot be empty or contain duplicate physical buttons', async () => {
  const input = threeControls();
  const empty = await compileSheetsSong(input.source, { ...input.mapping, controls: [] });
  assert.equal(empty.executable, false);
  const first = input.mapping.controls[0];
  assert(first);
  await assert.rejects(() => compileSheetsSong(input.source, { ...input.mapping, controls: [...input.mapping.controls, first] }));
});
