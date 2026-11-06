import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnCDP } from '../start-cdp.js';
import { HELP, parseCommand, runSheets } from '../show-tools.js';
import { inspectCDP, openSetList, parseChartSelection, type CDPConnection } from '../open-chart.js';
import { SONGS, loadSong } from '../../songs/index.js';
import { rangeForBar } from '../../lib/performance/chart.js';

const env = { SHOW_TOOLS_CDP_PORT: '49197', SHOW_TOOLS_PRACTICE_ORIGIN: 'https://practice.example' };
const command = { kind: 'sheets', launch: true, open: false } satisfies Parameters<typeof runSheets>[0];
const refused = () => new Error('fetch failed', { cause: Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }) });
const noLaunch = async () => { assert.fail('must not launch a browser'); };
const execute = promisify(execFile);

function logs(controller?: AbortController) {
  const messages: string[] = [];
  return { messages, log(message: string) {
    messages.push(message);
    if (message.startsWith('Waiting for practice events.')) controller?.abort();
  } };
}
function helperURL(messages: string[]) {
  const message = messages.find(line => line.startsWith('Helper    listening '));
  assert(message, 'helper announced its bound ephemeral port');
  return message.slice('Helper    listening '.length);
}
async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
}

test('CLI parses optional slug or one-based index and flags', () => {
  assert.deepEqual(parseCommand([]), { kind: 'help' });
  assert.deepEqual(parseCommand(['sheets']), { ...command, songId: undefined, open: true });
  assert.deepEqual(parseCommand(['songs']), { kind: 'songs' });
  for (const [index, song] of SONGS.entries()) {
    assert.deepEqual(parseCommand(['sheets', String(index + 1)]), { ...command, songId: song.id, open: true });
    assert.deepEqual(parseCommand(['sheets', song.id, '--skip-open', '--no-cdp']), {
      ...command, songId: song.id, launch: false, open: false,
    });
  }
  assert.deepEqual(parseCommand(['sheets', '--no-cdp', '--skip-open']), { ...command, songId: undefined, launch: false, open: false });
});

test('CLI rejects invalid commands, extra songs, indices and options', () => {
  for (const args of [['wat'], ['songs', '1'], ['sheets', '0'], ['sheets', '999'], ['sheets', 'missing'],
    ['sheets', '-1'], ['sheets', '--wat'], ['sheets', '1', '2'], ['sheets', '1.5']]) {
    assert.throws(() => parseCommand(args));
  }
});

test('executable help and song list finish without service configuration', async () => {
  const executableEnv = { ...process.env, SHOW_TOOLS_CDP_PORT: 'invalid', SHOW_TOOLS_CHROMIUM_APP: '/missing-browser' };
  for (const args of [[], ['--help'], ['sheets', '--help'], ['-h']]) {
    const result = await execute('./show-tools', args, { env: executableEnv, timeout: 10000 });
    assert.equal(result.stdout, HELP);
    assert.equal(result.stderr, '');
  }
  const result = await execute('./show-tools', ['songs'], { env: executableEnv, timeout: 10000 });
  for (const [index, song] of SONGS.entries()) assert(result.stdout.includes(`${index + 1}  ${song.id}  `));
  assert.equal(result.stderr, '');
  await assert.rejects(execute('./show-tools', ['sheets', '0'], { timeout: 10000 }), { code: 2 });
});

