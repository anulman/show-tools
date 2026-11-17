import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalSongJson, type CompiledSong } from '../lib/performance/compiled-song.js';
import { encodeCompiledProgram } from '../lib/performance/compiled-native.js';
import { readMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { createMusicianSheets } from '../lib/performance/musician-sheets.js';
import { PF } from '../lib/performance/wasm-abi.js';

const baseline = {
  commit: '4eb0569',
  song: '9b8b75d0e5248941e586edb4602b6aad72c9164cd3c06e1be253bc7a9cd04b39',
  native: '237b834c47ede65e4488e25c268a7202c4da1845388ff5cfa63fa9e94e51c7a8',
  sheetTemplate: 'show-tools-musician-sheet-projection-v5',
  sheets: [
    {
      "name": "Bass",
      "labelCell": "A14",
      "pages": [
        "52ff530fb70407b2358c09e998a35e8d5c58153cfe21399660fe88b45071cc64",
        "36a0d717b08dbc8d76bb1d50ff161d81cf0129372e85d3998fad1ca9c15efb35",
        "aa1cefd719efbdbc6b025e7b4a9ed1351eeb1ff205579e482a3461ee32080adf",
        "7616d86e8c2c9e6c1a707133d7741d79c52ca5898c728d7a38ff2faa428560fd"
      ]
    },
    {
      "name": "Drums",
      "labelCell": "A15",
      "pages": [
        "d752f3bc5e18d96e9d1a47bcec821c465419b3c14c397e66afc8e87a67c619b7",
        "f5f091804c4dcc22f7024268ac0fef6badedccd73c24504cc364b675f7c1b08e",
        "3af18fbffbc2c174acb4a4c7573834bf6dc823549b48ed9bb4f773dc1ec59e44",
        "fee65af06ebebd4d604bba7a5cefc714454cd265bd371bd730cd446032604039",
        "80f47320ecde2d67fd804ad91693f08c4cf15daf82b2187fbce6e61bf06962e8"
      ]
    }
  ],
};

function digest(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function compiledMeaningDigest(song: CompiledSong): string {
  const { mappingDigest: _mappingDigest, source, ...meaning } = song;
  assert(!song.externalSamples?.length, 'The frozen legacy song cannot acquire external sample bindings.');
  const cues = song.cues.map(({ captureReplacement, launchPolicy, playbackMode, sourceName, groupId, ...cue }) => {
    assert.equal(captureReplacement, false, 'Legacy capture replacement must stay disabled.');
    assert.equal(launchPolicy, 'autoplay', 'Legacy commits must retain autoplay.');
    assert.equal(playbackMode, 'loop', 'Legacy playback must remain looping.');
    assert.equal(sourceName, null, 'Legacy cues must not acquire named sources.');
    assert.equal(groupId, null, 'Legacy cues must not acquire grouped presses.');
    return cue;
  });
  const takes = song.takes.map(({ sourceVoiceId, sourceName, ...take }) => {
    assert(sourceVoiceId === undefined || sourceVoiceId === take.voiceId, 'Legacy source effects must retain their voice.');
    assert(sourceName === undefined || sourceName === null, 'Legacy takes must not acquire named sources.');
    return take;
  });
  const rotation = meaning.rotation ? (() => {
    const { inactivityBeats, ...fields } = meaning.rotation;
    return { ...fields, releaseGridBeats: inactivityBeats };
  })() : null;
  return digest(canonicalSongJson({ ...meaning, cues, takes, schemaVersion: 5, rotation, source: { ...source, digest: '' } }));
}

export async function frozenCutoverMusicXml(): Promise<string> {
  const { importSheetMusicXml } = await import('../lib/performance/sheet-musicxml.js');
  const source: unknown = JSON.parse(await readFile(new URL('../songs/dance-yrself-clean.source.json', import.meta.url), 'utf8'));
  const mapping: unknown = JSON.parse(await readFile(new URL('../songs/dance-yrself-clean.cutover.mapping.json', import.meta.url), 'utf8'));
  return (await importSheetMusicXml({ source, mapping })).xml;
}

export async function verifyMusicXmlCutover(musicxml: string) {
  const { song } = await readMusicXmlSong(musicxml);
  assert.equal(compiledMeaningDigest(song), baseline.song, `Compiled song differs from pre-cutover ${baseline.commit}. Only source and mapping digests may change.`);
  assert.equal(song.schemaVersion, 7, 'The current compiled schema must be explicit.');
  const program = encodeCompiledProgram(song);
  assert.equal(program[1], 6, 'The inactivity packet must use native version 6.');
  program[1] = 5;
  let cursor = PF.COMPILED_HEADER_FIELDS + program[8] * PF.COMPILED_TAKE_FIELDS + program[9] * PF.COMPILED_LEGACY_CUE_FIELDS
    + program[10] * PF.COMPILED_MEMBER_FIELDS + program[11] * PF.COMPILED_PLAYBACK_FIELDS;
  const historical = Array.from(program.slice(0, cursor));
  while (cursor < program.length) {
    const magic = program[cursor], count = program[cursor + 1];
    if (magic === PF.COMPILED_ROTATION_MAGIC) {
      const end = cursor + PF.COMPILED_ROTATION_HEADER_FIELDS + count * PF.COMPILED_ROTATION_FIELDS;
      historical.push(...program.slice(cursor, end)); cursor = end;
    } else {
      assert.equal(magic, PF.COMPILED_WINDOW_MAGIC);
      historical.push(magic, count);
      for (let row = 0; row < count; row++) {
        const offset = cursor + PF.COMPILED_WINDOW_HEADER_FIELDS + row * PF.COMPILED_WINDOW_FIELDS;
        const selection = song.selections[program[offset]];
        assert.equal(selection.window.kind, 'prefix', 'The frozen fixture cannot acquire a slice.');
        assert.equal(program[offset + 1], 0, 'Historical prefixes must begin at source zero.');
        historical.push(program[offset], program[offset + 2]);
      }
      cursor += PF.COMPILED_WINDOW_HEADER_FIELDS + count * PF.COMPILED_WINDOW_FIELDS;
    }
  }
  const bytes = new Uint8Array(historical.length * 8);
  const view = new DataView(bytes.buffer);
  historical.forEach((value, index) => view.setFloat64(index * 8, value, true));
  assert.equal(digest(bytes), baseline.native, 'Native instructions beyond the explicit v6 jiggle migration changed.');
  const sheets = await createMusicianSheets({ musicxml });
  const actualSheets = sheets.map(sheet => ({ name: sheet.name, labelCell: sheet.labelCell, pages: sheet.pages.map(digest) }));
  assert.deepEqual(actualSheets, baseline.sheets, `Musician-sheet pages differ from the reviewed ${baseline.sheetTemplate} template.`);
  return { baselineCommit: baseline.commit, bars: song.chart.bars.length, cues: song.cues.length,
    takes: song.takes.length, nativeSha256: baseline.native,
    sheets: actualSheets.map(sheet => ({ name: sheet.name, pages: sheet.pages.length })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Usage: node --import tsx scripts/verify-musicxml-cutover.ts [SONG.musicxml]');
  const xml = args[0] ? await readFile(args[0], 'utf8') : await frozenCutoverMusicXml();
  const result = await verifyMusicXmlCutover(xml);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
