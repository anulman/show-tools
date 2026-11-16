import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Effect, Layer, Schema, Sink, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { NativeStateSchema } from '../../lib/remote-performance/native-schema.js';
import { TunerStateSchema } from '../../lib/tuner/schema.js';
import { lightFixture } from '../../lib/remote-performance/tests/light-fixture.js';
import { installedPackage, sessionProfile } from '../../lib/remote-performance/tests/session-fixture.js';
import type { Observation } from '../../lib/remote-performance/gateway.js';
import { DeskRevisionSchema, type NativeOutcome } from '../../lib/remote-performance/session-schema.js';
import { SongBindingAuthority } from '../../lib/remote-performance/song-bindings.js';
import type { InstalledSong, InstalledSongCatalog } from '../../lib/remote-performance/song-catalog.js';

export type Mutation = 'none' | 'cancel' | 'cleanup' | 'command' | 'observe' | 'ownership' | 'identity';
const replacements = {
  identity: ["            this.update({ kind: 'ready', attempt: attempt.id, performance: next });", "            this.update({ kind: 'ready', attempt: Schema.decodeUnknownSync(AttemptSchema)('wrong-attempt'), performance: next });"],
  ownership: ["    if (attempt.child.kind === 'pending') {", "    if (false && attempt.child.kind === 'pending') {"],
  cancel: ["    attempt.abort.abort();", "    void attempt.abort;"],
  cleanup: ["      if (running) {", "      if (false && running) {"],
  command: ["      if (this.attempt !== attempt || this.view.audio.kind !== 'ready' || attempt.abort.signal.aborted) return { outcome: 'unknown' };", "      void attempt;"],
  observe: ["    if (this.attempt !== attempt || this.view.audio.kind !== 'ready' || attempt.abort.signal.aborted) return;", "    void attempt;"],
} satisfies Record<Exclude<Mutation, 'none'>, [string, string]>;
export function mutateController(source: string, mutation: Mutation): string {
  if (mutation === 'none') return source;
  const [before, after] = replacements[mutation];
  assert.equal(source.split(before).length, 2, `Source drift: ${mutation} mutation anchor must occur once`);
  return source.replace(before, after);
}
export type ConfigurationMutation = 'none' | 'enable-during-config' | 'config-during-audio' | 'config-during-fault' | 'config-after-close' | 'overlapping-config' | 'commit-after-close' | 'close-without-wait' | 'stale-revision';
const configurationReplacements = {
  'enable-during-config': ["      if (this.configuration.kind !== 'idle') return { outcome: 'rejected', error: 'Wait for song configuration to finish before enabling audio', view: this.view };", '      void this.configuration;'],
  'config-during-audio': ["this.closing || this.attempt || this.view.audio.kind !== 'off' || this.configuration.kind !== 'idle'", "this.closing || this.configuration.kind !== 'idle'"],
  'config-during-fault': ["this.view.audio.kind !== 'off' || ", ''],
  'config-after-close': ["if (this.closing || this.attempt ||", "if (this.attempt ||"],
  'overlapping-config': [" || this.configuration.kind !== 'idle')\n      return rejected", ")\n      return rejected"],
  'commit-after-close': ["      if (this.closing) return rejected('Desk is shutting down; configuration was not committed');", '      void this.closing;'],
  'close-without-wait': ["    if (this.configuration.kind === 'preparing') await this.configuration.done;", '    void this.configuration;'],
  'stale-revision': ["    if (expectedRevision !== this.view.revision) return rejected('Desk changed. Reload its current state before saving');", '    void expectedRevision;'],
} satisfies Record<Exclude<ConfigurationMutation, 'none'>, [string, string]>;
export function mutateConfigurationController(source: string, mutation: ConfigurationMutation): string {
  if (mutation === 'none') return source;
  const [before, after] = configurationReplacements[mutation];
  assert.equal(source.split(before).length, 2, `Source drift: ${mutation} mutation anchor must occur once`);
  return source.replace(before, after);
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function until(read: () => boolean, label: string) {
  for (let i = 0; i < 1000; i++) { if (read()) return; await new Promise(done => setTimeout(done, 2)); }
  throw Error(`Replay failed to reach ${label}`);
}
const state = Schema.decodeUnknownSync(NativeStateSchema)({
  phase: 'idle', bar: null, beat: null, countInRemaining: 0, bpm: 120, startBar: 1, endBar: 1,
  loop: false, automatic: true, click: false, selectedChannel: 'L1', runId: 'synthetic-run', seq: 0,
  channels: ['L1', 'L2', 'R1', 'R2'].map(id => ({ id, gain: 1, muted: false, looping: false, ready: false,
    status: 'empty', light: { kind: 'off' } })),
  looping: [], recording: null, microphone: true, error: null,
});
const tuning = Schema.decodeUnknownSync(TunerStateSchema)({
  revision: 0, root: 48, scale: 'major', step: 0,
  targets: [48, 50, 52, 53, 55, 57, 59, 60].map((midi, index) => ({
    midi, letter: ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'][index], accidental: 0, octave: index === 7 ? 4 : 3,
  })),
  complete: false, listening: false, preview: { kind: 'silent' }, pitch: { kind: 'off' },
});
type SyntheticChild = { alive: boolean; exit: ReturnType<typeof deferred<ChildProcessSpawner.ExitCode>> };
interface ReplayDependencies {
  layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
  prepare(): Promise<void>;
  prepareBindings(): Promise<{ installed: ReturnType<typeof installedPackage>['installed'] }>;
  Instrument: new () => ReplayInstrument;
}
declare global { var __nativeAudioReplay: ReplayDependencies | undefined; }
class ReplayInstrument {
  readonly listeners = new Set<(value: Observation) => void>();
  closed = false;
  constructor(readonly value: Observation, readonly delayed: ReturnType<typeof deferred<NativeOutcome>>, readonly issued: () => void) {}
  snapshot() { return this.closed ? null : this.value; }
  subscribe(listener: (value: Observation) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  command() { this.issued(); return this.delayed.promise; }
  close() { this.closed = true; }
}
type ReplayOptions = {
  mutation: Mutation;
  configurationMutation?: ConfigurationMutation;
  configuration?: 'blocked' | 'failed-prepare' | 'failed-commit';
  preparation?: 'blocked';
  cleanup?: 'unconfirmed';
  readback?: 'blocked';
  acquisition?: 'blocked' | 'fail-before-child' | 'fail-after-child';
  runtimeRootFailure?: true;
  exitQuery?: 'failed';
};
async function fixture(options: ReplayOptions) {
  const { mutation } = options;
  const directory = await mkdtemp(join(tmpdir(), 'native-audio-replay-'));
  const bundleDirectory = await mkdtemp(resolve('node_modules/.native-audio-replay-'));
  if (options.runtimeRootFailure) await writeFile(join(directory, 'runtime'), 'not a directory');
  const prepared = deferred<void>(), commandDone = deferred<NativeOutcome>(), spawnReturned = deferred<void>();
  if (!options.acquisition) spawnReturned.resolve();
  if (!options.preparation) prepared.resolve();
  const children: SyntheticChild[] = [], instruments: ReplayInstrument[] = [];
  let prepareCalls = 0, commandCalls = 0, spawnCalls = 0;
  const readback = { ready: !options.readback };
  const configurationPrepared = deferred<void>();
  let configurationPrepareCalls = 0, configurationCommitCalls = 0;
  const song = installedPackage().installed;
  const spawner = ChildProcessSpawner.make(() => Effect.gen(function*() {
    spawnCalls++;
    if (options.acquisition === 'fail-before-child') {
      yield* Effect.promise(() => spawnReturned.promise);
      return yield* Effect.die(new Error('Synthetic spawn failed before child creation'));
    }
    const handle = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const child = { alive: true, exit: deferred<ChildProcessSpawner.ExitCode>() };
        children.push(child);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(children.length + 1000),
          exitCode: Effect.promise(() => child.exit.promise),
          isRunning: options.exitQuery ? Effect.die(new Error('Synthetic exit query failed')) : Effect.sync(() => child.alive),
          kill: () => Effect.sync(() => { child.alive = false; child.exit.resolve(ChildProcessSpawner.ExitCode(0)); }),
          stdin: Sink.drain, stdout: Stream.empty, stderr: Stream.empty, all: Stream.empty,
          getInputFd: () => Sink.drain, getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      }),
      handle => Effect.sync(() => {
        const child = children[Number(handle.pid) - 1001];
        assert(child);
        if (!options.cleanup) { child.alive = false; child.exit.resolve(ChildProcessSpawner.ExitCode(0)); }
      }),
    );
    yield* Effect.promise(() => spawnReturned.promise);
    if (options.acquisition === 'fail-after-child') return yield* Effect.die(new Error('Synthetic spawn failed after child acquisition'));
    return handle;
  }));
  const dependencies: ReplayDependencies = {
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    prepare: async () => { prepareCalls++; await prepared.promise; },
    prepareBindings: async () => {
      configurationPrepareCalls++;
      await configurationPrepared.promise;
      if (options.configuration === 'failed-prepare') throw Error('Synthetic candidate preparation rejected');
      return { installed: song };
    },
    Instrument: class extends ReplayInstrument {
      constructor() {
        super({ type: 'session', song: song.song, state, lights: lightFixture(), tuner: tuning,
          revision: '1', hostEpoch: `native-${children.length}` }, commandDone, () => { commandCalls++; });
        instruments.push(this);
      }
      override snapshot() { return readback.ready ? super.snapshot() : null; }
    },
  };
  globalThis.__nativeAudioReplay = dependencies;
  const sourcePath = resolve('lib/remote-performance/controller.ts');
  const source = mutateConfigurationController(mutateController(await readFile(sourcePath, 'utf8'), mutation), options.configurationMutation ?? 'none');
  const sourceCopy = join(bundleDirectory, 'controller-source.ts');
  await writeFile(sourceCopy, source);
  const outfile = join(bundleDirectory, 'controller.mjs');
  await build({
    entryPoints: [sourcePath], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    plugins: [{ name: 'controlled-native-boundaries', setup(builder) {
      builder.onLoad({ filter: /\/controller\.ts$/ }, async () => ({ contents: await readFile(sourceCopy, 'utf8'), loader: 'ts', resolveDir: resolve('lib/remote-performance') }));
      builder.onResolve({ filter: /^@effect\/platform-node$/ }, () => ({ path: 'platform', namespace: 'native-replay' }));
      builder.onResolve({ filter: /^\.\/(instrument|prepare|song-bindings)\.js$/ }, args => args.importer === sourcePath ? { path: args.path, namespace: 'native-replay' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'native-replay' }, args => ({ contents:
        args.path === 'platform' ? 'export const NodeServices = {layer: globalThis.__nativeAudioReplay.layer};'
          : args.path.includes('song-bindings') ? 'export const prepareSongBindings = (...args) => globalThis.__nativeAudioReplay.prepareBindings(...args);'
          : args.path.includes('instrument') ? 'export const NativeInstrument = globalThis.__nativeAudioReplay.Instrument;'
          : 'export const prepareInstalledPackage = (...args) => globalThis.__nativeAudioReplay.prepare(...args);', loader: 'js' }));
    } }],
  });
  const { PersistentDesk }: typeof import('../../lib/remote-performance/controller.js') = await import(pathToFileURL(outfile).href);
  const entry: InstalledSong = { id: song.song.id, title: song.song.chart.title, packageDigest: '0'.repeat(64),
    hashes: { manifestSha256: '0'.repeat(64), packetSha256: '0'.repeat(64), effectsSha256: '0'.repeat(64) },
    paths: { manifest: join(directory, 'manifest.json'), packet: join(directory, 'song.pfp'), effects: join(directory, 'effects.json') }, installed: song };
  const catalog: InstalledSongCatalog = { initialSongId: entry.id, choices: [entry], get(id) { assert.equal(id, entry.id); return entry; } };
  const authority = options.configuration ? SongBindingAuthority.open(join(directory, 'binding-authority.sqlite')) : undefined;
  if (authority) authority.save = () => {
    if (options.configuration === 'failed-commit') throw Error('Synthetic compare-and-swap rejected');
    configurationCommitCalls++;
    return { ...authority.read(entry), revision: 1 };
  };
  const controller = new PersistentDesk(sessionProfile(directory), song, authority ? { catalog, bindings: authority } : undefined);
  const publications: ReturnType<typeof controller.snapshot>[] = [];
  controller.subscribe(publication => { if (publication.type === 'desk') publications.push(publication.view); });
  return { directory, controller, children, instruments, prepared, commandDone, publications, readback, spawnReturned,
    configurationPrepared,
    get configurationPrepareCalls() { return configurationPrepareCalls; }, get configurationCommitCalls() { return configurationCommitCalls; },
    get prepareCalls() { return prepareCalls; }, get commandCalls() { return commandCalls; }, get spawnCalls() { return spawnCalls; },
    async dispose() {
      prepared.resolve();
      configurationPrepared.resolve();
      spawnReturned.resolve();
      commandDone.resolve({ outcome: 'unknown' });
      for (const child of children) { child.alive = false; child.exit.resolve(ChildProcessSpawner.ExitCode(0)); }
      controller.setAudio('off');
      await controller.close().catch(error => {
        if (!(options.cleanup || options.acquisition || options.exitQuery) || !(error instanceof Error) || error.message !== 'Native cleanup did not confirm exit') throw error;
      });
      authority?.close();
      await rm(directory, { recursive: true, force: true });
      await rm(bundleDirectory, { recursive: true, force: true });
      globalThis.__nativeAudioReplay = undefined;
    },
  };
}
async function ready(controller: Awaited<ReturnType<typeof fixture>>['controller']) {
  await until(() => controller.snapshot().audio.kind === 'ready', 'ready');
  const audio = controller.snapshot().audio;
  assert.equal(audio.kind, 'ready');
  if (audio.kind !== 'ready') throw Error('Expected ready');
  return audio;
}
function stopped(controller: Awaited<ReturnType<typeof fixture>>['controller']): boolean {
  const a = controller.snapshot().audio;
  return a.kind === 'off' || a.kind === 'fault' || a.kind === 'stopping' && a.error !== undefined;
}

