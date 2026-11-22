import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Schema } from 'effect';
import { peripheralConfigurationDirectory, withPeripheralMaintenance } from './maintenance.js';
import { PHYSICAL_SWITCH_IDS } from '../performance/model.js';
import { boundedLines, decodePeripheralBridgeConfig, decodePeripheralInputMap, type PeripheralBridgeConfig, type PeripheralInputMap } from './bridge.js';

const integer = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const control = Schema.Literals(PHYSICAL_SWITCH_IDS);
export const INPUT_ONLY_SWITCH_IDS: readonly PhysicalControlId[] = ['pedal', 'mushroom'];
export const ARCADE_SWITCH_IDS = PHYSICAL_SWITCH_IDS.filter(id => !INPUT_ONLY_SWITCH_IDS.includes(id));
const absolute = Schema.NonEmptyString.check(Schema.isPattern(/^\//));
const codes = Schema.Array(integer(0, 65535)).check(Schema.isMaxLength(1024), Schema.makeFilter(values => values.every((value, index) => index === 0 || value > values[index - 1]) || 'Capabilities must be sorted and unique'));
const SourceSchema = Schema.Struct({ type: Schema.Literal('source'), device: absolute, canonical: absolute,
  interfaceNumber: integer(0, 255), eventClock: Schema.Literal('CLOCK_MONOTONIC'), eventTypes: codes, keyCodes: codes, relativeAxes: codes });
const KeySchema = Schema.Struct({ type: Schema.Literal('key'), device: absolute, code: integer(0, 65535), value: integer(0, 2) });
const TagSchema = Schema.Struct({ type: Schema.String });
const decodeReaderError = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.Literal('error'), message: Schema.String }));
const ReadySchema = Schema.Struct({ type: Schema.Literal('ready'), schemaVersion: Schema.Literal(2), trialId: Schema.String,
  controlId: control, nonce: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)) });
const ArmedSchema = Schema.Struct({ ...ReadySchema.fields, type: Schema.Literal('armed') });
const decodeArmed = Schema.decodeUnknownSync(ArmedSchema);
const TerminalSchema = Schema.Struct({ type: Schema.Literal('terminal'), schemaVersion: Schema.Literal(2), trialId: Schema.String,
  controlId: control, complete: Schema.Boolean, inputsClosed: Schema.Boolean, requiresSuccessfulExit: Schema.Literal(true),
  error: Schema.NullOr(Schema.String), keySignatures: Schema.Array(Schema.Struct({ device: absolute, code: integer(0, 65535),
    presses: integer(0, 32768), releases: integer(0, 32768), repeats: integer(0, 32768) })) });
const direction = Schema.Literals(['clockwise', 'counterclockwise']);
const MotionPhaseSchema = Schema.Struct({ type: Schema.Literals(['ready', 'armed']), schemaVersion: Schema.Literal(1), trialId: Schema.String,
  controlId: Schema.Literal('knob'), operatorDirection: direction, nonce: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)) });
const MotionReadySchema = Schema.Struct({ ...MotionPhaseSchema.fields, type: Schema.Literal('ready'), usbParent: absolute,
  instance: Schema.Tuple([integer(0, Number.MAX_SAFE_INTEGER), integer(0, Number.MAX_SAFE_INTEGER), Schema.String, Schema.String]) });
const MotionSchema = Schema.Struct({ type: Schema.Literal('motion'), device: absolute, eventType: Schema.Literal(2),
  code: integer(0, 65535), value: integer(-2147483648, 2147483647) });
