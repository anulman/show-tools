import { createHash } from 'node:crypto';
import { buildSessionBundles, writeSessionLaunchers } from '../../../scripts/session-bundles.js';
import { SongBindingAuthority } from '../song-bindings.js';
import { tunerFixture } from './tuner-fixture.js';
import { lightFixture } from './light-fixture.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import song from '../../../songs/dance-yrself-clean.js';
import { decodeSessionProfile } from '../session-profile.js';
import { renderSessionUnit } from '../session-service.js';

const token = 'private-CLI-test-token-0123456789abcdef';
const entry = resolve('scripts/show-tools.ts');
const state = {
  phase: 'idle', bar: null, beat: null, countInRemaining: 0, bpm: 120, startBar: 1, endBar: 2,
  loop: false, automatic: false, click: false, selectedChannel: 'L1', runId: 'run', seq: 1,
  channels: ['L1', 'L2', 'R1', 'R2'].map(id => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })),
  looping: [], recording: null, microphone: false, error: null,
};

async function fixture() {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'show-tools-session-cli-')));
  const configDirectory = join(workspace, 'config');
  const bin = join(workspace, 'bin');
  await mkdir(bin);
  const requests: Array<{ path: string; body: unknown }> = [];
  let launcher: string | undefined;
  let kind = 'off';
  let phase = 'idle';
  let authorized = true;
  let bootstraps = 0;
  let transitions = 0;
  let active = false;
  let badStop = false;
  let audioFault = false;
  const view = () => ({ serverEpoch: 'server', revision: '1', song,
    audio: kind === 'ready' ? { kind, attempt: 'attempt', performance: { hostEpoch: 'native', revision: '1', tuner: tunerFixture(), lights: lightFixture(), state: { ...state, phase } } }
      : kind === 'fault' ? { kind, error: 'Synthetic native failure' } : kind === 'starting' || kind === 'stopping' ? { kind, attempt: 'attempt' } : { kind } });
  const server = createServer(async (req, res) => {
    if (!authorized || req.headers.authorization !== `Bearer ${token}` || req.headers.origin !== origin) { res.writeHead(401).end(); return; }
    let data = '';
    for await (const chunk of req) data += chunk;
    const body: unknown = data ? JSON.parse(data) : undefined;
    requests.push({ path: req.url ?? '', body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/session') { bootstraps++; res.end(JSON.stringify({ sessionId: 'cli', inputOwnerToken: 'fixture-owner-token', view: view() })); }
    else if (req.url === '/api/status') {
      if (transitions > 0 && --transitions === 0) kind = audioFault ? 'fault' : kind === 'starting' ? 'ready' : 'off';
      res.end(JSON.stringify(view()));
    } else if (req.url === '/api/songs') { res.end(JSON.stringify({ songs: [{ id: song.id, title: 'DYC', packageDigest: 'a'.repeat(64) }] }));
    } else if (req.url === '/api/song' || req.url === '/api/song-bindings') {
      res.end(JSON.stringify(kind === 'off' ? { outcome: 'accepted', view: view() } : { outcome: 'rejected', error: 'Audio must be off', view: view() }));
    } else if (req.url === '/api/audio') {
      assert.deepEqual(body, { sessionId: 'cli', sequence: 1, goal: kind === 'ready' ? 'off' : 'on' });
      kind = kind === 'ready' ? 'stopping' : 'starting'; transitions = 3;
      res.end(JSON.stringify({ outcome: 'accepted', view: view() }));
    } else res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const profilePath = join(workspace, 'profile.json');
  const profile = decodeSessionProfile({ schemaVersion: 2, restartPolicy: 'on-failure', serviceName: 'show-tools-test.service', host: '127.0.0.1', port: address.port, origin,
    server: { nodeExecutable: process.execPath, entrypoint: '/opt/show tools/server $x%test".mjs' },
    tokenFile: join(workspace, 'token'), staticRoot: '/opt/desk', runtimeRoot: '/tmp/desk',
    native: { executable: '/opt/native', sampleRate: 48000, blockFrames: 256, maxVoices: 8, maxSeconds: 30, driver: { kind: 'fake', inputLevel: 0 } },
    catalog: { initialSongId: 'dance-yrself-clean', entries: [{ id: 'dance-yrself-clean', path: '/opt/song' }] }, authoringDatabase: join(workspace, 'bindings.sqlite'),
  });
  await writeFile(profilePath, JSON.stringify(profile));
  await writeFile(profile.tokenFile, token, { mode: 0o600 });
  const unit = join(configDirectory, 'systemd', 'user', profile.serviceName);
  const control = join(workspace, 'control.json');
  const calls = join(workspace, 'calls.jsonl');
  const fake = `#!${process.execPath}\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({command:process.argv[1],args})+'\\n');\nconst control=${JSON.stringify(control)};\nconst s=JSON.parse(fs.readFileSync(control));\nif(process.argv[1].endsWith('loginctl')) {console.log('no');process.exit(0);}\nif(args[1]==='show') {console.log('LoadState=loaded\\nActiveState='+(s.active?'active':'inactive')+'\\nSubState='+(s.active?'running':'dead')+'\\nMainPID='+(s.active?'42':'0')+'\\nFragmentPath='+${JSON.stringify(unit)}+'\\nDropInPaths=\\nTasksCurrent='+(s.active?'2':'0'));}\nelse if(args[1]==='start') {s.active=true;fs.writeFileSync(control,JSON.stringify(s));}\nelse if(args[1]==='stop') {if(!s.badStop)s.active=false;fs.writeFileSync(control,JSON.stringify(s));}\n`;
  for (const name of ['systemctl', 'loginctl']) { await writeFile(join(bin, name), fake); await chmod(join(bin, name), 0o700); }
  await writeFile(join(bin, 'package.json'), '{"type":"module"}');
  async function sync() { await writeFile(control, JSON.stringify({ active, badStop })); }
  async function cli(...args: string[]) {
    await sync();
    const child = spawn(launcher ?? process.execPath, launcher ? args : ['--import', 'tsx', entry, 'session', ...args], {
      env: { ...process.env, XDG_CONFIG_HOME: configDirectory, PATH: bin + ':' + process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'exit');
    assert(!stdout.includes(token) && !stderr.includes(token), 'secrets stay out of output');
    const result = JSON.parse(await readFile(control, 'utf8'));
    active = result.active;
    return { code, stdout, stderr };
  }
  return { workspace, configDirectory, unit, profile, profilePath, requests, cli, origin, bin, useLauncher: (path: string) => { launcher = path; },
    closeServer: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); },
    bootstraps: () => bootstraps,
    calls: async () => { try { return (await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } },
    set: (values: { kind?: string; phase?: string; authorized?: boolean; active?: boolean; badStop?: boolean; audioFault?: boolean }) => {
      kind = values.kind ?? kind; phase = values.phase ?? phase; authorized = values.authorized ?? authorized; active = values.active ?? active; badStop = values.badStop ?? badStop; audioFault = values.audioFault ?? audioFault;
    },
    installFile: async () => { await mkdir(dirname(unit), { recursive: true }); await writeFile(unit, renderSessionUnit(profile, profilePath)); },
    close: async () => { if (server.listening) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } await rm(workspace, { recursive: true, force: true }); },
  };
}

test('session help and invalid commands never invoke systemctl or bootstrap', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.cli('--help')).code, 0);
    assert.notEqual((await f.cli('nonsense')).code, 0);
    assert.match((await f.cli('status', '--profile', join(f.workspace, 'absent'))).stderr, /No target is assumed/);
    assert.deepEqual(await f.calls(), []); assert.equal(f.bootstraps(), 0);
    await mkdir(join(f.configDirectory, 'show-tools'), { recursive: true });
    await writeFile(join(f.configDirectory, 'show-tools', 'session.json'), JSON.stringify(f.profile));
    assert.equal((await f.cli('status')).code, 0, 'default profile uses the isolated XDG configuration directory');
  } finally { await f.close(); }
});

