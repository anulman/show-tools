import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Schema } from 'effect';
import {
  chiefHandoff, commandFailureExitCode, formatCommandFailure, productFailure,
  type CommandFailure,
} from '../../scripts/lib/command-diagnostics.js';

const here = dirname(fileURLToPath(import.meta.url));
const absolutePath = Schema.String.check(Schema.makeFilter((value: string) => isAbsolute(value)), Schema.isPattern(/\S/));
const Input = Schema.Struct({
  recipe: Schema.Literal('measured-hex-joint'),
  python: absolutePath.pipe(Schema.brand('CadPythonExecutable')),
  output: absolutePath.pipe(Schema.brand('CadOutputDirectory')),
});
const sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const receipt = Schema.Struct({ path: absolutePath, sha256 });
const stage = Schema.Literals(['input', 'runtime', 'validation', 'export', 'receipt', 'cleanup']);
const BridgeReply = Schema.Union([
  Schema.Struct({ protocol: Schema.Literal(1), kind: Schema.Literal('validated'), recipe: Schema.Literal('measured-hex-joint'), receipt }),
  Schema.Struct({ protocol: Schema.Literal(1), kind: Schema.Literals(['gate-failed', 'execution-failed']), stage, cause: Schema.NonEmptyString }),
]);
const artifact = Schema.Struct({ name: Schema.Literals(['well', 'keeper']), step: absolutePath, step_sha256: sha256, stl: absolutePath, stl_sha256: sha256 });
const Receipt = Schema.Struct({
  scope: Schema.Literal('ISOLATED_FULL_HEX_ONE_KEEPER_FIT_COUPON_NOT_FULL_MOUNT'),
  geometry_checks_pass: Schema.Literal(true),
  physical_fit_preload_and_strength_verified: Schema.Literal(false),
  review_components: Schema.Array(artifact),
  assembly_step: absolutePath, assembly_step_sha256: sha256,
});
const decodeInput = Schema.decodeUnknownSync(Input);
const decodeBridge = Schema.decodeUnknownSync(BridgeReply);
const decodeReceipt = Schema.decodeUnknownSync(Receipt);
type Input = typeof Input.Type;
type ReceiptReference = typeof receipt.Type;
type Success = { schemaVersion: 1; status: 'ok'; recipe: 'measured-hex-joint'; receipt: ReceiptReference; scope: 'fit-trial-only' };
export type CadCandidateResult = Success | CommandFailure;

function handoff(code: string, message: string, locations: readonly string[]): CommandFailure {
  return chiefHandoff({ code, message, locations,
    nextSteps: ['Ask Chief to inspect the CAD runtime or command harness. Keep dependent export and publication stopped.'] });
}

