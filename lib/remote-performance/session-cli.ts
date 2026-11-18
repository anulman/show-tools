import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile, stat } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NodeServices } from '@effect/platform-node';
import { Console, Effect, Schema } from 'effect';
import { Command, Flag } from 'effect/cli';
import { decodeSessionProfile, migrateSessionProfileV1 } from './session-profile.js';
import { createSessionClient, DeskUnavailableError } from './session-client.js';
import { createSessionService, sessionConfigDirectory } from './session-service.js';
import { SongCatalogOptionsSchema } from './song-catalog.js';
import { SongBindingAuthority, verifySongBindingBackup, restoreSongBindingBackup } from './song-bindings.js';
import type { DeskView } from './session-schema.js';

class SessionCommandError extends Schema.TaggedError<SessionCommandError>()('SessionCommandError', { message: Schema.String }) {}
const profileFlag = Flag.String('profile').pipe(Flag.withDefault(join(sessionConfigDirectory(), 'show-tools', 'session.json')));
const enableFlag = Flag.Boolean('enable').pipe(Flag.withDefault(false), Flag.withDescription('Explicitly enable this service for future user-manager starts'));

async function context(path: string) {
  let profile;
  let profilePath;
  try {
    profilePath = await realpath(path);
    profile = decodeSessionProfile(JSON.parse(await readFile(profilePath, 'utf8')));
  } catch { throw new Error(`Cannot load a valid session profile at ${path}. Supply --profile with an installed host profile containing service, server, TLS, token, catalog, authoring database and native paths. No target is assumed.`); }
  return { profile, profilePath, service: createSessionService(profile, profilePath) };
}

function summary(view: DeskView) {
  return `Audio ${view.audio.kind}${view.audio.kind === 'ready' ? `; transport ${view.audio.performance.state.phase}` : view.audio.kind === 'fault' ? `; ${view.audio.error}` : ''}`;
}

const perform = (action: () => Promise<string>) => Effect.tryPromise({
  try: action,
  catch: error => new SessionCommandError({ message: error instanceof Error ? error.message : 'Session command failed.' }),
}).pipe(Effect.flatMap(Console.log));

const start = Command.make('start', { profile: profileFlag }, ({ profile }) => perform(async () => {
  const ctx = await context(profile);
  const client = await createSessionClient(ctx.profile);
  const state = await ctx.service.state();
  // A reachable but unowned desk must never authorize launching a second owner.
  if (state.get('ActiveState') !== 'active') {
    try { await client.status(); throw new Error('A desk already answers this profile while its named service is inactive. Resolve ownership before starting.'); }
    catch (error) {
      if (!(error instanceof DeskUnavailableError)) throw error;
    }
  }
  await ctx.service.start();
  const deadline = Date.now() + 30_000;
  let view: DeskView | undefined;
  do {
    try { view = await client.status(); break; }
    catch (error) { if (!(error instanceof DeskUnavailableError)) throw error; }
    await delay(100);
  } while (Date.now() < deadline);
  if (!view) throw new Error('The named service did not become authenticated and ready within 30 seconds. Check its user journal.');
  const linger = await ctx.service.linger();
  return `Server active (${ctx.profile.serviceName}). ${summary(view)}. Linger=${linger}.${linger === 'yes' ? '' : ' Persistence after the last logout is not provisioned or verified. A host administrator must configure user lingering once if required.'}`;
}));

const stop = Command.make('stop', { profile: profileFlag }, ({ profile }) => perform(async () => {
  const ctx = await context(profile);
  await ctx.service.stop();
  return `Server inactive; owned process group empty; native takes discarded (${ctx.profile.serviceName}).`;
}));

const status = Command.make('status', { profile: profileFlag }, ({ profile }) => perform(async () => {
  const ctx = await context(profile);
  const state = await ctx.service.state();
  const linger = await ctx.service.linger();
  if (state.get('ActiveState') !== 'active') return `Server ${state.get('ActiveState') ?? 'unknown'} (${ctx.profile.serviceName}); Linger=${linger}.`;
  const view = await (await createSessionClient(ctx.profile)).status();
  return `Server active (${ctx.profile.serviceName}). ${summary(view)}. Linger=${linger}.`;
}));

