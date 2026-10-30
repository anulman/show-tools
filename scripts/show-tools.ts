import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import { SONGS, loadSong } from '../songs/index.js';
import { rangeForBar } from '../lib/performance/chart.js';
import { chartSettings, LOCAL_PRACTICE_ORIGINS } from './chart-settings.js';
import { createChartHelper, inspectCDP, openChart, openSetList } from './open-chart.js';
import { spawnCDP } from './start-cdp.js';
import { chiefHandoff, commandFailureExitCode, formatCommandFailure, parseCommandFailure } from './lib/command-diagnostics.js';

export const HELP = `Usage: show-tools sheets [SONG_SLUG_OR_SET_LIST_NUMBER] [--no-cdp] [--skip-open]
       show-tools songs

Commands:
  chart          Fetch, compile, and inspect mapped performance charts
  sheets [song]  Run Sheets following; open the set list or a song's lead-in
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
SHOW_TOOLS_SET_LIST_URL selects the spreadsheet opened when no song is given.
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
  inspect = inspectCDP, launch = spawnCDP, select = openChart, openList = openSetList,
}: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; port?: number; log?: (message: string) => void;
  inspect?: typeof inspectCDP; launch?: typeof spawnCDP; select?: typeof openChart; openList?: typeof openSetList } = {}) {
  const settings = chartSettings(env);
  const song = command.songId ? await loadSong(command.songId) : undefined;
  const helper = createChartHelper({ cdp: settings.cdp, origins: [...LOCAL_PRACTICE_ORIGINS, settings.practiceOrigin], select });
  let browser: { child: ChildProcess; exited: Promise<Error> } | undefined;
  const lifetime = new AbortController();
  const cancelled = AbortSignal.any([signal, lifetime.signal]);
  let bound = false;
  try {
    cancelled.throwIfAborted();
    await new Promise<void>((ready, reject) => {
      helper.once('error', reject);
      helper.listen(port, '127.0.0.1', () => { helper.removeListener('error', reject); bound = true; ready(); });
    });
    helper.on('error', error => lifetime.abort(error));
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
    const address = helper.address();
    log(`Helper    listening http://127.0.0.1:${address && typeof address === 'object' ? address.port : port}`);
    if (song && command.open) {
      const result = await select(settings.cdp, { spreadsheetId: song.chart.spreadsheetId, sheetId: song.chart.sheetId,
        range: rangeForBar(song.chart, song.practice.startBar, 'count-in'), activate: true }, undefined, cancelled);
      log(`Chart     ${song.chart.title} · ${result.selectedRange} selected`);
    } else if (command.open) {
      await openList(settings.cdp, settings.setListURL, cancelled);
      log(`Set list  ${settings.setListURL}`);
    }
    cancelled.throwIfAborted();
    log(`Waiting for practice events. Ctrl+C stops the helper${browser ? ' and the browser launched here.' : '; the reused browser stays open.'}`);
    await new Promise<void>(done => {
      if (cancelled.aborted) done();
      else cancelled.addEventListener('abort', () => done(), { once: true });
    });
    if (!signal.aborted) throw lifetime.signal.reason;
  } catch (error) {
    if (!signal.aborted) { lifetime.signal.throwIfAborted(); throw error; }
  } finally {
    lifetime.abort();
    helper.closeAllConnections();
    if (bound) await new Promise<void>(done => helper.close(() => done()));
    if (browser) await stopBrowser(browser.child, browser.exited);
  }
}

export async function main(args = process.argv.slice(2)) {
  try {
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
