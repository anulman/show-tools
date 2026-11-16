import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs, promisify } from 'node:util';
import { decodePeripheralBridgeConfig } from './bridge.js';
import { captureAxis, captureSwitch, commissionDial, decodeMotionDirection, commissionHardware, profileSnapshot, type CapturedAxis, type CommissioningIo,
  type CommissioningService, type CommissioningMaintenance, type PeripheralBaseProfile } from './commissioning.js';
import { renderPeripheralUnit } from './service-unit.js';
import { decodeSessionProfile } from '../remote-performance/session-profile.js';
import { createSessionClient, DeskUnavailableError } from '../remote-performance/session-client.js';
import { createSessionService } from '../remote-performance/session-service.js';

const UNIT = 'show-tools-peripheral.service';
const exec = promisify(execFile);
export const COMMISSIONING_HELP = `Usage: show-tools peripheral setup --config FILE --session-profile FILE --helper FILE --bench-dir DIRECTORY --runner FILE
       show-tools peripheral setup --dial --direction clockwise --capture-seconds 5 --config FILE --session-profile FILE --helper FILE --bench-dir DIRECTORY --runner FILE
       show-tools peripheral setup --test --config FILE --runner FILE
       show-tools peripheral setup --status --config FILE --runner FILE

Run setup in a foreground terminal on the EliteDesk. The web service must be stopped.
Add --stop-performance to stop the verified web service and discard recorded takes.
After successful setup, a previously active web service restarts with audio off.
Cancellation or failure leaves it stopped; start it explicitly after resolving the error.
Setup captures two to six named buttons and asks for each LED output explicitly.
Only the verified profile web service and show-tools-peripheral.service are controlled.
Add --start to button setup to start a previously inactive service after saving.
--dial adds the observed relative-Y source without recapturing the button map.
Add --jiggle-travel N --jiggle-reversal N to save explicit motion thresholds,
or --disable-jiggle. Existing thresholds are retained when neither is supplied.
--test asks you to confirm held and released LED feedback while the service runs.
No song cue assignments, audio activation or root policy changes are inferred.
`;
export type ServiceCommand = (args: readonly string[]) => Promise<{ readonly code: number; readonly stdout: string }>;
export interface CommissioningCliOptions {
  readonly helperExecutable?: string; readonly benchDirectory?: string; readonly serviceRunner?: string;
  readonly unitPath?: string; readonly stagingRoot?: string; readonly configPath?: string; readonly sessionProfilePath?: string;
  readonly io?: CommissioningIo; readonly service?: CommissioningService; readonly command?: ServiceCommand;
  readonly signal?: AbortSignal;
  readonly webService?: Pick<ReturnType<typeof createSessionService>, 'state' | 'start' | 'stop'>;
  readonly checkListenerAbsent?: () => Promise<void>;
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
    'jiggle-travel': { type: 'string' }, 'jiggle-reversal': { type: 'string' }, 'disable-jiggle': { type: 'boolean' },
    direction: { type: 'string' }, 'capture-seconds': { type: 'string' }, dial: { type: 'boolean' }, test: { type: 'boolean' }, status: { type: 'boolean' }, start: { type: 'boolean' }, 'stop-performance': { type: 'boolean' } } });
  if (Number(Boolean(values.dial)) + Number(Boolean(values.test)) + Number(Boolean(values.status)) > 1) throw new Error('Choose setup, --dial, --test or --status.');
  if (!values.dial && (values.direction || values['capture-seconds'] || values['jiggle-travel'] || values['jiggle-reversal'] || values['disable-jiggle']))
    throw new Error('Use direction, capture duration and jiggle settings with --dial.');
  if (values['stop-performance'] && (values.test || values.status)) throw new Error('--stop-performance applies only to button or dial setup.');
  if (values.start && (values.dial || values.test || values.status)) throw new Error('--start applies to button setup. Start the named peripheral service separately after other commands.');
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
      if (!previous && values.test) throw new Error('No commissioned peripheral configuration exists. Run setup first.');
      const state = await service.inspect();
      if (!previous) { io.write(`${UNIT}: ${state.active ? 'active' : 'inactive'}. No input map is saved. Run setup to capture the connected controls.\n`); return; }
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
    const webService = options.webService ?? createSessionService(session, sessionPath);
    const checkListenerAbsent = options.checkListenerAbsent ?? (async () => {
      try { await (await createSessionClient(session)).status(); }
      catch (error) { if (error instanceof DeskUnavailableError) return; throw error; }
      throw new Error('The desk endpoint still has a listener although its managed service is stopped. Refusing hardware setup.');
    });
    let webChanged = false;
    const inactiveWeb = async () => {
      if (webChanged) throw new Error('The web service restarted during hardware setup. Refusing automatic service restoration.');
      const state = await webService.state();
      if (state.get('ActiveState') !== 'inactive' || state.get('MainPID') !== '0'
        || !['0', '[not set]', ''].includes(state.get('TasksCurrent') ?? '')) {
        webChanged = true;
        if (values['stop-performance']) await webService.stop();
        throw new Error('The web service restarted during hardware setup. Setup refused; inspect the named service before retrying.');
      }
      await checkListenerAbsent();
    };
    const audioOff = async () => { await inactiveWeb(); await options.audioOff?.(); };
    const maintenance: CommissioningMaintenance = async operation => {
      signal.throwIfAborted();
      const initial = await webService.state();
      signal.throwIfAborted();
      const active = initial.get('ActiveState');
      if (active !== 'active' && active !== 'inactive') throw new Error('The web service state is not settled. Inspect its named unit before setup.');
      if (active === 'active' && !values['stop-performance']) throw new Error('The web service is active. Rerun setup with --stop-performance to stop it and discard recorded takes.');
      if (values['stop-performance']) io.write(`Stopping ${session.serviceName} for hardware setup. Recorded takes are discarded.\n`);
      await webService.stop();
      let completed = false;
      try {
        signal.throwIfAborted();
        await inactiveWeb();
        signal.throwIfAborted();
        const result = await operation();
        signal.throwIfAborted();
        await inactiveWeb();
        signal.throwIfAborted();
        completed = true;
        return result;
      } finally {
        if (completed && active === 'active') {
          await webService.start();
          io.write(`${session.serviceName} restarted. Audio is off.\n`);
        } else io.write(`${session.serviceName} is left stopped. Start it explicitly after setup or recovery.\n`);
      }
    };
    const stagingRoot = values['staging-root'] ?? options.stagingRoot ?? '/home/anulman/.local/share/show-tools/staging';
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    const capture = options.captureAxis;
    if (values.dial) {
      const direction = decodeMotionDirection(values.direction ?? 'clockwise');
      const seconds = values['capture-seconds'] ?? '5';
      if (!/^(?:[1-9]|[12][0-9]|30)$/.test(seconds)) throw new Error('Dial capture seconds must be an integer from 1 through 30.');
      const captureSeconds = Number(seconds);
      const hasThresholds = values['jiggle-travel'] !== undefined || values['jiggle-reversal'] !== undefined;
      if (hasThresholds && values['disable-jiggle']) throw new Error('Choose explicit jiggle thresholds or --disable-jiggle.');
      let jiggle: PeripheralBaseProfile['jiggle'] | undefined;
      if (values['disable-jiggle']) jiggle = null;
      else if (hasThresholds) {
        const travel = values['jiggle-travel'], reversal = values['jiggle-reversal'];
        if (!travel || !reversal || !/^[1-9][0-9]{0,4}$/.test(travel) || !/^[1-9][0-9]{0,4}$/.test(reversal)
          || Number(travel) > 32767 || Number(reversal) > Number(travel))
          throw new Error('Supply both jiggle thresholds as integer counts, 1 <= reversal <= travel <= 32767.');
        jiggle = { minimumTravel: Number(travel), minimumReversal: Number(reversal) };
      }
      const axisCapture = capture ? () => capture({ benchDirectory, stagingRoot, io }) : async () => {
        const captured = await captureAxis({ readerPath: join(benchDirectory, 'raw_motion.py'), publisherPath: join(benchDirectory, 'publish_marker.py'),
          stagingRoot, direction, captureSeconds, signal,
          onArmed: (direction, seconds) => io.write(`ARMED: turn only the dial ${direction} for ${seconds} seconds.\n`),
          chooseAxis: async axes => {
            for (const [index, axis] of axes.entries()) io.write(`${index + 1}. Interface ${axis.interfaceNumber}, relative axis ${axis.code}, ${axis.samples} samples, signed delta ${axis.delta}.\n`);
            const answer = (await io.question('Choose the dial axis by its listed number: ')).trim();
            return /^[1-9][0-9]*$/.test(answer) ? Number(answer) - 1 : -1;
          } });
        for (const axis of captured.observations) io.write(`Observed relative axis ${axis.code} on interface ${axis.interfaceNumber}: ${axis.samples} nonzero samples, signed delta ${axis.delta}, positive counts ${axis.positiveCounts}, negative counts ${axis.negativeCounts}.\n`);
        return captured;
      };
      return await commissionDial({ profilePath, service, audioOff, io, signal, maintenance, captureAxis: axisCapture, ...(jiggle !== undefined ? { jiggle } : {}) });
    }
    const baseProfile: PeripheralBaseProfile = { version: 2, origin: session.origin, tokenFile: session.tokenFile,
      ...(session.connectAddress ? { connectAddress: session.connectAddress } : {}), ...(session.caFile ? { caFile: session.caFile } : {}),
      helperExecutable: helper, bindingRevision: (previous?.bindingRevision ?? 0) + 1, jiggle: previous?.jiggle ?? null };
    const previousAxis = previous?.inputMap.axis;
    const previousSource = previousAxis ? previous.inputMap.sources.find(source => source.id === previousAxis.sourceId) : undefined;
    const retainedAxis = previousAxis && previousSource?.kind === 'linux' ? { source: { interfaceNumber: previousSource.interfaceNumber,
      eventTypes: previousSource.eventTypes, keyCodes: previousSource.keyCodes, relativeAxes: previousSource.relativeAxes },
      type: 2, code: previousAxis.code, evidencePath: profilePath } satisfies CapturedAxis : undefined;
    return await commissionHardware({ profilePath, baseProfile, service, audioOff, io, signal, maintenance, includeAxis: false, retainedAxis,
      startAfterSave: values.start === true,
      capture: controlId => captureSwitch({ controlId, observerPath: join(benchDirectory, 'raw_keys.py'), publisherPath: join(benchDirectory, 'publish_marker.py'),
        stagingRoot, signal, onArmed: identity => io.write(`ARMED: press and fully release ${identity} three times. Leave it released.\n`) }) });
  } finally { terminal?.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
