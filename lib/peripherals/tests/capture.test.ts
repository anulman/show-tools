import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCapture } from '../capture.js';

const key = { type: 'input', platform: 'macos', device: 'fixture-keyboard', hostTimeNs: '100', deviceTicks: '9007199254740999', timestampDomain: 'mach_absolute_time', usagePage: 7, usage: 4, relative: false };
const motion = { type: 'input', platform: 'linux-evdev', device: '/dev/input/fixture', hostTimeNs: '200', deviceSeconds: 1, deviceMicroseconds: 2, eventType: 2, code: 0, relative: true };
function ndjson(values: unknown[]) { return values.map(value => JSON.stringify(value)).join('\n'); }

test('capture summary retains raw identities and signed distance and accepts full-precision timestamp strings', () => {
  const summary = summarizeCapture(ndjson([
    { ...key, sequence: 0, value: 1 }, { ...key, sequence: 1, value: 0 },
    { ...motion, sequence: 0, value: 9 }, { ...motion, sequence: 1, value: -4 },
    { type: 'error', reason: 'fixture-read-failure' }, { type: 'stopped' }, { type: 'gap', reason: 'SYN_DROPPED' }, { type: 'disconnect', device: 'fixture-keyboard' },
  ]));
  assert.equal(summary.inputs[0].code, 'hid:7:4');
  assert.equal(summary.inputs[0].presses, 1);
  assert.equal(summary.inputs[0].releases, 1);
  assert.equal(summary.inputs[1].signedDistance, 5);
  assert.equal(summary.inputs[1].absoluteDistance, 13);
  assert.equal(summary.gaps, 1);
  assert.equal(summary.disconnects, 1);
  assert.equal(summary.stops, 1);
  assert.equal(summary.errors, 1);
  assert.ok(!JSON.stringify(summary).includes('gain'));
});

test('Linux repeats remain distinguishable from fresh press events', () => {
  const event = { ...motion, eventType: 1, relative: false };
  const summary = summarizeCapture(ndjson([{ ...event, sequence: 0, value: 1 }, { ...event, sequence: 1, value: 2 }, { ...event, sequence: 2, value: 0 }]));
  assert.equal(summary.inputs[0].presses, 1);
  assert.equal(summary.inputs[0].repeats, 1);
  assert.equal(summary.inputs[0].releases, 1);
});

test('capture boundary rejects malformed, unsafe and replayed observations', () => {
  assert.throws(() => summarizeCapture('{'), /line 1/);
  assert.throws(() => summarizeCapture(ndjson([{ ...key, sequence: 0, value: 'down' }])), /line 1/);
  assert.throws(() => summarizeCapture(ndjson([{ ...key, sequence: 0, value: Number.MAX_SAFE_INTEGER + 1 }])), /line 1/);
  assert.throws(() => summarizeCapture(ndjson([{ ...key, sequence: 0, value: 1 }, { ...key, sequence: 0, value: 0 }])), /Out-of-order/);
});
