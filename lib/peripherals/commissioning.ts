import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Schema } from 'effect';
import { PHYSICAL_SWITCH_IDS } from '../performance/model.js';
import { boundedLines, decodePeripheralBridgeConfig, decodePeripheralInputMap, type PeripheralBridgeConfig, type PeripheralInputMap } from './bridge.js';

const integer = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const control = Schema.Literals(PHYSICAL_SWITCH_IDS);
const absolute = Schema.NonEmptyString.check(Schema.isPattern(/^\//));
const codes = Schema.Array(integer(0, 65535)).check(Schema.isMaxLength(1024), Schema.makeFilter(values => values.every((value, index) => index === 0 || value > values[index - 1]) || 'Capabilities must be sorted and unique'));
const SourceSchema = Schema.Struct({ type: Schema.Literal('source'), device: absolute, canonical: absolute,
  interfaceNumber: integer(0, 255), eventClock: Schema.Literal('CLOCK_MONOTONIC'), eventTypes: codes, keyCodes: codes, relativeAxes: codes });
const KeySchema = Schema.Struct({ type: Schema.Literal('key'), device: absolute, code: integer(0, 65535), value: integer(0, 2) });
const TagSchema = Schema.Struct({ type: Schema.String });
const ReadySchema = Schema.Struct({ type: Schema.Literal('ready'), schemaVersion: Schema.Literal(2), trialId: Schema.String,
  controlId: control, nonce: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)) });
const ArmedSchema = Schema.Struct({ ...ReadySchema.fields, type: Schema.Literal('armed') });
const decodeArmed = Schema.decodeUnknownSync(ArmedSchema);
const TerminalSchema = Schema.Struct({ type: Schema.Literal('terminal'), schemaVersion: Schema.Literal(2), trialId: Schema.String,
  controlId: control, complete: Schema.Boolean, inputsClosed: Schema.Boolean, requiresSuccessfulExit: Schema.Literal(true),
  error: Schema.NullOr(Schema.String), keySignatures: Schema.Array(Schema.Struct({ device: absolute, code: integer(0, 65535),
    presses: integer(0, 32768), releases: integer(0, 32768), repeats: integer(0, 32768) })) });
const decodeSource = Schema.decodeUnknownSync(SourceSchema);
const decodeKey = Schema.decodeUnknownSync(KeySchema);
const decodeTag = Schema.decodeUnknownSync(TagSchema);
const decodeReady = Schema.decodeUnknownSync(ReadySchema);
const decodeTerminal = Schema.decodeUnknownSync(TerminalSchema);
export type PhysicalControlId = typeof control.Type;
export type ObservedSource = Omit<typeof SourceSchema.Type, 'type' | 'device' | 'canonical' | 'eventClock'>;
export interface CapturedSwitch { readonly controlId: PhysicalControlId; readonly source: ObservedSource; readonly type: 1; readonly code: number; readonly evidencePath: string }
export interface CapturedAxis { readonly source: ObservedSource; readonly type: 2; readonly code: number; readonly evidencePath: string }
export interface LedAssignment { readonly controlId: PhysicalControlId; readonly sdkChannel: number }
export type PeripheralBaseProfile = Omit<PeripheralBridgeConfig, 'inputMap'>;
export interface CommissioningService { inspect(): Promise<{ readonly active: boolean }>; stop(): Promise<void>; start(): Promise<void> }
export interface CommissioningIo { question(prompt: string): Promise<string>; write(message: string): void }
export class CommissioningSaveUncertain extends Error {}

async function configurationDirectory(path: string) {
  if (resolve(path) !== path) throw new Error('Peripheral profile path must be canonical and absolute.');
  const parent = dirname(path);
  if (await realpath(parent) !== parent) throw new Error('Peripheral configuration directory must be canonical.');
  const info = await lstat(parent);
  if (!info.isDirectory() || (info.mode & 0o022) || (process.getuid && info.uid !== process.getuid()))
    throw new Error('Peripheral configuration directory must be caller-owned and not writable by other users.');
  return parent;
}

