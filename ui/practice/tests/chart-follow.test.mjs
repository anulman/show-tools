import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sourceForVM } from '../../../scripts/source-for-vm.ts';
import { createChartFollower } from '../open-chart.ts';

const source = await sourceForVM(new URL('../app.ts', import.meta.url));
const dispatch = source.match(/function postPerformanceEvent[^\{]*\{[\s\S]*?\n\}/)?.[0];
assert(dispatch);
const event = seq => ({ v: 1, runId: 'test-run', seq, state: { phase: 'playing', bar: 1,
  chart: { spreadsheetId: '1234567890123456789012345', sheetId: 101, columns: [3, 4], leadInColumn: 2 } } });

for (const hostname of ['127.0.0.1', 'practice.example']) {
  test(`Sheets follow from ${hostname} respects local defaults and hosted opt-in`, async () => {
    const requests = [];
    const context = { location: { hostname, origin: `http://${hostname}` }, window: { postMessage() {} },
      elements: { 'sheet-status': { textContent: '' } },
      createChartFollower: options => createChartFollower({ ...options, fetch: async (_url, request) => {
        const input = JSON.parse(request.body);
        requests.push(input);
        return new Response(JSON.stringify({ ok: true, selectedRange: input.range, url: 'https://docs.google.com/' }));
      } }),
    };
    vm.createContext(context);
    vm.runInContext(`let chartFollowOptIn = false; let chartFollower; ${dispatch}\nglobalThis.follow = postPerformanceEvent; globalThis.optIn = () => { chartFollowOptIn = true; };`, context);
    context.follow(event(1));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, hostname === '127.0.0.1' ? 1 : 0);
    context.optIn();
    context.follow(event(2));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].range, 'C:C');
    assert.equal(requests[0].activate, false);
    const stopped = event(3);
    stopped.state.phase = 'idle';
    context.follow(stopped);
  });
}
