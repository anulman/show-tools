import { resolve, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { chiefHandoff, commandFailureExitCode, formatCommandFailure, productFailure, type CommandFailure } from '../../lib/command-diagnostics.js';
import { OutputConflict, publishDirectory, publishReport } from './atomic-output.mjs';

const usage = `Usage:
  promotion.mts reexport-scripts PACKAGE_DIRECTORY OUTPUT_DIRECTORY [--json]
  promotion.mts check PACKAGE_DIRECTORY CAPTURE_DIRECTORY [--report REPORT.json] [--json]
`;

class UsageFailure extends Error {}

type Command =
  | { operation: 'help' }
  | { operation: 'reexport-scripts'; packageDirectory: string; directory: string }
  | { operation: 'check'; packageDirectory: string; directory: string; report: string | null };

function commandArguments(args: readonly string[]): Command {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { operation: 'help' };
  const [operation, ...rest] = args.filter(arg => arg !== '--json');
  if (operation !== 'check' && operation !== 'reexport-scripts') throw new UsageFailure('Choose reexport-scripts or check.');
  const positional = [];
  let report: string | null = null;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--report' && operation === 'check' && report === null) {
      const value = rest[++index];
      if (!value || value.startsWith('-')) throw new UsageFailure('--report needs a report file path.');
      report = value;
    } else if (!arg || arg.startsWith('-')) throw new UsageFailure('An argument is empty or a flag is unsupported.');
    else positional.push(arg);
  }
  if (positional.length !== 2) throw new UsageFailure('Supply exactly one package directory and one output or capture directory.');
  return operation === 'check'
    ? { operation, packageDirectory: positional[0], directory: positional[1], report }
    : { operation, packageDirectory: positional[0], directory: positional[1] };
}

function ioCode(error: unknown): string | null {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code) ? error.code : null;
}

export async function runCommand(args: readonly string[]): Promise<void> {
  const json = args.includes('--json');
  let command: Command | undefined;
  let core: typeof import('./canonical-export.mjs') | undefined;
  let phase: 'startup' | 'input' | 'output' = 'startup';
  try {
    command = commandArguments(args);
    if (command.operation === 'help') { process.stdout.write(usage); return; }
    core = await import('./canonical-export.mjs');
    phase = 'input';
    let result;
    if (command.operation === 'reexport-scripts') {
      const prepared = await core.readScripts(command.packageDirectory);
      phase = 'output';
      await publishDirectory(command.directory, prepared.files);
      result = { fileKey: prepared.fileKey, outputDirectory: command.directory, poses: prepared.poses };
    } else {
      result = await core.checkCanonicalExport(command.packageDirectory, command.directory);
      if (command.report !== null) {
        phase = 'output';
        await publishReport(command.report, JSON.stringify(result, null, 2) + '\n');
      }
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const locations = command && command.operation !== 'help'
      ? [join(command.packageDirectory, 'promotion.json'), command.directory, ...(command.operation === 'check' && command.report !== null ? [command.report] : [])] : [];
    if (error instanceof Error && 'path' in error && typeof error.path === 'string' && error.path.trim()) locations.push(error.path);
    let failure: CommandFailure;
    if (error instanceof UsageFailure) {
      failure = productFailure({ code: 'FIGMA_ARGUMENTS_INVALID', message: error.message, locations: [], nextSteps: ['Run promotion.mts --help, then supply the required paths and supported flags.'] });
    } else if (error instanceof OutputConflict && error.reason !== 'busy') {
      failure = productFailure({ code: 'FIGMA_OUTPUT_CONFLICT', message: error.message, locations: [error.outputPath], nextSteps: ['Choose a fresh output path, or reuse an existing output only when its complete contents match. Existing output was preserved.'] });
    } else if (error instanceof OutputConflict) {
      failure = chiefHandoff({ code: 'FIGMA_PUBLICATION_LOCKED', message: error.message, locations: [error.outputPath], nextSteps: ['Chief: establish whether the publisher is still active before retrying or resolving an orphaned lock. Do not steal the lock or stop another session.'] });
    } else if (phase === 'input' && ((core && error instanceof core.CanonicalViolation) || Schema.isSchemaError(error) || error instanceof SyntaxError || ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(ioCode(error) ?? '') || error instanceof Error && /Input buffer (contains unsupported image format|has corrupt header)|XML parse error/.test(error.message))) {
      const message = core && error instanceof core.CanonicalViolation ? error.message
        : Schema.isSchemaError(error) ? 'Package or capture metadata does not match the required schema.'
        : error instanceof SyntaxError ? 'A package or capture JSON file is invalid.'
        : ioCode(error) ? 'A required input file or directory is missing or has the wrong type.'
        : 'A package or capture image could not be decoded.';
      failure = productFailure({ code: 'FIGMA_CANONICAL_INPUT_BLOCKED', message, locations,
        nextSteps: ['Restore the approved runtime package if it changed. Generate fresh reexport-scripts for that package and capture the recorded Figma nodes.', 'Repair the pixel, visible-scene or HOLD mismatch before retrying. Do not edit a certificate to silence a failed check; no dependent output was published.'] });
    } else {
      const code = ioCode(error);
      failure = chiefHandoff({ code: phase === 'startup' ? 'FIGMA_RUNTIME_UNAVAILABLE' : phase === 'output' ? 'FIGMA_OUTPUT_IO_FAILED' : 'FIGMA_RUNNER_FAILED',
        message: phase === 'startup' ? 'The verification runtime could not be loaded.' : phase === 'output' ? `Complete output could not be published${code ? ` (${code})` : ''}.` : `An unexpected runner failure interrupted verification${code ? ` (${code})` : ''}.`, locations,
        nextSteps: ['Chief: restore the declared dependencies and inspect the isolated runner or output filesystem, then rerun the same command. Keep the canonical validation gates enabled.'] });
    }
    (json ? process.stdout : process.stderr).write(formatCommandFailure(failure, json ? 'json' : 'human'));
    process.exitCode = commandFailureExitCode(failure);
  }
}

if (process.argv[1] && await realpath(resolve(process.argv[1])) === await realpath(fileURLToPath(import.meta.url))) await runCommand(process.argv.slice(2));
