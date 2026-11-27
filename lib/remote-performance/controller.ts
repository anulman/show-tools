import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { Effect, Fiber, Schema, Stream } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { NativeInstrument } from './instrument.js';
import { isPriorityCommand } from './commands.js';
import type { Observation } from './gateway.js';
import { SongSchema, NativeEventSchema } from './native-schema.js';
import { prepareChart } from './prepare-chart.js';
import { prepareInstalledPackage, type validateInstalledPackage } from './prepare.js';
import type { SessionProfile } from './session-profile.js';
import type { InstalledSongCatalog } from './song-catalog.js';
import { chartSource, MAX_CHART_BYTES, type ChartOverrides, type ChartSource, type PublishedChart } from './chart-overrides.js';
import { prepareSongBindings, type SongBindingAuthority } from './song-bindings.js';
import type { InputBindings } from '../performance/input-bindings.js';
import { chartMetadata } from '../performance/chart.js';
import { requireLegacyMonitorInactive } from './legacy-monitor.js';
import { openDemoFile, RecordingArchive } from './recording-archive.js';
import { AttemptSchema, DeskRevisionSchema, ServerEpochSchema, NativePerformanceSchema, NativeOutcomeSchema,
  type DeskController, type DeskView, type DeskPublication, type NativeTarget, type AudioGoal, type AudioDecision, type NativeOutcome, type NativeEngineRetirementProof, type SongPreview } from './session-schema.js';

const performance = Schema.decodeUnknownSync(NativePerformanceSchema);
const outcome = Schema.decodeUnknownSync(NativeOutcomeSchema);
const nativeEvent = Schema.decodeUnknownSync(NativeEventSchema);
const revision = Schema.decodeUnknownSync(DeskRevisionSchema);
const MAX_RETIRED_TARGETS = 128;
const nativeRunNumber = (runId: string) => BigInt(runId.slice(runId.lastIndexOf(':') + 1));
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Native audio failed').slice(0, 8192);
type InstalledPackage = ReturnType<typeof validateInstalledPackage>;
const diagnosticMessage = (attempt: Attempt, message: string) => {
  const tail = stripVTControlCharacters(attempt.stderr.toString('utf8')).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').trim();
  const prefix = message.slice(0, 1024);
  return tail ? `${prefix}\n${tail.slice(-(8192 - prefix.length - 1))}` : prefix;
};
type ChildOwnership = { kind: 'not-requested' } | { kind: 'pending' } | { kind: 'known'; handle: ChildProcessSpawner.ChildProcessHandle };
type Attempt = { id: typeof AttemptSchema.Type; abort: AbortController; done: Promise<void>; finish: 'off' | 'fault'; stderr: Buffer; chartRunFloor?: bigint; readyTarget?: NativeTarget; instrument?: NativeInstrument; child: ChildOwnership };

export class PersistentDesk implements DeskController {
  private view: DeskView;
  private eventChart: ReturnType<typeof chartMetadata>;
  private readonly demoPath: string;
  readonly recordingArchive?: RecordingArchive;
  private readonly listeners = new Set<(value: DeskPublication) => void>();
  private attempt: Attempt | undefined;
  private closing = false;
  private readonly retirements = new Map<string, NativeEngineRetirementProof>();
  confirmedRetirement(target: NativeTarget) {
    return this.retirements.get(JSON.stringify([target.attempt, target.hostEpoch])) ?? null;
  }

