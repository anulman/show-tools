import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NodeServices } from '@effect/platform-node';
import { Console, Effect, Schema } from 'effect';
import { Command, Flag } from 'effect/cli';
import { decodeSessionProfile } from './session-profile.js';
import { createSessionClient, DeskUnavailableError } from './session-client.js';
import { createSessionService } from './session-service.js';
import type { DeskView } from './session-schema.js';

class SessionCommandError extends Schema.TaggedError<SessionCommandError>()('SessionCommandError', { message: Schema.String }) {}
const profileFlag = Flag.String('profile').pipe(Flag.withDefault(join(homedir(), '.config', 'show-tools', 'session.json')));
const enableFlag = Flag.Boolean('enable').pipe(Flag.withDefault(false), Flag.withDescription('Explicitly enable this service for future user-manager starts'));

async function context(path: string) {
  let profile;
  let profilePath;
  try {
    profilePath = await realpath(path);
    profile = decodeSessionProfile(JSON.parse(await readFile(profilePath, 'utf8')));
  } catch { throw new Error(`Cannot load a valid session profile at ${path}. Supply --profile with an installed host profile containing service, server, TLS, token, package and native paths. No target is assumed.`); }
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
const session = Command.make('session').pipe(Command.withDescription('Manage the installed persistent web desk and its optional native audio'), Command.withSubcommands([install, start, stop, status, audio]));

export async function runSessionCli(args: readonly string[]) {
  await Effect.runPromise(Command.runWith(session, { version: '1' })([...args]).pipe(
    Effect.catchTag('SessionCommandError', error => Console.error(error.message).pipe(Effect.tap(() => Effect.sync(() => { process.exitCode = 1; })))),
    Effect.provide(NodeServices.layer),
  ));
}