function inputFailure(): CommandFailure {
  return productFailure({ code: 'CAD_INPUT_INVALID',
    message: 'Choose measured-hex-joint with explicit absolute Python and new output paths.',
    nextSteps: ['Use: cad candidate measured-hex-joint --python /path/to/python --output /path/to/new-trial [--json]'],
    locations: ['--python', '--output'] });
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function verifyWrittenReceipt(reference: ReceiptReference, input: Input): CommandFailure | null {
  try {
    const output = realpathSync(input.output);
    const expectedReceipt = join(output, 'receipt.json');
    if (reference.path !== expectedReceipt) return handoff('CAD_PROTOCOL_INVALID', 'The CAD bridge returned a receipt outside the requested output.', [input.output]);
    const bytes = readFileSync(expectedReceipt);
    if (digest(bytes) !== reference.sha256) return productFailure({ code: 'CAD_EXPORT_CHANGED', message: 'The exported CAD receipt changed after validation.',
      nextSteps: ['Keep this trial out of publication. Inspect the changed output and rerun into a new directory.'], locations: [expectedReceipt] });
    const report = decodeReceipt(JSON.parse(bytes.toString('utf8')));
    if (report.review_components.length !== 2 || new Set(report.review_components.map(part => part.name)).size !== 2) {
      return handoff('CAD_PROTOCOL_INVALID', 'The CAD receipt does not contain exactly the two required trial pieces.', [expectedReceipt]);
    }
    const files = report.review_components.flatMap(part => [
      { path: part.step, expected: join(output, 'print', `measured-hex-${part.name}.step`), sha: part.step_sha256 },
      { path: part.stl, expected: join(output, 'print', `measured-hex-${part.name}.stl`), sha: part.stl_sha256 },
    ]);
    files.push({ path: report.assembly_step, expected: join(output, 'nominal-one-keeper-assembly.step'), sha: report.assembly_step_sha256 });
    for (const file of files) {
      if (file.path !== file.expected || digest(readFileSync(file.expected)) !== file.sha) {
        return productFailure({ code: 'CAD_EXPORT_CHANGED', message: 'A checked CAD export is relocated or changed.',
          nextSteps: ['Keep dependent fabrication and publication stopped. Inspect the output and rerun the real validators into a new directory.'], locations: [file.expected] });
      }
    }
    return null;
  } catch {
    return handoff('CAD_PROTOCOL_INVALID', 'The reported CAD result could not be verified from its actual files.', [input.output]);
  }
}

export function runCadCandidate(value: unknown): CadCandidateResult {
  let input: Input;
  try { input = decodeInput(value); } catch { return inputFailure(); }
  const child = spawnSync(input.python, [join(here, 'headless_candidate.py'), input.recipe, '--output', input.output], {
    cwd: resolve(here, '../..'), encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  if (child.error || child.signal || child.status !== 0) {
    return handoff('CAD_RUNNER_FAILED', 'The selected Python runtime could not complete the CAD command.', [input.python]);
  }
  try {
    const reply = decodeBridge(JSON.parse(child.stdout));
    switch (reply.kind) {
      case 'gate-failed':
        return productFailure({ code: 'CAD_GATE_REJECTED', message: reply.cause,
          nextSteps: ['Resolve the reported input or CAD gate failure, then rerun into a new output directory. Do not publish dependent designs before it passes.'],
          locations: [reply.stage, input.output] });
      case 'execution-failed':
        return handoff('CAD_HARNESS_FAILED', `The CAD command encountered ${reply.cause} during ${reply.stage}.`, [input.python, reply.stage]);
      case 'validated': {
        const failure = verifyWrittenReceipt(reply.receipt, input);
        if (failure) return failure;
        return { schemaVersion: 1, status: 'ok', recipe: input.recipe, receipt: reply.receipt, scope: 'fit-trial-only' };
      }
    }
  } catch {
    return handoff('CAD_PROTOCOL_INVALID', 'The CAD bridge did not return its required typed result.', [input.python]);
  }
}

export function runCadCandidateCli(args: readonly string[]): number {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: cad candidate measured-hex-joint --python /path/to/python --output /path/to/new-trial [--json]\nRuns the existing headless validator and exporter. No publication or service discovery.\n');
    return 0;
  }
  let json = args.includes('--json');
  let result: CadCandidateResult;
  try {
    const parsed = parseArgs({ args: [...args], strict: true, allowPositionals: true,
      options: { python: { type: 'string' }, output: { type: 'string' }, json: { type: 'boolean' } } });
    json = parsed.values.json ?? false;
    if (parsed.positionals[0] === 'publish' || parsed.positionals[0] === 'discover') {
      result = handoff('CAD_INFRASTRUCTURE_MANUAL', 'Publication and service discovery are outside this headless command.', ['CAD publication']);
    } else {
      result = parsed.positionals.length === 1
        ? runCadCandidate({ recipe: parsed.positionals[0], python: parsed.values.python, output: parsed.values.output })
        : inputFailure();
    }
  } catch { result = inputFailure(); }
  if (result.status !== 'ok') {
    const message = formatCommandFailure(result, json ? 'json' : 'human');
    (json ? process.stdout : process.stderr).write(message);
    return commandFailureExitCode(result);
  }
  process.stdout.write(json ? JSON.stringify(result) + '\n'
    : `Validated two-piece CAD fit trial: ${result.receipt.path}\nPhysical fit and manufacturing approval remain unverified.\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCadCandidateCli(process.argv.slice(2));
}