const ObservedAxisSchema = Schema.Struct({ device: absolute, interfaceNumber: integer(0, 255), eventType: Schema.Literal(2),
  code: integer(0, 65535), samples: integer(1, 32768), delta: integer(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  positiveCounts: integer(0, Number.MAX_SAFE_INTEGER), negativeCounts: integer(0, Number.MAX_SAFE_INTEGER) });
const MotionTerminalSchema = Schema.Struct({ type: Schema.Literal('terminal'), schemaVersion: Schema.Literal(1), trialId: Schema.String,
  controlId: Schema.Literal('knob'), operatorDirection: direction, complete: Schema.Boolean, inputsClosed: Schema.Boolean,
  requiresSuccessfulExit: Schema.Literal(true), deviceWrites: Schema.Literal(false), error: Schema.NullOr(Schema.String), observedAxes: Schema.Array(ObservedAxisSchema).check(Schema.isMaxLength(16)) });
const decodeMotionPhase = Schema.decodeUnknownSync(MotionPhaseSchema);
const decodeMotionReady = Schema.decodeUnknownSync(MotionReadySchema);
const decodeMotion = Schema.decodeUnknownSync(MotionSchema);
const decodeMotionTerminal = Schema.decodeUnknownSync(MotionTerminalSchema);
const decodeSource = Schema.decodeUnknownSync(SourceSchema);
const decodeKey = Schema.decodeUnknownSync(KeySchema);
const decodeTag = Schema.decodeUnknownSync(TagSchema);
const decodeReady = Schema.decodeUnknownSync(ReadySchema);
const decodeTerminal = Schema.decodeUnknownSync(TerminalSchema);
export type PhysicalControlId = typeof control.Type;
export type ObservedSource = Omit<typeof SourceSchema.Type, 'type' | 'device' | 'canonical' | 'eventClock'>;
export interface CapturedSwitch { readonly controlId: PhysicalControlId; readonly source: ObservedSource; readonly type: 1; readonly code: number; readonly evidencePath: string }
export interface CapturedAxis { readonly source: ObservedSource; readonly type: 2; readonly code: number; readonly evidencePath: string }
export type MotionDirection = typeof direction.Type;
export const decodeMotionDirection = Schema.decodeUnknownSync(direction);
export type ObservedMotionAxis = typeof ObservedAxisSchema.Type & { readonly source: ObservedSource };
export interface CapturedMotionAxis extends CapturedAxis { readonly observations: readonly ObservedMotionAxis[]; readonly direction: MotionDirection }
export interface LedAssignment { readonly controlId: PhysicalControlId; readonly sdkChannel: number }
export type PeripheralBaseProfile = Omit<PeripheralBridgeConfig, 'inputMap'>;
export interface CommissioningService { inspect(): Promise<{ readonly active: boolean }>; stop(): Promise<void>; start(): Promise<void> }
export type CommissioningMaintenance = (operation: () => Promise<PeripheralBridgeConfig>) => Promise<PeripheralBridgeConfig>;
export interface CommissioningIo { question(prompt: string): Promise<string>; write(message: string): void }
export class CommissioningSaveUncertain extends Error {}

function hash(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function owner(info: Stats) {
  if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid()))
    throw new Error('Commissioning files must be caller-owned single-link regular files with mode 0600.');
}
async function privateBytes(path: string, maximum: number, live = false) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat(); owner(before);
    if (before.size > maximum) throw new Error('Commissioning evidence exceeds its size limit.');
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    for (;;) {
      const read = await file.read(buffer, length, buffer.length - length, null);
      length += read.bytesRead;
      if (length > maximum) throw new Error('Commissioning evidence exceeds its size limit.');
      if (!read.bytesRead) break;
    }
    const bytes = buffer.subarray(0, length);
    const after = await file.stat();
    if (bytes.length > maximum || before.ino !== after.ino || (!live && (before.size !== after.size || before.mtimeMs !== after.mtimeMs)))
      throw new Error('Commissioning file changed while being read.');
    return bytes;
  } finally { await file.close(); }
}
function records(bytes: Buffer, complete: boolean): unknown[] {
  const lines = bytes.toString('utf8').split('\n');
  if (!complete) lines.pop();
  else if (lines.pop() !== '') throw new Error('Trial evidence ends in a partial record.');
  if (lines.length > 4096) throw new Error('Trial evidence exceeds the record limit.');
  return lines.filter(Boolean).map(line => JSON.parse(line));
}
function threePairs(values: readonly unknown[]) {
  const keys = values.filter(value => decodeTag(value).type === 'key').map(value => decodeKey(value));
  const signatures = new Set(keys.map(value => JSON.stringify([value.device, value.code])));
  if (signatures.size !== 1) return false;
  let held = false, presses = 0, releases = 0;
  for (const key of keys) {
    if (key.value === 2) { if (!held) return false; continue; }
    if (key.value === 1) { if (held) return false; held = true; presses++; }
    else { if (!held) return false; held = false; releases++; }
  }
  return !held && presses === 3 && releases === 3;
}

function sourceSignature(source: ObservedSource) { return JSON.stringify([source.interfaceNumber, source.eventTypes, source.keyCodes, source.relativeAxes]); }
function requireUniqueSelector(sources: readonly ObservedSource[], selected: ObservedSource) {
  if (sources.filter(source => sourceSignature(source) === sourceSignature(selected)).length !== 1)
    throw new Error('The observed interface and capabilities do not select one input source. Correct the board interface configuration before saving its map.');
}

