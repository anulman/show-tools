import assert from 'node:assert/strict';
import { importSheetMusicXml } from '../../lib/performance/sheet-musicxml.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../../lib/performance/musicxml-song.js';
import { columnName } from '../../lib/performance/columns.js';
import type { MusicalAnnotations } from '../../lib/performance/musicxml-model.js';
import { scoreCases, scoreInput } from './domain.js';

export const boundaryGrammar = {
  meters: [{ numerator: 4, denominator: 4 }, { numerator: 6, denominator: 8 }],
  barCounts: [1, 2],
  texts: ['4&', '  <&> "🎵"\r\n  '],
  boundaries: ['neither', 'lead-in', 'tail', 'both'],
};
function withoutArchives(xml: string): string {
  return xml.replace(/<miscellaneous-field name="show-tools:(?:source|mapping)">[^]*?<\/miscellaneous-field>/g, '');
}
function firstScore() {
  const example = scoreCases().next().value;
  assert(example, 'NONEMPTY_GRAMMAR');
  return example;
}
export async function verifyBoundaries() {
  let cases = 0, archiveChecks = 0, placementRejections = 0;
  const ids = new Set<string>();
  for (const meter of boundaryGrammar.meters) for (const count of boundaryGrammar.barCounts)
    for (const text of boundaryGrammar.texts) for (const presence of boundaryGrammar.boundaries) {
      const id = JSON.stringify([meter, count, text, presence]);
      assert(!ids.has(id), 'DUPLICATE_BOUNDARY_CASE'); ids.add(id);
      const input = scoreInput({ ...firstScore(), meter, cells: Array<string>(count).fill('1') });
      const values = input.source.values.map(row => [...row]);
      values[4][1] = 'Lead-in'; values[4][count + 2] = 'Tail';
      const expected: NonNullable<MusicalAnnotations['boundaryCues']> = [];
      for (const row of [10, 14]) {
        if (presence === 'lead-in' || presence === 'both') {
          values[row - 1][1] = text;
          expected.push({ partId: `PA${row}`, cell: `B${row}`, position: 'lead-in', text });
        }
        if (presence === 'tail' || presence === 'both') {
          values[row - 1][count + 2] = text;
          expected.push({ partId: `PA${row}`, cell: `${columnName(count + 3)}${row}`, position: 'tail', text });
        }
      }
      const imported = await importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping });
      const document = await readMusicXmlSong(imported.xml);
      assert.deepEqual(document.report.annotations.boundaryCues, expected.length ? expected : undefined, 'BOUNDARY_CUE_MEANING');
      assert.equal(document.report.measureCount, count, 'BOUNDARY_NO_EXTRA_MEASURES');
      const standalone = await readMusicXmlSong(withoutArchives(imported.xml));
      assert.equal(standalone.source, null, 'BOUNDARY_ARCHIVES_ABSENT');
      assert.equal(standalone.mapping, null, 'BOUNDARY_ARCHIVES_ABSENT');
      assert.deepEqual(standalone.report, document.report, 'BOUNDARY_ARCHIVE_INDEPENDENCE');
      assert.deepEqual(standalone.song, document.song, 'BOUNDARY_ARCHIVE_INDEPENDENCE'); archiveChecks++;
      const rewritten = await readMusicXmlSong(await writeMusicXmlSong({ song: standalone.song, report: standalone.report }));
      assert.deepEqual(rewritten.report, standalone.report, 'BOUNDARY_ROUNDTRIP');
      assert.deepEqual(rewritten.song, standalone.song, 'BOUNDARY_ROUNDTRIP');
      const tail = expected.find(cue => cue.position === 'tail');
      if (tail) {
        const pattern = new RegExp(`<direction><direction-type><words id="boundary-tail-${tail.cell}">[^]*?</words></direction-type><offset>[^<]+</offset></direction>`);
        const shown = imported.xml.match(pattern)?.[0];
        assert(shown, 'BOUNDARY_DIRECTION_PRESENT');
        assert.match(shown, new RegExp(`<offset>${meter.numerator * 960 * 4 / meter.denominator}</offset>`), 'BOUNDARY_END_OFFSET');
        const changed = imported.xml.replace(shown, shown.replace(/<offset>[^<]+<\/offset>/, '<offset>0</offset>'));
        await assert.rejects(readMusicXmlSong(changed), /Misplaced canonical boundary/, 'BOUNDARY_PLACEMENT'); placementRejections++;
        const htmlEntity = imported.xml.replace(shown, shown.replace(/(<words[^>]*>)[^]*?(<\/words>)/, '$1&nbsp;$2'));
        await assert.rejects(readMusicXmlSong(htmlEntity), /XML entities|character references/, 'BOUNDARY_XML_ENTITIES');
        const wrongRow = imported.xml.replace(`boundary-tail-${tail.cell}`, 'boundary-tail-Z99');
        await assert.rejects(readMusicXmlSong(wrongRow), /boundary cue source/, 'BOUNDARY_SOURCE_PROVENANCE');
        const duplicate = imported.xml.replace(shown, shown + shown);
        await assert.rejects(readMusicXmlSong(duplicate), /Duplicate/, 'BOUNDARY_UNIQUENESS');
      }
      cases++;
    }
  assert.equal(cases, 32, 'BOUNDARY_DOMAIN_CARDINALITY');
  assert.equal(placementRejections, 16, 'BOUNDARY_NEGATIVE_CARDINALITY');
  return { grammar: boundaryGrammar, cases, archiveChecks, placementRejections };
}

export async function verifyHigherIntensity(identityOnly = false) {
  const input = scoreInput({ ...firstScore(), cells: ['!', '!!', '!!!'] });
  const values = input.source.values.map(row => [...row]);
  values[9][2] = '!!!';
  const imported = await importSheetMusicXml({ ...input, source: { ...input.source, values } });
  const document = await readMusicXmlSong(withoutArchives(imported.xml));
  if (!identityOnly) {
    assert.deepEqual(document.report.annotations.feels, [
      { partId: 'PA14', startBar: 1, endBar: 1, text: 'Funky' },
      { partId: 'PA14', startBar: 2, endBar: 2, text: 'Extra funky' },
      { partId: 'PA14', startBar: 3, endBar: 3, text: 'Higher intensity' },
    ], 'HIGHER_INTENSITY_MEANING');
    assert.equal(document.report.annotations.feels.some(feel => feel.partId === 'PA10'), false, 'AF_FEEL_ISOLATION');
    const rewritten = await readMusicXmlSong(await writeMusicXmlSong({ song: document.song, report: document.report }));
    assert.deepEqual(rewritten.report, document.report, 'HIGHER_INTENSITY_ROUNDTRIP');
  }
  const changed = imported.xml.replace('>Higher intensity</words>', '>Extra funky</words>');
  assert.notEqual(changed, imported.xml, 'FEEL_IDENTITY_EDIT_APPLIED');
  const edited = await readMusicXmlSong(withoutArchives(changed));
  assert.notEqual(edited.song.source.digest, document.song.source.digest, 'FEEL_SEMANTIC_IDENTITY');
  return { namedWitnesses: 1, feelLevels: 3, managedIsolation: !identityOnly, archiveFree: true };
}
