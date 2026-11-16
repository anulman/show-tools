import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs, promisify } from 'node:util';
import { decodePeripheralBridgeConfig } from './bridge.js';
import { captureSwitch, commissionDial, commissionHardware, profileSnapshot, type CapturedAxis, type CommissioningIo,
  type CommissioningService, type PeripheralBaseProfile } from './commissioning.js';
import { renderPeripheralUnit } from './service-unit.js';
import { decodeSessionProfile } from '../remote-performance/session-profile.js';
import { createSessionClient } from '../remote-performance/session-client.js';

const UNIT = 'show-tools-peripheral.service';
const exec = promisify(execFile);
export const COMMISSIONING_HELP = `Usage: show-tools peripheral setup --config FILE --session-profile FILE --helper FILE --bench-dir DIRECTORY --runner FILE
       show-tools peripheral setup --dial --config FILE --session-profile FILE --helper FILE --bench-dir DIRECTORY --runner FILE
       show-tools peripheral setup --test --config FILE --runner FILE
       show-tools peripheral setup --status --config FILE --runner FILE

Run setup in a foreground terminal on the EliteDesk. Audio must be off.
Setup captures two to six named buttons and asks for each LED output explicitly.
Only the verified show-tools-peripheral.service is stopped and restored.
--dial adds the observed relative-Y source without recapturing the button map.
--test asks you to confirm held and released LED feedback while the service runs.
No song cue assignments, audio activation or root policy changes are inferred.
`;
export type ServiceCommand = (args: readonly string[]) => Promise<{ readonly code: number; readonly stdout: string }>;
export interface CommissioningCliOptions {
  readonly helperExecutable?: string; readonly benchDirectory?: string; readonly serviceRunner?: string;
  readonly unitPath?: string; readonly stagingRoot?: string; readonly configPath?: string; readonly sessionProfilePath?: string;
  readonly io?: CommissioningIo; readonly service?: CommissioningService; readonly command?: ServiceCommand;
  readonly signal?: AbortSignal;
  readonly audioOff?: () => Promise<void>; readonly captureAxis?: (options: { readonly benchDirectory: string; readonly stagingRoot: string; readonly io: CommissioningIo }) => Promise<CapturedAxis>;
}
async function systemctl(args: readonly string[]) {
  try { const result = await exec('/usr/bin/systemctl', ['--user', ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 65536 }); return { code: 0, stdout: result.stdout }; }
  catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'number' && 'stdout' in error && typeof error.stdout === 'string') return { code: error.code, stdout: error.stdout };
    throw error;
  }
}
export function commissioningService({ profilePath, runner, unitPath, command = systemctl }: {
  profilePath: string; runner: string; unitPath: string; command?: ServiceCommand;
}): CommissioningService {
  const expected = renderPeripheralUnit(runner, profilePath);
  const properties = async () => {
    const result = await command(['show', UNIT, '--property=LoadState,ActiveState,SubState,MainPID,FragmentPath,DropInPaths,NeedDaemonReload,TasksCurrent,KillMode']);
    if (result.code !== 0) throw new Error(`Cannot inspect ${UNIT}. Install the reviewed peripheral service before commissioning.`);
    const values = new Map<string, string>();
    for (const line of result.stdout.trim().split('\n')) {
      const at = line.indexOf('=');
      if (at <= 0 || values.has(line.slice(0, at))) throw new Error('Invalid service-manager property output.');
      values.set(line.slice(0, at), line.slice(at + 1));
    }
    return values;
  };
  const inspect = async () => {
    const metadata = await lstat(unitPath);
    if (!metadata.isFile() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600
      || (process.getuid && metadata.uid !== process.getuid()) || await realpath(unitPath) !== unitPath)
      throw new Error('Peripheral unit must be the canonical caller-owned mode-0600 managed unit.');
    if (await readFile(unitPath, 'utf8') !== expected) throw new Error('Peripheral service unit differs from the selected runner and profile. Review and install the matching unit before commissioning.');
    const state = await properties();
    if (state.get('LoadState') !== 'loaded' || state.get('FragmentPath') !== unitPath || state.get('DropInPaths')
      || state.get('NeedDaemonReload') !== 'no' || state.get('KillMode') !== 'control-group') throw new Error('The loaded peripheral service has foreign or stale unit configuration.');
    const active = state.get('ActiveState');
    if (!['active', 'inactive', 'failed'].includes(active ?? '')) throw new Error('Peripheral service is changing state. Wait for it to settle before commissioning.');
    if (active === 'active' && !/^[1-9][0-9]*$/.test(state.get('MainPID') ?? '')) throw new Error('Active peripheral service has no confirmed process identity.');
    if (active !== 'active' && (state.get('MainPID') !== '0' || !['0', '[not set]', ''].includes(state.get('TasksCurrent') ?? '')))
      throw new Error('Inactive peripheral service still owns processes. Stop it and inspect its process group before commissioning.');
    return { active: active === 'active' };
  };
  const checked = async (action: 'stop' | 'start') => {
    await inspect();
    if ((await command([action, UNIT])).code !== 0) throw new Error(`Cannot ${action} ${UNIT}. Inspect journalctl --user -u ${UNIT}.`);
    const state = await properties();
    if (action === 'stop' && (state.get('ActiveState') !== 'inactive' || state.get('MainPID') !== '0'
      || !['0', '[not set]', ''].includes(state.get('TasksCurrent') ?? ''))) throw new Error('Peripheral stop did not confirm an inactive, empty process group. Do not start another device reader.');
    if (action === 'start' && state.get('ActiveState') !== 'active') throw new Error('Peripheral service did not become active. Check its user journal.');
  };
  return { inspect, stop: () => checked('stop'), start: () => checked('start') };
}

