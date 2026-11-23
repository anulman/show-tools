import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { readBundledMusicXml } from '../songs/load-musicxml.js';
import { rehearsalMusicXml } from '../songs/rehearsal.js';
import { SET_SONGS } from '../songs/routes.js';
import { buildSongCatalog, readSongCatalog } from './build-song-catalog.js';

const { values } = parseArgs({ options: { base: { type: 'string' }, out: { type: 'string' } } });
if (!values.base || !values.out) throw new Error('Usage: build-rehearsal-catalog --base EXISTING_CATALOG --out NEW_CATALOG');
const base = resolve(values.base);
const { catalog } = await readSongCatalog(base);
const installed = new Map(catalog.entries.map(entry => [entry.id, entry]));
const workspace = await mkdtemp(join(tmpdir(), 'show-tools-rehearsal-'));
try {
  const songs = await Promise.all(SET_SONGS.map(async entry => {
    const existing = installed.get(entry.id);
    if (existing) {
      const path = join(base, existing.path);
      return { id: entry.id, musicXml: join(path, 'source.musicxml'), effects: join(path, 'effects.json') };
    }
    if (!entry.rehearsal) throw new Error(`Missing installed executable chart for ${entry.id}.`);
    const authored = await readMusicXmlSong(await readBundledMusicXml(entry.id));
    const musicXml = join(workspace, entry.id + '.musicxml');
    await writeFile(musicXml, await rehearsalMusicXml(authored));
    return { id: entry.id, musicXml };
  }));
  const result = await buildSongCatalog({ schemaVersion: 1, initialSongId: catalog.initialSongId, songs }, resolve(values.out));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
