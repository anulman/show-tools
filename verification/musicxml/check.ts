import assert from 'node:assert/strict';
import { compiledProgramBytes } from '../../lib/performance/compiled-native.js';
import { CONTROL_IDS, PHYSICAL_SWITCH_IDS } from '../../lib/performance/model.js';
import { PF } from '../../lib/performance/wasm-abi.js';
import { createHash } from 'node:crypto';
import { importSheetMusicXml } from '../../lib/performance/sheet-musicxml.js';
import { compileMusicXmlSong, readMusicXmlSong, writeMusicXmlSong, type MusicXmlSong } from '../../lib/performance/musicxml-song.js';
import { bindingCases, bindingGrammar, fullSetupBindingCases, fullSetupBindingGrammar, grammar, scoreCases, scoreInput, voiceCatalog, type ScoreCase } from './domain.js';

function withoutArchive(xml: string, field: string): string {
  const pattern = new RegExp(`<miscellaneous-field name="show-tools:${field}">[^]*?<\\/miscellaneous-field>`);
  assert(pattern.test(xml), `ARCHIVE_FIELD_PRESENT: ${field}`);
  return xml.replace(pattern, '');
}
function archives(xml: string, variant: typeof grammar.archives[number]): string {
  if (variant !== 'both' && variant !== 'source') xml = withoutArchive(xml, 'source');
  if (variant !== 'both' && variant !== 'mapping') xml = withoutArchive(xml, 'mapping');
  return xml;
}
function meaning(document: MusicXmlSong) {
  return { song: document.song, report: document.report, voices: document.voices };
}
function writeInput(document: MusicXmlSong) {
  return { song: document.song, report: document.report,
    ...(document.voices === null ? {} : { voices: document.voices }),
    ...(document.source === null ? {} : { source: document.source }),
    ...(document.mapping === null ? {} : { mapping: document.mapping }) };
}
async function displayAgreement(xml: string): Promise<void> {
  const changed = xml.replace(/(<words id="command-R1-1">)[^<]+(<\/words>)/, '$1contradictory$2');
  assert.notEqual(changed, xml, 'DISPLAY_WITNESS_PRESENT');
  await assert.rejects(readMusicXmlSong(changed), /command display disagrees/, 'DISPLAY_ACTION_AGREEMENT');
}
function scoreMeaning(document: MusicXmlSong, example: ScoreCase): void {
  assert(document.song.executable, 'GENERATED_CASE_MUST_BE_EXECUTABLE');
  assert.deepEqual(document.song.diagnostics, [], 'GENERATED_CASE_MUST_HAVE_NO_DIAGNOSTICS');
  assert.deepEqual(document.song.meter, example.meter, 'METER_PRESERVED');
  assert.equal(document.song.chart.beatsPerBar, example.meter.numerator, 'COUNT_UNIT_PRESERVED');
  assert.equal(document.report.measureCount, example.cells.length, 'ALL_BARS_PRESERVED');
  assert.equal(document.report.parts.length, example.liveVocals ? 6 : 5, 'ALL_SCORE_PARTS_PRESERVED');
  const reference = document.report.parts.find(part => part.labelCell === 'A14');
  assert(reference, 'REFERENCE_PART_PRESENT');
  for (const [index, token] of example.cells.entries()) {
    const expected = token === '' ? { kind: 'blank' } : { kind: 'hits', offsets: token === '1' ? [0] : [3.5, 3.75], sampled: token !== '1' };
    assert.deepEqual(reference.cells[index].reading, expected, 'REFERENCE_SUBDIVISIONS_PRESERVED');
  }
  assert.equal(document.song.cues.length, 1, 'ONE_AUTHORED_ACTION');
  const cue = document.song.cues[0];
  assert.equal(cue.kind, 'stop', 'ACTION_KIND_PRESERVED');
  assert.deepEqual(cue.execution, example.command === 'x' ? { kind: 'now' } : { kind: 'beat', beat: 1.5 }, 'ACTION_BOUNDARY_PRESERVED');
}
async function voiceDigests(document: MusicXmlSong): Promise<string[]> {
  const result: string[] = [];
  for (const variant of grammar.voices) {
    const voices = voiceCatalog(variant);
    const xml = await writeMusicXmlSong({ ...writeInput(document), ...(voices === undefined ? {} : { voices }) });
    const parsed = await readMusicXmlSong(xml);
    assert.deepEqual(parsed.voices, voices ?? null, 'VOICE_METADATA_PRESERVED');
    result.push(parsed.song.source.digest);
  }
  assert.equal(new Set(result).size, grammar.voices.length, 'VOICE_SEMANTIC_IDENTITY');
  return result;
}

