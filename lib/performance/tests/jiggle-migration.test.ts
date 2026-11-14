import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { migrateMusicXmlSongV2, readMusicXmlSong, writeMusicXmlSong } from '../musicxml-song.js';
import type { CatalogDocument } from '../../voice-catalog/model.js';
import { frozenCutoverMusicXml } from '../../../scripts/verify-musicxml-cutover.js';
import { Schema } from 'effect';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { LegacyCueSchema } from '../compiled-song.js';

async function fixture() {
  return readMusicXmlSong(await frozenCutoverMusicXml());
}

function oldProfile(xml: string): string {
  const nodes = new XMLParser({ preserveOrder: true, ignoreAttributes: false }).parse(xml);
  const records = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)));
  const text = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ '#text': Schema.String })));
  const attributes = Schema.decodeUnknownSync(Schema.Struct({ '@_name': Schema.String }));
  const metadata = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));
  const rewrite = (input: unknown): ReturnType<typeof records> => records(input).map(node => {
    if ('miscellaneous-field' in node && attributes(node[':@'])['@_name'] === 'show-tools:performance') {
      const performance = metadata(JSON.parse(text(node['miscellaneous-field'])[0]['#text']));
      const cues = Schema.decodeUnknownSync(Schema.Array(LegacyCueSchema))(performance.cues);
      return { ...node, 'miscellaneous-field': [{ '#text': JSON.stringify({ ...performance, version: 1, cues }) }] };
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, Array.isArray(value) ? rewrite(value) : value]));
  });
  return new XMLBuilder({ preserveOrder: true, ignoreAttributes: false }).build(rewrite(nodes))
    .replaceAll('show-tools-song-v3', 'show-tools-song-v2')
    .replaceAll('&quot;inactivityBeats&quot;', '&quot;releaseGridBeats&quot;')
    .replaceAll('&quot;mappingVersion&quot;:6', '&quot;mappingVersion&quot;:5');
}

test('explicit v2 migration preserves chart, archives, annotations and portable voice metadata', async () => {
  const original = await fixture();
  const voices: CatalogDocument = { version: 2, revision: 4, voices: [{ id: 'voice', name: 'Voice', notes: 'preserve me',
    characterId: null, avatarToken: 'neutral', effects: [{ kind: 'slapback', delayMs: 100.4, feedback: .2, wet: .3 }] }], bindings: [] };
  const current = await writeMusicXmlSong({ song: original.song, report: original.report,
    source: original.source ?? undefined, mapping: original.mapping ?? undefined, voices });
  const legacy = oldProfile(current);
  await assert.rejects(readMusicXmlSong(legacy), /complete canonical/);
  const migrated = await migrateMusicXmlSongV2(legacy);
  assert.equal(migrated, current);
  const result = await readMusicXmlSong(migrated);
  assert.deepEqual(result.voices, voices);
  assert.deepEqual(result.report, (await readMusicXmlSong(current)).report);
  assert.deepEqual(result.source, original.source);
  assert.deepEqual(result.mapping, original.mapping);
  assert.equal(result.song.schemaVersion, 7);
  assert.equal(result.song.rotation?.inactivityBeats, .25);
  assert.equal(await migrateMusicXmlSongV2(migrated), migrated);
});

test('migration refuses unknown legacy fields, unsupported profiles and invalid intervals', async () => {
  const original = await fixture();
  const legacy = oldProfile(await writeMusicXmlSong({ song: original.song, report: original.report }));
  await assert.rejects(migrateMusicXmlSongV2(legacy.replace('&quot;releaseGridBeats&quot;:0.25', '&quot;releaseGridBeats&quot;:0')));
  await assert.rejects(migrateMusicXmlSongV2(legacy.replace('&quot;releaseGridBeats&quot;:0.25', '&quot;unexpected&quot;:1,&quot;releaseGridBeats&quot;:0.25')), /unexpected/);
  await assert.rejects(migrateMusicXmlSongV2(legacy.replaceAll('show-tools-song-v2', 'show-tools-song-v0')), /Migration requires/);
  await assert.rejects(migrateMusicXmlSongV2('<!DOCTYPE x>' + legacy), /DTD/);
  await assert.rejects(migrateMusicXmlSongV2(legacy.replace('</identification>', '')), /MusicXML/);
});

test('v2 migration rejects slice and source-bar instructions introduced after that profile', async () => {
  const current = await readFile(new URL('../../../songs/dance-yrself-clean.musicxml', import.meta.url), 'utf8');
  await assert.rejects(migrateMusicXmlSongV2(oldProfile(current)));
  const legacy = oldProfile(await frozenCutoverMusicXml());
  const withSourceBar = legacy.replace('&quot;sourceArmCell&quot;', '&quot;sourceBar&quot;:82,&quot;sourceArmCell&quot;');
  assert.notEqual(withSourceBar, legacy);
  await assert.rejects(migrateMusicXmlSongV2(withSourceBar), /sourceBar/);
});

test('legacy metadata migration follows XML nodes across equivalent attribute formatting', async () => {
  const current = await frozenCutoverMusicXml();
  const legacy = oldProfile(current);
  const expected = await migrateMusicXmlSongV2(legacy);
  for (const formatted of [
    legacy.replaceAll('name="show-tools:profile"', "name='show-tools:profile'"),
    legacy.replace(/<miscellaneous-field name="([^"]+)">/g, (_element, name: string) => `<miscellaneous-field\n name = '${name}' >`),
    legacy.replaceAll('</miscellaneous-field>', '</miscellaneous-field >'),
  ]) {
    assert.notEqual(formatted, legacy);
    assert.equal(await migrateMusicXmlSongV2(formatted), expected);
  }
});