test('direct launcher invocation through a symlink executes instead of silently succeeding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-entry-'));
  try {
    const alias = join(directory, 'show-tools.ts');
    await symlink(fileURLToPath(new URL('../show-tools.ts', import.meta.url)), alias);
    const help = await execute(process.execPath, ['--import', 'tsx', alias, 'chart', '--help']);
    assert.match(help.stdout, /chart encode --song SONG.json/);
    assert.equal(help.stderr, '');
    await assert.rejects(execute(process.execPath, ['--import', 'tsx', alias, 'chart', 'encode', '--json']), error => {
      assert(error instanceof Error && 'code' in error && 'stdout' in error);
      assert.equal(error.code, 2);
      assert.match(String(error.stdout), /"status":"blocked"/);
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('reuses configured CDP, serves configured practice origin, and closes helper on cancellation', async () => {
  const controller = new AbortController();
  const output = logs();
  let ready = () => {};
  const waiting = new Promise<void>(done => { ready = done; });
  const running = runSheets(command, { env, port: 0, signal: controller.signal, log: message => {
    output.log(message); if (message.startsWith('Waiting')) ready();
  },
    inspect: async (address, signal) => { assert.equal(address, 'http://127.0.0.1:49197'); assert(signal); return 'Chrome/test'; }, launch: noLaunch,
  });
  try {
    await Promise.race([waiting, running.then(() => assert.fail('exited before readiness'))]);
    const response = await fetch(`${helperURL(output.messages)}/open`, { method: 'OPTIONS', headers: { Origin: env.SHOW_TOOLS_PRACTICE_ORIGIN } });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.SHOW_TOOLS_PRACTICE_ORIGIN);
    assert(output.messages.some(message => message.includes('reused Chrome/test')));
  } finally { controller.abort(); await running; }
  await assert.rejects(fetch(helperURL(output.messages)));
});

test('--no-cdp fails clearly for an absent browser without launching', async () => {
  await assert.rejects(runSheets({ ...command, launch: false }, { env, port: 0, inspect: async () => { throw refused(); }, launch: noLaunch }), /No CDP browser.*omit --no-cdp/);
});

test('an incompatible occupied CDP endpoint never launches a browser', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('{}'); });
  const port = await listen(server);
  try {
    await assert.rejects(runSheets(command, { env: { ...env, SHOW_TOOLS_CDP_PORT: String(port) }, port: 0, inspect: inspectCDP, launch: noLaunch }), /Cannot reuse CDP[\s\S]*occupied by another service/);
  } finally { await close(server); }
});

test('occupied helper port fails before inspecting or launching CDP', async () => {
  const server = createServer();
  const port = await listen(server);
  try {
    await assert.rejects(runSheets(command, { env, port, inspect: async () => assert.fail('must bind helper first'), launch: noLaunch }), { code: 'EADDRINUSE' });
  } finally { await close(server); }
});

test('startup selects the registered song lead-in with activation; skip-open leaves it alone', async () => {
  const songId = 'drunk-girls';
  const song = await loadSong(songId);
  for (const open of [true, false]) {
    const controller = new AbortController();
    const output = logs(controller);
    const selections: unknown[] = [];
    await runSheets({ ...command, songId, open }, { env, port: 0, signal: controller.signal, ...output,
      inspect: async () => 'Chromium/test', launch: noLaunch,
      select: async (address, input, _connect, signal) => {
        assert.equal(address, 'http://127.0.0.1:49197'); assert(signal);
        selections.push(input);
        const selection = parseChartSelection(input);
        return { ok: true, selectedRange: selection.range, url: 'https://docs.google.com/spreadsheets/test' };
      },
    });
    assert.deepEqual(selections, open ? [{ spreadsheetId: song.chart.spreadsheetId, sheetId: song.chart.sheetId,
      range: rangeForBar(song.chart, song.practice.startBar, 'count-in'), activate: true }] : []);
    await assert.rejects(fetch(helperURL(output.messages)));
  }
});

test('cancelling an in-flight inspection aborts it and releases the helper', async () => {
  const controller = new AbortController();
  let aborted = false;
  await runSheets(command, { env, port: 0, signal: controller.signal, log: () => {}, launch: noLaunch,
    inspect: async (_address, signal) => {
      assert(signal);
      const stopped = new Promise<never>((_done, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true }));
      controller.abort();
      return stopped;
    },
  });
  assert(aborted);
});

async function fakeBrowser() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const exited = new Promise<Error>(done => {
    child.once('error', done);
    child.once('exit', (code, signal) => done(new Error(`Chromium exited (${signal || code}).`)));
  });
  await once(child, 'spawn');
  return { child, exited };
}