async function pickupTimelineWitness(): Promise<void> {
  const example = scoreCases().next().value;
  assert(example, 'NONEMPTY_GRAMMAR');
  const input = scoreInput(example);
  const values = input.source.values.map(row => [...row.slice(0, 2), '', ...row.slice(2)]);
  values[1][5] = '98'; values[3][2] = 'Pickup'; values[4][2] = 'Pickup 0';
  values[4][4] = 'Tail'; values[17][4] = 'x';
  const imported = await importSheetMusicXml({ source: { ...input.source, range: 'A1:G21', values },
    mapping: { ...input.mapping, prelude: [{ label: 'Pickup 0', counts: 4 }], terminalStops: ['E18'] } });
  const original = await readMusicXmlSong(imported.xml);
  assert.equal(original.song.executable, true, 'PICKUP_WITNESS_EXECUTABLE');
  assert.deepEqual(original.song.chart.bars.map(bar => bar.label), ['Pickup 0', '1'], 'PICKUP_LABELS_PRESERVED');
  assert.deepEqual(original.song.terminalStops?.map(stop => [stop.a1, stop.text]), [['E18', 'x']], 'TERMINAL_STOP_PRESERVED');
  const standalone = await readMusicXmlSong(archives(imported.xml, 'neither'));
  assert.deepEqual(meaning(standalone), meaning(original), 'PICKUP_ARCHIVE_INDEPENDENCE');
  const rewritten = await readMusicXmlSong(await writeMusicXmlSong(writeInput(standalone)));
  assert.deepEqual(meaning(rewritten), meaning(original), 'PICKUP_ROUNDTRIP_MEANING');
  const inconsistent = imported.xml.replace('measure number="Pickup 0"', 'measure number="Wrong pickup"');
  assert.notEqual(inconsistent, imported.xml, 'PICKUP_LABEL_EDIT_APPLIED');
  await assert.rejects(readMusicXmlSong(inconsistent), /chronological and contiguous/, 'MEASURE_LABEL_AGREEMENT');
}

async function inputBindingWitness() {
  const example = scoreCases().next().value;
  assert(example, 'NONEMPTY_GRAMMAR');
  const input = scoreInput(example), ids = new Set<string>(), digests = new Set<string>();
  let accepted = 0, rejected = 0, archiveChecks = 0;
  for (const candidate of bindingCases()) {
    assert(!ids.has(candidate.id), 'DUPLICATE_BINDING_CASE'); ids.add(candidate.id);
    const mapping = { ...input.mapping, ...(candidate.bindings === undefined ? {} : { inputBindings: candidate.bindings }) };
    if (!candidate.valid) {
      await assert.rejects(importSheetMusicXml({ source: input.source, mapping }), 'INPUT_BINDING_OWNERSHIP');
      rejected++; continue;
    }
    const imported = await importSheetMusicXml({ source: input.source, mapping });
    const parsed = await readMusicXmlSong(imported.xml);
    assert.deepEqual(parsed.song.inputBindings, candidate.bindings, 'INPUT_BINDING_MEANING');
    assert.equal(await writeMusicXmlSong(writeInput(parsed)), await writeMusicXmlSong(writeInput(parsed)), 'INPUT_BINDING_DETERMINISTIC_WRITE');
    const rewritten = await readMusicXmlSong(await writeMusicXmlSong(writeInput(parsed)));
    assert.deepEqual(meaning(rewritten), meaning(parsed), 'INPUT_BINDING_ROUNDTRIP');
    assert(!digests.has(parsed.song.source.digest), 'INPUT_BINDING_SEMANTIC_IDENTITY'); digests.add(parsed.song.source.digest);
    for (const archive of grammar.archives) {
      const xml = archives(imported.xml, archive), standalone = await readMusicXmlSong(xml);
      assert.deepEqual(meaning(standalone), meaning(parsed), 'INPUT_BINDING_ARCHIVE_INDEPENDENCE');
      assert.deepEqual(await compileMusicXmlSong(xml), parsed.song, 'INPUT_BINDING_COMPILER_ENTRYPOINT'); archiveChecks++;
    }
    accepted++;
  }
  assert.equal(ids.size, 6173, 'EXHAUSTIVE_BINDING_CARDINALITY');
  assert.equal(accepted, 1814, 'VALID_BINDING_CARDINALITY');
  assert.equal(rejected, 4359, 'REJECTED_BINDING_CARDINALITY');
  assert.equal(archiveChecks, accepted * grammar.archives.length, 'BINDING_ARCHIVE_CARDINALITY');
  return { grammar: bindingGrammar, cases: ids.size, accepted, rejected, archiveChecks };
}