test('install is idempotent, escapes unit paths, never enables without explicit flag, refuses foreign unit', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.cli('install', '--profile', f.profilePath)).code, 0);
    const unit = await readFile(f.unit, 'utf8');
    assert.match(unit, /KillMode=control-group/); assert.match(unit, /Restart=on-failure/);
    assert.match(unit, /RestartSec=3s/); assert.match(unit, /StartLimitIntervalSec=0/);
    assert.match(unit, /server \$\$x%%test\\"\.mjs/);
    assert(!unit.includes(token)); assert(!unit.includes('RuntimeMaxSec'));
    assert(!(await f.calls()).some(call => call.args.includes('enable')));
    assert.equal((await f.cli('install', '--enable', '--profile', f.profilePath)).code, 0);
    assert((await f.calls()).some(call => call.args.includes('enable')));
    await writeFile(f.unit, 'foreign');
    const failure = await f.cli('install', '--profile', f.profilePath);
    assert.notEqual(failure.code, 0); assert.match(failure.stderr, /Refusing to overwrite/);
    assert.equal(await readFile(f.unit, 'utf8'), 'foreign');
  } finally { await f.close(); }
});

test('status is read-only and repeated start leaves a playing engine untouched', async () => {
  const f = await fixture();
  try {
    await f.installFile(); f.set({ active: true, kind: 'ready', phase: 'playing' });
    for (const action of ['status', 'start', 'start', 'audio']) {
      const result = await f.cli(...(action === 'audio' ? ['audio', 'status'] : [action]), '--profile', f.profilePath);
      assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /transport playing/);
    }
    assert.equal(f.bootstraps(), 0); assert(f.requests.every(req => req.path === '/api/status'));
    assert(!(await f.calls()).some(call => call.args.includes('stop')));
  } finally { await f.close(); }
});

