import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRelay } from '../../../lib/relay/server.ts';
import { readEvents } from '../../../lib/relay/event-stream.js';

const event = (runId, seq) => ({ v: 1, runId, seq, type: 'beat', state: { phase: 'playing', bar: 1, beat: 1, countInRemaining: 0, bpm: 98, startBar: 1, endBar: 76, loop: true, automatic: true, click: true, selectedChannel: 'R1', runId, seq, channels: [], looping: [], recording: null, microphone: false, error: null } });

test('relay enforces a producer, delivers controls once, initializes late followers, and rejects stale runs', async () => {
  const relay = createRelay({ token: 'test-token', serveUI: false });
  relay.server.listen(0, '127.0.0.1');
  await once(relay.server, 'listening');
  const url = `http://127.0.0.1:${relay.server.address().port}`;
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', 'X-Producer-Id': 'producer-123' };
  const abort = new AbortController();
  const received = [];
  const waitFor = async predicate => {
    const deadline = Date.now() + 2000;
    while (!predicate()) { if (Date.now() > deadline) assert.fail('SSE delivery timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  const post = (path, value, extra = {}) => fetch(url + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(value) });
  try {
    assert.equal((await fetch(url + '/api/events')).status, 401);
    assert.equal((await fetch(url + '/ui/practice/')).status, 404, 'headless relay serves no UI');
    assert.equal((await post('/api/events', event('run-one', 1))).status, 409);
    assert.equal((await post('/api/producer', { producerId: 'producer-123' })).status, 200);
    assert.equal((await post('/api/producer', { producerId: 'producer-other' })).status, 409);
    const controlResponse = await fetch(url + '/api/controls', { headers, signal: abort.signal });
    const controls = [];
    const readingControls = readEvents(controlResponse, value => controls.push(value), abort.signal).catch(() => {});
    assert.equal((await post('/api/controls', { commandId: 'command-123', control: { id: 'L1' } })).status, 202);
    await waitFor(() => controls.length === 1);
    assert.deepEqual(controls[0], { commandId: 'command-123', control: { id: 'L1' } });
    assert.equal((await post('/api/controls', { commandId: 'command-123', control: { id: 'L1' } })).status, 200);
    assert.equal((await post('/api/controls', { commandId: 'command-123', control: { id: 'L2' } })).status, 409);
    assert.equal(controls.length, 1);
    assert.equal((await post('/api/controls', { commandId: 'command-bad', control: { id: 'knob', value: 2 } })).status, 400);
    assert.equal((await post('/api/events', event('run-one', 1))).status, 202);
    const response = await fetch(url + '/api/events', { headers, signal: abort.signal });
    const readingEvents = readEvents(response, value => received.push(value), abort.signal).catch(() => {});
    await waitFor(() => received.length === 1);
    assert.equal(received[0].seq, 1, 'late follower starts from current state');
    assert.equal((await post('/api/events', event('run-one', 1))).status, 409);
    assert.equal((await post('/api/events', event('run-one', 2))).status, 202);
    assert.equal((await post('/api/events', event('run-two', 1))).status, 202);
    assert.equal((await post('/api/events', event('run-one', 3))).status, 409);
    await waitFor(() => received.length === 3);
    assert.deepEqual(received.map(value => value.runId), ['run-one', 'run-one', 'run-two']);
    abort.abort();
    await Promise.all([readingControls, readingEvents]);
    assert.equal((await fetch(url + '/api/producer', { method: 'DELETE', headers })).status, 200);
    assert.equal((await post('/api/controls', { commandId: 'command-456', control: { id: 'L2' } })).status, 503);
  } finally { abort.abort(); await relay.close(); }
});

test('SSE parser handles split frames and multiline JSON data', async () => {
  const encoder = new TextEncoder();
  const parts = ['event: performance\nda', 'ta: {"bar":\n', 'data: 4}\n\n: heartbeat\n\n'];
  const stream = new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(encoder.encode(part))); controller.close(); } });
  const values = [];
  await assert.rejects(readEvents(new Response(stream), value => values.push(value)), /closed/);
  assert.deepEqual(values, [{ bar: 4 }]);
});
