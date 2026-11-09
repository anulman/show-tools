import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { deskFixture, sessionProfile } from './session-fixture.js';

const execute = promisify(execFile);
const token = 'client-ca-test-token-0123456789abcdef';

test('client CA is explicit and server fullchain does not replace default roots', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-client-ca-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = (name: string) => join(directory, name);
  function openssl(...args: string[]) { execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' }); }
  for (const name of ['root', 'unrelated']) openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', `${name}.key`, '-out', `${name}.pem`, '-days', '1', '-subj', `/CN=${name}`, '-addext', 'basicConstraints=critical,CA:TRUE');
  openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'intermediate.key', '-out', 'intermediate.csr', '-subj', '/CN=intermediate');
  await writeFile(file('intermediate.ext'), 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n');
  openssl('x509', '-req', '-in', 'intermediate.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial',
    '-out', 'intermediate.pem', '-days', '1', '-extfile', 'intermediate.ext');
  openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=desk.invalid');
  await writeFile(file('leaf.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:desk.invalid\n');
  openssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key', '-CAcreateserial',
    '-out', 'leaf.pem', '-days', '1', '-extfile', 'leaf.ext');
  const fullchain = Buffer.concat([await readFile(file('leaf.pem')), await readFile(file('intermediate.pem'))]);
  await writeFile(file('fullchain.pem'), fullchain);
  await writeFile(file('token'), token, { mode: 0o600 });
  const requests: Array<{ host: string | undefined; origin: string | undefined }> = [];
  const view = deskFixture().snapshot();
  const server = createServer({ cert: fullchain, key: await readFile(file('leaf.key')) }, (request, response) => {
    requests.push({ host: request.headers.host, origin: request.headers.origin });
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    response.end(JSON.stringify(view));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const bound = server.address(); if (!bound || typeof bound === 'string') throw new Error('Missing test port');
  const origin = `https://desk.invalid:${bound.port}`;
  const clientModule = pathToFileURL(resolve('lib/remote-performance/session-client.ts')).href;
  const profileModule = pathToFileURL(resolve('lib/remote-performance/session-profile.ts')).href;
  const clientScript = `import { readFile } from 'node:fs/promises';
    import { createSessionClient } from ${JSON.stringify(clientModule)};
    import { decodeSessionProfile } from ${JSON.stringify(profileModule)};
    const profile = decodeSessionProfile(JSON.parse(await readFile(process.argv[1], 'utf8')));
    const view = await (await createSessionClient(profile)).status();
    console.log(view.audio.kind);`;
  async function status(options: { caFile?: string; origin?: string } = {}) {
    const profilePath = file('profile.json');
    await writeFile(profilePath, JSON.stringify({ ...sessionProfile(directory), origin, connectAddress: '127.0.0.1',
      tls: { cert: file('fullchain.pem'), key: file('leaf.key') }, ...options }));
    return execute(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', clientScript, profilePath], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { ...process.env, NODE_EXTRA_CA_CERTS: file('root.pem') }, timeout: 10_000,
    });
  }
  await t.test('omitted client CA uses normal roots despite server fullchain being configured', async () => {
    assert.equal((await status()).stdout.trim(), 'off');
    assert.deepEqual(requests.at(-1), { host: `desk.invalid:${bound.port}`, origin });
  });
  await t.test('explicit root CA works', async () => {
    assert.equal((await status({ caFile: file('root.pem') })).stdout.trim(), 'off');
  });
  await t.test('server fullchain without root is not a trust anchor', async () => {
    const before = requests.length;
    await assert.rejects(status({ caFile: file('fullchain.pem') }), /Desk connection failed/);
    assert.equal(requests.length, before);
  });
  await t.test('wrong custom CA and hostname fail before HTTP', async () => {
    const before = requests.length;
    await assert.rejects(status({ caFile: file('unrelated.pem') }), /Desk connection failed/);
    await assert.rejects(status({ caFile: file('root.pem'), origin: `https://wrong.invalid:${bound.port}` }), /Desk connection failed/);
    assert.equal(requests.length, before);
  });
});
