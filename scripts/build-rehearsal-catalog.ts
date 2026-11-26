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
const { catalog, files } = await readSongCatalog(base);
const installed = new Map(catalog.entries.map(entry => [entry.id, entry]));
const workspace = await mkdtemp(join(tmpdir(), 'show-tools-rehearsal-'));
try {
  const songs = await Promise.all(SET_SONGS.map(async entry => {
    const existing = installed.get(entry.id);
    const promoted = entry.id === 'all-i-want';
    if (existing) {
      const path = join(base, existing.path);
      const source = files.get(`${existing.path}/source.musicxml`);
      if (!source) throw new Error(`Missing validated catalog source for ${entry.id}.`);
      const timingOnly = promoted && await readMusicXmlSong(source.toString('utf8')).then(({ song }) => (
        song.voices.length === 0 && song.cues.length === 0 && song.takes.length === 0
        && song.parts.every(part => part.role.kind === 'default-live')
      ));
      if (!timingOnly) return { id: entry.id, musicXml: join(path, 'source.musicxml'), effects: join(path, 'effects.json') };
    }
    if (!entry.rehearsal && !promoted) throw new Error(`Missing installed executable chart for ${entry.id}.`);
    const xml = await readBundledMusicXml(entry.id);
    const musicXml = join(workspace, entry.id + '.musicxml');
    await writeFile(musicXml, entry.rehearsal ? await rehearsalMusicXml(await readMusicXmlSong(xml)) : xml);
    return { id: entry.id, musicXml };
  }));
  const result = await buildSongCatalog({ schemaVersion: 1, initialSongId: catalog.initialSongId, songs }, resolve(values.out));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