test('audio on and off bootstrap once per mutation, poll status, and never send musical Start', async () => {
  const f = await fixture();
  try {
    for (const goal of ['on', 'off']) {
      const result = await f.cli('audio', goal, '--profile', f.profilePath);
      assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, goal === 'on' ? /Audio ready; transport idle/ : /Audio off; native takes discarded/);
    }
    assert.equal(f.bootstraps(), 2);
    assert.equal(f.requests.filter(req => req.path === '/api/audio').length, 2);
    assert(f.requests.filter(req => req.path === '/api/status').length >= 6);
    assert(!f.requests.some(req => req.path === '/api/command'));
    assert.deepEqual(await f.calls(), []);
  } finally { await f.close(); }
});

test('explicit session stop terminates a playing service and verifies the empty group', async () => {
  const f = await fixture();
  try {
    await f.installFile(); f.set({ active: true, kind: 'ready', phase: 'playing' });
    const result = await f.cli('stop', '--profile', f.profilePath);
    assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /process group empty; native takes discarded/);
    f.set({ active: true, badStop: true });
    const failed = await f.cli('stop', '--profile', f.profilePath);
    assert.notEqual(failed.code, 0); assert.match(failed.stderr, /did not verify/);
  } finally { await f.close(); }
});

test('start fails closed for authentication failure or another owner, and rejects unsafe unit paths', async () => {
  const f = await fixture();
  try {
    await f.installFile(); f.set({ authorized: false });
    assert.notEqual((await f.cli('start', '--profile', f.profilePath)).code, 0);
    assert(!(await f.calls()).some(call => call.args.includes('start')));
    f.set({ authorized: true });
    assert.match((await f.cli('start', '--profile', f.profilePath)).stderr, /Resolve ownership/);
    assert.throws(() => renderSessionUnit({ ...f.profile, server: { ...f.profile.server, entrypoint: '/opt/server\nExecStart=/bin/evil' } }, f.profilePath), /control characters/);
    await chmod(f.profile.tokenFile, 0o644);
    assert.match((await f.cli('audio', 'status', '--profile', f.profilePath)).stderr, /owner-only/);
  } finally { await f.close(); }
});


test('start from absent launches a supervisor-owned server that outlives the CLI; stop ends it', async () => {
  const f = await fixture();
  const pidPath = join(f.workspace, 'managed.pid');
  try {
    await f.installFile();
    await f.closeServer();
    const view = { serverEpoch: 'server', revision: '1', song, audio: { kind: 'off' } };
    const viewPath = join(f.workspace, 'view.json');
    await writeFile(viewPath, JSON.stringify(view));
    const managed = join(f.workspace, 'managed.mjs');
    await writeFile(managed, `import {createServer} from 'node:http'; import fs from 'node:fs';
const token=fs.readFileSync(${JSON.stringify(f.profile.tokenFile)},'utf8');
const server=createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end();return;}res.end(fs.readFileSync(${JSON.stringify(viewPath)}));});
server.listen(${f.profile.port},'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`);
    const systemctl = join(f.bin, 'systemctl');
    let source = await readFile(systemctl, 'utf8');
    source = source.replace("import fs from 'node:fs';", "import fs from 'node:fs'; import {spawn} from 'node:child_process';");
    source = source.replace("s.active=true;", `const child=spawn(${JSON.stringify(process.execPath)},[${JSON.stringify(managed)}],{detached:true,stdio:'ignore'});child.unref();fs.writeFileSync(${JSON.stringify(pidPath)},String(child.pid));s.active=true;`);
    source = source.replace("if(!s.badStop)s.active=false;", `if(!s.badStop){process.kill(Number(fs.readFileSync(${JSON.stringify(pidPath)},'utf8')),'SIGTERM');s.active=false;}`);
    await writeFile(systemctl, source);
    const started = await f.cli('start', '--profile', f.profilePath);
    assert.equal(started.code, 0, started.stderr);
    assert.match(started.stdout, /Server active.*Audio off/);
    assert.match(started.stdout, /Linger=no.*not provisioned/);
    const response = await fetch(f.origin + '/api/status', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200, 'server remains after invoking CLI exits');
    assert.equal((await f.cli('stop', '--profile', f.profilePath)).code, 0);
    await assert.rejects(fetch(f.origin + '/api/status'));
  } finally {
    try { process.kill(Number(await readFile(pidPath, 'utf8')), 'SIGKILL'); } catch {}
    await f.close();
  }
});


