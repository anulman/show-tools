import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { validateInstalledPackage } from './prepare.js';

const id = Schema.NonEmptyString.check(Schema.isMaxLength(256), Schema.isPattern(/^[^\x00-\x1f\x7f]+$/));
const path = Schema.NonEmptyString.check(Schema.isMaxLength(4096), Schema.isPattern(/^\/[^\x00]*$/));
export const SongCatalogOptionsSchema = Schema.Struct({
  entries: Schema.NonEmptyArray(Schema.Struct({ id, path })),
  initialSongId: id,
});
export type SongCatalogOptions = typeof SongCatalogOptionsSchema.Type;
export type InstalledSong = Readonly<{
  id: string;
  title: string;
  packageDigest: string;
  hashes: Readonly<{ manifestSha256: string; packetSha256: string; effectsSha256: string }>;
  paths: Readonly<{ manifest: string; packet: string; effects: string }>;
  installed: ReturnType<typeof validateInstalledPackage>;
}>;
export type InstalledSongCatalog = Readonly<{
  initialSongId: string;
  choices: ReadonlyArray<Pick<InstalledSong, 'id' | 'title' | 'packageDigest'>>;
  get(id: string): InstalledSong;
}>;

export class SongCatalogError extends Schema.TaggedError<SongCatalogError>()('SongCatalogError', {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export const loadInstalledSongCatalog = (input: unknown) => Effect.tryPromise({
  try: async (): Promise<InstalledSongCatalog> => {
    const options = Schema.decodeUnknownSync(SongCatalogOptionsSchema, { onExcessProperty: 'error' })(input);
    const ids = new Set<string>();
    for (const entry of options.entries) {
      if (ids.has(entry.id)) throw new Error(`Duplicate installed song ID: ${entry.id}`);
      ids.add(entry.id);
    }
    if (!ids.has(options.initialSongId)) throw new Error(`Initial song is not installed: ${options.initialSongId}`);
    const songs = new Map<string, InstalledSong>();
    for (const entry of options.entries) {
      const directory = await realpath(entry.path);
      const paths = Object.freeze({ manifest: join(directory, 'manifest.json'),
        packet: join(directory, 'song.pfp'), effects: join(directory, 'effects.json') });
      const [manifest, packet, effects] = await Promise.all([
        readFile(paths.manifest), readFile(paths.packet), readFile(paths.effects),
      ]);
      const installed = validateInstalledPackage(manifest, packet, JSON.parse(effects.toString('utf8')));
      if (installed.song.id !== entry.id) throw new Error(`Installed song ID mismatch: expected ${entry.id}, found ${installed.song.id}`);
      const hashes = Object.freeze({ manifestSha256: hash(manifest), packetSha256: hash(packet), effectsSha256: hash(effects) });
      const packageDigest = hash(Buffer.from(JSON.stringify({ format: 'show-tools-installed-song-v1', files: [
        ['manifest.json', hashes.manifestSha256], ['song.pfp', hashes.packetSha256], ['effects.json', hashes.effectsSha256],
      ] })));
      songs.set(entry.id, Object.freeze({ id: entry.id, title: installed.song.chart.title, packageDigest, hashes, paths, installed }));
    }
    return Object.freeze({
      initialSongId: options.initialSongId,
      choices: Object.freeze([...songs.values()].map(({ id, title, packageDigest }) => Object.freeze({ id, title, packageDigest }))),
      get(id: string) {
        const song = songs.get(id);
        if (!song) throw new Error(`Unknown installed song ID: ${id}`);
        return song;
      },
    });
  },
  catch: cause => new SongCatalogError({ message: cause instanceof Error ? cause.message : 'Installed song catalog could not be loaded', cause }),
});