const install = Command.make('install', { profile: profileFlag, enable: enableFlag }, ({ profile, enable }) => perform(async () => {
  const ctx = await context(profile);
  const path = await ctx.service.install(enable);
  const linger = await ctx.service.linger();
  return `Installed ${path}.${enable ? ' Enabled for future user-manager starts.' : ' Autostart was not enabled.'} Linger=${linger}.${linger === 'yes' ? '' : ' Last-logout persistence requires separately provisioned user lingering.'} Run show-tools session start --profile ${ctx.profilePath}.`;
}));

const audioStatus = Command.make('status', { profile: profileFlag }, ({ profile }) => perform(async () => {
  const ctx = await context(profile);
  return summary(await (await createSessionClient(ctx.profile)).status());
}));
const audioOn = Command.make('on', { profile: profileFlag }, ({ profile }) => perform(async () => {
  const ctx = await context(profile);
  return summary(await (await createSessionClient(ctx.profile)).audio('on'));
}));
const audioOff = Command.make('off', { profile: profileFlag }, ({ profile }) => perform(async () => {
  const ctx = await context(profile);
  const client = await createSessionClient(ctx.profile);
  return `${summary(await client.audio('off'))}; native takes discarded.`;
}));
const audio = Command.make('audio').pipe(Command.withDescription('Enable stopped audio, terminate audio (discards takes), or inspect audio'), Command.withSubcommands([audioOn, audioOff, audioStatus]));
const inputFlag = Flag.String('input').pipe(Flag.withDescription('Existing input file'));
const outputFlag = Flag.String('output').pipe(Flag.withDescription('New output file; existing files are never replaced'));
const songFlag = Flag.String('song').pipe(Flag.withDescription('Exact installed song ID from songs list'));
const listSongs = Command.make('list', { profile: profileFlag }, ({ profile }) => perform(async () => {
  const ctx = await context(profile);
  return (await (await createSessionClient(ctx.profile)).songs()).map(song => `${song.id}\t${song.title}`).join('\n');
}));
const selectSong = Command.make('select', { profile: profileFlag, song: songFlag }, ({ profile, song }) => perform(async () => {
  const ctx = await context(profile);
  const view = await (await createSessionClient(ctx.profile)).selectSong(song);
  return `Selected ${view.song.id}. ${summary(view)}.`;
}));
const bindSong = Command.make('bind', { profile: profileFlag, song: songFlag, bindings: Flag.String('bindings') }, ({ profile, song, bindings }) => perform(async () => {
  const ctx = await context(profile);
  const view = await (await createSessionClient(ctx.profile)).configureSongBindings(song, JSON.parse(await readFile(bindings, 'utf8')));
  return `Saved button bindings for ${view.song.id}. ${summary(view)}.`;
}));
const songs = Command.make('songs').pipe(Command.withDescription('List installed songs, select while stopped, or assign bindings with audio off'), Command.withSubcommands([listSongs, selectSong, bindSong]));
const bindingScope = 'Only per-song button bindings and chart source hashes; excludes charts, effects and recordings.';
const backupBindings = Command.make('backup', { profile: profileFlag, output: outputFlag }, ({ profile, output }) => perform(async () => {
  const ctx = await context(profile);
  await verifySongBindingBackup(ctx.profile.authoringDatabase);
  const authority = SongBindingAuthority.open(ctx.profile.authoringDatabase);
  try { const backup = authority.backup(resolve(output)); return `Backed up ${backup.records.length} binding records to ${backup.filename}. ${bindingScope}`; }
  finally { authority.close(); }
}));
const verifyBindings = Command.make('verify', { input: inputFlag }, ({ input }) => perform(async () => {
  const records = verifySongBindingBackup(resolve(input));
  return `Verified ${records.length} binding records. ${bindingScope}`;
}));
const restoreBindings = Command.make('restore', { input: inputFlag, output: outputFlag }, ({ input, output }) => perform(async () => {
  const records = restoreSongBindingBackup(resolve(input), resolve(output));
  return `Restored ${records.length} binding records to new file ${resolve(output)}. ${bindingScope} No running profile was changed.`;
}));
const bindings = Command.make('bindings').pipe(Command.withDescription(bindingScope), Command.withSubcommands([backupBindings, verifyBindings, restoreBindings]));
const releaseCatalogSchema = Schema.Struct({ schemaVersion: Schema.Literal(1), initialSongId: Schema.NonEmptyString,
  entries: Schema.NonEmptyArray(Schema.Struct({ id: Schema.NonEmptyString, path: Schema.NonEmptyString,
    title: Schema.NonEmptyString, packageDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    files: Schema.Struct({ 'manifest.json': Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)), 'song.pfp': Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)), 'effects.json': Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)), 'source.musicxml': Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) }) })) });