export async function runCommissioningCli(args: readonly string[], options: CommissioningCliOptions = {}) {
  if (args.includes('--help') || args.includes('-h')) { (options.io?.write ?? (message => process.stdout.write(message)))(COMMISSIONING_HELP); return; }
  const { values } = parseArgs({ args: [...args], options: { config: { type: 'string' }, 'session-profile': { type: 'string' },
    helper: { type: 'string' }, 'bench-dir': { type: 'string' }, runner: { type: 'string' }, 'staging-root': { type: 'string' },
    dial: { type: 'boolean' }, test: { type: 'boolean' }, status: { type: 'boolean' }, start: { type: 'boolean' } } });
  if (Number(Boolean(values.dial)) + Number(Boolean(values.test)) + Number(Boolean(values.status)) > 1) throw new Error('Choose setup, --dial, --test or --status.');
  const profilePath = resolve(values.config ?? options.configPath ?? join(homedir(), '.config/show-tools/peripheral.json'));
  const existing = await profileSnapshot(profilePath);
  const previous = existing ? decodePeripheralBridgeConfig(JSON.parse(existing.toString('utf8'))) : undefined;
  const runner = values.runner ?? options.serviceRunner;
  if (!runner || !runner.startsWith('/')) throw new Error('Supply the exact installed peripheral runner with --runner.');
  const service = options.service ?? commissioningService({ profilePath, runner, unitPath: options.unitPath ?? join(homedir(), '.config/systemd/user', UNIT), command: options.command });
  const cancelled = new AbortController();
  const signal = AbortSignal.any([cancelled.signal, ...(options.signal ? [options.signal] : [])]);
  const stop = () => cancelled.abort(new Error('Commissioning cancelled.'));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let terminal: ReturnType<typeof createInterface> | undefined;
  const io = options.io ?? { question: async (prompt: string) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run commissioning in an interactive foreground terminal.');
    if (!terminal) { terminal = createInterface({ input: process.stdin, output: process.stdout }); terminal.on('SIGINT', stop); }
    return terminal.question(prompt, { signal });
  }, write: (message: string) => { process.stdout.write(message); } };
  try {
    if (values.status || values.test) {
      if (!previous) throw new Error('No commissioned peripheral configuration exists. Run setup first.');
      const state = await service.inspect();
      io.write(`${UNIT}: ${state.active ? 'active' : 'inactive'}. Configured switches: ${previous.inputMap.switches.map(value => value.controlId).join(', ')}. Dial: ${previous.inputMap.axis ? 'configured' : 'not configured'}.\n`);
      if (values.test) {
        if (!state.active) throw new Error(`Start ${UNIT} before checking its LED feedback.`);
        for (const led of previous.inputMap.leds) {
          const answer = await io.question(`Hold ${led.controlId}, then release it. Did output ${led.sdkChannel + 1} light fully while held and restore its prior level on release (yes/no)? `);
          if (answer.trim() !== 'yes') throw new Error(`LED feedback for ${led.controlId} was not confirmed. Check the configured output, LED supply and service journal.`);
          io.write(`Operator confirmed held/released LED feedback for ${led.controlId}.\n`);
        }
        if (!previous.inputMap.leds.length) io.write('No LED associations are configured.\n');
      }
      return;
    }
    const sessionPath = resolve(values['session-profile'] ?? options.sessionProfilePath ?? join(homedir(), '.config/show-tools/session.json'));
    const session = decodeSessionProfile(JSON.parse(await readFile(sessionPath, 'utf8')));
    if (previous && (previous.origin !== session.origin || previous.tokenFile !== session.tokenFile
      || previous.connectAddress !== session.connectAddress || previous.caFile !== session.caFile))
      throw new Error('The existing peripheral configuration targets a different desk. Supply its matching session profile.');
    const helper = values.helper ?? options.helperExecutable ?? previous?.helperExecutable;
    const benchDirectory = values['bench-dir'] ?? options.benchDirectory;
    if (!helper || !helper.startsWith('/') || !benchDirectory || !benchDirectory.startsWith('/')) throw new Error('Supply the installed --helper and --bench-dir paths.');
    const audioOff = options.audioOff ?? (async () => {
      const view = await (await createSessionClient(session)).status();
      if (view.audio.kind !== 'off') throw new Error('Hardware audio must be off before commissioning. Use show-tools session audio off after preserving any takes you need.');
    });
    const stagingRoot = values['staging-root'] ?? options.stagingRoot ?? '/home/anulman/.local/share/show-tools/staging';
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    const captureAxis = options.captureAxis;
    const axisCapture = captureAxis ? () => captureAxis({ benchDirectory, stagingRoot, io }) : undefined;
    if (values.dial) {
      if (!axisCapture) throw new Error('The reviewed dial reader is not installed. Install the motion commissioning component before --dial.');
      return await commissionDial({ profilePath, service, audioOff, io, captureAxis: axisCapture });
    }
    const baseProfile: PeripheralBaseProfile = { version: 2, origin: session.origin, tokenFile: session.tokenFile,
      ...(session.connectAddress ? { connectAddress: session.connectAddress } : {}), ...(session.caFile ? { caFile: session.caFile } : {}),
      helperExecutable: helper, bindingRevision: (previous?.bindingRevision ?? 0) + 1, jiggle: previous?.jiggle ?? null };
    const previousAxis = previous?.inputMap.axis;
    const previousSource = previousAxis ? previous.inputMap.sources.find(source => source.id === previousAxis.sourceId) : undefined;
    const retainedAxis = previousAxis && previousSource?.kind === 'linux' ? { source: { interfaceNumber: previousSource.interfaceNumber,
      eventTypes: previousSource.eventTypes, keyCodes: previousSource.keyCodes, relativeAxes: previousSource.relativeAxes },
      type: 2, code: previousAxis.code, evidencePath: profilePath } satisfies CapturedAxis : undefined;
    return await commissionHardware({ profilePath, baseProfile, service, audioOff, io, includeAxis: false, retainedAxis,
      startAfterSave: values.start === true,
      capture: controlId => captureSwitch({ controlId, observerPath: join(benchDirectory, 'raw_keys.py'), publisherPath: join(benchDirectory, 'publish_marker.py'),
        stagingRoot, signal, onArmed: identity => io.write(`ARMED: press and fully release ${identity} three times. Leave it released.\n`) }) });
  } finally { terminal?.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
