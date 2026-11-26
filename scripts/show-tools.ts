import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import { SONGS, loadSong } from '../songs/index.js';
import { rangeForBar } from '../lib/performance/chart.js';
import { chartSettings, LOCAL_PRACTICE_ORIGINS } from './chart-settings.js';
import { createChartHelper, inspectCDP, openChart, openSetList, parseChartSelection } from './open-chart.js';
import { configureDeskChartSource, followDeskCharts } from './desk-chart-follower.js';
import { spawnCDP } from './start-cdp.js';
import { chiefHandoff, commandFailureExitCode, formatCommandFailure, parseCommandFailure } from './lib/command-diagnostics.js';

export const HELP = `Usage: show-tools sheets [SONG_SLUG_OR_SET_LIST_NUMBER] [--no-cdp] [--skip-open]
       show-tools ui <preview|live|status|stop|shutdown|gc>
       show-tools songs
       show-tools scenes COMMAND --database ABSOLUTE_SQLITE_PATH
       show-tools session <install|start|stop|status|audio> [--profile FILE]
       show-tools peripheral connect --config FILE

Commands:
  chart          Fetch, compile, and inspect mapped performance charts
  sheets [song]  Run Sheets following; open the set list or a song's lead-in
  ui             Manage stable live and worktree preview origins
  session        Manage the persistent web desk and optional native audio
  peripheral     Connect the local I-PAC to the enabled hardware instrument
  scenes         Save and inspect shared scene timelines without starting services
  songs          List song slugs and 1-indexed set-list numbers

Options:
  --no-cdp       Require an existing CDP browser; never launch one
  --skip-open    Skip initial chart opening; follow practice events normally
  -h, --help     Show help without starting services

Examples:
  show-tools sheets 1
  show-tools sheets drunk-girls --no-cdp
  show-tools sheets --skip-open

Chromium is reused at SHOW_TOOLS_CDP_PORT (default 9222), or launched if absent.
Use SHOW_TOOLS_CHROMIUM_APP, SHOW_TOOLS_CDP_PROFILE, and
SHOW_TOOLS_PRACTICE_ORIGIN for overrides in your ignored .envrc.
Set SHOW_TOOLS_DESK_ORIGIN to an exact HTTPS origin to follow the hardware desk directly.
Set SHOW_TOOLS_DESK_TOKEN_FILE to your private token file if it lives outside
~/.config/show-tools/desk-token.
SHOW_TOOLS_SET_LIST_URL selects the spreadsheet opened when no song is given.
SHOW_TOOLS_SHEETS_COPY_URL follows a copy of that workbook with the same worksheet IDs.
Ctrl+C stops this helper and any browser it launched. Reused browsers stay open.
`;

class UsageError extends Error {}
export type Command = { kind: 'help' } | { kind: 'songs' } | {
  kind: 'sheets'; songId?: string; launch: boolean; open: boolean;
};

export function parseCommand(args: readonly string[]): Command {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) return { kind: 'help' };
  if (args[0] === 'songs' && args.length === 1) return { kind: 'songs' };
  if (args[0] !== 'sheets') throw new UsageError('Expected sheets or songs. Run show-tools --help.');
  let songId: string | undefined;
  let launch = true, open = true;
  for (const argument of args.slice(1)) {
    if (argument === '--no-cdp') launch = false;
    else if (argument === '--skip-open') open = false;
    else {
      if (argument.startsWith('-')) throw new UsageError(`Unknown option: ${argument}`);
      if (songId !== undefined) throw new UsageError('Specify only one song slug or set-list number.');
      const song = /^\d+$/.test(argument) ? SONGS[Number(argument) - 1] : SONGS.find(entry => entry.id === argument);
      if (!song) throw new UsageError(`Unknown song: ${argument}. Run show-tools songs for valid slugs and 1-indexed numbers.`);
      songId = song.id;
    }
  }
  return { kind: 'sheets', songId, launch, open };
}

function connectionRefused(error: unknown): boolean {
  return error instanceof Error && (('code' in error && error.code === 'ECONNREFUSED') || connectionRefused(error.cause));
}

async function stopBrowser(child: ChildProcess, exited: Promise<Error>) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  child.kill('SIGTERM');
  const finished = await Promise.race([exited.then(() => true), delay(2000, false, { ref: false })]);
  if (!finished) { child.kill('SIGKILL'); await exited; }
}

