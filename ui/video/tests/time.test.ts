import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePerformanceTime, parsePreviewSeconds, quarterPosition } from '../time.js';

const input = { engineSessionId: 'engine', runId: 'take', epoch: 2, sourceSequence: 4, loopIteration: 3, sourceFrame: 48000, sampleRate: 48000, quarterPosition: 11.5, beatUnit: 8, discontinuity: 'none' };
test('presentation follows supplied position rather than elapsed frames or BPM', () => {
  const sample = parsePerformanceTime(input);
  assert.equal(quarterPosition({ kind: 'performance', sample }), 11.5);
  assert.equal(quarterPosition({ kind: 'preview', seconds: 1.25 }), 2.5);
  assert.equal(quarterPosition({ kind: 'performance', sample: parsePerformanceTime({ ...input, sourceFrame: 999999 }) }), 11.5);
});
test('invalid external clock input fails at the boundary', () => {
  for (const invalid of [{ ...input, sampleRate: 0 }, { ...input, quarterPosition: NaN }, { ...input, sourceFrame: -1 }, { ...input, beatUnit: 6 }]) assert.throws(() => parsePerformanceTime(invalid));
  assert.throws(() => parsePreviewSeconds(-1));
  assert.throws(() => parsePreviewSeconds(Infinity));
});