export async function replay(mutation: Mutation, scenario: Exclude<Mutation, 'none'>): Promise<void> {
  if (scenario === 'ownership') return replayOwnership(mutation);
  const f = await fixture({ mutation, preparation: scenario === 'cancel' ? 'blocked' : undefined, cleanup: scenario === 'cleanup' ? 'unconfirmed' : undefined });
  try {
    const admission = f.controller.setAudio('on');
    const reserved = admission.view.audio;
    assert.equal(reserved.kind, 'starting');
    if (scenario === 'cancel') {
      await until(() => f.prepareCalls === 1, 'preparation await');
      f.controller.setAudio('off');
      const cancelIndex = f.publications.length;
      f.prepared.resolve();
      await until(() => ['off', 'ready'].includes(f.controller.snapshot().audio.kind), 'canceled startup completion');
      assert(!f.publications.slice(cancelIndex).some(view => view.audio.kind === 'ready'), 'Canceled startup must never publish Ready');
      return;
    }
    const first = await ready(f.controller);
    if (scenario === 'identity') {
      assert(reserved.kind === 'starting');
      assert.equal(first.attempt, reserved.attempt, 'Ready view must keep the reserved attempt identity');
      return;
    }
    const oldTarget = { attempt: first.attempt, hostEpoch: first.performance.hostEpoch };
    if (scenario === 'cleanup') {
      f.controller.setAudio('off');
      await until(() => {
        const a = f.controller.snapshot().audio;
        return a.kind === 'off' || a.kind === 'stopping' && a.error !== undefined;
      }, 'cleanup confirmation');
      assert.equal(f.controller.setAudio('on').outcome, 'rejected', 'Unconfirmed cleanup must block a replacement');
      assert.equal(f.children.filter(child => child.alive).length, 1);
      return;
    }
    const pending = scenario === 'command' ? f.controller.command(oldTarget, { command: 'stop', args: {} }) : undefined;
    if (pending) await until(() => f.commandCalls === 1, 'native command await');
    f.controller.setAudio('off');
    await until(() => f.controller.snapshot().audio.kind === 'off', 'first child exit');
    f.controller.setAudio('on');
    const second = await ready(f.controller);
    assert.notEqual(first.attempt, second.attempt);
    const issuedBeforeStale = f.commandCalls;
    assert.equal((await f.controller.command(oldTarget, {})).outcome, 'rejected', 'Old target cannot enter replacement');
    assert.equal(f.commandCalls, issuedBeforeStale, 'Rejected old target cannot reach the replacement instrument');
    if (scenario === 'command') {
      f.commandDone.resolve({ outcome: 'applied', ...first.performance });
      assert.equal((await pending)?.outcome, 'unknown', 'Old command completion must not report applied to replacement');
    } else {
      let staleEvents = 0;
      const unsubscribe = f.controller.subscribe(value => { if (value.type === 'event' && value.attempt === first.attempt) staleEvents++; });
      for (const listener of f.instruments[0].listeners) listener({ type: 'event', event: { v: 1, runId: 'synthetic-run', seq: 1, type: 'state', state } });
      unsubscribe();
      assert.equal(staleEvents, 0, 'Old observer must not publish into replacement');
    }
  } finally { await f.dispose(); }
}