  private publishingChart?: Promise<PublishedChart>;
  private loadedChart?: ChartSource;
  private configurationRevision = 0n;
  private configuration: { kind: 'idle' } | { kind: 'preparing'; done: Promise<void> } = { kind: 'idle' };
  constructor(private readonly profile: SessionProfile, private installed: InstalledPackage,
    private readonly songs?: { catalog: InstalledSongCatalog; bindings: SongBindingAuthority; charts?: ChartOverrides;
      chartPreviews?: Map<string, SongPreview>; initialChart?: ChartSource }) {
    this.view = { serverEpoch: Schema.decodeUnknownSync(ServerEpochSchema)(randomUUID()), revision: revision('0'),
      song: Schema.decodeUnknownSync(SongSchema)(installed.song), defaultVoiceEffects: installed.defaultVoiceEffects, audio: { kind: 'off' } };
    this.eventChart = chartMetadata(this.view.song.chart);
    this.demoPath = join(profile.runtimeRoot, 'demo-latest.wav');
    if (profile.recordingArchiveRoot) this.recordingArchive = new RecordingArchive(profile.recordingArchiveRoot, profile.recordingArchiveReserveBytes);
    this.loadedChart = songs?.initialChart;
  }
  songChoices() {
    if (!this.songs) throw new Error('No installed song catalog is configured');
    return this.songs.catalog.choices.map(choice => {
      const override = this.songs?.chartPreviews?.get(choice.id);
      return override ? { id: choice.id, title: override.song.chart.title, packageDigest: override.packageDigest } : choice;
    });
  }
  songPreview(id: string): SongPreview | undefined {
    const context = this.songs;
    if (!context?.catalog.choices.some(choice => choice.id === id)) return;
    const override = context.chartPreviews?.get(id);
    if (override) return override;
    const { installed, packageDigest } = context.catalog.get(id);
    return { song: installed.song, defaultVoiceEffects: installed.defaultVoiceEffects, packageDigest };
  }
  private async chartSource(id: string) {
    const context = this.songs;
    if (!context?.catalog.choices.some(choice => choice.id === id)) return;
    const entry = context.catalog.get(id);
    const override = await context.charts?.read(id);
    const musicXml = override ?? await readFile(join(dirname(entry.paths.manifest), 'source.musicxml'), 'utf8');
    return chartSource(id, musicXml, override !== undefined);
  }
  async readChart(id: string): Promise<PublishedChart | undefined> {
    const source = await this.chartSource(id);
    if (!source) return;
    const { overridden: _, ...chart } = source;
    return chart;
  }
  async publishInstalledChart(id: string, musicXml: string, expectedChartVersion: string): Promise<PublishedChart> {
    if (this.closing || this.publishingChart || this.configuration.kind !== 'idle') throw new Error('Wait for the current desk operation to finish');
    if (!musicXml || Buffer.byteLength(musicXml) > MAX_CHART_BYTES) throw new Error('MusicXML must be nonempty and at most 4 MiB');
    const context = this.songs;
    const charts = context?.charts;
    if (!context || !charts) throw new Error('Chart updates are unavailable on this desk');
    const publish = async () => {
      const current = await this.readChart(id);
      if (!current) throw new Error('Song is not installed');
      if (current.chartVersion !== expectedChartVersion) throw new Error('Chart changed. Reload before saving');
      const bindings = context.bindings.read();
      const { chartVersion, ...preview } = await prepareChart({ entry: context.catalog.get(id), bindings: bindings.bindings, musicXml });
      const latest = await this.readChart(id);
      if (this.closing || latest?.chartVersion !== expectedChartVersion || context.bindings.read().revision !== bindings.revision)
        throw new Error('Chart or bindings changed. Reload before saving');
      await charts.save(id, musicXml);
      context.chartPreviews?.set(id, preview);
      return { songId: id, musicXml, chartVersion };
    };
    this.publishingChart = publish();
    try { return await this.publishingChart; }
    finally { this.publishingChart = undefined; }
  }
  private async configure(expectedRevision: string, prepare: () => Promise<{ installed: InstalledPackage; commit: () => void | Promise<void>; chart?: ChartSource }>, selecting?: string): Promise<AudioDecision> {
    const rejected = (error: string): AudioDecision => ({ outcome: 'rejected', error, view: this.view });
    if (this.closing || this.publishingChart || this.configuration.kind !== 'idle') return rejected('Wait for the current desk operation to finish');
    const audio = this.view.audio;
    const stopped = audio.kind === 'ready' && !audio.performance.state.preflightStage
      && (audio.performance.state.phase === 'idle' || audio.performance.state.phase === 'ended');
    const attempt = selecting && stopped ? this.attempt : undefined;
    if (audio.kind !== 'off' && !attempt)
      return rejected(selecting ? 'Stop practice before switching songs' : 'Switch to Standby before changing desk configuration');
    if (!/^(0|[1-9][0-9]{0,19})$/.test(expectedRevision)) return rejected('Invalid desk revision');
    const seen = BigInt(expectedRevision);
    if (attempt ? seen < this.configurationRevision || seen > BigInt(this.view.revision) : expectedRevision !== this.view.revision)
      return rejected('Desk changed. Reload its current state before saving');
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    this.configuration = { kind: 'preparing', done };
    try {
      if (selecting === this.view.song.id && (!this.loadedChart || this.loadedChart.chartVersion === (await this.readChart(selecting))?.chartVersion))
        return { outcome: 'accepted', view: this.view };
      const candidate = await prepare();
      const song = Schema.decodeUnknownSync(SongSchema)(candidate.installed.song);
      if (this.closing) return rejected('Desk is shutting down; configuration was not committed');
      let nextAudio = audio;
      if (attempt) {
        const instrument = attempt.instrument;
        if (!instrument || attempt !== this.attempt || attempt.abort.signal.aborted || audio.kind !== 'ready') return rejected('Hardware audio changed while loading the song');
        try {
          if (!await instrument.replaceSong(candidate.installed.operation)) return rejected('Native host could not replace the stopped song');
          const snapshot = instrument.snapshot();
          if (!snapshot || snapshot.type !== 'session' || JSON.stringify(Schema.decodeUnknownSync(SongSchema)(snapshot.song)) !== JSON.stringify(song))
            throw new Error('Native song readback mismatch');
          if (attempt !== this.attempt || attempt.abort.signal.aborted) return rejected('Hardware audio changed while loading the song');
          const next = performance(snapshot);
          if (next.hostEpoch !== audio.performance.hostEpoch || next.state.phase !== 'idle') throw new Error('Native stopped song readback mismatch');
          attempt.chartRunFloor = nativeRunNumber(next.state.runId);
          nextAudio = { ...audio, performance: next };
        } catch (error) {
          this.failAttempt(attempt, errorText(error));
          throw error;
        }
      }
      const committed = candidate.commit();
      if (committed) await committed;
      this.installed = candidate.installed;
      if (candidate.chart) this.loadedChart = candidate.chart;
      this.view = { ...this.view, song, defaultVoiceEffects: candidate.installed.defaultVoiceEffects };
      this.eventChart = chartMetadata(song.chart);
      this.update(nextAudio);
      return { outcome: 'accepted', view: this.view };
    } catch (error) { return rejected(errorText(error)); }
    finally { this.configuration = { kind: 'idle' }; finish(); }
  }
  selectSong(songId: string, expectedRevision: string): Promise<AudioDecision> {
    return this.configure(expectedRevision, async () => {
      if (!this.songs) throw new Error('No installed song catalog is configured');
      const entry = this.songs.catalog.get(songId), authored = this.songs.bindings.read();
      const prepared = await prepareSongBindings(entry, authored.bindings, await this.songs.charts?.read(songId));
      return { installed: prepared.installed, chart: prepared.chart, commit: () => {} };
    }, songId);
  }
  configureButtonBindings(expectedRevision: string, input: InputBindings): Promise<AudioDecision> {
    return this.configure(expectedRevision, async () => {
      const context = this.songs;
      if (!context) throw new Error('No installed song catalog is configured');
      const entry = context.catalog.get(this.view.song.id), current = context.bindings.read();
      const source = this.loadedChart;
      const prepared = await prepareSongBindings(entry, input, source?.overridden ? source.musicXml : undefined);
      return { installed: prepared.installed, commit: () => { context.bindings.save(prepared.bindings, current.revision); } };
    });
  }
  publishChart(musicXml: string, expectedRevision: string): Promise<AudioDecision> {
    return this.configure(expectedRevision, async () => {
      if (!musicXml || Buffer.byteLength(musicXml) > MAX_CHART_BYTES) throw new Error('MusicXML must be nonempty and at most 4 MiB');
      const context = this.songs;
      const charts = context?.charts;
      if (!context || !charts) throw new Error('Chart updates are unavailable on this desk');
      const entry = context.catalog.get(this.view.song.id);
      const expectedChartVersion = this.loadedChart?.chartVersion;
      if (!expectedChartVersion || (await this.readChart(entry.id))?.chartVersion !== expectedChartVersion)
        throw new Error('Chart changed since this song was loaded. Load its current chart before saving');
      const prepared = await prepareSongBindings(entry, context.bindings.read().bindings, musicXml);
      if ((await this.readChart(entry.id))?.chartVersion !== expectedChartVersion) throw new Error('Chart changed. Reload before saving');
      return { installed: prepared.installed, chart: prepared.chart, commit: async () => {
        await charts.save(entry.id, musicXml);
        context.chartPreviews?.set(entry.id, { song: prepared.installed.song, defaultVoiceEffects: prepared.installed.defaultVoiceEffects, packageDigest: prepared.packageDigest });
      } };
    });
  }
  snapshot() { return this.view; }
  subscribe(listener: (value: DeskPublication) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(value: DeskPublication) { for (const listener of this.listeners) listener(value); }
  private update(audio: DeskView['audio']) {
    this.view = { ...this.view, revision: revision((BigInt(this.view.revision) + 1n).toString()), audio };
    this.configurationRevision = BigInt(this.view.revision);
    this.publish({ type: 'desk', view: this.view });
  }
  setAudio(goal: AudioGoal): AudioDecision {
    if (this.closing) return { outcome: 'rejected', error: 'Desk is shutting down', view: this.view };
    if (goal === 'off') {
      if (this.attempt) this.stop(this.attempt);
      else if (this.view.audio.kind === 'fault') this.update({ kind: 'off' });
    } else {
      if (this.configuration.kind !== 'idle') return { outcome: 'rejected', error: 'Wait for song configuration to finish before enabling audio', view: this.view };
      if (this.view.audio.kind === 'stopping') return { outcome: 'rejected', error: 'Audio is stopping', view: this.view };
      if (!this.attempt) this.start();
    }
    return { outcome: 'accepted', view: this.view };
  }
  private stop(attempt: Attempt) {
    attempt.finish = 'off';
    if (this.view.audio.kind !== 'stopping') this.update({ kind: 'stopping', attempt: attempt.id });
    attempt.abort.abort();
  }
  private failAttempt(attempt: Attempt, message: string) {
    if (this.attempt !== attempt || attempt.abort.signal.aborted) return;
    this.update({ kind: 'stopping', attempt: attempt.id, error: diagnosticMessage(attempt, message) });
    attempt.abort.abort(new Error(message));
  }
  private observe(attempt: Attempt, value: Observation) {
    if (this.attempt !== attempt || this.view.audio.kind !== 'ready' || attempt.abort.signal.aborted) return;
    if (value.type === 'gap') {
      const reason = typeof value.dropped === 'string' ? `Native observer lost ${value.dropped} event(s)`
        : typeof value.reason === 'string' ? value.reason : 'Native observer disconnected';
      this.failAttempt(attempt, reason);
      return;
    }
    if (value.type === 'event') {
      const native = nativeEvent(value.event);
      const oldChart = attempt.chartRunFloor !== undefined && nativeRunNumber(native.runId) < attempt.chartRunFloor;
      const event = oldChart ? native : { ...native, state: { ...native.state, chart: this.eventChart } };
      if (event.type === 'control' && event.control?.id === 'mushroom' && event.applied && event.physicalPanic) {
        this.publish({ type: 'event', attempt: attempt.id, event });
        this.stop(attempt);
      } else if (!oldChart && this.configuration.kind === 'idle') this.publish({ type: 'event', attempt: attempt.id, event });
      return;
    }
    if (this.configuration.kind !== 'idle') return;
    const next = performance(value);
    if (next.hostEpoch !== this.view.audio.performance.hostEpoch) { this.failAttempt(attempt, 'Native identity changed'); return; }
    this.view = { ...this.view, revision: revision((BigInt(this.view.revision) + 1n).toString()), audio: { kind: 'ready', attempt: attempt.id, performance: next } };
    this.publish({ type: 'native', serverEpoch: this.view.serverEpoch, revision: this.view.revision, attempt: attempt.id, performance: next });
  }
  private start() {
    const attempt: Attempt = { id: Schema.decodeUnknownSync(AttemptSchema)(randomUUID()), abort: new AbortController(), done: Promise.resolve(), finish: 'fault', stderr: Buffer.alloc(0), child: { kind: 'not-requested' } };
    this.attempt = attempt;
    this.update({ kind: 'starting', attempt: attempt.id });
    attempt.done = Effect.runPromise(this.runAttempt(attempt).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: attempt.abort.signal })
      .then(() => this.finished(attempt, 'Native host exited'), error => this.finished(attempt, errorText(error)));
  }
  private async finished(attempt: Attempt, error: string) {
    if (this.attempt !== attempt) return;
    if (attempt.child.kind === 'pending') {
      this.update({ kind: 'stopping', attempt: attempt.id, error: 'Native launch ownership is uncertain. Stop the managed service before enabling audio again.' });
      return;
    }
    if (attempt.child.kind === 'known') {
      const running = await Effect.runPromise(attempt.child.handle.isRunning).catch(() => true);
      if (this.attempt !== attempt) return;
      if (running) {
        this.update({ kind: 'stopping', attempt: attempt.id, error: 'Native cleanup could not confirm exit. Stop the managed service before enabling audio again.' });
        return;
      }
    }
    if (attempt.child.kind === 'known' && attempt.readyTarget) {
      this.retirements.set(JSON.stringify([attempt.readyTarget.attempt, attempt.readyTarget.hostEpoch]), {
        kind: 'old-engine-ended', target: attempt.readyTarget, serverEpoch: this.view.serverEpoch,
        retirementDeskRevision: revision((BigInt(this.view.revision) + 1n).toString()),
      });
      if (this.retirements.size > MAX_RETIRED_TARGETS) this.retirements.delete(this.retirements.keys().next().value!);
    }
    this.attempt = undefined;
    this.update(attempt.finish === 'off' ? { kind: 'off' } : { kind: 'fault', error: diagnosticMessage(attempt, attempt.abort.signal.aborted ? errorText(attempt.abort.signal.reason) : error) });
  }
  private readonly runAttempt = Effect.fn('PersistentDesk.runAttempt')(function*(this: PersistentDesk, attempt: Attempt) {
    const root = this.profile.runtimeRoot;
    yield* Effect.tryPromise(async () => {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const info = await stat(root);
      if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || !info.isDirectory()) throw new Error('Runtime root must be caller-owned and private');
    });
    const directory = yield* Effect.acquireRelease(
      Effect.tryPromise(() => mkdtemp(join(root, 'audio-'))),
      directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    );
    yield* Effect.tryPromise(() => chmod(directory, 0o700));
    const socket = join(directory, 'host.sock');
    const native = this.profile.native;
    const driver = native.driver;
    if (driver.kind === 'alsa' && driver.requireInactiveUserService) yield* requireLegacyMonitorInactive(driver.requireInactiveUserService);
    const args = [socket, String(native.sampleRate), String(native.blockFrames), String(native.maxVoices), String(native.maxSeconds),
      ...(driver.kind === 'fake' ? [String(driver.inputLevel), '--idle-monitor'] : [`hw:CARD=${driver.identity.alsaCardId},DEV=${driver.identity.pcmDevice}`, `hw:CARD=${driver.identity.alsaCardId},DEV=${driver.identity.pcmDevice}`, String(driver.captureChannels), String(driver.inputChannel), String(driver.periodFrames), String(driver.bufferFrames), driver.format,
        '--usb-identity', driver.identity.byId, driver.identity.usbSerial, driver.identity.usbVendor, driver.identity.usbProduct, driver.identity.alsaCardId, String(driver.identity.pcmDevice), driver.identity.monitorOff, '--idle-monitor']),
      '--owner-pid', String(process.pid), ...(this.profile.recordingArchiveRoot
        ? ['--demo-archive', this.profile.recordingArchiveRoot] : ['--demo-output', this.demoPath]),
      ...(this.profile.recordingArchiveReserveBytes === undefined ? []
        : ['--demo-archive-reserve', String(this.profile.recordingArchiveReserveBytes)])];
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    attempt.child = { kind: 'pending' };
    const child = yield* spawner.spawn(ChildProcess.make(native.executable, args, { shell: false, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', killSignal: 'SIGTERM', forceKillAfter: 1000 }));
    attempt.child = { kind: 'known', handle: child };
    const diagnostics = yield* child.stderr.pipe(
      Stream.runForEach(chunk => Effect.sync(() => {
        attempt.stderr = Buffer.from(Buffer.concat([attempt.stderr, chunk]).subarray(-8192));
      })),
      Effect.ignore,
      Effect.forkScoped,
    );
    const initialize = Effect.tryPromise({ try: async signal => {
      await prepareInstalledPackage(socket, this.installed, signal);
      signal.throwIfAborted();
      const instrument = new NativeInstrument(socket, { disconnected: () => this.failAttempt(attempt, 'Native host disconnected') });
      attempt.instrument = instrument;
      const timer = setTimeout(() => this.failAttempt(attempt, 'Native readback timed out'), 5000);
      try {
        for (;;) {
          signal.throwIfAborted();
          const snapshot = instrument.snapshot();
          if (snapshot) {
            const next = performance(snapshot);
            if (next.state.phase !== 'idle' || JSON.stringify(Schema.decodeUnknownSync(SongSchema)(snapshot.song)) !== JSON.stringify(this.view.song)) throw new Error('Native stopped package readback mismatch');
            if (this.attempt !== attempt || attempt.abort.signal.aborted) throw new Error('Stale audio attempt');
            instrument.subscribe(value => this.observe(attempt, value));
            this.update({ kind: 'ready', attempt: attempt.id, performance: next });
            attempt.readyTarget = { attempt: attempt.id, hostEpoch: next.hostEpoch };
            break;
          }
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
      } finally { clearTimeout(timer); }
    }, catch: error => error });
    yield* Effect.addFinalizer(() => Effect.sync(() => attempt.instrument?.close()));
    yield* Effect.raceFirst(
      initialize.pipe(Effect.andThen(Effect.never)),
      Effect.gen(function*() {
        const exited = yield* Effect.exit(child.exitCode);
        yield* Fiber.await(diagnostics).pipe(Effect.timeout('250 millis'), Effect.ignore);
        return yield* Effect.fail(new Error(exited._tag === 'Success' ? `Native host exited (${exited.value})` : 'Native host exited unexpectedly'));
      }),
    );
  });
  async openDemo() {
    return this.recordingArchive ? this.recordingArchive.latest() : openDemoFile(this.demoPath);
  }
  async takeAudio(target: NativeTarget, request: import('../performance/take-audio.js').TakeAudioRequest) {
    const attempt = this.attempt, audio = this.view.audio;
    if (!attempt?.instrument || attempt.abort.signal.aborted || audio.kind !== 'ready' || target.attempt !== attempt.id || target.hostEpoch !== audio.performance.hostEpoch)
      throw new Error('Native target is unavailable or stale');
    if (this.configuration.kind !== 'idle') throw new Error('Wait for song selection to finish before downloading');
    const bytes = await attempt.instrument.takeAudio(request);
    if (this.attempt !== attempt || this.view.audio.kind !== 'ready' || attempt.abort.signal.aborted) throw new Error('Native target changed during download');
    return bytes;
  }
  async command(target: NativeTarget, input: unknown): Promise<NativeOutcome> {
    const attempt = this.attempt;
    const audio = this.view.audio;
    if (!attempt?.instrument || attempt.abort.signal.aborted || audio.kind !== 'ready' || target.attempt !== attempt.id || target.hostEpoch !== audio.performance.hostEpoch) return { outcome: 'rejected', error: 'Native target is unavailable or stale' };
    if (this.configuration.kind !== 'idle' && typeof input === 'object' && input !== null && 'command' in input
      && input.command !== 'inputRevoke' && input.command !== 'inputEvent' && !isPriorityCommand(input, audio.performance.state))
      return { outcome: 'rejected', error: 'Wait for song selection to finish before sending this command' };
    try {
      const result = outcome(await attempt.instrument.command(input));
      if (this.attempt !== attempt || this.view.audio.kind !== 'ready' || attempt.abort.signal.aborted) return { outcome: 'unknown' };
      return result;
    } catch { return { outcome: 'unknown' }; }
  }
  async close() {
    this.closing = true;
    if (this.configuration.kind === 'preparing') await this.configuration.done;
    await this.publishingChart?.catch(() => {});
    const attempt = this.attempt;
    if (attempt) { this.stop(attempt); await attempt.done; if (this.attempt) throw new Error('Native cleanup did not confirm exit'); }
    await rm(this.demoPath, { force: true });
    this.listeners.clear();
  }
}