export async function runSheets(command: Extract<Command, { kind: 'sheets' }>, {
  env = process.env, signal = new AbortController().signal, port = 9223,
  log = (message: string) => process.stdout.write(message + '\n'),
  inspect = inspectCDP, launch = spawnCDP, select = openChart, openList = openSetList, request = fetch,
}: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; port?: number; log?: (message: string) => void;
  inspect?: typeof inspectCDP; launch?: typeof spawnCDP; select?: typeof openChart; openList?: typeof openSetList; request?: typeof fetch } = {}) {
  const settings = chartSettings(env);
  const redirect = settings.spreadsheetRedirect;
  const selectChart: typeof openChart = redirect
    ? (address, input, connect, signal) => {
      const selection = parseChartSelection(input);
      const target = selection.spreadsheetId === redirect.source ? redirect.target : selection.spreadsheetId;
      return select(address, { ...selection, spreadsheetId: target }, connect, signal);
    }
    : select;
  const song = command.songId ? await loadSong(command.songId) : undefined;
  const desk = await configureDeskChartSource(env);
  const helper = desk ? undefined : createChartHelper({ cdp: settings.cdp, origins: [...LOCAL_PRACTICE_ORIGINS, settings.practiceOrigin], select: selectChart });
  let browser: { child: ChildProcess; exited: Promise<Error> } | undefined;
  const lifetime = new AbortController();
  const cancelled = AbortSignal.any([signal, lifetime.signal]);
  let bound = false;
  try {
    cancelled.throwIfAborted();
    if (helper) {
      await new Promise<void>((ready, reject) => {
        helper.once('error', reject);
        helper.listen(port, '127.0.0.1', () => { helper.removeListener('error', reject); bound = true; ready(); });
      });
      helper.on('error', error => lifetime.abort(error));
    }
    let product: string;
    try { product = await inspect(settings.cdp, cancelled); }
    catch (error) {
      cancelled.throwIfAborted();
      if (!connectionRefused(error)) throw new Error(`Cannot reuse CDP at ${settings.cdp}: ${error instanceof Error ? error.message : error}. The configured port may be occupied by another service.`, { cause: error });
      if (!command.launch) throw new Error(`No CDP browser at ${settings.cdp}. Start one or omit --no-cdp.`);
      cancelled.throwIfAborted();
      browser = await launch(env);
      const { exited } = browser;
      void exited.then(error => lifetime.abort(error));
      log(`Browser   launching at ${settings.cdp}`);
      const readiness = AbortSignal.any([cancelled, AbortSignal.timeout(15000)]);
      try {
        for (;;) {
          readiness.throwIfAborted();
          try { product = await inspect(settings.cdp, readiness); break; }
          catch {
            readiness.throwIfAborted();
            await delay(100, undefined, { signal: readiness });
          }
        }
      } catch (error) {
        cancelled.throwIfAborted();
        throw new Error(`Chromium did not become ready at ${settings.cdp} within 15 seconds.`, { cause: error });
      }
    }
    cancelled.throwIfAborted();
    log(`Browser   ${browser ? 'launched' : 'reused'} ${product} · ${settings.cdp}`);
    if (helper) {
      const address = helper.address();
      log(`Helper    listening http://127.0.0.1:${address && typeof address === 'object' ? address.port : port}`);
    }
    if (song && command.open) {
      const result = await selectChart(settings.cdp, { spreadsheetId: song.chart.spreadsheetId, sheetId: song.chart.sheetId,
        range: rangeForBar(song.chart, song.practice.startBar, 'count-in'), activate: true }, undefined, cancelled);
      log(`Chart     ${song.chart.title} · ${result.selectedRange} selected`);
    } else if (command.open) {
      await openList(settings.cdp, settings.setListURL, cancelled);
      log(`Set list  ${settings.setListURL}`);
    }
    cancelled.throwIfAborted();
    log(`Waiting for practice events. Ctrl+C stops the ${desk ? 'follower' : 'helper'}${browser ? ' and the browser launched here.' : '; the reused browser stays open.'}`);
    if (desk) await followDeskCharts({ ...desk, cdp: settings.cdp, select: selectChart, signal: cancelled, log, request });
    else await new Promise<void>(done => {
      if (cancelled.aborted) done();
      else cancelled.addEventListener('abort', () => done(), { once: true });
    });
    if (!signal.aborted) throw lifetime.signal.reason;
  } catch (error) {
    if (!signal.aborted) { lifetime.signal.throwIfAborted(); throw error; }
  } finally {
    lifetime.abort();
    helper?.closeAllConnections();
    if (helper && bound) await new Promise<void>(done => helper.close(() => done()));
    if (browser) await stopBrowser(browser.child, browser.exited);
  }
}

export async function main(args = process.argv.slice(2)) {
  try {
    if (args[0] === 'scenes') {
      process.exitCode = await (await import('./scene-authoring.js')).runSceneAuthoringCli(args.slice(1));
      return;
    }
    if (args[0] === 'ui') {
      await (await import('../lib/ui-host/cli.js')).runUiCli(args.slice(1));
      return;
    }
    if (args[0] === 'peripheral') {
      await (await import('../lib/peripherals/bridge-cli.js')).runPeripheralCli(args.slice(1));
      return;
    }
    if (args[0] === 'session') {
      await (await import('../lib/remote-performance/session-cli.js')).runSessionCli(args.slice(1));
      return;
    }
    if (args[0] === 'chart') {
      const json = args.includes('--json'), output: string[] = [];
      try {
        await (await import('./chart-compiler.js')).runChartCompiler(args.slice(1).filter(argument => argument !== '--json'), message => { output.push(message); });
        process.stdout.write(output.join(''));
      } catch (error) {
        let failure;
        try { failure = parseCommandFailure(error); }
        catch {
          failure = chiefHandoff({ code: 'CHART_COMMAND_FAILED', message: 'The chart command encountered an unexpected tooling failure.',
            nextSteps: ['Hand the command and its inputs to Chief to diagnose the tooling failure. Keep the product gate blocked until verification succeeds.'], locations: [] });
        }
        (json ? process.stdout : process.stderr).write(formatCommandFailure(failure, json ? 'json' : 'human'));
        process.exitCode = commandFailureExitCode(failure);
      }
      return;
    }
    const command = parseCommand(args);
    if (command.kind === 'help') { process.stdout.write(HELP); return; }
    if (command.kind === 'songs') { process.stdout.write(SONGS.map((song, index) => `${index + 1}  ${song.id}  ${song.title.replace(/^\d+ · /, '')}`).join('\n') + '\n'); return; }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    try { await runSheets(command, { signal: controller.signal }); }
    finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

if (process.argv[1] && realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url))) await main();
