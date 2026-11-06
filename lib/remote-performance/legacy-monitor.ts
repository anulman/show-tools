import { Effect, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

const InactiveMonitorSchema = Schema.Struct({
  LoadState: Schema.Literal('loaded'), ActiveState: Schema.Literal('inactive'),
  SubState: Schema.Literal('dead'), MainPID: Schema.Literal('0'), ControlGroup: Schema.Literal(''),
});
const decodeInactive = Schema.decodeUnknownSync(InactiveMonitorSchema);

export function parseInactiveMonitor(output: string) {
  const lines = output.replace(/\n$/, '').split('\n');
  const entries = lines.map(line => {
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Incomplete legacy monitor status');
    return [line.slice(0, separator), line.slice(separator + 1)];
  });
  if (entries.length !== 5 || new Set(entries.map(([key]) => key)).size !== 5) throw new Error('Incomplete legacy monitor status');
  return decodeInactive(Object.fromEntries(entries));
}

export const requireLegacyMonitorInactive = Effect.fn('requireLegacyMonitorInactive')(function*(unit: 'scarlett-monitor.service') {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make('systemctl', ['--user', 'show', unit,
    '--property=LoadState,ActiveState,SubState,MainPID,ControlGroup'],
  { shell: false, stdin: 'ignore', stderr: 'ignore', stdout: 'pipe', killSignal: 'SIGTERM', forceKillAfter: 1000 }));
  const output = yield* child.stdout.pipe(Stream.decodeText(), Stream.runFoldEffect(() => '', (before, chunk) => {
    const next = before + chunk;
    return Buffer.byteLength(next) <= 4096 ? Effect.succeed(next) : Effect.fail(new Error('Oversized legacy monitor status'));
  }));
  const code = yield* child.exitCode;
  if (code !== 0) return yield* Effect.fail(new Error('Cannot verify legacy monitor inactivity'));
  yield* Effect.try(() => parseInactiveMonitor(output));
}, Effect.timeout('2 seconds'), Effect.mapError(() => new Error('Legacy monitor must be loaded, inactive/dead, with no process or control group before enabling audio. Check scarlett-monitor.service.')));
