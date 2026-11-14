import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSheetsSong, decodeCompiledSong } from '../compiled-song.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { readMusicXmlSong } from '../musicxml-song.js';
import { terseCaptureInput } from './fixtures/terse-capture.js';
import { discoverSheetVoices } from '../../voice-catalog/sheet-voices.js';
import { initialVoiceEffects } from '../../../ui/practice/voice-effects.js';

function input() {
  const fixture = terseCaptureInput();
  const values = fixture.source.values.map((row, index) => index === 13 ? ['AF - Captured lead', ...row.slice(1)] : row);
  const sourceBindings = fixture.mapping.sourceBindings?.map(binding => binding.sourceName === 'pick'
    ? { ...binding, voiceId: 'captured-lead', profile: 4, sourceCell: 'A14' } : binding);
  return { source: { ...fixture.source, values }, mapping: { ...fixture.mapping, sourceBindings } };
}

test('source profiles remain independent of physical banks through canonical XML and native bytes', async () => {
  const { source, mapping } = input();
  const compiled = await compileSheetsSong(source, mapping);
  assert.equal(compiled.executable, true, JSON.stringify(compiled.diagnostics));
  const lead = compiled.takes.find(take => take.sourceName === 'pick');
  assert(lead);
  assert.equal(lead.voiceId, 'guitar');
  assert.equal(lead.sourceVoiceId, 'captured-lead');
  assert.equal(lead.profile, 4);
  assert.deepEqual(compiled.sourceProfiles?.map(profile => [profile.id, profile.profile, profile.source.a1]), [['captured-lead', 4, 'A14']]);
  const packet = Array.from(encodeCompiledProgram(compiled));
  const extension = packet.indexOf(0x50465031);
  assert.deepEqual(packet.slice(extension), [0x50465031, 1, compiled.takes.indexOf(lead), 4]);
  const imported = await importSheetMusicXml({ source, mapping });
  const standalone = await readMusicXmlSong(imported.xml);
  assert.deepEqual(standalone.song.sourceProfiles, compiled.sourceProfiles);
  assert.equal(standalone.song.takes.find(take => take.sourceName === 'pick')?.profile, 4);
  const voices = discoverSheetVoices(standalone.song);
  assert.equal(voices.find(voice => voice.partId === 'captured-lead')?.profile, 4);
  assert.throws(() => decodeCompiledSong({ ...compiled, takes: compiled.takes.map(take => take.id === lead.id ? { ...take, profile: 1 } : take) }), /source effect profile/);
  assert.throws(() => decodeCompiledSong({ ...compiled, sourceProfiles: compiled.sourceProfiles?.map(profile => ({ ...profile, profile: 1 })) }), /profile ownership/);
});

test('a source cannot silently claim another voice profile and declared source defaults are dry', async () => {
  const { source, mapping } = input();
  const brokenMapping = { ...mapping, sourceBindings: mapping.sourceBindings?.map(binding => binding.sourceName === 'pick' ? { ...binding, profile: 1 } : binding) };
  const compiled = await compileSheetsSong(source, brokenMapping);
  assert.equal(compiled.executable, false);
  assert(compiled.diagnostics.some(diagnostic => diagnostic.code === 'source-profile'));
  const duplicateLabel = { ...mapping, sourceBindings: mapping.sourceBindings?.map(binding => binding.sourceName === 'pick' ? { ...binding, sourceCell: 'A10' } : binding) };
  assert((await compileSheetsSong(source, duplicateLabel)).diagnostics.some(diagnostic => diagnostic.code === 'source-profile'));
  assert.deepEqual(initialVoiceEffects('compiled', [5]).find(profile => profile.profile === 5)?.effects, []);
  assert.equal(initialVoiceEffects('compiled').find(profile => profile.profile === 5)?.effects.length, 2, 'legacy rotation profile defaults remain unchanged');
});


test('named commit cannot silently publish a differently named active recording', async () => {
  const { source, mapping } = input();
  const mismatched = { ...source, values: source.values.map((row, index) => index === 19
    ? row.map((value, column) => column === 8 ? '1c(strum)+p(strum)' : value) : row) };
  const blocked = await compileSheetsSong(mismatched, mapping);
  assert.equal(blocked.executable, false);
  assert(blocked.diagnostics.some(diagnostic => diagnostic.code === 'capture-source-mismatch' && diagnostic.source.a1 === 'I20'));
  const compiled = await compileSheetsSong(source, mapping);
  const pick = compiled.takes.find(take => take.sourceName === 'pick');
  assert(pick);
  assert.throws(() => decodeCompiledSong({ ...compiled, takes: compiled.takes.map(take => take.id === pick.id ? { ...take, sourceName: 'strum' } : take) }), /Named commit source/);
});


test('unnamed playback retains its explicitly bound default source after another voice captures on the same bank', async () => {
  const { source, mapping } = input();
  const laterPlay = { ...source, values: source.values.map((row, index) => index === 19
    ? row.map((value, column) => column === 10 ? '1p' : value) : row) };
  const compiled = await compileSheetsSong(laterPlay, mapping);
  assert.equal(compiled.executable, true, JSON.stringify(compiled.diagnostics));
  const play = compiled.cues.find(cue => cue.bar === 9 && cue.buttonId === 'L1' && cue.kind === 'play');
  const selection = compiled.selections.find(selection => selection.id === play?.selectionId);
  assert.equal(compiled.takes.find(take => take.id === selection?.takeIds[0])?.sourceName, 'strum');
});

test('hardware notes remain control labels while arrangement labels own effect profiles', async () => {
  const { source, mapping } = input();
  const combined = { ...source, notes: { ...source.notes, A20: 'AF - Guitar + AF - Captured lead' } };
  const compiled = await compileSheetsSong(combined, mapping);
  const guitar = compiled.parts.find(part => part.id === 'guitar');
  assert.equal(guitar?.source.a1, 'A12');
  assert.equal(guitar?.name, 'Guitar');
  assert.equal(compiled.chart.controlNames.L1, 'AF - Guitar + AF - Captured lead');
});