test('audio fault ends bounded readiness with an actionable failure and one bootstrap', async () => {
  const f = await fixture();
  try {
    f.set({ audioFault: true });
    const result = await f.cli('audio', 'on', '--profile', f.profilePath);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Audio fault: Synthetic native failure/);
    assert.equal(f.bootstraps(), 1);
    assert.equal(f.requests.filter(req => req.path === '/api/audio').length, 1);
  } finally { await f.close(); }
});


test('install refuses to silently replace an older web unit restart policy', async () => {
  const f = await fixture();
  try {
    const legacy = renderSessionUnit(f.profile, f.profilePath).replace('StartLimitIntervalSec=0\n', '').replace('Restart=on-failure\nRestartSec=3s', 'Restart=no');
    await mkdir(dirname(f.unit), { recursive: true });
    await writeFile(f.unit, legacy);
    const result = await f.cli('install', '--enable', '--profile', f.profilePath);
    assert.notEqual(result.code, 0); assert.match(result.stderr, /Refusing to overwrite/);
    assert.equal(await readFile(f.unit, 'utf8'), legacy);
    assert.deepEqual(await f.calls(), [], 'reviewed upgrade remains separate from install/start');
    assert.equal(f.bootstraps(), 0);
  } finally { await f.close(); }
});


test('song list and explicit bindings use authenticated sequenced gateway revisions; enabled audio blocks mutations', async () => {
  const f = await fixture();
  try {
    const list = await f.cli('songs', 'list', '--profile', f.profilePath);
    assert.equal(list.code, 0, list.stderr); assert.match(list.stdout, /DYC/);
    const selected = await f.cli('songs', 'select', '--song', song.id, '--profile', f.profilePath);
    assert.equal(selected.code, 0, selected.stderr);
    const bindings = [{ controlId: 'red', target: { kind: 'cue-rows', rows: ['R1'] } }];
    const filename = join(f.workspace, 'buttons.json'); await writeFile(filename, JSON.stringify(bindings));
    const assigned = await f.cli('songs', 'bind', '--song', song.id, '--bindings', filename, '--profile', f.profilePath);
    assert.equal(assigned.code, 0, assigned.stderr);
    assert.deepEqual(f.requests.filter(request => request.path === '/api/song' || request.path === '/api/song-bindings'), [
      { path: '/api/song', body: { sessionId: 'cli', sequence: 1, songId: song.id, expectedRevision: '1' } },
      { path: '/api/song-bindings', body: { sessionId: 'cli', sequence: 1, songId: song.id, expectedRevision: '1', bindings } },
    ]);
    f.set({ kind: 'ready' });
    const blocked = await f.cli('songs', 'select', '--song', song.id, '--profile', f.profilePath);
    assert.notEqual(blocked.code, 0); assert.match(blocked.stderr, /audio off/);
    assert.equal(f.requests.filter(request => request.path === '/api/song').length, 1);
    assert.deepEqual(await f.calls(), []);
  } finally { await f.close(); }
});