async function replayOwnership(mutation: Mutation): Promise<void> {
  const f = await fixture({ mutation, cleanup: 'unconfirmed', acquisition: 'blocked' });
  try {
    f.controller.setAudio('on');
    await until(() => f.children.length === 1, 'child acquired before handle return');
    f.controller.setAudio('off');
    await until(() => stopped(f.controller), 'unassigned cleanup');
    assert.equal(f.controller.snapshot().audio.kind, 'stopping', 'Pending acquisition must retain ownership');
    assert.equal(f.controller.setAudio('on').outcome, 'rejected');
    assert.equal(f.children.filter(child => child.alive).length, 1);
  } finally { await f.dispose(); }
}

export async function replayAcquisitionFailures(): Promise<void> {
  for (const acquisition of ['fail-before-child', 'fail-after-child'] satisfies Array<ReplayOptions['acquisition']>) {
    const f = await fixture({ mutation: 'none', acquisition, cleanup: 'unconfirmed' });
    try {
      f.controller.setAudio('on');
      await until(() => f.spawnCalls === 1, 'requested spawn failure');
      f.spawnReturned.resolve();
      await until(() => stopped(f.controller), 'failed spawn disposition');
      assert.equal(f.controller.snapshot().audio.kind, 'stopping', 'A failed pending spawn cannot prove absence of a child');
      assert.equal(f.controller.setAudio('on').outcome, 'rejected');
      assert.equal(f.spawnCalls, 1);
      assert(!f.publications.some(view => view.audio.kind === 'ready'));
      await assert.rejects(f.controller.close(), /Native cleanup did not confirm exit/);
    } finally { await f.dispose(); }
  }
}
export async function replayCancelBeforeRequest(): Promise<void> {
  const f = await fixture({ mutation: 'none' });
  try {
    f.controller.setAudio('on');
    f.controller.setAudio('off');
    await until(() => f.controller.snapshot().audio.kind === 'off', 'cancellation before spawn request');
    assert.equal(f.spawnCalls, 0);
    assert.equal(f.controller.setAudio('on').outcome, 'accepted');
    await ready(f.controller);
  } finally { await f.dispose(); }
}

