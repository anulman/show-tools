import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Schema } from 'effect';
import { createChartHelper, openChart, parseChartSelection, type CDPConnection } from '../open-chart.js';

const spreadsheetId = '1HZ6FipBtjaqPWAisDmjFY-Vvn_UtUfaH2gsNsY41USg';
const selection = { spreadsheetId, sheetId: 101, range: 'D:D' };
const parseExpression = Schema.decodeUnknownSync(Schema.Struct({ expression: Schema.String }));
const parseText = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));

function chromeFixture({ existing = true, hashWorks = true, sheetId = 101, delayedSheet = false } = {}) {
  const calls: { method: string; params: object; sessionId?: string }[] = [];
  let closed = false;
  let range = 'A1';
  let text = '';
  let activeSheetId = 101;
  let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?pli=1#gid=101`;
  const connection: CDPConnection = {
    async request(method, params = {}, sessionId) {
      calls.push({ method, params, ...(sessionId ? { sessionId } : {}) });
      switch (method) {
        case 'Target.getTargets': return { targetInfos: existing ? [{ targetId: 'existing-chart', type: 'page', url }] : [] };
        case 'Target.createTarget': return { targetId: 'new-chart' };
        case 'Page.navigate': activeSheetId = sheetId; range = 'A1'; return {};
        case 'Target.attachToTarget': return { sessionId: 'chart-session' };
        case 'Target.detachFromTarget':
        case 'Target.activateTarget': return {};
        case 'Runtime.evaluate': {
          const { expression } = parseExpression(params);
          if (expression.includes('location.hash =')) {
            url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?pli=1#gid=${sheetId}&range=D%3AD`;
            if (hashWorks) range = 'D:D';
            if (!delayedSheet) activeSheetId = sheetId;
            return { result: { value: true } };
          }
          if (expression.includes('box.focus()')) return { result: { value: true } };
          const state = { ready: true, range, activeSheetId, url };
          if (delayedSheet && range === 'D:D') activeSheetId = sheetId;
          return { result: { value: JSON.stringify(state) } };
        }
        case 'Input.insertText': text = parseText(params).text; return {};
        case 'Input.dispatchKeyEvent': range = text; return {};
        default: throw new Error(`Unexpected CDP command ${method}`);
      }
    },
    close() { closed = true; },
  };
  return { connection, calls, isClosed: () => closed };
}

test('selects an existing chart and confirms the Name box before acknowledging', async () => {
  const fixture = chromeFixture();
  const result = await openChart('http://127.0.0.1:9222', selection, async () => fixture.connection);
  assert.equal(result.selectedRange, 'D:D');
  assert(!fixture.calls.some(call => call.method === 'Target.createTarget'));
  assert(fixture.calls.some(call => call.method === 'Target.activateTarget'));
  assert(fixture.calls.some(call => call.method === 'Target.detachFromTarget'));
  assert(fixture.isClosed());
});

test('new charts load first and trusted keyboard input recovers from ignored range fragments', async () => {
  const fixture = chromeFixture({ existing: false, hashWorks: false });
  const result = await openChart('http://127.0.0.1:9222', selection, async () => fixture.connection);
  assert.equal(result.selectedRange, 'D:D');
  assert(fixture.calls.some(call => call.method === 'Target.createTarget'));
  assert(fixture.calls.some(call => call.method === 'Input.insertText'));
  assert.equal(fixture.calls.filter(call => call.method === 'Input.dispatchKeyEvent').length, 2);
  assert(fixture.isClosed());
});

test('song changes navigate to the requested visible sheet before selecting its range', async () => {
  const fixture = chromeFixture({ sheetId: 102, delayedSheet: true });
  const result = await openChart('http://127.0.0.1:9222', { ...selection, sheetId: 102 }, async () => fixture.connection);
  assert.equal(result.selectedRange, 'D:D');
  assert(fixture.calls.some(call => call.method === 'Page.navigate'), 'changed the actual song instead of only its URL fragment');
});

test('rejects malformed ranges before connecting and closes on CDP failures', async () => {
  let connected = false;
  await assert.rejects(openChart('http://127.0.0.1:9222', { ...selection, range: 'D:D;alert(1)' }, async () => {
    connected = true; return chromeFixture().connection;
  }));
  assert.equal(connected, false);
  let closed = false;
  await assert.rejects(openChart('http://127.0.0.1:9222', selection, async () => ({
    async request() { throw new Error('Disconnected'); }, close() { closed = true; },
  })), /Disconnected/);
  assert(closed);
});

test('loopback helper validates origins and serializes selection requests', async () => {
  let active = 0;
  let maximum = 0;
  const server = createChartHelper({ origins: ['https://practice.example'], select: async (_address, input) => {
    const requested = parseChartSelection(input);
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active--;
    return { ok: true, selectedRange: requested.range, url: `https://docs.google.com/spreadsheets/d/${requested.spreadsheetId}/edit` };
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/open`;
  try {
    const post = (origin: string, body: unknown) => fetch(endpoint, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('https://elsewhere.example', selection)).status, 403);
    assert.equal((await post('https://practice.example', { ...selection, sheetId: -1 })).status, 400);
    const results = await Promise.all([post('https://practice.example', selection), post('https://practice.example', selection)]);
    assert(results.every(response => response.status === 200));
    assert.equal(maximum, 1);
    assert.equal(results[0]?.headers.get('Access-Control-Allow-Origin'), 'https://practice.example');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
  }
});