test('explicit V1 migration preserves host settings, requires new output and never contacts services', async () => {
  const f = await fixture();
  try {
    const { catalog, authoringDatabase, restartPolicy: _restart, ...current } = f.profile;
    const original = { ...current, schemaVersion: 1, package: { manifest: '/opt/old.json', packet: '/opt/old.pfp', effects: '/opt/old-fx.json' } };
    const input = join(f.workspace, 'v1.json'), output = join(f.workspace, 'v2.json'), catalogFile = join(f.workspace, 'catalog.json');
    await writeFile(input, JSON.stringify(original));
    await mkdir(join(f.workspace, 'songs/dyc'), { recursive: true });
    await writeFile(catalogFile, JSON.stringify({ schemaVersion: 1, initialSongId: catalog.initialSongId, entries: [{ id: catalog.initialSongId, path: 'songs/dyc', title: 'DYC', packageDigest: 'a'.repeat(64), files: Object.fromEntries(['manifest.json', 'song.pfp', 'effects.json', 'source.musicxml'].map(name => [name, createHash('sha256').update('fixture').digest('hex')])) }] }));
    for (const name of ['manifest.json', 'song.pfp', 'effects.json', 'source.musicxml']) await writeFile(join(f.workspace, 'songs/dyc', name), 'fixture');
    for (const path of ['runtime/node', 'gateway/server.mjs', 'native/native_alsa_host']) { await mkdir(dirname(join(f.workspace, path)), { recursive: true }); await writeFile(join(f.workspace, path), 'fixture'); }
    await mkdir(join(f.workspace, 'static')); await writeFile(join(f.workspace, 'release.json'), '{"schemaVersion":1}');
    const args = ['profile', 'migrate', '--input', input, '--output', output, '--catalog', catalogFile, '--release', f.workspace, '--authoring-database', authoringDatabase, '--restart-policy', 'no'];
    const migrated = await f.cli(...args); assert.equal(migrated.code, 0, migrated.stderr);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { ...current, schemaVersion: 2, catalog: { initialSongId: catalog.initialSongId, entries: [{ id: catalog.initialSongId, path: join(f.workspace, 'songs/dyc') }] }, authoringDatabase, restartPolicy: 'no', server: { nodeExecutable: join(f.workspace, 'runtime/node'), entrypoint: join(f.workspace, 'gateway/server.mjs') }, native: { ...current.native, executable: join(f.workspace, 'native/native_alsa_host') }, staticRoot: join(f.workspace, 'static') });
    assert.equal(await readFile(input, 'utf8'), JSON.stringify(original));
    assert.notEqual((await f.cli(...args)).code, 0);
    assert.deepEqual(await f.calls(), []); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});


test('binding backup verify and create-only restore report their limited scope and retain existing targets', async () => {
  const f = await fixture();
  try {
    SongBindingAuthority.open(f.profile.authoringDatabase).close();
    const backup = join(f.workspace, 'backup.sqlite'), restored = join(f.workspace, 'restored.sqlite');
    const result = await f.cli('bindings', 'backup', '--profile', f.profilePath, '--output', backup);
    assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /excludes charts, effects and recordings/);
    assert.equal((await f.cli('bindings', 'verify', '--input', backup)).code, 0);
    assert.equal((await f.cli('bindings', 'restore', '--input', backup, '--output', restored)).code, 0);
    const before = await readFile(restored);
    assert.notEqual((await f.cli('bindings', 'restore', '--input', backup, '--output', restored)).code, 0);
    assert.deepEqual(await readFile(restored), before);
    assert.deepEqual(await f.calls(), []); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('peripheral serve waits unconfigured without USB and exits cleanly when cancelled', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'show-tools-peripheral-wait-'));
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', entry, 'peripheral', 'serve', '--config', join(workspace, 'missing.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const ready = new Promise<void>((done, reject) => { child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('USB is unopened')) done(); }); child.once('exit', () => reject(new Error('Peripheral exited before waiting state: ' + stderr))); });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      await ready;
      child.kill('SIGTERM');
      const [code] = await once(child, 'exit'); assert.equal(code, 0, stderr);
      assert.match(stdout, /Waiting for peripheral configuration/);
    } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill('SIGKILL'); }
  } finally { await rm(workspace, { recursive: true, force: true }); }
});


test('release-relative installed launchers expose setup help and authenticated session status', async () => {
  const f = await fixture();
  try {
    const release = join(f.workspace, 'release');
    for (const directory of ['gateway', 'provenance', 'bin', 'runtime']) await mkdir(join(release, directory), { recursive: true });
    await buildSessionBundles(resolve('.'), release); await writeSessionLaunchers(release);
    await symlink(process.execPath, join(release, 'runtime/node'));
    f.useLauncher(join(release, 'bin/show-tools-session'));
    const help = await f.cli('--help'); assert.equal(help.code, 0, help.stderr); assert.match(help.stdout, /songs/);
    await f.installFile(); f.set({ active: true });
    const status = await f.cli('status', '--profile', f.profilePath); assert.equal(status.code, 0, status.stderr); assert.match(status.stdout, /Server active.*Audio off/);
    const child = spawn(join(release, 'bin/show-tools-peripheral'), ['setup', '--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'exit'); assert.equal(code, 0, stderr); assert.match(stdout, /--dial/); assert.match(stdout, /--test/);
  } finally { await f.close(); }
});