export async function replayPreSpawnRecovery(): Promise<void> {
  const f = await fixture({ mutation: 'none', runtimeRootFailure: true });
  try {
    f.controller.setAudio('on');
    await until(() => f.controller.snapshot().audio.kind === 'fault', 'failure before spawn request');
    assert.equal(f.spawnCalls, 0);
    f.controller.setAudio('off');
    assert.equal(f.controller.snapshot().audio.kind, 'off');
    await rm(join(f.directory, 'runtime'));
    assert.equal(f.controller.setAudio('on').outcome, 'accepted');
    await ready(f.controller);
  } finally { await f.dispose(); }
}
export async function replayFailedExitQuery(): Promise<void> {
  const f = await fixture({ mutation: 'none', exitQuery: 'failed' });
  try {
    f.controller.setAudio('on'); await ready(f.controller);
    f.controller.setAudio('off');
    await until(() => stopped(f.controller), 'failed exit query');
    assert.equal(f.controller.snapshot().audio.kind, 'stopping');
    assert.equal(f.controller.setAudio('on').outcome, 'rejected');
  } finally { await f.dispose(); }
}

export async function probeUnassignedCleanupFailure() {
  const f = await fixture({ mutation: 'none', cleanup: 'unconfirmed', acquisition: 'blocked' });
  try {
    f.controller.setAudio('on');
    await until(() => f.children.length === 1, 'acquired child before handle assignment');
    f.controller.setAudio('off');
    f.spawnReturned.resolve();
    await until(() => {
      const audio = f.controller.snapshot().audio;
      return audio.kind === 'off' || audio.kind === 'stopping' && audio.error !== undefined;
    }, 'unassigned child cleanup');
    const audioAfterCleanup = f.controller.snapshot().audio.kind;
    const childrenAlive = f.children.filter(child => child.alive).length;
    const replacementDecision = f.controller.setAudio('on').outcome;
    return { audioAfterCleanup, childrenAlive, replacementDecision };
  } finally { await f.dispose(); }
}