const migrateProfile = Command.make('migrate', { input: inputFlag, output: outputFlag, catalog: Flag.String('catalog'), release: Flag.String('release'),
  authoringDatabase: Flag.String('authoring-database'), restartPolicy: Flag.String('restart-policy') }, ({ input, output, catalog, release, authoringDatabase, restartPolicy }) => perform(async () => {
  if (resolve(input) === resolve(output)) throw new Error('Migration requires a new output file.');
  if (restartPolicy !== 'no' && restartPolicy !== 'on-failure') throw new Error('Restart policy must be no or on-failure; choose the actual host policy explicitly.');
  const releaseRoot = await realpath(release), catalogPath = await realpath(catalog);
  if (relative(releaseRoot, catalogPath).startsWith('..') || isAbsolute(relative(releaseRoot, catalogPath))) throw new Error('Catalog must be inside the explicit release directory.');
  const metadata = Schema.decodeUnknownSync(releaseCatalogSchema, { onExcessProperty: 'error' })(JSON.parse(await readFile(catalogPath, 'utf8')));
  const entries = await Promise.all(metadata.entries.map(async entry => {
    if (isAbsolute(entry.path) || entry.path.split('/').some(part => part === '..' || part === '.')) throw new Error('Catalog song paths must be bounded relative paths.');
    const path = await realpath(resolve(dirname(catalogPath), entry.path));
    if (relative(releaseRoot, path).startsWith('..') || isAbsolute(relative(releaseRoot, path))) throw new Error('Catalog song path escapes the release.');
    for (const [name, expected] of Object.entries(entry.files)) {
      const file = await realpath(join(path, name));
      if (dirname(file) !== path || createHash('sha256').update(await readFile(file)).digest('hex') !== expected) throw new Error(`Catalog file hash mismatch for ${entry.id}/${name}.`);
    }
    return { id: entry.id, path };
  }));
  const options = Schema.decodeUnknownSync(SongCatalogOptionsSchema, { onExcessProperty: 'error' })({ initialSongId: metadata.initialSongId, entries });
  const releasePaths = { nodeExecutable: join(releaseRoot, 'runtime/node'), entrypoint: join(releaseRoot, 'gateway/server.mjs'), native: join(releaseRoot, 'native/native_alsa_host'), staticRoot: join(releaseRoot, 'static') };
  for (const path of [releasePaths.nodeExecutable, releasePaths.entrypoint, releasePaths.native]) if (!(await stat(path)).isFile()) throw new Error('Release executable or gateway file is missing.');
  if (!(await stat(releasePaths.staticRoot)).isDirectory()) throw new Error('Release static directory is missing.');
  const releaseManifest: unknown = JSON.parse(await readFile(join(releaseRoot, 'release.json'), 'utf8'));
  Schema.decodeUnknownSync(Schema.Struct({ schemaVersion: Schema.Literal(2) }))(releaseManifest);
  if (new Set(options.entries.map(entry => entry.id)).size !== options.entries.length || !options.entries.some(entry => entry.id === options.initialSongId))
    throw new Error('Catalog IDs must be unique and include the initial song.');
  const migrated = migrateSessionProfileV1(JSON.parse(await readFile(input, 'utf8')), { catalog: options, authoringDatabase, restartPolicy });
  const installed = decodeSessionProfile({ ...migrated, server: { nodeExecutable: releasePaths.nodeExecutable, entrypoint: releasePaths.entrypoint }, native: { ...migrated.native, executable: releasePaths.native }, staticRoot: releasePaths.staticRoot });
  await writeFile(resolve(output), JSON.stringify(installed, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return `Created V2 profile ${resolve(output)}. Applied explicit release executable/static paths; preserved service, network, TLS, token, driver and audio settings. No services or audio were changed.`;
}));
const profile = Command.make('profile').pipe(Command.withSubcommands([migrateProfile]));
const session = Command.make('session').pipe(Command.withDescription('Manage the installed persistent web desk and its optional native audio'), Command.withSubcommands([install, start, stop, status, audio, songs, bindings, profile]));

export async function runSessionCli(args: readonly string[]) {
  await Effect.runPromise(Command.runWith(session, { version: '1' })([...args]).pipe(
    Effect.catchTag('SessionCommandError', error => Console.error(error.message).pipe(Effect.tap(() => Effect.sync(() => { process.exitCode = 1; })))),
    Effect.provide(NodeServices.layer),
  ));
}
