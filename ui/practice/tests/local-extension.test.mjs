import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sourceForVM } from '../../../scripts/source-for-vm.ts';

const bridge = (await sourceForVM(new URL('../sheets-extension/practice-bridge.ts', import.meta.url))).replace(/export \{\};?\n?/g, '');
const follower = (await sourceForVM(new URL('../sheets-extension/follow.ts', import.meta.url))).replace(/^import .*;\n/gm, '');

test('extension carries local worklet events over a tab port and rejects other windows and origins', () => {
  const listeners = [];
  const requests = [];
  let connect;
  const window = { addEventListener: (type, callback) => listeners.push(callback), postMessage: message => requests.push(message) };
  const context = vm.createContext({ window, location: { origin: 'https://practice.example' }, chrome: { runtime: { onConnect: { addListener(callback) { connect = callback; } } } } });
  vm.runInContext(bridge, context);
  vm.runInContext(bridge, context);
  assert.equal(listeners.length, 1, 'reconnecting does not install duplicate window handlers');
  const events = [];
  let disconnected;
  connect({ name: 'show-tools-follow', postMessage: message => events.push(message), onDisconnect: { addListener(callback) { disconnected = callback; } } });
  assert.equal(requests[0].kind, 'show-tools-state-request');
  const event = { v: 1, runId: 'local', seq: 3 };
  const data = { kind: 'show-tools-performance', event };
  listeners[0]({ source: window, origin: 'https://practice.example', data });
  listeners[0]({ source: {}, origin: 'https://practice.example', data });
  listeners[0]({ source: window, origin: 'https://elsewhere.example', data });
  assert.deepEqual(events, [event]);
  disconnected();
  listeners[0]({ source: window, origin: 'https://practice.example', data });
  assert.equal(events.length, 1, 'closed follower receives no more events');
});

test('stopping the follower while target lookup is pending prevents a later selection', async () => {
  let release;
  let entered;
  const lookup = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; });
  class Element { value = ''; disabled = false; textContent = ''; addEventListener() {} }
  const updates = [];
  const context = vm.createContext({ URL, AbortController, setTimeout,
    HTMLParagraphElement: Element, HTMLButtonElement: Element, HTMLInputElement: Element, HTMLFormElement: Element,
    document: { querySelector: () => new Element() }, location: { href: 'chrome-extension://test/follow.html?tabId=123' },
    window: { addEventListener() {} },
    chrome: { tabs: { async get() { entered(); return lookup; }, async update(...args) { updates.push(args); } } },
    selectionURL: () => 'https://docs.google.com/spreadsheets/d/test/edit#gid=101&range=D%3AD',
  });
  vm.runInContext(`${follower}\nglobalThis.testFollower = { disconnect, queue() { const controller = new AbortController(); connection = controller; pending = { controller, selection: { range: 'D:D' } }; return applyPending(); } };`, context);
  const selecting = context.testFollower.queue();
  await waiting;
  context.testFollower.disconnect();
  release({ url: 'https://docs.google.com/spreadsheets/d/test/edit#gid=101' });
  await selecting;
  assert.deepEqual(updates, []);
});