export async function replayAcquisitionCancellation(): Promise<void> {
  const f = await fixture({ mutation: 'none', acquisition: 'blocked' });
  try {
    f.controller.setAudio('on');
    await until(() => f.children.length === 1, 'physical child acquired before handle assignment');
    f.controller.setAudio('off');
    assert.equal(f.controller.setAudio('on').outcome, 'rejected');
    f.spawnReturned.resolve();
    await until(() => stopped(f.controller), 'scoped acquisition cleanup');
    assert.equal(f.controller.snapshot().audio.kind, 'stopping', 'Unassigned acquisition remains uncertain even after synthetic cleanup');
    assert.equal(f.controller.setAudio('on').outcome, 'rejected');
    assert(f.children.every(child => !child.alive), 'Scope must reap an acquired child before publishing Off');
    assert(!f.publications.some(view => view.audio.kind === 'ready'));
  } finally { await f.dispose(); }
}

export async function replayCounterexample(mutation: Mutation, actions: readonly string[]): Promise<void> {
  const f = await fixture({ mutation, preparation: 'blocked', cleanup: actions.includes('FinishExited') ? 'unconfirmed' : undefined, readback: 'blocked', acquisition: actions.includes('SpawnFailed') ? actions.includes('ChildAcquired') ? 'fail-after-child' : 'fail-before-child' : 'blocked' });
  let pending: Promise<NativeOutcome> | undefined;
  let first: Awaited<ReturnType<typeof ready>> | undefined;
  let reservedAttempt: string | undefined;
  let canceled = false;
  let staleEvents = 0;
  f.controller.subscribe(value => { if (value.type === 'event' && canceled) staleEvents++; });
  try {
    for (const action of actions) {
      if (action === 'Enable') {
        const admitted = f.controller.setAudio('on').view.audio;
        assert(admitted.kind === 'starting'); reservedAttempt = admitted.attempt;
      }
      else if (action === 'BeginSpawn') await until(() => f.spawnCalls === 1, 'spawn request');
      else if (action === 'ChildAcquired') await until(() => f.children.length === 1, 'child acquired before handle return');
      else if (action === 'Spawn') {
        f.spawnReturned.resolve();
        await until(() => f.prepareCalls === 1 || stopped(f.controller), 'spawn return or cancellation');
      }
      else if (action === 'SpawnFailed') {
        f.spawnReturned.resolve();
        await until(() => stopped(f.controller), 'spawn failure disposition');
      } else if (action === 'PrepareDone') {
        f.prepared.resolve();
        await until(() => f.instruments.length === 1 || stopped(f.controller), 'prepared readback wait');
      } else if (action === 'PublishReady') {
        f.readback.ready = true;
        await until(() => f.controller.snapshot().audio.kind === 'ready' || stopped(f.controller), 'ready publication or cancellation');
        const audio = f.controller.snapshot().audio;
        if (audio.kind === 'ready') {
          assert.equal(audio.attempt, reservedAttempt, 'Ready view must keep the reserved attempt identity');
          first = audio;
        }
        assert(!canceled || audio.kind !== 'ready', 'Canceled startup must never publish Ready');
      } else if (action === 'Terminate') { canceled = true; f.controller.setAudio('off'); }
      else if (action === 'BeginCleanup') await until(() => f.controller.snapshot().audio.kind !== 'ready', 'cleanup response');
      else if (action === 'HoldPending') {
        await until(() => stopped(f.controller), 'uncertain acquisition hold');
        assert.equal(f.controller.snapshot().audio.kind, 'stopping', 'Pending acquisition must retain ownership');
      } else if (action === 'FinishExited') {
        await until(() => stopped(f.controller), 'exit confirmation');
        const released = ['off', 'fault'].includes(f.controller.snapshot().audio.kind);
        if (actions.includes('SpawnFailed') && actions.includes('ChildAcquired'))
          assert.equal(released ? f.children.filter(child => child.alive).length : 0, 0, 'Released attempt must not leave a live child');
        assert.equal(f.controller.snapshot().audio.kind, 'stopping', mutation === 'ownership' ? 'Pending acquisition must retain ownership' : 'Unconfirmed cleanup must retain ownership');
      } else if (action === 'IssueCommand') {
        assert(first);
        pending = f.controller.command({ attempt: first.attempt, hostEpoch: first.performance.hostEpoch }, {});
        await until(() => f.commandCalls === 1, 'issued control');
      } else if (action === 'NativeExit') {
        const child = f.children[0]; assert(child); child.alive = false; child.exit.resolve(ChildProcessSpawner.ExitCode(0));
        await until(() => f.controller.snapshot().audio.kind !== 'ready', 'native exit observed');
      } else if (action === 'ReturnCommand') {
        assert(first); assert(pending);
        f.commandDone.resolve({ outcome: 'applied', ...first.performance });
        assert.equal((await pending).outcome, 'unknown', 'Unready old command must report unknown');
      } else if (action === 'DeliverEvent') {
        assert(f.instruments[0]);
        for (const listener of f.instruments[0].listeners) listener({ type: 'event', event: { v: 1, runId: 'synthetic-run', seq: 1, type: 'state', state } });
        assert.equal(staleEvents, 0, 'Canceled observer must not publish');
      } else throw Error(`Unmapped TLC action ${action}`);
    }
  } finally { await f.dispose(); }
}