async function fullSetupBindingWitness() {
  const example = scoreCases().next().value;
  assert(example, 'NONEMPTY_GRAMMAR');
  const input = scoreInput(example), ids = new Set<string>(), digests = new Set<string>();
  const counts = new Map<number, number>();
  for (const candidate of fullSetupBindingCases()) {
    assert(!ids.has(candidate.id), 'DUPLICATE_FULL_SETUP_BINDING_CASE'); ids.add(candidate.id);
    counts.set(candidate.bindings.length, (counts.get(candidate.bindings.length) ?? 0) + 1);
    const imported = await importSheetMusicXml({ source: input.source, mapping: { ...input.mapping, inputBindings: candidate.bindings } });
    const standalone = await readMusicXmlSong(archives(imported.xml, 'neither'));
    assert.deepEqual(standalone.song.inputBindings, candidate.bindings, 'INPUT_BINDING_MEANING');
    assert.equal(standalone.source, null, 'FULL_SETUP_SOURCE_ARCHIVE_ABSENT');
    assert.equal(standalone.mapping, null, 'FULL_SETUP_MAPPING_ARCHIVE_ABSENT');
    const rewrittenXml = await writeMusicXmlSong(writeInput(standalone));
    assert.equal(await writeMusicXmlSong(writeInput(standalone)), rewrittenXml, 'FULL_SETUP_DETERMINISTIC_WRITE');
    const rewritten = await readMusicXmlSong(rewrittenXml);
    assert.deepEqual(meaning(rewritten), meaning(standalone), 'FULL_SETUP_ROUNDTRIP');
    assert.deepEqual(await compileMusicXmlSong(rewrittenXml), standalone.song, 'FULL_SETUP_COMPILER_ENTRYPOINT');
    assert(!digests.has(standalone.song.source.digest), 'INPUT_BINDING_SEMANTIC_IDENTITY'); digests.add(standalone.song.source.digest);
    const expected = [PF.INPUT_MAGIC, candidate.bindings.length, ...candidate.bindings.flatMap(binding => [
      PHYSICAL_SWITCH_IDS.indexOf(binding.controlId),
      binding.target.kind === 'cue-rows' ? PF.INPUT_CUES : binding.target.kind === 'tempo' ? PF.INPUT_TEMPO : PF.INPUT_PANIC,
      binding.target.kind === 'cue-rows' ? binding.target.rows.reduce((mask, row) => mask | 1 << CONTROL_IDS.indexOf(row), 0) : 0,
    ])];
    const bytes = compiledProgramBytes(standalone.song), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const emptyBytes = compiledProgramBytes({ ...standalone.song, inputBindings: [] });
    const begin = emptyBytes.length - 2 * Float64Array.BYTES_PER_ELEMENT;
    assert.equal(bytes.length, begin + expected.length * Float64Array.BYTES_PER_ELEMENT, 'NATIVE_BINDING_TABLE');
    assert.deepEqual(bytes.slice(0, begin), emptyBytes.slice(0, begin), 'NATIVE_BINDING_PREFIX_UNCHANGED');
    assert.deepEqual(expected.map((_, index) => view.getFloat64(begin + index * Float64Array.BYTES_PER_ELEMENT, true)), expected, 'NATIVE_BINDING_TABLE');
    assert.deepEqual(compiledProgramBytes(rewritten.song), bytes, 'FULL_SETUP_NATIVE_ROUNDTRIP');
  }
  assert.equal(ids.size, 2786, 'FULL_SETUP_BINDING_CARDINALITY');
  assert.deepEqual([...counts], [[3, 125], [4, 383], [5, 839], [6, 1439]], 'FULL_SETUP_LENGTH_CARDINALITY');
  return { grammar: fullSetupBindingGrammar, cases: ids.size, casesByLength: Object.fromEntries(counts), archiveFreeRoundtrips: ids.size,
    distinctDigests: digests.size, nativeBindingTables: ids.size };
}