test('cancellation terminates only the browser launched by this run', async () => {
  const controller = new AbortController();
  const output = logs(controller);
  const browser = await fakeBrowser();
  const { child } = browser;
  let inspections = 0;
  try {
    await runSheets(command, { env, port: 0, signal: controller.signal, ...output,
      inspect: async () => { if (++inspections === 1) throw refused(); return 'Chrome/fake'; },
      launch: async receivedEnv => { assert.deepEqual(receivedEnv, env); return browser; },
    });
    assert.equal(child.signalCode, 'SIGTERM');
    assert(output.messages.some(message => message.includes('launched Chrome/fake')));
    await assert.rejects(fetch(helperURL(output.messages)));
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});

test('owned browser exit rejects the run and closes the helper', async () => {
  const browser = await fakeBrowser();
  const { child } = browser;
  const output = logs();
  let inspections = 0;
  try {
    await assert.rejects(runSheets(command, { env, port: 0, log: message => {
      output.log(message);
      if (message.startsWith('Waiting')) child.kill('SIGTERM');
    }, inspect: async () => { if (++inspections === 1) throw refused(); return 'Chrome/fake'; }, launch: async () => browser }), /Chromium exited/);
    await assert.rejects(fetch(helperURL(output.messages)));
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});


test('missing browser executable is observed and fails without an unhandled child error', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'show-tools-cli-test-'));
  try {
    await assert.rejects(runSheets(command, {
      env: { ...env, SHOW_TOOLS_CHROMIUM_APP: join(profile, 'missing-browser'), SHOW_TOOLS_CDP_PROFILE: profile },
      port: 0, log: () => {}, inspect: async () => { throw refused(); }, launch: spawnCDP,
    }), /ENOENT/);
  } finally { await rm(profile, { recursive: true, force: true }); }
});

test('real CDP inspection checks browser version and target access over WebSocket', async () => {
  const methods: string[] = [];
  let product = 'Chromium/test';
  const server = createServer((request, response) => {
    assert.equal(request.url, '/json/version');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://${request.headers.host}/browser` }));
  });
  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    assert.equal(typeof key, 'string');
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let pending = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 6) {
        const opcode = pending[0] & 15;
        const size = pending[1] & 127;
        assert(size < 126, 'fixture commands fit short websocket frames');
        if (pending.length < size + 6) return;
        const payload = Buffer.from(pending.subarray(6, size + 6));
        for (let index = 0; index < size; index++) payload[index] ^= pending[2 + index % 4];
        pending = pending.subarray(size + 6);
        if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        const message: unknown = JSON.parse(payload.toString());
        assert(message && typeof message === 'object' && 'id' in message && 'method' in message);
        assert(typeof message.method === 'string');
        methods.push(message.method);
        const reply = Buffer.from(JSON.stringify({ id: message.id, result:
          message.method === 'Browser.getVersion' ? { product } : { targetInfos: [] } }));
        socket.write(Buffer.concat([Buffer.from([0x81, reply.length]), reply]));
      }
    });
  });
  const port = await listen(server);
  try {
    assert.equal(await inspectCDP(`http://127.0.0.1:${port}`), product);
    assert.deepEqual(methods, ['Browser.getVersion', 'Target.getTargets']);
    product = 'Firefox/test';
    await assert.rejects(inspectCDP(`http://127.0.0.1:${port}`), /Unsupported CDP browser/);
  } finally { await close(server); }
});


