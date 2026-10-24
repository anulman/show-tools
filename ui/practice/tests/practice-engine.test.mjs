import assert from 'node:assert/strict';
import test from 'node:test';
import { PracticeEngine } from '../practice-engine.js';

test('one full count-in bar precedes the first song beat and looping preserves the chosen range', () => {
  const engine = new PracticeEngine({ barCount: 8, endBar: 8, program: { lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'R1' }] } });
  engine.start({ runId: 'first', startBar: 3, endBar: 3, automatic: true });
  for (let id = 41; id < 45; id++) {
    assert.deepEqual(engine.onBeat(id, 2).triggers, []);
    assert.equal(engine.snapshot().bar, null);
    assert.equal(engine.snapshot().countInRemaining, 45 - id);
  }
  assert(engine.onBeat(45, 2).triggers.length > 0);
  assert.equal(engine.snapshot().bar, 3);
  assert.equal(engine.snapshot().beat, 1);
  for (let id = 46; id <= 49; id++) engine.onBeat(id, 2);
  assert.equal(engine.snapshot().bar, 3);
  assert.equal(engine.snapshot().beat, 1);
});

test('duplicate crossings do nothing and gaps or changed epochs stop the transport', () => {
  for (const crossing of [{ id: 4, epoch: 1 }, { id: 3, epoch: 2 }]) {
    const engine = new PracticeEngine({ barCount: 218, endBar: 76 });
    engine.start({ runId: 'first', countInBars: 0 });
    engine.onBeat(2, 1);
    assert.equal(engine.onBeat(2, 1), null);
    assert.equal(engine.onBeat(crossing.id, crossing.epoch).stopped, true);
    assert.equal(engine.snapshot().phase, 'idle');
  }
});

test('stopping cancels count-in and each restart has its own event sequence', () => {
  const engine = new PracticeEngine({ barCount: 218, endBar: 76 });
  engine.start({ runId: 'first' });
  assert.equal(engine.event('state').seq, 1);
  engine.onBeat(10, 1);
  engine.stop();
  assert.equal(engine.onBeat(11, 1), null);
  engine.start({ runId: 'second', countInBars: 0, startBar: 2, endBar: 2, loop: false });
  assert.equal(engine.event('state').seq, 1);
  for (let id = 12; id < 16; id++) engine.onBeat(id, 1);
  assert.equal(engine.onBeat(16, 1).stopped, true);
  assert.equal(engine.snapshot().phase, 'ended');
});

test('bad ranges and options leave the previous state intact', () => {
  const engine = new PracticeEngine({ barCount: 218, endBar: 76 });
  for (const options of [{ bpm: 0 }, { startBar: 0 }, { countInBars: 0.5 }, { endBar: 300 }, { loop: 'yes' }]) {
    assert.throws(() => engine.start({ runId: 'bad', ...options }));
    assert.equal(engine.snapshot().phase, 'idle');
  }
});