export const configurationFailures = {
  'enable-during-config': 'Configuration must reject Enable before reserving an attempt',
  'config-during-audio': 'Owned audio must reject configuration before preparation',
  'config-during-fault': 'Faulted audio must reject configuration until explicitly Off',
  'config-after-close': 'A closed desk must reject new configuration before preparation',
  'overlapping-config': 'A pending configuration must reject another preparation',
  'commit-after-close': 'Closing must prevent configuration commit',
  'close-without-wait': 'Close must wait for its pending configuration',
  'stale-revision': 'Stale desk revisions must reject configuration',
} satisfies Record<Exclude<ConfigurationMutation, 'none'>, string>;

export async function replayConfiguration(mutation: ConfigurationMutation, scenario: Exclude<ConfigurationMutation, 'none'>,
  actions: readonly string[]): Promise<void> {
  const expectedActions = {
    'enable-during-config': ['BeginConfigure', 'Enable'],
    'config-during-audio': ['Enable', 'BeginConfigure'],
    'config-during-fault': ['Enable', 'ConfirmedFailure', 'BeginConfigure'],
    'config-after-close': ['BeginClose', 'BeginConfigure'],
    'overlapping-config': ['BeginConfigure', 'BeginConfigure'],
    'commit-after-close': ['BeginConfigure', 'BeginClose', 'FinishConfigure'],
    'close-without-wait': ['BeginConfigure', 'BeginClose'],
    'stale-revision': ['BeginConfigure'],
  } satisfies Record<Exclude<ConfigurationMutation, 'none'>, string[]>;
  assert.deepEqual(actions, expectedActions[scenario], 'New model path must map to these actual-controller operations');
  const f = await fixture({ mutation: 'none', configuration: 'blocked', configurationMutation: mutation,
    ...(scenario === 'config-during-fault' ? { runtimeRootFailure: true } : {}) });
  const configure = (expected = f.controller.snapshot().revision) =>
    f.controller.configureSongBindings(f.controller.snapshot().song.id, expected, []);
  try {
    if (scenario === 'config-during-fault' || scenario === 'config-after-close') {
      if (scenario === 'config-during-fault') {
        f.controller.setAudio('on');
        await until(() => f.controller.snapshot().audio.kind === 'fault', 'confirmed setup failure before spawn');
        assert.equal(f.spawnCalls, 0);
      } else await f.controller.close();
      const result = configure();
      assert.equal(f.configurationPrepareCalls, 0, configurationFailures[scenario]);
      assert.equal((await result).outcome, 'rejected');
      return;
    }
    if (scenario === 'stale-revision') {
      const noncurrent = Schema.decodeUnknownSync(DeskRevisionSchema)((BigInt(f.controller.snapshot().revision) + 1n).toString());
      const result = configure(noncurrent);
      assert.equal(f.configurationPrepareCalls, 0, configurationFailures[scenario]);
      assert.equal((await result).outcome, 'rejected');
      return;
    }
    if (scenario === 'config-during-audio') {
      f.controller.setAudio('on');
      const result = configure();
      assert.equal(f.configurationPrepareCalls, 0, configurationFailures[scenario]);
      assert.equal((await result).outcome, 'rejected');
      return;
    }
    const original = f.controller.snapshot();
    const pending = configure();
    assert.equal(f.configurationPrepareCalls, 1, 'Configuration must reserve before its preparation await');
    if (scenario === 'enable-during-config') {
      assert.equal(f.controller.setAudio('on').outcome, 'rejected', configurationFailures[scenario]);
      assert.equal(f.spawnCalls, 0, 'Rejected Enable must not request a native child');
    } else if (scenario === 'overlapping-config') {
      const second = configure();
      assert.equal(f.configurationPrepareCalls, 1, configurationFailures[scenario]);
      assert.equal((await second).outcome, 'rejected');
    } else if (scenario === 'commit-after-close' || scenario === 'close-without-wait') {
      let closed = false;
      const closing = f.controller.close().then(() => { closed = true; });
      await Promise.resolve();
      await Promise.resolve();
      if (scenario === 'close-without-wait') assert(!closed, configurationFailures[scenario]);
      f.configurationPrepared.resolve();
      const decision = await pending;
      await closing;
      assert.equal(f.configurationCommitCalls, 0, configurationFailures['commit-after-close']);
      assert.equal(decision.outcome, 'rejected');
      assert.equal(f.controller.snapshot().revision, original.revision);
    } else {
      f.configurationPrepared.resolve();
      assert.equal((await pending).outcome, 'accepted');
      assert.notEqual(f.controller.snapshot().revision, original.revision);
      const second = await configure(original.revision);
      assert.equal(second.outcome, 'rejected', configurationFailures[scenario]);
      assert.equal(f.configurationPrepareCalls, 1, 'A stale request must not prepare a second candidate');
    }
  } finally { await f.dispose(); }
}