test('bare sheets opens the configured set list on reused CDP, while skip-open preserves later following', async () => {
  const setListURL = 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvxyz/edit#gid=123';
  for (const open of [true, false]) {
    const controller = new AbortController();
    const output = logs();
    const opened: string[] = [];
    let ready = () => {};
    const waiting = new Promise<void>(done => { ready = done; });
    const selections: unknown[] = [];
    const running = runSheets({ ...command, open }, {
      env: { ...env, SHOW_TOOLS_SET_LIST_URL: setListURL }, port: 0, signal: controller.signal,
      log: message => { output.log(message); if (message.startsWith('Waiting')) ready(); },
      inspect: async () => 'Chrome/reused', launch: noLaunch,
      openList: async (address, url, signal) => {
        assert.equal(address, 'http://127.0.0.1:49197'); assert(signal);
        opened.push(url);
      },
      select: async (_address, input) => {
        selections.push(input);
        return { ok: true, selectedRange: parseChartSelection(input).range, url: setListURL };
      },
    });
    try {
      await Promise.race([waiting, running.then(() => assert.fail('exited before readiness'))]);
      assert.deepEqual(opened, open ? [setListURL] : []);
      const selection = { spreadsheetId: 'abcdefghijklmnopqrstuvxyz', sheetId: 123, range: 'D:D', activate: false };
      const response = await fetch(`${helperURL(output.messages)}/open`, { method: 'POST',
        headers: { Origin: env.SHOW_TOOLS_PRACTICE_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(selection) });
      assert.equal(response.status, 200);
      assert.deepEqual(selections, [selection]);
    } finally { controller.abort(); await running; }
    await assert.rejects(fetch(helperURL(output.messages)));
  }
});

test('invalid set-list URL fails before starting a helper or touching CDP', async () => {
  for (const url of ['https://example.com/spreadsheets/d/abcdefghijklmnopqrstuvxyz/edit',
    'https://docs.google.com/document/d/abcdefghijklmnopqrstuvxyz/edit']) {
    await assert.rejects(runSheets(command, { env: { ...env, SHOW_TOOLS_SET_LIST_URL: url }, port: 0,
      inspect: async () => assert.fail('invalid configuration must not inspect CDP'), launch: noLaunch }), /SHOW_TOOLS_SET_LIST_URL/);
  }
});

test('startup chart failure closes helper and terminates owned browser', async () => {
  const browser = await fakeBrowser();
  const output = logs();
  let inspections = 0;
  try {
    await assert.rejects(runSheets({ ...command, open: true, songId: 'drunk-girls' }, { env, port: 0, ...output,
      inspect: async () => { if (++inspections === 1) throw refused(); return 'Chrome/fake'; }, launch: async () => browser,
      select: async () => { throw new Error('Chart selection failed'); },
    }), /Chart selection failed/);
    assert.equal(browser.child.signalCode, 'SIGTERM');
    await assert.rejects(fetch(helperURL(output.messages)));
  } finally { if (browser.child.exitCode === null && browser.child.signalCode === null) browser.child.kill('SIGKILL'); }
});

test('set-list opening reuses the spreadsheet tab, creates only when absent, and navigates explicit gid', async () => {
  const base = 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvxyz/edit';
  for (const existing of [true, false]) {
    for (const suffix of ['', '?gid=123', '#gid=123']) {
      const calls: { method: string; params: object; sessionId?: string }[] = [];
      let closed = false;
      const connection: CDPConnection = {
        async request(method, params = {}, sessionId) {
          calls.push({ method, params, ...(sessionId ? { sessionId } : {}) });
          switch (method) {
            case 'Target.getTargets': return { targetInfos: existing ? [{ targetId: 'existing', type: 'page', url: `${base}#gid=999` }] : [] };
            case 'Target.createTarget': return { targetId: 'created' };
            case 'Target.attachToTarget': return { sessionId: 'session' };
            case 'Page.navigate':
            case 'Target.detachFromTarget':
            case 'Target.activateTarget': return {};
            default: assert.fail(`Unexpected method ${method}`);
          }
        },
        close() { closed = true; },
      };
      await openSetList('http://127.0.0.1:49197', base + suffix, undefined, async () => connection);
      assert(closed);
      assert.deepEqual(calls.filter(call => call.method === 'Target.createTarget').map(call => call.params), existing ? [] : [{ url: base + suffix }]);
      assert.deepEqual(calls.filter(call => call.method === 'Target.activateTarget').map(call => call.params), [{ targetId: existing ? 'existing' : 'created' }]);
      assert.deepEqual(calls.filter(call => call.method === 'Page.navigate'), existing && suffix ? [{ method: 'Page.navigate', params: { url: base + suffix }, sessionId: 'session' }] : []);
    }
  }
});
