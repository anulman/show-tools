import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { NativeInstrument } from './instrument.js';
import type { Observation } from './gateway.js';
import { SongSchema, NativeEventSchema } from './native-schema.js';
import { prepareInstalledPackage, type validateInstalledPackage } from './prepare.js';
import type { SessionProfile } from './session-profile.js';
import { AttemptSchema, DeskRevisionSchema, ServerEpochSchema, NativePerformanceSchema, NativeOutcomeSchema,
  type DeskController, type DeskView, type DeskPublication, type NativeTarget, type AudioGoal, type AudioDecision, type NativeOutcome } from './session-schema.js';

const performance = Schema.decodeUnknownSync(NativePerformanceSchema);
const outcome = Schema.decodeUnknownSync(NativeOutcomeSchema);
const nativeEvent = Schema.decodeUnknownSync(NativeEventSchema);
const revision = Schema.decodeUnknownSync(DeskRevisionSchema);
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Native audio failed').slice(0, 8192);
type InstalledPackage = ReturnType<typeof validateInstalledPackage>;
type Attempt = { id: typeof AttemptSchema.Type; abort: AbortController; done: Promise<void>; finish: 'off' | 'fault'; instrument?: NativeInstrument; child?: ChildProcessSpawner.ChildProcessHandle };

export class PersistentDesk implements DeskController {
  private view: DeskView;
  private readonly listeners = new Set<(value: DeskPublication) => void>();
  private attempt: Attempt | undefined;
  private closing = false;

  constructor(private readonly profile: SessionProfile, private readonly installed: InstalledPackage) {
    this.view = { serverEpoch: Schema.decodeUnknownSync(ServerEpochSchema)(randomUUID()), revision: revision('0'),
      song: Schema.decodeUnknownSync(SongSchema)(installed.song), audio: { kind: 'off' } };
  }
  snapshot() { return this.view; }
  subscribe(listener: (value: DeskPublication) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(value: DeskPublication) { for (const listener of this.listeners) listener(value); }
  private update(audio: DeskView['audio']) {
    this.view = { ...this.view, revision: revision((BigInt(this.view.revision) + 1n).toString()), audio };
    this.publish({ type: 'desk', view: this.view });
  }
  setAudio(goal: AudioGoal): AudioDecision {
    if (this.closing) return { outcome: 'rejected', error: 'Desk is shutting down', view: this.view };
    if (goal === 'off') {
      if (this.attempt) this.stop(this.attempt);
      else if (this.view.audio.kind === 'fault') this.update({ kind: 'off' });
    } else {
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
    this.update({ kind: 'stopping', attempt: attempt.id, error: message });
    attempt.abort.abort(new Error(message));
  }
  private observe(attempt: Attempt, value: Observation) {
    if (this.attempt !== attempt || this.view.audio.kind !== 'ready' || attempt.abort.signal.aborted) return;
    if (value.type === 'gap') { this.failAttempt(attempt, 'Native observer disconnected'); return; }
    if (value.type === 'event') { this.publish({ type: 'event', attempt: attempt.id, event: nativeEvent(value.event) }); return; }
    const next = performance(value);
    if (next.hostEpoch !== this.view.audio.performance.hostEpoch) { this.failAttempt(attempt, 'Native identity changed'); return; }
    this.view = { ...this.view, revision: revision((BigInt(this.view.revision) + 1n).toString()), audio: { kind: 'ready', attempt: attempt.id, performance: next } };
    this.publish({ type: 'native', serverEpoch: this.view.serverEpoch, revision: this.view.revision, attempt: attempt.id, performance: next });
  }
  private start() {
    const attempt: Attempt = { id: Schema.decodeUnknownSync(AttemptSchema)(randomUUID()), abort: new AbortController(), done: Promise.resolve(), finish: 'fault' };
    this.attempt = attempt;
    this.update({ kind: 'starting', attempt: attempt.id });
    attempt.done = Effect.runPromise(this.runAttempt(attempt).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: attempt.abort.signal })
      .then(() => this.finished(attempt, 'Native host exited'), error => this.finished(attempt, errorText(error)));
  }
  private async finished(attempt: Attempt, error: string) {
    if (this.attempt !== attempt) return;
    if (attempt.child) {
      const running = await Effect.runPromise(attempt.child.isRunning).catch(() => true);
      if (running) {
        this.update({ kind: 'stopping', attempt: attempt.id, error: 'Native cleanup could not confirm exit. Stop the managed service before enabling audio again.' });
        return;
      }
    }
    this.attempt = undefined;
    this.update(attempt.finish === 'off' ? { kind: 'off' } : { kind: 'fault', error: attempt.abort.signal.aborted ? errorText(attempt.abort.signal.reason) : error });
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
    const args = [socket, String(native.sampleRate), String(native.blockFrames), String(native.maxVoices), String(native.maxSeconds),
      ...(driver.kind === 'fake' ? [String(driver.inputLevel)] : [driver.captureDevice, driver.playbackDevice, String(driver.captureChannels), String(driver.inputChannel), String(driver.periodFrames), String(driver.bufferFrames), driver.format]),
      '--owner-pid', String(process.pid)];
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(ChildProcess.make(native.executable, args, { shell: false, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', killSignal: 'SIGTERM', forceKillAfter: 1000 }));
    attempt.child = child;
    const initialize = Effect.tryPromise({ try: async signal => {
      for (let index = 0; ; index++) {
        signal.throwIfAborted();
        try { await stat(socket); break; } catch { if (index >= 200) throw new Error('Native socket timed out'); }
        await new Promise<void>(resolve => setTimeout(resolve, 10));
      }
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
            break;
          }
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
      } finally { clearTimeout(timer); }
    }, catch: error => error });
    yield* Effect.addFinalizer(() => Effect.sync(() => attempt.instrument?.close()));
    yield* Effect.raceFirst(
      initialize.pipe(Effect.andThen(Effect.never)),
      child.exitCode.pipe(Effect.flatMap(code => Effect.fail(new Error(`Native host exited (${code})`)))),
    );
  });
  async command(target: NativeTarget, input: unknown): Promise<NativeOutcome> {
    const attempt = this.attempt;
    const audio = this.view.audio;
    if (!attempt?.instrument || attempt.abort.signal.aborted || audio.kind !== 'ready' || target.attempt !== attempt.id || target.hostEpoch !== audio.performance.hostEpoch) return { outcome: 'rejected', error: 'Native target is unavailable or stale' };
    try {
      const result = outcome(await attempt.instrument.command(input));
      if (this.attempt !== attempt || this.view.audio.kind !== 'ready' || attempt.abort.signal.aborted) return { outcome: 'unknown' };
      return result;
    } catch { return { outcome: 'unknown' }; }
  }
  async close() {
    this.closing = true;
    const attempt = this.attempt;
    if (attempt) { this.stop(attempt); await attempt.done; if (this.attempt) throw new Error('Native cleanup did not confirm exit'); }
    this.listeners.clear();
  }
}