export function switchFromEvidence({ values, controlId, trialId, evidencePath, exitCode }: {
  values: readonly unknown[]; controlId: PhysicalControlId; trialId: string; evidencePath: string; exitCode: number | null;
}): CapturedSwitch {
  const sources = values.filter(value => decodeTag(value).type === 'source').map(value => decodeSource(value));
  const terminals = values.filter(value => decodeTag(value).type === 'terminal').map(value => decodeTerminal(value));
  if (terminals.length !== 1) throw new Error('Need exactly one durable terminal trial record.');
  const terminal = terminals[0];
  if (exitCode !== 0 || terminal.trialId !== trialId || terminal.controlId !== controlId || !terminal.complete || !terminal.inputsClosed || terminal.error !== null)
    throw new Error(`Button capture did not complete: ${terminal.error ?? 'reader did not confirm closed inputs and successful exit'}. Release every control and run setup again.`);
  const signature = terminal.keySignatures[0];
  if (terminal.keySignatures.length !== 1 || !signature || signature.presses !== 3 || signature.releases !== 3 || !threePairs(values))
    throw new Error('Need exactly three fresh press/release pairs from one unambiguous switch.');
  const keys = values.filter(value => decodeTag(value).type === 'key').map(value => decodeKey(value));
  if (keys.some(key => key.device !== signature.device || key.code !== signature.code)
    || keys.filter(key => key.value === 2).length !== signature.repeats)
    throw new Error('Terminal switch signature contradicts the recorded key events.');
  const matching = sources.filter(source => source.device === signature.device);
  if (matching.length !== 1) throw new Error('Captured switch has no unique observed source capabilities.');
  const source = matching[0];
  requireUniqueSelector(sources, source);
  if (!source.eventTypes.includes(1) || !source.keyCodes.includes(signature.code)) throw new Error('Captured key is absent from its source capabilities.');
  return { controlId, source: { interfaceNumber: source.interfaceNumber, eventTypes: source.eventTypes, keyCodes: source.keyCodes,
    relativeAxes: source.relativeAxes }, type: 1, code: signature.code, evidencePath };
}

export function assembleInstallationMap({ switches, leds, axis, confirmWiring }: {
  switches: readonly CapturedSwitch[]; leds: readonly LedAssignment[]; axis?: CapturedAxis; confirmWiring: boolean;
}): PeripheralInputMap {
  const sources: Array<{ kind: 'linux'; id: string } & ObservedSource> = [];
  const identify = (source: ObservedSource) => {
    const key = sourceSignature(source);
    const index = sources.findIndex(value => sourceSignature(value) === key);
    if (index >= 0) return sources[index].id;
    const id = `source-${sources.length + 1}`;
    sources.push({ kind: 'linux', id, ...source });
    return id;
  };
  if (!switches.length || switches.length > 6) throw new Error('Choose between one and six observed switches.');
  const controls = new Set(switches.map(value => value.controlId));
  if (leds.some(value => !controls.has(value.controlId))) throw new Error('LEDs can only be assigned to configured switches.');
  const mappedSwitches = switches.map(value => ({ controlId: value.controlId, sourceId: identify(value.source), type: value.type, code: value.code }));
  const mappedAxis = axis ? { sourceId: identify(axis.source), type: axis.type, code: axis.code } : undefined;
  return decodePeripheralInputMap({ sources, switches: mappedSwitches, ...(mappedAxis ? { axis: mappedAxis } : {}), leds, confirmWiring });
}