export async function replayConfigurationOutcomes(): Promise<void> {
  for (const configuration of ['blocked', 'failed-prepare', 'failed-commit'] satisfies Array<NonNullable<ReplayOptions['configuration']>>) {
    const f = await fixture({ mutation: 'none', configuration });
    try {
      const before = f.controller.snapshot();
      const pending = f.controller.configureSongBindings(before.song.id, before.revision, []);
      assert.equal(f.configurationPrepareCalls, 1);
      f.configurationPrepared.resolve();
      const result = await pending;
      if (configuration === 'blocked') {
        assert.equal(result.outcome, 'accepted');
        assert.equal(f.configurationCommitCalls, 1);
        assert.notEqual(f.controller.snapshot().revision, before.revision);
      } else {
        assert.equal(result.outcome, 'rejected');
        assert.equal(f.configurationCommitCalls, 0);
        assert.equal(f.controller.snapshot(), before, 'A rejected preparation or CAS must preserve the installed view');
      }
      if (configuration === 'blocked') {
        const calls = f.configurationPrepareCalls;
        const stale = await f.controller.configureSongBindings(before.song.id, before.revision, []);
        assert.equal(stale.outcome, 'rejected', 'A prior successful configuration must invalidate its old desk revision');
        assert.equal(f.configurationPrepareCalls, calls);
      }
      assert.equal(f.controller.setAudio('on').outcome, 'accepted', 'Configuration outcome must release its lock');
      await ready(f.controller);
    } finally { await f.dispose(); }
  }
}

