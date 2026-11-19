import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import vm from 'node:vm';
import { Schema } from 'effect';
import { createChartHelper, openChart, parseChartSelection, type CDPConnection } from '../open-chart.js';
import { createChartFollower } from '../../ui/practice/open-chart.js';
import { selectionURL } from '../../ui/practice/sheets-extension/selection.js';
import { sourceForVM } from '../source-for-vm.js';

const spreadsheetId = '1HZ6FipBtjaqPWAisDmjFY-Vvn_UtUfaH2gsNsY41USg';
const selection = { spreadsheetId, sheetId: 101, range: 'D:D' };
const parseExpression = Schema.decodeUnknownSync(Schema.Struct({ expression: Schema.String }));
const parseText = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));

let fixtureSerial = 0;
function chromeFixture({ existing = true, sheetId = 101, delayedSheet = false, pendingViewport = 0, pendingSelection = 0, lostSelections = 0,
  widths = [150], viewportWidth = 600, maxScroll = 100000 } = {}) {
  const calls: { method: string; params: object; sessionId?: string }[] = [];
  const targetId = `chart-${++fixtureSerial}`;
  let preserved = false;
  const scrolls: number[] = [];
  let closed = false;
  let range = 'A1';
  let text = '';
  let activeSheetId = 101;
  let scrollLeft = 0;
  const selectedColumn = () => Array.from(range.split(':')[0]).reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0);
  const selectedPosition = () => {
    const column = selectedColumn();
    let offset = 0;
    for (let index = 2; index < column; index++) offset += widths[index - 1] ?? 60;
    return { left: column === 1 ? 50 : 200 + offset - scrollLeft, width: widths[column - 1] ?? 60 };
  };
  let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?pli=1#gid=101`;
  const connection: CDPConnection = {
    async request(method, params = {}, sessionId) {
      calls.push({ method, params, ...(sessionId ? { sessionId } : {}) });
      switch (method) {
        case 'Target.getTargets': return { targetInfos: existing ? [{ targetId, type: 'page', url }] : [] };
        case 'Target.createTarget': return { targetId };
        case 'Page.navigate': activeSheetId = sheetId; range = 'A1'; return {};
        case 'Target.attachToTarget': return { sessionId: 'chart-session' };
        case 'Target.detachFromTarget':
        case 'Target.activateTarget': return {};
        case 'Runtime.evaluate': {
          const { expression } = parseExpression(params);
          if (expression.includes('box.focus(')) {
            if (pendingViewport > 0) { pendingViewport--; return { result: { value: false } }; }
            preserved = true;
            return { result: { value: true } };
          }
          if (expression.includes('native-scrollbar-x')) {
            if (pendingSelection > 0) { pendingSelection--; return { result: { value: null } }; }
            const assigned = /scrollbar.scrollLeft = ([\d.]+);/.exec(expression);
            if (assigned) { scrollLeft = Math.min(maxScroll, Math.max(0, Number(assigned[1]))); scrolls.push(scrollLeft); }
            const selected = selectedPosition();
            return { result: { value: JSON.stringify({ scrollLeft, left: 200, right: 200 + viewportWidth,
              selectedLeft: selected.left, selectedRight: selected.left + selected.width }) } };
          }
          assert(!expression.includes('location.hash ='), 'selecting a column must not navigate its hash');
          if (expression.includes('window.__showToolsReleaseViewport?.()')) { preserved = false; return { result: { value: true } }; }
          const state = { ready: true, range, activeSheetId, url };
          if (delayedSheet && range === 'D:D') activeSheetId = sheetId;
          return { result: { value: JSON.stringify(state) } };
        }
        case 'Input.insertText':
          text = lostSelections > 0 ? '' : parseText(params).text;
          if (lostSelections > 0) lostSelections--;
          return {};
        case 'Input.dispatchKeyEvent': if (text) range = text; if (!preserved) { scrollLeft = 0; scrolls.push(0); } return {};
        default: throw new Error(`Unexpected CDP command ${method}`);
      }
    },
    close() { closed = true; },
  };
  return { connection, calls, scrolls, isClosed: () => closed, viewport: () => ({ range, scrollLeft, ...selectedPosition() }) };
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

test('new charts load first and trusted keyboard input selects only the requested column', async () => {
  const fixture = chromeFixture({ existing: false });
  const result = await openChart('http://127.0.0.1:9222', selection, async () => fixture.connection);
  assert.equal(result.selectedRange, 'D:D');
  assert(fixture.calls.some(call => call.method === 'Target.createTarget'));
  assert(fixture.calls.some(call => call.method === 'Input.insertText'));
  assert.equal(fixture.calls.filter(call => call.method === 'Input.dispatchKeyEvent').length, 2);
  assert(fixture.isClosed());
});

