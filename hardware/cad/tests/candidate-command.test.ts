import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runCadCandidate } from '../candidate-command.js';
import { parseCommandFailure } from '../../../scripts/lib/command-diagnostics.js';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../candidate-command.ts');
const root = resolve(here, '../../..');

function shellQuote(value: string) { return "'" + value.replaceAll("'", "'\\''") + "'"; }

function scriptFixture(body: string) {
  const directory = mkdtempSync(join(tmpdir(), 'cad-command-protocol-'));
  const executable = join(directory, 'protocol-fixture');
  writeFileSync(executable, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  return { directory, executable, output: join(directory, 'new-trial') };
}

function fixture(raw: string) { return scriptFixture(`printf '%s\\n' ${shellQuote(raw)}`); }

function resultFixture(ending: string) {
  const program = `
    const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
    const args=process.argv.slice(1);
    const staging=args[args.indexOf('--staging-root')+1],output=args[args.indexOf('--output')+1];
    const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
    fs.mkdirSync(path.join(staging,'print'));
    const parts=['well','keeper'].map(name=>{
      const part={name};
      for(const kind of ['step','stl']){
        const relative=path.join('print','measured-hex-'+name+'.'+kind), bytes=Buffer.from('protocol fixture');
        fs.writeFileSync(path.join(staging,relative),bytes);
        part[kind]=path.join(output,relative);part[kind+'_sha256']=sha(bytes);
      }return part;
    });
    const assembly='nominal-one-keeper-assembly.step',assemblyBytes=Buffer.from('assembly fixture');
    fs.writeFileSync(path.join(staging,assembly),assemblyBytes);
    const report={scope:'ISOLATED_FULL_HEX_ONE_KEEPER_FIT_COUPON_NOT_FULL_MOUNT',geometry_checks_pass:true,
      physical_fit_preload_and_strength_verified:false,review_components:parts,
      assembly_step:path.join(output,assembly),assembly_step_sha256:sha(assemblyBytes)};
    const receiptBytes=Buffer.from(JSON.stringify(report));
    fs.writeFileSync(path.join(staging,'receipt.pending.json'),receiptBytes);
    ${ending}
    process.stdout.write(JSON.stringify({protocol:1,kind:'validated',recipe:'measured-hex-joint',
      receipt:{path:path.join(output,'receipt.json'),sha256:sha(receiptBytes)}}));
  `;
  return scriptFixture(`exec ${shellQuote(process.execPath)} -e ${shellQuote(program)} -- "$@"`);
}

function stagingDirectory(directory: string): string {
  const name = readdirSync(directory).find(value => value.startsWith('.cad-unpublished-'));
  assert.ok(name, 'The command should own a private staging directory');
  return join(directory, name);
}

function cli(args: readonly string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], { cwd: root, encoding: 'utf8' });
}

test('invalid request is an operator block without invoking a Python runtime', () => {
  const result = runCadCandidate({ recipe: 'unregistered-model', python: '/no/runtime', output: '/unused/output' });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') assert.equal(result.code, 'CAD_INPUT_INVALID');
  for (const field of ['python', 'output']) {
    const invalid = { recipe: 'measured-hex-joint', python: '/no/runtime', output: '/unused/output', [field]: '/invalid\0path' };
    const rejected = runCadCandidate(invalid);
    assert.equal(rejected.status, 'blocked');
    if (rejected.status === 'blocked') assert.equal(rejected.code, 'CAD_INPUT_INVALID');
  }
});

test('help describes explicit inputs without requiring a CAD runtime', () => {
  const child = cli(['--help']);
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.match(child.stdout, /--python/);
  assert.match(child.stdout, /No publication or service discovery/);
});

test('a symlinked CLI entry executes instead of silently skipping the command', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cad-entry-alias-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const alias = join(directory, 'candidate-command.ts');
  symlinkSync(entry, alias);
  const child = spawnSync(process.execPath, ['--import', 'tsx', alias, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.match(child.stdout, /Usage: cad candidate/);
});

test('missing Python is a Chief handoff, not a product input failure', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cad-missing-runtime-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const result = runCadCandidate({ recipe: 'measured-hex-joint', python: '/no/such/cad-python', output: join(directory, 'trial') });
  assert.equal(result.status, 'needs-chief');
  if (result.status === 'needs-chief') assert.equal(result.code, 'CAD_RUNNER_FAILED');
});