async function runMarker({ publisherPath, directory, operation, trialId, nonce, python, signal }: {
  publisherPath: string; directory: string; operation: 'arm' | 'stop'; trialId: string; nonce: string; python: string; signal?: AbortSignal;
}) {
  const child = spawn(python, ['-I', '-B', publisherPath, '--directory', directory, '--op', operation, '--trial', trialId, '--nonce', nonce],
    { stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]) });
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(0, 8192); if (diagnostics.length === 8192) child.kill('SIGTERM'); });
  child.stdout.resume();
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Cannot publish ${operation} marker: ${diagnostics.slice(0, 1000)}`)));
  });
}

interface ForegroundTrialOptions {
  readerPath: string; publisherPath: string; stagingRoot: string; trialPrefix: string; readerArgs: readonly string[];
  onArmed(): void; phase(value: unknown, type: 'ready' | 'armed'): { readonly trialId: string; readonly nonce: string };
  stopWhen?: (values: readonly unknown[]) => boolean; signal?: AbortSignal; python?: string; timeoutMs?: number;
}
async function foregroundTrial({ readerPath, publisherPath, stagingRoot, trialPrefix, readerArgs, onArmed, phase, stopWhen, signal,
  python = '/usr/bin/python3', timeoutMs = 160000 }: ForegroundTrialOptions) {
  const trialId = `${trialPrefix}-${randomUUID()}`;
  const directory = join(stagingRoot, trialId);
  await mkdir(directory, { mode: 0o700 });
  const evidencePath = join(directory, 'trial.ndjson');
  const abort = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
  abort.throwIfAborted();
  const child = spawn(python, ['-I', '-B', readerPath, '--directory', directory, '--trial', trialId, ...readerArgs],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let ended = false, armed = false, stopped = false, readyNonce: string | undefined, readiness: unknown, terminal: unknown;
  let diagnostics = '';
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => { ended = true; resolve(code); });
  });
  const stop = () => { child.kill('SIGTERM'); };
  abort.addEventListener('abort', stop, { once: true });
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(0, 16384); if (diagnostics.length === 16384) child.kill('SIGTERM'); });
  try {
    const output = (async () => {
      for await (const line of boundedLines(child.stdout, 8192)) {
        const value: unknown = JSON.parse(line);
        const tag = decodeTag(value).type;
        if (tag === 'ready') {
          if (readyNonce) throw new Error('Duplicate capture readiness.');
          const ready = phase(value, 'ready');
          if (ready.trialId !== trialId) throw new Error('Reader readiness does not match this trial.');
          readyNonce = ready.nonce;
          readiness = value;
          await runMarker({ publisherPath, directory, operation: 'arm', trialId, nonce: readyNonce, python, signal: abort });
        } else if (tag === 'armed') {
          const ready = phase(value, 'armed');
          if (armed || ready.trialId !== trialId || ready.nonce !== readyNonce) throw new Error('Reader ARM acknowledgement differs.');
          armed = true; onArmed();
        } else if (tag === 'terminal') terminal = value;
        else if (tag === 'error') throw new Error(`Reader failed: ${decodeReaderError(value).message}`);
        else throw new Error(`Unexpected reader record: ${tag}.`);
      }
    })();
    const monitor = (async () => {
      while (!ended) {
        abort.throwIfAborted();
        if (armed && !stopped && readyNonce && stopWhen) {
          const evidence = await privateBytes(evidencePath, 524288, true);
          if (stopWhen(records(evidence, false))) {
            await runMarker({ publisherPath, directory, operation: 'stop', trialId, nonce: readyNonce, python, signal: abort });
            stopped = true;
          }
        }
        await delay(25, undefined, { signal: abort });
      }
    })();
    const [code] = await Promise.all([exited, output, monitor]);
    abort.throwIfAborted();
    if (!terminal) throw new Error(`Reader ended without a terminal record. ${diagnostics.slice(0, 1000)}`);
    if (!armed) throw new Error('Reader ended before acknowledging ARM.');
    const values = records(await privateBytes(evidencePath, 524288), true);
    return { values, terminal, readiness, exitCode: code, trialId, evidencePath };
  } finally {
    abort.removeEventListener('abort', stop);
    if (!ended) {
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(force); }
    }
  }
}


export async function captureSwitch({ controlId, observerPath, publisherPath, stagingRoot, onArmed, signal,
  python = '/usr/bin/python3', timeoutMs = 160000 }: {
  controlId: PhysicalControlId; observerPath: string; publisherPath: string; stagingRoot: string;
  onArmed(control: PhysicalControlId): void; signal?: AbortSignal; python?: string; timeoutMs?: number;
}): Promise<CapturedSwitch> {
  const result = await foregroundTrial({ readerPath: observerPath, publisherPath, stagingRoot, trialPrefix: `setup-${controlId}`,
    readerArgs: ['--control-id', controlId], onArmed: () => onArmed(controlId), stopWhen: threePairs, signal, python, timeoutMs,
    phase: (value, type) => {
      const ready = type === 'ready' ? decodeReady(value) : decodeArmed(value);
      if (ready.controlId !== controlId) throw new Error('Reader identity differs from the named switch.');
      return ready;
    } });
  const captured = switchFromEvidence({ ...result, controlId });
  const durable = result.values.findLast(value => decodeTag(value).type === 'terminal');
  if (JSON.stringify(decodeTerminal(result.terminal)) !== JSON.stringify(decodeTerminal(durable))) throw new Error('Public and durable trial outcomes differ.');
  return captured;
}

export function motionFromEvidence({ values, direction, trialId, exitCode }: {
  values: readonly unknown[]; direction: MotionDirection; trialId: string; exitCode: number | null;
}): readonly ObservedMotionAxis[] {
  const sources = values.filter(value => decodeTag(value).type === 'source').map(value => decodeSource(value));
  const terminals = values.filter(value => decodeTag(value).type === 'terminal').map(value => decodeMotionTerminal(value));
  if (terminals.length !== 1) throw new Error('Need exactly one durable motion terminal record.');
  const terminal = terminals[0];
  if (exitCode !== 0 || terminal.trialId !== trialId || terminal.operatorDirection !== direction || !terminal.complete || !terminal.inputsClosed || terminal.error !== null)
    throw new Error(`Dial capture did not complete: ${terminal.error ?? 'closed inputs and successful exit are unconfirmed'}. Leave all switches released and run dial capture again.`);
  if (!terminal.observedAxes.length) throw new Error('No nonzero relative motion was observed. Turn the dial during the armed capture.');
  const events = values.filter(value => decodeTag(value).type === 'motion').map(value => decodeMotion(value)).filter(value => value.value !== 0);
  const signatures = new Set(events.map(value => JSON.stringify([value.device, value.code])));
  if (signatures.size !== terminal.observedAxes.length) throw new Error('Observed motion signatures differ from the terminal report.');
  const seen = new Set<string>();
  return terminal.observedAxes.map(axis => {
    const signature = JSON.stringify([axis.device, axis.code]);
    if (seen.has(signature)) throw new Error('Duplicate observed motion axis.');
    seen.add(signature);
    const matching = sources.filter(source => source.device === axis.device);
    if (matching.length !== 1) throw new Error('Motion axis has no unique observed source capabilities.');
    const source = matching[0];
    requireUniqueSelector(sources, source);
    if (source.interfaceNumber !== axis.interfaceNumber || !source.eventTypes.includes(2) || !source.relativeAxes.includes(axis.code))
      throw new Error('Motion axis is absent from its declared interface capabilities.');
    const samples = events.filter(value => value.device === axis.device && value.code === axis.code);
    const positive = samples.reduce((sum, sample) => sum + Math.max(0, sample.value), 0);
    const negative = samples.reduce((sum, sample) => sum + Math.max(0, -sample.value), 0);
    if (samples.length !== axis.samples || positive !== axis.positiveCounts || negative !== axis.negativeCounts || positive - negative !== axis.delta)
      throw new Error('Motion sample counts differ from the durable observations.');
    return { ...axis, source: { interfaceNumber: source.interfaceNumber, eventTypes: source.eventTypes,
      keyCodes: source.keyCodes, relativeAxes: source.relativeAxes } };
  });
}

interface MotionCaptureOptions {
  readerPath: string; publisherPath: string; stagingRoot: string; direction: MotionDirection; captureSeconds: number;
  onArmed(direction: MotionDirection, seconds: number): void;
  signal?: AbortSignal; python?: string; timeoutMs?: number;
}
async function observeMotion({ readerPath, publisherPath, stagingRoot, direction, captureSeconds, onArmed,
  signal, python, timeoutMs }: MotionCaptureOptions, mode: 'mapping' | 'diagnostic' = 'mapping') {
  Schema.decodeUnknownSync(integer(1, 30))(captureSeconds);
  const result = await foregroundTrial({ readerPath, publisherPath, stagingRoot, trialPrefix: 'setup-knob',
    readerArgs: ['--direction', direction, '--capture-seconds', String(captureSeconds), ...(mode === 'diagnostic' ? ['--diagnostic-only'] : [])], signal, python, timeoutMs,
    onArmed: () => onArmed(direction, captureSeconds), phase: (value, type) => {
      const phase = type === 'ready' ? decodeMotionReady(value) : decodeMotionPhase(value);
      if (phase.type !== type || phase.operatorDirection !== direction) throw new Error('Motion capture direction or phase differs.');
      return phase;
    } });
  const axes = motionFromEvidence({ ...result, direction });
  const durable = result.values.findLast(value => decodeTag(value).type === 'terminal');
  if (JSON.stringify(decodeMotionTerminal(result.terminal)) !== JSON.stringify(decodeMotionTerminal(durable))) throw new Error('Public and durable motion outcomes differ.');
  const ready = decodeMotionReady(result.readiness);
  const durableReady = result.values.filter(value => decodeTag(value).type === 'ready');
  if (durableReady.length !== 1 || JSON.stringify(ready) !== JSON.stringify(decodeMotionReady(durableReady[0])))
    throw new Error('Public and durable motion attachment records differ.');
  return { axes, attachment: JSON.stringify([ready.usbParent, ...ready.instance]), evidencePath: result.evidencePath,
    outsideWindow: result.values.filter(value => decodeTag(value).type === 'out-of-window-motion').length };
}

export async function captureAxis({ chooseAxis, ...options }: MotionCaptureOptions & {
  chooseAxis?: (axes: readonly ObservedMotionAxis[]) => Promise<number>;
}): Promise<CapturedMotionAxis> {
  const { axes, evidencePath } = await observeMotion(options);
  const selected = axes.length === 1 ? 0 : chooseAxis ? await chooseAxis(axes) : -1;
  if (!Number.isInteger(selected) || selected < 0 || selected >= axes.length)
    throw new Error('Multiple relative axes were observed. Select an explicitly listed axis; no dominant axis or polarity is inferred.');
  const axis = axes[selected];
  return { source: axis.source, type: 2, code: axis.code, evidencePath, observations: axes, direction: options.direction };
}

type DialObservation = Awaited<ReturnType<typeof observeMotion>>;
type DialDirectionsOptions = Omit<MotionCaptureOptions, 'direction' | 'onArmed'> & { io: CommissioningIo };

export function matchingDialAxes(clockwise: Pick<DialObservation, 'attachment' | 'axes'>, counterclockwise: Pick<DialObservation, 'attachment' | 'axes'>) {
  if (clockwise.attachment !== counterclockwise.attachment) throw new Error('USB attachment changed between the two dial captures.');
  const matches = clockwise.axes.flatMap(cw => counterclockwise.axes.filter(ccw => cw.code === ccw.code && cw.device === ccw.device
    && sourceSignature(cw.source) === sourceSignature(ccw.source) && Math.sign(cw.delta) === -Math.sign(ccw.delta) && cw.delta !== 0)
    .map(ccw => ({ axis: cw, counterclockwiseDelta: ccw.delta })));
  if (!matches.length) throw new Error('No common axis reported opposite signed motion.');
  return matches;
}

async function observeDialDirections({ io, ...capture }: DialDirectionsOptions, verifyProfile?: () => Promise<void>, firstDirection: MotionDirection = 'clockwise') {
  const turn = async (direction: MotionDirection) => {
    await io.question(`Leave all buttons released and the dial still. Press Enter to prepare the ${direction} turn. `);
    await verifyProfile?.();
    const observation = await observeMotion({ ...capture, direction,
      onArmed: (direction, seconds) => io.write(`ARMED: turn the dial ${direction} briefly, then let it settle. Capture lasts ${seconds} seconds.\n`) }, 'diagnostic');
    if (observation.outsideWindow) io.write(`Outside the capture window: ${observation.outsideWindow} motion records excluded.\n`);
    io.write(`Capture evidence: ${observation.evidencePath}\n`);
    await verifyProfile?.();
    return observation;
  };
  const first = await turn(firstDirection);
  const second = await turn(firstDirection === 'clockwise' ? 'counterclockwise' : 'clockwise');
  const [clockwise, counterclockwise] = firstDirection === 'clockwise' ? [first, second] : [second, first];
  const matches = matchingDialAxes(clockwise, counterclockwise);
  for (const { axis, counterclockwiseDelta } of matches)
    io.write(`Interface ${axis.interfaceNumber}, relative axis ${axis.code}: clockwise ${axis.delta}, counterclockwise ${counterclockwiseDelta}.\n`);
  return { axes: matches.map(match => match.axis), evidencePath: clockwise.evidencePath };
}

export async function captureVerifiedDial({ chooseAxis, firstDirection, ...options }: DialDirectionsOptions & {
  chooseAxis: (axes: readonly ObservedMotionAxis[]) => Promise<number>;
  firstDirection?: MotionDirection;
}): Promise<CapturedMotionAxis> {
  const { axes, evidencePath } = await observeDialDirections(options, undefined, firstDirection);
  const selected = axes.length === 1 ? 0 : await chooseAxis(axes);
  if (!Number.isInteger(selected) || selected < 0 || selected >= axes.length)
    throw new Error('Choose one of the axes verified in both directions.');
  const axis = axes[selected];
  return { source: axis.source, type: 2, code: axis.code, evidencePath, observations: axes, direction: 'clockwise' };
}

export async function checkDialMotion({ profilePath, ...capture }: Omit<DialDirectionsOptions, 'captureSeconds'> & { profilePath: string }) {
  const original = await profileSnapshot(profilePath);
  if (!original) throw new Error('Capture and save the button map before checking the dial.');
  const profile = decodePeripheralBridgeConfig(JSON.parse(original.toString('utf8')));
  if (profile.inputMap.axis || profile.jiggle !== null) throw new Error('This check requires a profile without a dial mapping and with jiggle disabled.');
  await observeDialDirections({ ...capture, captureSeconds: 5 }, async () => {
    if (!(await profileSnapshot(profilePath))?.equals(original)) throw new Error('Peripheral profile changed during the dial check.');
  });
}

export async function profileSnapshot(path: string): Promise<Buffer | null> {
  try { return await privateBytes(path, 16384); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
}

export async function saveCommissionedProfile(path: string, expected: Buffer | null, profile: PeripheralBridgeConfig, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const valid = decodePeripheralBridgeConfig(profile);
  const encoded = Buffer.from(JSON.stringify(valid, null, 2) + '\n');
  if (encoded.length > 16384) throw new Error('The installation profile exceeds the runtime 16 KiB limit. Reduce the configured source set before saving.');
  const parent = await peripheralConfigurationDirectory(path);
  const current = await profileSnapshot(path);
  if ((expected === null) !== (current === null) || (expected && current && hash(expected) !== hash(current)))
    throw new Error('Peripheral profile changed during commissioning. The previous configuration was preserved; run setup again.');
  const temporary = join(parent, `.peripheral-${randomUUID()}.tmp`);
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let published = false, temporaryPresent = true;
  try {
    await file.writeFile(encoded);
    await file.sync();
    await file.close();
    const latest = await profileSnapshot(path);
    if ((expected === null) !== (latest === null) || (expected && latest && hash(expected) !== hash(latest))) throw new Error('Peripheral profile changed before publication.');
    signal?.throwIfAborted();
    if (expected === null) { await link(temporary, path); published = true; await unlink(temporary); temporaryPresent = false; }
    else { await rename(temporary, path); published = true; temporaryPresent = false; }
    const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
    if (!(await profileSnapshot(path))?.equals(encoded)) throw new Error('Saved profile differs from the commissioned bytes.');
    return valid;
  } catch (error) {
    if (published) throw new CommissioningSaveUncertain(`Profile publication at ${path} needs inspection before restarting the service. ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    await file.close().catch(() => {});
    if (temporaryPresent) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export interface HardwareCommissioningOptions {
  profilePath: string; baseProfile: PeripheralBaseProfile; service: CommissioningService; audioOff(): Promise<void>; io: CommissioningIo;
  capture(control: PhysicalControlId): Promise<CapturedSwitch>; captureAxis?: () => Promise<CapturedAxis>;
  includeAxis: boolean; retainedAxis?: CapturedAxis; startAfterSave?: boolean; signal?: AbortSignal; maintenance?: CommissioningMaintenance;
}
export async function commissionHardware(options: HardwareCommissioningOptions) {
  return withPeripheralMaintenance(options.profilePath, () => options.maintenance ? options.maintenance(() => commissionHardwareUnderLock(options)) : commissionHardwareUnderLock(options));
}
async function commissionHardwareUnderLock({ profilePath, baseProfile, service, audioOff, io, capture, captureAxis, includeAxis, retainedAxis, startAfterSave = false, signal }: HardwareCommissioningOptions) {
  signal?.throwIfAborted();
  const expected = await profileSnapshot(profilePath);
  signal?.throwIfAborted();
  const answer = await io.question(`Press Enter to capture all six switches (${PHYSICAL_SWITCH_IDS.join(', ')}), or enter two to six connected names separated by commas: `);
  signal?.throwIfAborted();
  const selected = answer.trim() ? answer.split(',').map(value => value.trim()) : PHYSICAL_SWITCH_IDS;
  if (selected.length < 2 || selected.length > 6 || new Set(selected).size !== selected.length) throw new Error('Choose two to six distinct connected switch identities.');
  const identities = selected.map(value => Schema.decodeUnknownSync(control)(value));
  signal?.throwIfAborted();
  const state = await service.inspect();
  signal?.throwIfAborted();
  await audioOff();
  signal?.throwIfAborted();
  if (state.active) await service.stop();
  let saved = false, restore = state.active;
  try {
    signal?.throwIfAborted();
    const captured: CapturedSwitch[] = [];
    for (const identity of identities) {
      await io.question(`Release every control. Press Enter when ready to capture ${identity}. `);
      signal?.throwIfAborted();
      await audioOff();
      signal?.throwIfAborted();
      captured.push(await capture(identity));
      signal?.throwIfAborted();
      io.write(`Captured ${identity}.\n`);
    }
    let axis: CapturedAxis | undefined = retainedAxis;
    if (includeAxis) {
      if (!captureAxis) throw new Error('Dial capture is unavailable in this installation. Install the reviewed motion reader before using setup with the dial.');
      await audioOff();
      signal?.throwIfAborted();
      axis = await captureAxis();
      signal?.throwIfAborted();
    }
    const leds: LedAssignment[] = [];
    for (const identity of identities) {
      signal?.throwIfAborted();
      if (INPUT_ONLY_SWITCH_IDS.includes(identity)) continue;
      const output = (await io.question(`LED output for ${identity} (none, or the board output number 1–96): `)).trim();
      signal?.throwIfAborted();
      if (output === 'none') continue;
      if (!/^(?:[1-9]|[1-8][0-9]|9[0-6])$/.test(output)) throw new Error('Use none or a physical LED output number from 1 through 96.');
      leds.push({ controlId: identity, sdkChannel: Number(output) - 1 });
    }
    const confirmWiring = leds.length > 0 && (await io.question('Confirm these exact LED connections and polarity are checked (yes/no): ')).trim() === 'yes';
    signal?.throwIfAborted();
    const inputMap = assembleInstallationMap({ switches: captured, leds, ...(axis ? { axis } : {}), confirmWiring });
    const profile = decodePeripheralBridgeConfig({ ...baseProfile, inputMap });
    await audioOff();
    signal?.throwIfAborted();
    await saveCommissionedProfile(profilePath, expected, profile, signal);
    saved = true;
    if (signal?.aborted) throw new Error('Configuration saved. Commissioning was cancelled after publication; the peripheral service is left stopped.');
    restore = restore || startAfterSave;
    io.write(`Saved ${identities.length} switch identities${axis ? ' and the dial' : ''} to ${profilePath}.\n`);
    io.write(`Replaced and verified the physical map at revision ${profile.bindingRevision}.\n`);
    return profile;
  } catch (error) {
    if (error instanceof CommissioningSaveUncertain || signal?.aborted) restore = false;
    throw error;
  } finally {
    if (restore) {
      try {
        signal?.throwIfAborted();
        await audioOff();
        signal?.throwIfAborted();
        await service.start();
      }
      catch (error) { throw new Error(`${saved ? 'Configuration saved.' : 'Previous configuration preserved.'} The peripheral service was left stopped. Turn audio off, then start show-tools-peripheral.service. ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
}

export interface DialCommissioningOptions {
  profilePath: string; service: CommissioningService; audioOff(): Promise<void>; io: CommissioningIo; captureAxis(): Promise<CapturedAxis>;
  jiggle?: PeripheralBridgeConfig['jiggle']; signal?: AbortSignal; maintenance?: CommissioningMaintenance;
}
export async function commissionDial(options: DialCommissioningOptions) {
  return withPeripheralMaintenance(options.profilePath, () => options.maintenance ? options.maintenance(() => commissionDialUnderLock(options)) : commissionDialUnderLock(options));
}
async function commissionDialUnderLock({ profilePath, service, audioOff, io, captureAxis, jiggle, signal }: DialCommissioningOptions) {
  signal?.throwIfAborted();
  const expected = await profileSnapshot(profilePath);
  signal?.throwIfAborted();
  if (!expected) throw new Error('Capture and save the button map before adding the dial.');
  const original = decodePeripheralBridgeConfig(JSON.parse(expected.toString('utf8')));
  const switches = original.inputMap.switches.map(value => {
    const source = original.inputMap.sources.find(source => source.id === value.sourceId);
    if (!source || source.kind !== 'linux') throw new Error('Dial commissioning requires an explicitly observed Linux installation map.');
    return { controlId: value.controlId, source: { interfaceNumber: source.interfaceNumber, eventTypes: source.eventTypes,
      keyCodes: source.keyCodes, relativeAxes: source.relativeAxes }, type: 1, code: value.code, evidencePath: profilePath } satisfies CapturedSwitch;
  });
  signal?.throwIfAborted();
  const state = await service.inspect();
  signal?.throwIfAborted();
  await audioOff();
  signal?.throwIfAborted();
  if (state.active) await service.stop();
  let saved = false, restore = state.active;
  try {
    signal?.throwIfAborted();
    await io.question('Leave the dial still. Press Enter when ready to capture signed relative-Y motion. ');
    signal?.throwIfAborted();
    await audioOff();
    signal?.throwIfAborted();
    const axis = await captureAxis();
    signal?.throwIfAborted();
    const inputMap = assembleInstallationMap({ switches, leds: original.inputMap.leds, axis, confirmWiring: original.inputMap.confirmWiring });
    const profile = decodePeripheralBridgeConfig({ ...original, inputMap, bindingRevision: original.bindingRevision + 1,
      ...(jiggle !== undefined ? { jiggle } : {}) });
    await audioOff();
    signal?.throwIfAborted();
    await saveCommissionedProfile(profilePath, expected, profile, signal);
    saved = true;
    if (signal?.aborted) throw new Error('Configuration saved. Commissioning was cancelled after publication; the peripheral service is left stopped.');
    io.write(`Saved the observed dial source to ${profilePath}. Button and LED assignments are retained.\n`);
    return profile;
  } catch (error) {
    if (error instanceof CommissioningSaveUncertain || signal?.aborted) restore = false;
    throw error;
  } finally {
    if (restore) {
      try {
        signal?.throwIfAborted();
        await audioOff();
        signal?.throwIfAborted();
        await service.start();
      }
      catch (error) { throw new Error(`${saved ? 'Configuration saved.' : 'Previous configuration preserved.'} The peripheral service was left stopped. Turn audio off, then start show-tools-peripheral.service. ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
}
