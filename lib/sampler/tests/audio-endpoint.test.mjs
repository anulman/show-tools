import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { AudioEndpoint } from '../audio-endpoint.js';

function fakePort() {
  return { messages: [], started: false, closed: false,
    postMessage(message) { this.messages.push(message); },
    start() { this.started = true; }, close() { this.closed = true; },
    reply(data) { this.onmessage({ data }); } };
}

test('state publishes before a request resolves and late subscribers see latest state', async () => {
  const port = fakePort();
  const endpoint = new AudioEndpoint(port, { pollInterval: 0 });
  assert.equal(port.started, true);
  const events = [];
  endpoint.subscribe(state => events.push(state.sampler.volume));
  const request = endpoint.request('sample.volume', { volume: 0.5 }).then(value => {
    events.push('resolved');
    return value;
  });
  const state = { sampler: { volume: 0.5 } };
  port.reply({ id: 1, ok: true, value: 'done', state });
  assert.equal(await request, 'done');
  assert.deepEqual(events, [0.5, 'resolved']);
  endpoint.subscribe(value => assert.equal(value, state))();
  assert.equal(endpoint.snapshot(), state);
  endpoint.dispose();
});

test('polls allow only one outstanding request and command errors reject', async () => {
  const port = fakePort();
  const endpoint = new AudioEndpoint(port, { pollInterval: 0 });
  endpoint.poll();
  endpoint.poll();
  assert.equal(port.messages.length, 1);
  port.reply({ id: 1, ok: true, state: { sampler: {} } });
  await new Promise(resolve => setImmediate(resolve));
  endpoint.poll();
  assert.equal(port.messages.length, 2);
  const command = endpoint.request('unknown');
  port.reply({ id: 3, ok: false, error: 'Unknown command' });
  await assert.rejects(command, /Unknown command/);
  endpoint.dispose();
});

test('dispose rejects pending requests, closes the port and stops accepting requests', async () => {
  const port = fakePort();
  const endpoint = new AudioEndpoint(port, { pollInterval: 0 });
  const pending = endpoint.request('state');
  const rejected = assert.rejects(pending, /disposed/);
  endpoint.dispose();
  await rejected;
  assert.equal(port.closed, true);
  assert.equal(endpoint.pending.size, 0);
  await assert.rejects(endpoint.request('state'), /disposed/);
});

test('real MessagePorts deliver transfer lists and acknowledgments', async () => {
  const { port1, port2 } = new MessageChannel();
  const endpoint = new AudioEndpoint(port1, { pollInterval: 0 });
  port2.on('message', ({ id, payload }) => {
    assert.deepEqual(Array.from(payload.channel), [1, 2]);
    port2.postMessage({ id, ok: true, value: 'loaded' });
  });
  const channel = new Float32Array([1, 2]);
  const result = endpoint.request('load', { channel }, [channel.buffer]);
  assert.equal(channel.byteLength, 0);
  assert.equal(await result, 'loaded');
  endpoint.dispose();
  port2.close();
});

test('an unresponsive port times out requests and permits the next state poll', async () => {
  const port = fakePort();
  const endpoint = new AudioEndpoint(port, { pollInterval: 0, requestTimeout: 10 });
  await assert.rejects(endpoint.request('sample.stopAll'), /timed out/);
  assert.equal(endpoint.pending.size, 0);
  endpoint.poll();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(endpoint.pollPending, false);
  endpoint.poll();
  assert.equal(port.messages.length, 3);
  endpoint.dispose();
});
