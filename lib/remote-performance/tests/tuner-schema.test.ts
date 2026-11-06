import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from 'effect';
import { TunerStateSchema } from '../../tuner/schema.js';
import { tunerFixture } from './tuner-fixture.js';

test('tuner publications reject unbounded targets and contradictory pitch or progress', () => {
  const decode = Schema.decodeUnknownSync(TunerStateSchema);
  const valid = tunerFixture();
  assert.deepEqual(decode(valid), valid);
  for (const invalid of [
    { ...valid, targets: Array(14).fill(valid.targets[0]) },
    { ...valid, step: valid.targets.length },
    { ...valid, preview: { kind: 'scale', step: valid.targets.length } },
    { ...valid, targets: [{ ...valid.targets[0], letter: 'H' }, valid.targets[1]] },
    { ...valid, pitch: { kind: 'pitched', frequency: 130, midi: 48, cents: 0, confidence: .9, rms: .2, note: valid.targets[0] } },
  ]) assert.throws(() => decode(invalid));
});
