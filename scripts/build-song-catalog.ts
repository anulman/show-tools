import { Schema } from 'effect';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { compiledProgramBytes } from '../lib/performance/compiled-native.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { encodeInitialProfiles } from '../lib/remote-performance/commands.js';
import { validateInstalledPackage } from '../lib/remote-performance/prepare.js';

const id = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));
const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const specSchema = Schema.Struct({ schemaVersion: Schema.Literal(1), initialSongId: id,
  songs: Schema.NonEmptyArray(Schema.Struct({ id, musicXml: Schema.NonEmptyString, effects: Schema.NonEmptyString })) });
export const catalogSchema = Schema.Struct({ schemaVersion: Schema.Literal(1), initialSongId: id,
  entries: Schema.NonEmptyArray(Schema.Struct({ id, path: Schema.NonEmptyString, title: Schema.String,
    packageDigest: digest, files: Schema.Struct({ 'manifest.json': digest, 'song.pfp': digest, 'effects.json': digest, 'source.musicxml': digest }) })) });
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const decode = <A>(schema: Schema.ConstraintDecoder<A, never>, value: unknown): A => Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value);
export const packageDigest = (files: { 'manifest.json': string; 'song.pfp': string; 'effects.json': string }) =>
  hash(Buffer.from(JSON.stringify({ format: 'show-tools-installed-song-v1', files: [
    ['manifest.json', files['manifest.json']], ['song.pfp', files['song.pfp']], ['effects.json', files['effects.json']],
  ] })));

export async function readSongCatalog(directory: string) {
  for (const path of [directory, join(directory, 'songs')]) if (!(await lstat(path)).isDirectory()) throw new Error('Catalog directories must not be links');
  if (!(await lstat(join(directory, 'catalog.json'))).isFile()) throw new Error('Catalog manifest must not be a link');
  const bytes = await readFile(join(directory, 'catalog.json'));
  const catalog = decode(catalogSchema, JSON.parse(bytes.toString('utf8')));
  const ids = new Set<string>();
  const files = new Map<string, Buffer>([['catalog.json', bytes]]);
  for (const entry of catalog.entries) {
    if (ids.has(entry.id) || entry.path !== `songs/${entry.id}`) throw new Error('Duplicate song ID or unsafe catalog path');
    ids.add(entry.id);
    if (!(await lstat(join(directory, entry.path))).isDirectory()) throw new Error('Catalog song directory must not be a link');
    const captured = new Map<string, Buffer>();
    for (const [name, expected] of Object.entries(entry.files)) {
      const path = join(directory, entry.path, name);
      if (!(await lstat(path)).isFile()) throw new Error(`Catalog member is not a regular file: ${path}`);
      const data = await readFile(path);
      if (hash(data) !== expected) throw new Error(`Catalog digest mismatch: ${entry.id}/${name}`);
      captured.set(name, data);
      files.set(`${entry.path}/${name}`, data);
    }
    const get = (name: string) => { const data = captured.get(name); if (!data) throw new Error('Missing catalog member'); return data; };
    const installed = validateInstalledPackage(get('manifest.json'), get('song.pfp'), JSON.parse(get('effects.json').toString('utf8')));
    const source = await readMusicXmlSong(get('source.musicxml').toString('utf8'));
    if (installed.song.id !== entry.id || source.song.id !== entry.id || installed.song.chart.title !== entry.title
      || JSON.stringify(source.song) !== JSON.stringify(installed.song.compiled) || entry.packageDigest !== packageDigest(entry.files)) throw new Error('Catalog source/package identity mismatch');
  }
  if (!ids.has(catalog.initialSongId)) throw new Error('Initial song is absent from catalog');
  return { catalog, files };
}

export async function buildSongCatalog(input: unknown, output: string, base = process.cwd()) {
  const spec = decode(specSchema, input);
  const ids = new Set<string>();
  const entries: Array<typeof catalogSchema.Type.entries[number]> = [];
  const packages = new Map<string, Buffer>();
  for (const song of spec.songs) {
    if (ids.has(song.id)) throw new Error(`Duplicate song ID: ${song.id}`);
    ids.add(song.id);
    const [source, effects] = await Promise.all([readFile(resolve(base, song.musicXml)), readFile(resolve(base, song.effects))]);
    const document = await readMusicXmlSong(source.toString('utf8'));
    const reread = await readMusicXmlSong(await writeMusicXmlSong({ song: document.song, report: document.report, ...(document.source ? { source: document.source } : {}), ...(document.mapping ? { mapping: document.mapping } : {}), ...(document.voices ? { voices: document.voices } : {}) }));
    if (document.song.id !== song.id || JSON.stringify(document.song) !== JSON.stringify(reread.song)) throw new Error('MusicXML canonical roundtrip identity mismatch');
    const compiled = reread.song;
    const packet = Buffer.from(compiledProgramBytes(compiled));
    const manifest = json({ id: song.id, description: 'Compiled from canonical MusicXML.', compiled,
      practice: { startBar: 1, endBar: compiled.chart.bars.length }, takeCount: compiled.takes.length,
      packetSha256: hash(packet), profilesSha256: hash(encodeInitialProfiles(JSON.parse(effects.toString('utf8')))) });
    validateInstalledPackage(manifest, packet, JSON.parse(effects.toString('utf8')));
    const data = { 'manifest.json': manifest, 'song.pfp': packet, 'effects.json': effects, 'source.musicxml': source };
    const files = { 'manifest.json': hash(manifest), 'song.pfp': hash(packet), 'effects.json': hash(effects), 'source.musicxml': hash(source) };
    const path = `songs/${song.id}`;
    entries.push({ id: song.id, path, title: compiled.chart.title, packageDigest: packageDigest(files), files });
    for (const [name, bytes] of Object.entries(data)) packages.set(`${path}/${name}`, bytes);
  }
  if (!ids.has(spec.initialSongId)) throw new Error('Initial song is absent from catalog');
  const catalog = { schemaVersion: 1 as const, initialSongId: spec.initialSongId, entries };
  packages.set('catalog.json', json(catalog));
  const temporary = `${resolve(output)}.building-${process.pid}`;
  await mkdir(temporary);
  try {
    for (const [path, bytes] of packages) { await mkdir(dirname(join(temporary, path)), { recursive: true }); await writeFile(join(temporary, path), bytes); }
    await readSongCatalog(temporary);
    try { await lstat(output); throw new Error('Catalog output already exists'); } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
    await rename(temporary, output);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = decode(Schema.Struct({ spec: Schema.NonEmptyString, out: Schema.NonEmptyString }),
    parseArgs({ options: { spec: { type: 'string' }, out: { type: 'string' } } }).values);
  const specPath = resolve(options.spec);
  process.stdout.write(JSON.stringify(await buildSongCatalog(JSON.parse(await readFile(specPath, 'utf8')), resolve(options.out), dirname(specPath))) + '\n');
}