async function witness(property: string): Promise<void> {
  const example = scoreCases().next().value;
  assert(example, 'NONEMPTY_GRAMMAR');
  const imported = await importSheetMusicXml(scoreInput(example));
  if (property === 'display') await displayAgreement(imported.xml);
  else if (property === 'voices') await voiceDigests(await readMusicXmlSong(imported.xml));
  else if (property === 'labels') await pickupTimelineWitness();
  else if (property === 'bindings' || property === 'binding-identity') await inputBindingWitness();
  else if (property === 'full-bindings') await fullSetupBindingWitness();
  else throw new Error('Unknown witness property');
}

async function verifyDomain() {
  const scoreIds = new Set<string>(), caseIds = new Set<string>();
  const actionDigests = new Map<string, Map<string, string>>();
  const fingerprint = createHash('sha256');
  let roundtrips = 0, displayRejections = 0, archiveChecks = 0, voiceIdentityChecks = 0, equivalentTempoChecks = 0;
  for (const example of scoreCases()) {
    assert(!scoreIds.has(example.id), 'DUPLICATE_SCORE_CASE'); scoreIds.add(example.id);
    try {
      const input = scoreInput(example);
      const imported = await importSheetMusicXml(input);
      const importedDocument = await readMusicXmlSong(imported.xml);
      scoreMeaning(importedDocument, example);
      const digests = await voiceDigests(importedDocument); voiceIdentityChecks++;
      const actionKey = JSON.stringify([example.meter, example.cells, example.text, example.liveVocals]);
      const paired = actionDigests.get(actionKey) ?? new Map<string, string>();
      assert(!paired.has(example.command), 'DUPLICATE_ACTION_CASE');
      paired.set(example.command, importedDocument.song.source.digest);
      actionDigests.set(actionKey, paired);
      for (const [voiceIndex, variant] of grammar.voices.entries()) {
        const voices = voiceCatalog(variant);
        const xml = await writeMusicXmlSong({ song: importedDocument.song, report: importedDocument.report,
          source: input.source, mapping: input.mapping, ...(voices === undefined ? {} : { voices }) });
        const expected = await readMusicXmlSong(xml);
        assert.equal(expected.song.source.digest, digests[voiceIndex], 'VOICE_DIGEST_DETERMINISTIC');
        for (const archive of grammar.archives) {
          const id = JSON.stringify([example.id, variant, archive]);
          assert(!caseIds.has(id), 'DUPLICATE_CANONICAL_CASE'); caseIds.add(id);
          const candidate = archives(xml, archive), parsed = await readMusicXmlSong(candidate);
          assert.deepEqual(meaning(parsed), meaning(expected), 'ARCHIVE_INDEPENDENT_MEANING'); archiveChecks++;
          assert.deepEqual(parsed.source, archive === 'source' || archive === 'both' ? input.source : null, 'SOURCE_ARCHIVE_PRESERVED');
          assert.deepEqual(parsed.mapping, archive === 'mapping' || archive === 'both' ? input.mapping : null, 'MAPPING_ARCHIVE_PRESERVED');
          const written = await writeMusicXmlSong(writeInput(parsed));
          assert.equal(await writeMusicXmlSong(writeInput(parsed)), written, 'DETERMINISTIC_WRITE');
          assert.deepEqual(meaning(await readMusicXmlSong(written)), meaning(parsed), 'ROUNDTRIP_MEANING'); roundtrips++;
          assert.deepEqual(await compileMusicXmlSong(candidate), parsed.song, 'COMPILER_ENTRYPOINT_MEANING');
          await displayAgreement(candidate); displayRejections++;
          if (example.meter.denominator === 8) {
            const equivalent = candidate.replace('<beat-unit>eighth</beat-unit><per-minute>98</per-minute>', '<beat-unit>quarter</beat-unit><per-minute>49</per-minute>');
            assert.notEqual(equivalent, candidate, 'TEMPO_MARK_PRESENT');
            assert.deepEqual(meaning(await readMusicXmlSong(equivalent)), meaning(parsed), 'SIX_EIGHT_COUNT_UNIT'); equivalentTempoChecks++;
          }
          fingerprint.update(id + '\n' + parsed.song.source.digest + '\n');
        }
      }
    } catch (cause) { throw new Error('BOUND_CASE_FAILURE ' + example.id, { cause }); }
  }
  const scoreCount = grammar.meters.length * grammar.barCounts.reduce((sum, bars) => sum + grammar.referenceCells.length ** bars, 0)
    * grammar.texts.length * grammar.liveVocals.length * grammar.commands.length;
  const canonicalCount = scoreCount * grammar.voices.length * grammar.archives.length;
  for (const paired of actionDigests.values()) {
    assert.equal(paired.size, grammar.commands.length, 'COMPLETE_ACTION_PAIRS');
    assert.equal(new Set(paired.values()).size, grammar.commands.length, 'ACTION_SEMANTIC_IDENTITY');
  }
  assert.equal(actionDigests.size * grammar.commands.length, scoreCount, 'EXHAUSTIVE_ACTION_CARDINALITY');
  assert.equal(scoreIds.size, scoreCount, 'EXHAUSTIVE_SCORE_CARDINALITY');
  assert.equal(caseIds.size, canonicalCount, 'EXHAUSTIVE_CANONICAL_CARDINALITY');
  assert.equal(roundtrips, canonicalCount); assert.equal(displayRejections, canonicalCount); assert.equal(archiveChecks, canonicalCount);
  await pickupTimelineWitness();
  const inputBindings = await inputBindingWitness();
  const fullSetupInputBindings = await fullSetupBindingWitness();
  return { status: 'PASS-bounded-exhaustive-musicxml', grammar, scoreCases: scoreCount, canonicalCases: canonicalCount, supplementalTimelineWitnesses: 1,
    roundtrips, displayRejections, archiveChecks, voiceIdentityChecks, actionIdentityChecks: actionDigests.size, equivalentTempoChecks, inputBindings, fullSetupInputBindings,
    caseFingerprint: fingerprint.digest('hex'), scope: 'Finite grammar through actual TypeScript implementation, not arbitrary XML or an unbounded proof.' };
}

if (process.argv[2] === '--witness') {
  const property = process.argv[3];
  const marker = property === 'display' ? 'DISPLAY_ACTION_AGREEMENT' : property === 'voices' ? 'VOICE_SEMANTIC_IDENTITY' : property === 'labels' ? 'MEASURE_LABEL_AGREEMENT' : property === 'bindings' ? 'INPUT_BINDING_MEANING' : property === 'binding-identity' ? 'INPUT_BINDING_SEMANTIC_IDENTITY' : property === 'full-bindings' ? 'NATIVE_BINDING_TABLE' : null;
  try {
    await witness(property);
    process.stdout.write(JSON.stringify({ status: 'PASS-witness', property }) + '\n');
  } catch (cause) {
    if (!(cause instanceof assert.AssertionError) || marker === null || !cause.message.includes(marker)) throw cause;
    process.stdout.write(JSON.stringify({ status: 'FAIL-witness-property', property, marker, assertionCode: cause.code }) + '\n');
    process.exitCode = 1;
  }
} else {
  assert.equal(process.argv.length, 2, 'Use no arguments or --witness display|voices|labels|bindings|binding-identity|full-bindings');
  process.stdout.write(JSON.stringify(await verifyDomain()) + '\n');
}