export async function replayConfigurationOwnershipStates(): Promise<void> {
  const known = await fixture({ mutation: 'none', configuration: 'blocked' });
  try {
    known.controller.setAudio('on');
    await ready(known.controller);
    const rejected = await known.controller.configureSongBindings(known.controller.snapshot().song.id, known.controller.snapshot().revision, []);
    assert.equal(rejected.outcome, 'rejected', 'A Ready native attempt must block configuration');
    assert.equal(known.configurationPrepareCalls, 0);
    known.controller.setAudio('off');
    await until(() => known.controller.snapshot().audio.kind === 'off', 'owned child exit before configuration');
    const pending = known.controller.configureSongBindings(known.controller.snapshot().song.id, known.controller.snapshot().revision, []);
    assert.equal(known.configurationPrepareCalls, 1);
    known.configurationPrepared.resolve();
    assert.equal((await pending).outcome, 'accepted', 'Confirmed ownership release must admit configuration');
  } finally { await known.dispose(); }
  const unknown = await fixture({ mutation: 'none', configuration: 'blocked', acquisition: 'blocked', cleanup: 'unconfirmed' });
  try {
    unknown.controller.setAudio('on');
    await until(() => unknown.children.length === 1, 'acquired child before its handle returns');
    unknown.controller.setAudio('off');
    await until(() => stopped(unknown.controller), 'unknown ownership retained');
    const rejected = await unknown.controller.configureSongBindings(unknown.controller.snapshot().song.id, unknown.controller.snapshot().revision, []);
    assert.equal(rejected.outcome, 'rejected', 'Unknown native ownership must block configuration');
    assert.equal(unknown.configurationPrepareCalls, 0);
  } finally { await unknown.dispose(); }
}