test('song changes wait for the new sheet and its viewport before selecting its range', async () => {
  const fixture = chromeFixture({ sheetId: 102, delayedSheet: true, pendingViewport: 2, pendingSelection: 2, lostSelections: 1 });
  const result = await openChart('http://127.0.0.1:9222', { ...selection, sheetId: 102 }, async () => fixture.connection);
  assert.equal(result.selectedRange, 'D:D');
  assert(fixture.calls.some(call => call.method === 'Page.navigate'), 'changed the actual song instead of only its URL fragment');
  assert.equal(fixture.calls.filter(call => call.method === 'Input.insertText').length, 2, 'one ignored selection is retried');
});

test('following preserves scrolling and uses cached unequal column widths without intermediate selections', async () => {
  const fixture = chromeFixture({ widths: [150, 40, 180, 90, 110, 70] });
  for (const range of ['C:C', 'D:D', 'E:E', 'F:F']) {
    await openChart('http://127.0.0.1:9222', { ...selection, range, activate: false }, async () => fixture.connection);
  }
  assert.deepEqual(fixture.viewport(), { range: 'F:F', scrollLeft: 220, left: 400, width: 70 });
  assert(!fixture.calls.some(call => call.method === 'Target.activateTarget'));
  assert.deepEqual(fixture.calls.filter(call => call.method === 'Input.insertText').map(call => parseText(call.params).text),
    ['C:C', 'D:D', 'E:E', 'F:F']);
  const positive = fixture.scrolls.findIndex(scroll => scroll > 0);
  assert(positive >= 0);
  assert(fixture.scrolls.slice(positive).every(scroll => scroll > 0), 'visible incremental selections never reset to zero');
});

test('early columns reset to the start and late columns retain their current selection', async () => {
  const fixture = chromeFixture();
  for (const range of ['AZ:AZ', 'C:C', 'B:B', 'A:A']) {
    await openChart('http://127.0.0.1:9222', { ...selection, range }, async () => fixture.connection);
    assert.equal(fixture.viewport().range, range);
    if (range !== 'AZ:AZ') assert.equal(fixture.viewport().scrollLeft, 0);
    else assert.equal(fixture.viewport().left, 320);
  }
});

test('a narrow viewport prioritizes the selected column when two previous columns do not fit', async () => {
  const fixture = chromeFixture({ widths: [150, 300, 300, 80], viewportWidth: 500 });
  await openChart('http://127.0.0.1:9222', { ...selection, range: 'B:B' }, async () => fixture.connection);
  await openChart('http://127.0.0.1:9222', selection, async () => fixture.connection);
  assert.equal(fixture.viewport().range, 'D:D');
  assert.equal(fixture.viewport().left + fixture.viewport().width, 700);
});

test('end-of-sheet scroll clamping retains the active column and available context', async () => {
  const fixture = chromeFixture({ maxScroll: 2460 });
  await openChart('http://127.0.0.1:9222', { ...selection, range: 'AZ:AZ' }, async () => fixture.connection);
  assert.deepEqual(fixture.viewport(), { range: 'AZ:AZ', scrollLeft: 2460, left: 740, width: 60 });
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

test('helper accepts both documented local practice ports without allowing other origins', async () => {
  const server = createChartHelper();
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}/health`;
    for (const origin of ['http://127.0.0.1:8082', 'http://localhost:8082', 'http://127.0.0.1:8084', 'http://localhost:8084']) {
      const response = await fetch(endpoint, { headers: { Origin: origin } });
      assert.equal(response.status, 200, origin);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
      assert.deepEqual(await response.json(), { ok: true });
    }
    for (const origin of ['https://untrusted.example', 'http://127.0.0.1:8099']) {
      const response = await fetch(endpoint, { headers: { Origin: origin } });
      assert.equal(response.status, 403, origin);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
      await response.arrayBuffer();
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
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

test('automatic selections do not activate the chart window', async () => {
  const fixture = chromeFixture({ existing: false });
  await openChart('http://127.0.0.1:9222', { ...selection, activate: false }, async () => fixture.connection);
  assert(!fixture.calls.some(call => call.method === 'Target.activateTarget'));
  assert.deepEqual(fixture.calls.find(call => call.method === 'Target.createTarget')?.params, {
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=101#gid=101`, background: true,
  });
});

