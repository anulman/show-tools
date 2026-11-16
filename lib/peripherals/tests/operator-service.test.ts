import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
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
