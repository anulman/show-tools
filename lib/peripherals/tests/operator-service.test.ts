import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { renderPeripheralUnit } from '../service-unit.js';
import { sessionProfile } from '../../remote-performance/tests/session-fixture.js';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

test('fixed-target operator installer verifies pins and create-only lifecycle with simulated manager and owned files', () => {
  execFileSync('python3', ['-I', resolve('lib/peripherals/operator-service/tests.py')], { stdio: 'pipe' });
});

test('operator packet stays pending without explicit tuning and pins a resolved synthetic profile without activation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'operator-packet-fixture-'));
  try {
    const release = join(directory, 'synthetic-release');
    const revision = '2'.repeat(40), webRevision = 'd8fa3cf199496d0f4897357f8e9cfad9f1415e9c';
    const destination = '/home/anulman/.local/share/show-tools/releases/session-2222222';
    const webDestination = '/home/anulman/.local/share/show-tools/releases/session-d8fa3cf';
    const names = ['release.json', 'runtime/node', 'bin/show-tools-peripheral', 'gateway/peripheral-cli.mjs', 'native/peripheral/peripheral-host', 'bin/show-tools-session', 'gateway/session-cli.mjs'];
    for (const name of names) {
      const path = join(release, name); await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, name === 'release.json' ? JSON.stringify({ sourceRevision: revision }) : `synthetic fixture ${name}`);
    }
    const installerSource = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const prepare = (...args: string[]) => JSON.parse(execFileSync(process.execPath,
      ['--import', 'tsx', resolve('lib/peripherals/operator-service/prepare.ts'), '--release', release, '--source-revision', revision, '--installer-source-revision', installerSource, ...args], { encoding: 'utf8', stdio: 'pipe' }));
    const pending = join(directory, 'pending');
    assert.equal(prepare('--out', pending).ready, false);
    await assert.rejects(access(join(pending, 'manifest.json')));
    await assert.rejects(access(join(pending, 'OPERATOR-COMMAND.txt')));
    const web = { ...sessionProfile(directory), serviceName: 'show-tools-web.service', origin: 'https://proxmox.tail54fc55.ts.net:8443', connectAddress: '100.93.139.99', tokenFile: '/home/anulman/.config/show-tools/credentials/token', server: { nodeExecutable: webDestination + '/runtime/node', entrypoint: webDestination + '/gateway/server.mjs' } };
    const webBytes = JSON.stringify(web), webFile = join(directory, 'synthetic-web-profile.json');
    await writeFile(webFile, webBytes, { mode: 0o600 });
    const mapFile = join(directory, 'synthetic-map.json');
    const inputMap = { sources: [{ kind: 'linux', id: 'synthetic', interfaceNumber: 2, eventTypes: [0, 1], keyCodes: [41], relativeAxes: [] }],
      switches: [{ controlId: 'blue', sourceId: 'synthetic', type: 1, code: 41 }], leds: [], confirmWiring: false };
    await writeFile(mapFile, JSON.stringify(inputMap));
    const withoutMap = join(directory, 'without-map');
    assert.equal(prepare('--out', withoutMap, '--web-profile', webFile, '--web-source-revision', webRevision, '--disable-jiggle').ready, false);
    await assert.rejects(access(join(withoutMap, 'OPERATOR-COMMAND.txt')));
    const output = join(directory, 'synthetic-final');
    const result = prepare('--input-map', mapFile, '--out', output, '--web-profile', webFile, '--web-source-revision', webRevision, '--jiggle-travel', '4', '--jiggle-reversal', '2');
    assert.equal(result.ready, true);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.webProfileSha256, sha(webBytes));
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.installerSourceRevision, installerSource);
    assert.equal(manifest.sourceRevision, revision);
    assert.equal(manifest.webSourceRevision, webRevision);
    for (const [name, digest] of Object.entries(manifest.files)) assert.equal(sha(await readFile(join(output, name))), digest);
    assert.equal(await readFile(join(output, 'show-tools-peripheral.service'), 'utf8'), renderPeripheralUnit(destination + '/bin/show-tools-peripheral', '/home/anulman/.config/show-tools/peripheral.json'));
    assert.match(await readFile(join(output, 'OPERATOR-COMMAND.txt'), 'utf8'), /--manifest-sha256 [a-f0-9]{64} --activate/);
    const profile = JSON.parse(await readFile(join(output, 'profile.json'), 'utf8'));
    assert.equal(profile.version, 2); assert.deepEqual(profile.inputMap, inputMap);
    assert.equal(profile.buttonKey, undefined); assert.equal(profile.sdkChannel, undefined);
    assert.equal(profile.caFile, undefined);
    const disabled = join(directory, 'synthetic-disabled');
    assert.equal(prepare('--input-map', mapFile, '--out', disabled, '--web-profile', webFile, '--web-source-revision', webRevision, '--disable-jiggle').ready, true);
    assert.equal(JSON.parse(await readFile(join(disabled, 'profile.json'), 'utf8')).jiggle, null);
    assert.throws(() => prepare('--out', join(directory, 'invalid-mixed'), '--disable-jiggle', '--jiggle-travel', '4', '--jiggle-reversal', '2'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('waiting packet pins the reviewed CLI and emits no profile or credential requirement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'operator-waiting-fixture-'));
  try {
    const release = join(directory, 'release');
    const repository = join(directory, 'reviewed-source');
    await mkdir(repository);
    const env = { ...process.env, GIT_DIR: join(repository, '.git'), GIT_WORK_TREE: repository };
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, env, encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init', '--quiet');
    git('config', '--local', 'user.name', 'Operator fixture');
    git('config', '--local', 'user.email', 'operator-fixture@example.invalid');
    git('config', '--local', 'commit.gpgsign', 'false');
    git('config', '--local', 'core.hooksPath', '/dev/null');
    const cliSource = await readFile(resolve('lib/peripherals/bridge-cli.ts'));
    const cliPath = join(repository, 'lib/peripherals/bridge-cli.ts');
    await mkdir(resolve(cliPath, '..'), { recursive: true });
    await writeFile(cliPath, cliSource);
    git('add', 'lib/peripherals/bridge-cli.ts');
    git('commit', '--quiet', '-m', 'Reviewed waiting CLI');
    const revision = git('rev-parse', 'HEAD');
    const installerPath = join(repository, 'lib/peripherals/operator-service/install.py');
    await mkdir(resolve(installerPath, '..'), { recursive: true });
    await writeFile(installerPath, await readFile(resolve('lib/peripherals/operator-service/install.py')));
    git('add', 'lib/peripherals/operator-service/install.py');
    git('commit', '--quiet', '-m', 'Reviewed standalone installer');
    const installerRevision = git('rev-parse', 'HEAD');
    const names = ['release.json', 'runtime/node', 'bin/show-tools-peripheral', 'gateway/peripheral-cli.mjs', 'native/peripheral/peripheral-host', 'bin/show-tools-session', 'gateway/session-cli.mjs', 'provenance/source/lib/peripherals/bridge-cli.ts'];
    for (const name of names) {
      const path = join(release, name); await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, name === 'release.json' ? JSON.stringify({ sourceRevision: revision }) : name.startsWith('provenance/') ? cliSource : `synthetic fixture ${name}`);
    }
    const prepare = (out: string, ...extra: string[]) => JSON.parse(execFileSync(process.execPath,
      ['--import', 'tsx', resolve('lib/peripherals/operator-service/prepare.ts'), '--release', release, '--source-revision', revision, '--installer-source-revision', installerRevision, '--waiting-configuration', '--out', out, ...extra], { env, encoding: 'utf8', stdio: 'pipe' }));
    const output = join(directory, 'packet');
    const result = prepare(output);
    assert.equal(result.ready, true);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 3);
    assert.equal(manifest.mode, 'waiting-configuration');
    assert.deepEqual(Object.keys(manifest.files).sort(), ['install.py', 'show-tools-peripheral.service']);
    assert.equal(manifest.webProfileSha256, undefined);
    assert.equal(manifest.waitingCliSourceSha256, sha(await readFile(resolve('lib/peripherals/bridge-cli.ts'))));
    await assert.rejects(access(join(output, 'profile.json')));
    assert.match(await readFile(join(output, 'README.txt'), 'utf8'), /without sudo/);
    assert.match(await readFile(join(output, 'OPERATOR-COMMAND.txt'), 'utf8'), /--manifest-sha256 [a-f0-9]{64} --activate/);
    const command = await readFile(join(output, 'OPERATOR-COMMAND.txt'));
    const reference = JSON.parse(await readFile(join(output, 'BOOTSTRAP-REFERENCE.json'), 'utf8'));
    assert.deepEqual(reference, { schemaVersion: 1, applicationSourceRevision: revision, installerSourceRevision: installerRevision, manifestSha256: sha(await readFile(join(output, 'manifest.json'))), command: { path: `/home/anulman/.local/share/show-tools/staging/peripheral-service-${revision.slice(0, 7)}-${installerRevision.slice(0, 7)}/OPERATOR-COMMAND.txt`, bytes: command.byteLength, sha256: sha(command) } });
    assert.equal(reference.manifestSha256, result.manifestSha256);
    assert.equal(command.at(-1), 10);
    assert.equal((await stat(join(output, 'BOOTSTRAP-REFERENCE.json'))).mode & 0o777, 0o600);
    assert.notEqual(reference.applicationSourceRevision, reference.installerSourceRevision);
    assert.throws(() => prepare(output));
    assert.equal(sha(await readFile(join(output, 'OPERATOR-COMMAND.txt'))), reference.command.sha256);
    for (const extra of [['--disable-jiggle'], ['--input-map', '/unused'], ['--web-profile', '/unused'], ['--jiggle-travel', '4']]) {
      assert.throws(() => prepare(join(directory, `mixed-${extra[0]}`), ...extra));
    }
    await writeFile(join(release, 'provenance/source/lib/peripherals/bridge-cli.ts'), 'old CLI source');
    const rejected = join(directory, 'rejected');
    assert.throws(() => prepare(rejected), /Waiting CLI source differs from the reviewed missing-configuration implementation/);
    await assert.rejects(access(join(rejected, 'OPERATOR-COMMAND.txt')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real serve CLI waits with a missing profile and refuses invalid configuration without spawning a helper', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'operator-waiting-cli-'));
  const missing = join(directory, 'peripheral.json');
  const moduleUrl = pathToFileURL(resolve('lib/peripherals/bridge-cli.ts')).href;
  const driver = `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
childProcess.spawn = () => { throw new Error('Unexpected helper spawn'); };
syncBuiltinESMExports();
const { runPeripheralCli } = await import(${JSON.stringify(moduleUrl)});
await runPeripheralCli(['serve', '--config', ${JSON.stringify(missing)}]);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', driver], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr.on('data', data => { errors += data; });
  try {
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`No waiting status: ${errors}`)), 3000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`CLI exited before waiting: ${code}; ${errors}`)); });
      child.stdout.on('data', data => {
        output += data;
        if (output.includes('USB is unopened.')) { clearTimeout(timer); resolveReady(); }
      });
    });
    const exited = new Promise<number | null>(resolveExit => child.once('exit', resolveExit));
    child.kill('SIGTERM');
    assert.equal(await exited, 0);
    assert.equal(errors, '');
    await writeFile(missing, 'invalid profile');
    assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', driver], { stdio: 'pipe' }), error => {
      assert.ok(error instanceof Error);
      assert.ok('stderr' in error);
      assert.match(String(error.stderr), /SyntaxError/);
      assert.doesNotMatch(String(error.stderr), /Unexpected helper spawn/);
      return true;
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});
