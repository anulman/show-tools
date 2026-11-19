import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chartMetadata, rangeForBar } from '../../lib/performance/chart.js';
import { deskFixture, until } from '../../lib/remote-performance/tests/session-fixture.js';
import { lightFixture } from '../../lib/remote-performance/tests/light-fixture.js';
import { tunerFixture } from '../../lib/remote-performance/tests/tuner-fixture.js';
import { configureDeskChartSource } from '../desk-chart-follower.js';
import { parseChartSelection } from '../open-chart.js';
import { runSheets } from '../show-tools.js';

const token = 'test-desk-token-0123456789abcdef';
const origin = 'https://desk.example:8443';

test('hardware destination is explicit and the token file must be private and direct', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-desk-token-'));
  try {
    const privateFile = join(directory, 'token');
    const publicFile = join(directory, 'public');
    const indirect = join(directory, 'indirect');
    await writeFile(privateFile, token + '\n', { mode: 0o600 });
    await writeFile(publicFile, token, { mode: 0o644 });
    await symlink(privateFile, indirect);
    const environment = { SHOW_TOOLS_DESK_TOKEN_FILE: privateFile };
    assert.equal(await configureDeskChartSource({ ...environment, SHOW_TOOLS_PRACTICE_ORIGIN: origin }), undefined);
    await assert.rejects(configureDeskChartSource({ ...environment, SHOW_TOOLS_DESK_ORIGIN: 'http://desk.example:8443' }), /exact HTTPS origin/);
    for (const path of [publicFile, indirect]) {
      await assert.rejects(configureDeskChartSource({ SHOW_TOOLS_DESK_ORIGIN: origin, SHOW_TOOLS_DESK_TOKEN_FILE: path }), /desk token file/);
    }
    assert.deepEqual(await configureDeskChartSource({ ...environment, SHOW_TOOLS_DESK_ORIGIN: origin }), { origin, token });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('hardware Sheets follows native practice through authenticated GETs with no browser page or local relay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-desk-sheets-'));
  const stop = new AbortController();
  const tokenFile = join(directory, 'token');
  await writeFile(tokenFile, token, { mode: 0o600 });
  const off = deskFixture().snapshot();
  const chart = chartMetadata(off.song.chart);
  const state = {
    phase: 'idle', bar: null, beat: null, countInRemaining: 0, bpm: 120, startBar: 1, endBar: 4, loop: false,
    automatic: false, click: false, selectedChannel: 'L1', runId: 'test-run', seq: 0,
    channels: ['L1', 'L2', 'R1', 'R2'].map(id => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })),
    looping: [], recording: null, microphone: false, error: null,
  };
  const performance = { hostEpoch: 'host', revision: '1', state, tuner: tunerFixture(), lights: lightFixture() };
  const ready = { ...off, revision: '2', audio: { kind: 'ready', attempt: 'attempt', performance } };
  const encoder = new TextEncoder();
  const sessions: string[] = [];
  const selections: Array<ReturnType<typeof parseChartSelection>> = [];
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let releaseFirst: (() => void) | undefined;
  const opened: string[] = [];
  const messages: string[] = [];
  const publish = (event: unknown) => {
    assert(stream);
    stream.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  };
  const beat = (seq: number, phase: string, bar: number | null, attempt = 'attempt') => publish({
    type: 'event', attempt, event: { v: 1, type: 'beat', runId: state.runId, seq, state: { ...state, seq, phase, bar, chart } },
  });
  const request: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const headers = new Headers(options?.headers);
    assert.equal(url.origin, origin);
    assert.equal(headers.get('Origin'), origin);
    assert.equal(headers.get('Authorization'), `Bearer ${token}`);
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.method, undefined, 'the follower sends no control requests');
    if (url.pathname === '/api/session') {
      const sessionId = `session-${sessions.length}`;
      sessions.push(sessionId);
      return Response.json({ sessionId, inputOwnerToken: 'owner', view: off });
    }
    assert.equal(url.pathname, '/api/events');
    assert.equal(headers.get('X-Session-Id'), sessions.at(-1));
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  const running = runSheets({ kind: 'sheets', launch: false, open: false }, {
    env: { SHOW_TOOLS_DESK_ORIGIN: origin, SHOW_TOOLS_DESK_TOKEN_FILE: tokenFile },
    signal: stop.signal, request, log: message => messages.push(message),
    inspect: async () => 'Chrome/test',
    openList: async (_address, url) => { opened.push(url); },
    select: async (_cdp, input, _connect, signal) => {
      const selection = parseChartSelection(input);
      selections.push(selection);
      if (selections.length === 1) await new Promise<void>(resolve => {
        releaseFirst = resolve;
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return { ok: true, selectedRange: selection.range, url: 'https://docs.google.com' };
    },
  });
  try {
    await Promise.race([until(() => stream), running.then(() => assert.fail('exited before subscribing'))]);
    assert.deepEqual(opened, []);
    assert(!messages.some(message => message.startsWith('Helper')));
    publish({ type: 'desk', view: ready });
    beat(1, 'count-in', null);
    await until(() => releaseFirst);
    beat(2, 'playing', 1);
    beat(3, 'playing', 2);
    beat(4, 'playing', 3);
    beat(5, 'playing', 5, 'stale-attempt');
    await new Promise(resolve => setImmediate(resolve));
    releaseFirst?.();
    await until(() => selections.length === 2 ? true : undefined);
    assert.deepEqual(selections.map(item => item.range), [
      rangeForBar(off.song.chart, 1, 'count-in'), rangeForBar(off.song.chart, 3, 'playing'),
    ]);
    assert(selections.every(item => item.activate === false));
    const firstStream = stream;
    publish({ type: 'gap' });
    await until(() => stream !== firstStream ? true : undefined);
    publish({ type: 'desk', view: { ...ready, audio: { ...ready.audio,
      performance: { ...performance, state: { ...state, seq: 7, phase: 'playing', bar: 4 } },
    } } });
    await until(() => selections.length === 3 ? true : undefined);
    assert.equal(selections.at(-1)?.range, rangeForBar(off.song.chart, 4, 'playing'));
    assert.deepEqual(sessions, ['session-0', 'session-1']);
  } finally {
    stop.abort();
    try { stream?.close(); } catch { /* The connection already released the reader. */ }
    await running;
    await rm(directory, { recursive: true, force: true });
  }
});