test('JSON product failure is exactly one shared result with cause and next steps', t => {
  const f = fixture(JSON.stringify({ protocol: 1, kind: 'gate-failed', stage: 'validation', cause: 'Hex allowance below the declared minimum.' }));
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const child = cli(['measured-hex-joint', '--python', f.executable, '--output', f.output, '--json']);
  assert.equal(child.status, 2);
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.trim().split('\n').length, 1);
  const failure = parseCommandFailure(JSON.parse(child.stdout));
  assert.equal(failure.status, 'blocked');
  assert.match(failure.message, /Hex allowance/);
  assert.ok(failure.nextSteps.length > 0);
});

test('human failure explains the operator action on stderr without a stack', t => {
  const f = fixture(JSON.stringify({ protocol: 1, kind: 'gate-failed', stage: 'input', cause: 'The output already exists.' }));
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const child = cli(['measured-hex-joint', '--python', f.executable, '--output', f.output]);
  assert.equal(child.status, 2);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /output already exists/);
  assert.match(child.stderr, /Next steps:/);
  assert.doesNotMatch(child.stderr, /\n\s+at /);
});

test('unknown bridge output and false success cannot bypass actual receipt verification', t => {
  for (const reply of ['not JSON', JSON.stringify({ protocol: 1, kind: 'validated', recipe: 'measured-hex-joint', receipt: { path: '/missing/receipt.json', sha256: '0'.repeat(64) } })]) {
    const f = fixture(reply);
    t.after(() => rmSync(f.directory, { recursive: true, force: true }));
    const result = runCadCandidate({ recipe: 'measured-hex-joint', python: f.executable, output: f.output });
    assert.equal(result.status, 'needs-chief');
    if (result.status === 'needs-chief') assert.equal(result.code, 'CAD_PROTOCOL_INVALID');
  }
});

test('a failed runner cannot leave its staged receipt as a success result', t => {
  const f = resultFixture("process.exit(9);");
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const result = runCadCandidate({ recipe: 'measured-hex-joint', python: f.executable, output: f.output });
  assert.equal(result.status, 'needs-chief');
  assert.equal(existsSync(f.output), false);
  assert.equal(existsSync(join(stagingDirectory(f.directory), 'receipt.pending.json')), false);
});

test('changed exported bytes remove the unpublished receipt and never commit the output', t => {
  const f = resultFixture("fs.appendFileSync(path.join(staging,'print','measured-hex-well.stl'),'changed');");
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const result = runCadCandidate({ recipe: 'measured-hex-joint', python: f.executable, output: f.output });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') assert.equal(result.code, 'CAD_EXPORT_CHANGED');
  assert.equal(existsSync(f.output), false);
  assert.equal(existsSync(join(stagingDirectory(f.directory), 'receipt.pending.json')), false);
});

test('a destination appearing during validation is preserved instead of overwritten', t => {
  const f = resultFixture("fs.mkdirSync(output);fs.writeFileSync(path.join(output,'earlier-work'),'keep');");
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const result = runCadCandidate({ recipe: 'measured-hex-joint', python: f.executable, output: f.output });
  assert.equal(result.status, 'needs-chief');
  assert.equal(existsSync(join(f.output, 'earlier-work')), true);
  assert.equal(existsSync(join(f.output, 'receipt.json')), false);
});

test('unexpected bridge exception routes to Chief with no raw stack or secret text', t => {
  const f = fixture(JSON.stringify({ protocol: 1, kind: 'execution-failed', stage: 'runtime', cause: 'ModuleNotFoundError' }));
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const child = cli(['measured-hex-joint', '--python', f.executable, '--output', f.output, '--json']);
  assert.equal(child.status, 3);
  const failure = parseCommandFailure(JSON.parse(child.stdout));
  assert.equal(failure.status, 'needs-chief');
  assert.match(failure.message, /ModuleNotFoundError/);
});

test('publication and discovery requests require Chief without executing them', () => {
  for (const command of ['publish', 'discover']) {
    const child = cli([command, '--json']);
    assert.equal(child.status, 3);
    const failure = parseCommandFailure(JSON.parse(child.stdout));
    assert.equal(failure.code, 'CAD_INFRASTRUCTURE_MANUAL');
  }
});