async function withCommissioningLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await configurationDirectory(path);
  const name = path + '.commissioning.lock';
  let lock;
  try { lock = await open(name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      throw new Error(`Commissioning is already active or left a lock at ${name}. Close the other setup terminal; inspect a leftover lock before removing it.`);
    throw error;
  }
  const identity = await lock.stat();
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }) + '\n');
    return await operation();
  } finally {
    await lock.close();
    const current = await lstat(name);
    if (current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('Commissioning lock changed; refusing to remove it.');
    await unlink(name);
  }
}

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
    const bytes = await file.readFile();
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
  const matching = sources.filter(source => source.device === signature.device);
  if (matching.length !== 1) throw new Error('Captured switch has no unique observed source capabilities.');
  const source = matching[0];
  if (!source.eventTypes.includes(1) || !source.keyCodes.includes(signature.code)) throw new Error('Captured key is absent from its source capabilities.');
  return { controlId, source: { interfaceNumber: source.interfaceNumber, eventTypes: source.eventTypes, keyCodes: source.keyCodes,
    relativeAxes: source.relativeAxes }, type: 1, code: signature.code, evidencePath };
}

export function assembleInstallationMap({ switches, leds, axis, confirmWiring }: {
  switches: readonly CapturedSwitch[]; leds: readonly LedAssignment[]; axis?: CapturedAxis; confirmWiring: boolean;
}): PeripheralInputMap {
  const sources: Array<{ kind: 'linux'; id: string } & ObservedSource> = [];
  const identify = (source: ObservedSource) => {
    const key = JSON.stringify([source.interfaceNumber, source.eventTypes, source.keyCodes, source.relativeAxes]);
    const index = sources.findIndex(value => JSON.stringify([value.interfaceNumber, value.eventTypes, value.keyCodes, value.relativeAxes]) === key);
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
  child.stderr.on('data', chunk => { diagnostics += chunk.toString(); if (diagnostics.length > 8192) child.kill('SIGTERM'); });
  child.stdout.resume();
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Cannot publish ${operation} marker: ${diagnostics.slice(0, 1000)}`)));
  });
}

export async function captureSwitch({ controlId, observerPath, publisherPath, stagingRoot, onArmed, signal,
  python = '/usr/bin/python3', timeoutMs = 160000 }: {
  controlId: PhysicalControlId; observerPath: string; publisherPath: string; stagingRoot: string;
  onArmed(control: PhysicalControlId): void; signal?: AbortSignal; python?: string; timeoutMs?: number;
}): Promise<CapturedSwitch> {
  const trialId = `setup-${controlId}-${randomUUID()}`;
  const directory = join(stagingRoot, trialId);
  await mkdir(directory, { mode: 0o700 });
  const evidencePath = join(directory, 'trial.ndjson');
  const abort = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
  abort.throwIfAborted();
  const child = spawn(python, ['-I', '-B', observerPath, '--directory', directory, '--trial', trialId, '--control-id', controlId],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let ended = false, armed = false, stopped = false, readyNonce: string | undefined, terminal: unknown;
  let diagnostics = '';
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => { ended = true; resolve(code); });
  });
  const stop = () => { child.kill('SIGTERM'); };
  abort.addEventListener('abort', stop, { once: true });
  child.stderr.on('data', chunk => { diagnostics += chunk.toString(); if (diagnostics.length > 16384) child.kill('SIGTERM'); });
  try {
    const output = (async () => {
      for await (const line of boundedLines(child.stdout, 8192)) {
        const value: unknown = JSON.parse(line);
        const tag = decodeTag(value).type;
        if (tag === 'ready') {
          if (readyNonce) throw new Error('Duplicate capture readiness.');
          const ready = decodeReady(value);
          if (ready.trialId !== trialId || ready.controlId !== controlId) throw new Error('Reader readiness does not match this trial.');
          readyNonce = ready.nonce;
          await runMarker({ publisherPath, directory, operation: 'arm', trialId, nonce: readyNonce, python, signal: abort });
        } else if (tag === 'armed') {
          const ready = decodeArmed(value);
          if (armed || ready.trialId !== trialId || ready.controlId !== controlId || ready.nonce !== readyNonce) throw new Error('Reader ARM acknowledgement differs.');
          armed = true; onArmed(controlId);
        } else if (tag === 'terminal') terminal = value;
        else throw new Error(`Unexpected reader record: ${tag}.`);
      }
    })();
    const monitor = (async () => {
      while (!ended) {
        abort.throwIfAborted();
        if (armed && !stopped && readyNonce) {
          const evidence = await privateBytes(evidencePath, 524288, true);
          if (threePairs(records(evidence, false))) {
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
    const values = records(await privateBytes(evidencePath, 524288), true);
    const captured = switchFromEvidence({ values, controlId, trialId, evidencePath, exitCode: code });
    const durable = values.findLast(value => decodeTag(value).type === 'terminal');
    if (JSON.stringify(decodeTerminal(terminal)) !== JSON.stringify(decodeTerminal(durable))) throw new Error('Public and durable trial outcomes differ.');
    return captured;
  } finally {
    abort.removeEventListener('abort', stop);
    if (!ended) {
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(force); }
    }
  }
}

export async function profileSnapshot(path: string): Promise<Buffer | null> {
  try { return await privateBytes(path, 16384); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
}

export async function saveCommissionedProfile(path: string, expected: Buffer | null, profile: PeripheralBridgeConfig) {
  const valid = decodePeripheralBridgeConfig(profile);
  const parent = await configurationDirectory(path);
  const current = await profileSnapshot(path);
  if ((expected === null) !== (current === null) || (expected && current && hash(expected) !== hash(current)))
    throw new Error('Peripheral profile changed during commissioning. The previous configuration was preserved; run setup again.');
  const temporary = join(parent, `.peripheral-${randomUUID()}.tmp`);
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let published = false, temporaryPresent = true;
  try {
    await file.writeFile(JSON.stringify(valid, null, 2) + '\n');
    await file.sync();
    await file.close();
    const latest = await profileSnapshot(path);
    if ((expected === null) !== (latest === null) || (expected && latest && hash(expected) !== hash(latest))) throw new Error('Peripheral profile changed before publication.');
    if (expected === null) { await link(temporary, path); published = true; await unlink(temporary); temporaryPresent = false; }
    else { await rename(temporary, path); published = true; temporaryPresent = false; }
    const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
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
  includeAxis: boolean; retainedAxis?: CapturedAxis; startAfterSave?: boolean;
}
export async function commissionHardware(options: HardwareCommissioningOptions) {
  return withCommissioningLock(options.profilePath, () => commissionHardwareUnderLock(options));
}
async function commissionHardwareUnderLock({ profilePath, baseProfile, service, audioOff, io, capture, captureAxis, includeAxis, retainedAxis, startAfterSave = false }: HardwareCommissioningOptions) {
  const expected = await profileSnapshot(profilePath);
  const answer = await io.question(`Switch identities (${PHYSICAL_SWITCH_IDS.join(', ')}). Enter the connected names separated by commas: `);
  const selected = answer.split(',').map(value => value.trim());
  if (selected.length < 2 || selected.length > 6 || new Set(selected).size !== selected.length) throw new Error('Choose two to six distinct connected switch identities.');
  const identities = selected.map(value => Schema.decodeUnknownSync(control)(value));
  const state = await service.inspect();
  await audioOff();
  if (state.active) await service.stop();
  let saved = false, restore = state.active;
  try {
    const captured: CapturedSwitch[] = [];
    for (const identity of identities) {
      await io.question(`Release every control. Press Enter when ready to capture ${identity}. `);
      await audioOff();
      captured.push(await capture(identity));
      io.write(`Captured ${identity}.\n`);
    }
    let axis: CapturedAxis | undefined = retainedAxis;
    if (includeAxis) {
      if (!captureAxis) throw new Error('Dial capture is unavailable in this installation. Install the reviewed motion reader before using setup with the dial.');
      await audioOff();
      await io.question('Leave the dial still. Press Enter when ready for dial capture. ');
      axis = await captureAxis();
    }
    const leds: LedAssignment[] = [];
    for (const identity of identities) {
      const output = (await io.question(`LED output for ${identity} (none, or the board output number 1–96): `)).trim();
      if (output === 'none') continue;
      if (!/^(?:[1-9]|[1-8][0-9]|9[0-6])$/.test(output)) throw new Error('Use none or a physical LED output number from 1 through 96.');
      leds.push({ controlId: identity, sdkChannel: Number(output) - 1 });
    }
    const confirmWiring = leds.length > 0 && (await io.question('Confirm these exact LED connections and polarity are checked (yes/no): ')).trim() === 'yes';
    const inputMap = assembleInstallationMap({ switches: captured, leds, ...(axis ? { axis } : {}), confirmWiring });
    const profile = decodePeripheralBridgeConfig({ ...baseProfile, inputMap });
    await audioOff();
    await saveCommissionedProfile(profilePath, expected, profile);
    saved = true;
    restore = restore || startAfterSave;
    io.write(`Saved ${identities.length} switch identities${axis ? ' and the dial' : ''} to ${profilePath}.\n`);
    return profile;
  } catch (error) {
    if (error instanceof CommissioningSaveUncertain) restore = false;
    throw error;
  } finally {
    if (restore) {
      try { await audioOff(); await service.start(); }
      catch (error) { throw new Error(`${saved ? 'Configuration saved.' : 'Previous configuration preserved.'} The peripheral service was left stopped. Turn audio off, then start show-tools-peripheral.service. ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
}

export interface DialCommissioningOptions {
  profilePath: string; service: CommissioningService; audioOff(): Promise<void>; io: CommissioningIo; captureAxis(): Promise<CapturedAxis>;
}
export async function commissionDial(options: DialCommissioningOptions) {
  return withCommissioningLock(options.profilePath, () => commissionDialUnderLock(options));
}
async function commissionDialUnderLock({ profilePath, service, audioOff, io, captureAxis }: DialCommissioningOptions) {
  const expected = await profileSnapshot(profilePath);
  if (!expected) throw new Error('Capture and save the button map before adding the dial.');
  const original = decodePeripheralBridgeConfig(JSON.parse(expected.toString('utf8')));
  const switches = original.inputMap.switches.map(value => {
    const source = original.inputMap.sources.find(source => source.id === value.sourceId);
    if (!source || source.kind !== 'linux') throw new Error('Dial commissioning requires an explicitly observed Linux installation map.');
    return { controlId: value.controlId, source: { interfaceNumber: source.interfaceNumber, eventTypes: source.eventTypes,
      keyCodes: source.keyCodes, relativeAxes: source.relativeAxes }, type: 1, code: value.code, evidencePath: profilePath } satisfies CapturedSwitch;
  });
  const state = await service.inspect();
  await audioOff();
  if (state.active) await service.stop();
  let saved = false, restore = state.active;
  try {
    await io.question('Leave the dial still. Press Enter when ready to capture signed relative-Y motion. ');
    await audioOff();
    const axis = await captureAxis();
    const inputMap = assembleInstallationMap({ switches, leds: original.inputMap.leds, axis, confirmWiring: original.inputMap.confirmWiring });
    const profile = decodePeripheralBridgeConfig({ ...original, inputMap, bindingRevision: original.bindingRevision + 1 });
    await audioOff();
    await saveCommissionedProfile(profilePath, expected, profile);
    saved = true;
    io.write(`Saved the observed dial source to ${profilePath}. Button and LED assignments are retained.\n`);
    return profile;
  } catch (error) {
    if (error instanceof CommissioningSaveUncertain) restore = false;
    throw error;
  } finally {
    if (restore) {
      try { await audioOff(); await service.start(); }
      catch (error) { throw new Error(`${saved ? 'Configuration saved.' : 'Previous configuration preserved.'} The peripheral service was left stopped. Turn audio off, then start show-tools-peripheral.service. ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
}