function position(bar: number | null, seq: number, runId = 'run-one') {
  return { v: 1, runId, seq, state: { phase: bar === null ? 'count-in' : 'playing', bar,
    chart: { spreadsheetId, sheetId: 101, leadInColumn: 2, columns: [3, 4, 5, 6] } } };
}
const settled = () => new Promise<void>(done => setImmediate(done));
const selectionReply = (range: string) => new Response(JSON.stringify({ ok: true, selectedRange: range,
  url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` }));

function requestSelection(options?: RequestInit) {
  assert.equal(typeof options?.body, 'string');
  if (typeof options?.body !== 'string') throw new Error('Missing request body');
  return parseChartSelection(JSON.parse(options.body));
}

test('automatic following sends lead-in and changed columns only, coalescing stale pending bars', async () => {
  const requested: string[] = [];
  const statuses: string[] = [];
  let release: () => void = () => {};
  const waiting = new Promise<void>(done => { release = done; });
  const follower = createChartFollower({ onStatus: status => statuses.push(status), fetch: async (_url, options) => {
    const selected = requestSelection(options);
    assert.equal(selected.activate, false);
    requested.push(selected.range);
    if (requested.length === 1) await waiting;
    return selectionReply(selected.range);
  } });
  follower.receive(position(null, 1));
  follower.receive(position(null, 2));
  follower.receive(position(1, 3));
  follower.receive(position(2, 4));
  follower.receive(position(4, 5));
  release();
  await settled();
  assert.deepEqual(requested, ['B:B', 'F:F']);
  assert.equal(statuses.at(-1), 'Following F:F');
  follower.receive(position(4, 6));
  follower.receive(position(2, 4));
  await settled();
  assert.equal(requested.length, 2);
  follower.stop();
});

test('stopping automatic follow aborts requests and the same position works on a new run', async () => {
  const requested: string[] = [];
  const statuses: string[] = [];
  let aborted = false;
  const follower = createChartFollower({ onStatus: status => statuses.push(status), fetch: async (_url, options) => {
    const selected = requestSelection(options);
    requested.push(selected.range);
    if (requested.length === 1) await new Promise<void>((_done, reject) => {
      options?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('Aborted')); }, { once: true });
    });
    return selectionReply(selected.range);
  } });
  follower.receive(position(1, 1));
  follower.receive(position(2, 2));
  follower.stop();
  await settled();
  assert(aborted);
  assert.deepEqual(requested, ['C:C']);
  assert.deepEqual(statuses, []);
  follower.receive(position(1, 1, 'run-two'));
  await settled();
  assert.deepEqual(requested, ['C:C', 'C:C']);
  assert.deepEqual(statuses, ['Following C:C']);
  follower.stop();
});

test('unavailable automatic helper reports status without rejecting practice events and retries the next bar', async () => {
  let requests = 0;
  const statuses: string[] = [];
  const follower = createChartFollower({ onStatus: status => statuses.push(status), fetch: async () => {
    requests++; throw new Error('Connection refused');
  } });
  assert.doesNotThrow(() => follower.receive(position(1, 1)));
  await settled();
  follower.receive(position(1, 2));
  follower.receive(position(2, 3));
  await settled();
  assert.equal(requests, 2);
  assert.equal(statuses.length, 2);
  assert(statuses.every(status => status.includes('does not affect practice audio')));
  follower.stop();
});

test('extension checks the visible song sheet even when the previous Name box already matches', async () => {
  const followerSource = (await sourceForVM(new URL('../../ui/practice/sheets-extension/follow.ts', import.meta.url))).replace(/^import .*;\n/gm, '');
  for (const navigates of [true, false]) {
    class Element { value = ''; disabled = false; textContent = ''; addEventListener() {} }
    const elements = new Map<string, Element>();
    const updates: string[] = [];
    let checks = 0;
    const context = vm.createContext({ URL, AbortController, selectionURL,
      setTimeout: (callback: () => void) => setImmediate(callback),
      HTMLParagraphElement: Element, HTMLButtonElement: Element, HTMLInputElement: Element, HTMLFormElement: Element,
      document: { querySelector(selector: string) {
        let element = elements.get(selector);
        if (!element) { element = new Element(); elements.set(selector, element); }
        return element;
      } },
      location: { href: 'chrome-extension://test/follow.html?tabId=123' }, window: { addEventListener() {} },
      chrome: {
        tabs: {
          async get() { return { url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=101#gid=101&range=D%3AD` }; },
          async update(_target: number, update: { url: string }) { updates.push(update.url); },
        },
        scripting: { async executeScript() { checks++; return [{ result: { range: 'D:D', activeSheetId: navigates && checks > 2 ? 102 : 101 } }]; } },
      },
    });
    vm.runInContext(`${followerSource}\nglobalThis.checkSong = async (selection) => { const controller = new AbortController(); connection = controller; pending = {controller, selection}; await applyPending(); };`, context);
    const checkSong = vm.runInContext('checkSong', context);
    await checkSong({ spreadsheetId, sheetId: 102, range: 'D:D' });
    assert.equal(new URL(updates[0] || '').searchParams.get('gid'), '102', 'a song change performs a real navigation');
    assert(checks >= 3, 'a matching range on the old sheet is not sufficient');
    if (navigates) assert.equal(elements.get('#status')?.textContent, 'Following D:D directly from the practice tab.');
    else assert.match(elements.get('#status')?.textContent || '', /did not confirm/);
  }
});
