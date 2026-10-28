import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLightPublication, encodeLightReplacement } from '../lights.js';
import { PF as PFL } from '../light-abi.js';

function publication() {
  const values = new Float64Array(PFL.LIGHT_FIELDS);
  values[PFL.LIGHT_FORMAT] = 1;
  values[PFL.LIGHT_GENERATION] = 2;
  values[PFL.LIGHT_EPOCH] = 1;
  values[PFL.LIGHT_SEQUENCE] = 1;
  values[PFL.LIGHT_RATE] = 48000;
  return values;
}

test('light instructions encode explicit count periods and preserve the buffer on invalid replacement', () => {
  const target = new Float64Array(PFL.LIGHT_CAPACITY * PFL.LIGHT_ROW_FIELDS);
  const request = { generation: 1, revision: 1, launch: { kind: 'grid', quantumBeats: .5 },
    rows: [{ id: 0xffffffff, kind: 'blink', level: .8, periodBeats: 2, duty: .25 }] } satisfies Parameters<typeof encodeLightReplacement>[0];
  assert.deepEqual(encodeLightReplacement(request, target), { launch: PFL.LIGHT_GRID, quantumBeats: .5, count: 1 });
  assert.deepEqual(Array.from(target.subarray(0, 5)), [0xffffffff, PFL.LIGHT_BLINK, .8, 2, .25]);
  assert(target.subarray(5).every(value => value === 0));
  const before = target.slice();
  assert.throws(() => encodeLightReplacement({ ...request, rows: [...request.rows, ...request.rows] }, target), /unique/);
  assert.deepEqual(target, before);
  assert.throws(() => encodeLightReplacement({ ...request, launch: { kind: 'grid', quantumBeats: 0 } }, target), /positive/);
  assert.deepEqual(target, before);
});

test('complete evaluated publication validates identities and zero padding without reconstructing phase', () => {
  const values = publication();
  values[PFL.LIGHT_COUNT_BEAT] = -2;
  values[PFL.LIGHT_ORIGIN_BEAT] = -4;
  values[PFL.LIGHT_PENDING] = 1;
  values[PFL.LIGHT_PENDING_BEAT] = .5;
  values[PFL.LIGHT_COUNT] = 1;
  values[PFL.LIGHT_SAMPLES] = 17;
  values[PFL.LIGHT_SAMPLES + 1] = .3;
  const decoded = decodeLightPublication(values);
  assert.equal(decoded.countBeat, -2);
  assert.deepEqual(decoded.pending, { countBeat: .5 });
  assert.deepEqual(decoded.samples, [{ id: 17, level: .3 }]);
  for (const [field, invalid] of [[PFL.LIGHT_GENERATION, 0], [PFL.LIGHT_RUN, -1], [PFL.LIGHT_EPOCH, 0],
    [PFL.LIGHT_SEQUENCE, Number.MAX_SAFE_INTEGER + 1], [PFL.LIGHT_FRAME, .5], [PFL.LIGHT_COUNT, 33],
    [PFL.LIGHT_RUNNING, 2], [PFL.LIGHT_COUNT_BEAT, NaN], [PFL.LIGHT_SAMPLES + 1, 1.01],
    [PFL.LIGHT_SAMPLES + 2, 99]]) {
    const malformed = values.slice();
    malformed[field] = invalid;
    assert.throws(() => decodeLightPublication(malformed));
  }
  const duplicate = values.slice();
  duplicate[PFL.LIGHT_COUNT] = 2;
  duplicate[PFL.LIGHT_SAMPLES + 2] = 17;
  assert.throws(() => decodeLightPublication(duplicate), /sample/);
  assert.throws(() => decodeLightPublication(values.subarray(1)), /format/);
  assert.deepEqual(decodeLightPublication(publication()).samples, []);
  const terminal = publication();
  terminal[PFL.LIGHT_SEQUENCE] = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(decodeLightPublication(terminal).samples, []);
  terminal[PFL.LIGHT_PENDING] = 1;
  assert.throws(() => decodeLightPublication(terminal), /Terminal/);
  terminal[PFL.LIGHT_PENDING] = 0;
  terminal[PFL.LIGHT_COUNT] = 1;
  terminal[PFL.LIGHT_SAMPLES + 1] = .1;
  assert.throws(() => decodeLightPublication(terminal), /Terminal/);
});
