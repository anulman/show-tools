import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequiredTuningBank, TunerPort, TunerState } from '../../../lib/tuner/model.js';
import { recordRequiredTuningBank } from '../required-bank.js';

const bank: RequiredTuningBank = { profile: 1, slots: [0, 1], target: { root: 52, scale: 'major' } };

function tuner() {
  let state: TunerState = {
    revision: 1, root: 52, scale: 'major', step: 0, complete: false, listening: true,
    targets: [{ midi: 52, letter: 'E', accidental: 0, octave: 3 }, { midi: 64, letter: 'E', accidental: 0, octave: 4 }],
    preview: { kind: 'note', step: 0 }, pitch: { kind: 'reference' },
  };
  const listeners = new Set<(next: TunerState) => void>();
  const port: TunerPort = {
    beginRequiredBank: async capture => { assert.deepEqual(capture, bank); return state; },
    snapshot: () => state,
    subscribe: listener => { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    command: async () => { throw new Error('Required capture advances through the engine'); },
  };
  return {
    port, listeners,
    publish(update: Partial<TunerState>) {
      state = { ...state, revision: state.revision + 1, ...update };
      for (const listener of listeners) listener(state);
    },
  };
}

test('required tuning waits for the final captured note before letting Start continue', async () => {
  const { port, listeners, publish } = tuner();
  let canStart = false;
  const recording = recordRequiredTuningBank(port, bank, new AbortController().signal).then(() => { canStart = true; });
  await Promise.resolve();
  publish({ step: 1, preview: { kind: 'note', step: 1 } });
  await Promise.resolve();
  assert.equal(canStart, false);
  publish({ complete: true, listening: false, preview: { kind: 'silent' } });
  await recording;
  assert.equal(canStart, true);
  assert.equal(listeners.size, 0);
});

test('canceling required tuning clears the listener and never continues to Start', async () => {
  const { port, listeners } = tuner();
  const controller = new AbortController();
  const recording = recordRequiredTuningBank(port, bank, controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(recording, { name: 'AbortError' });
  assert.equal(listeners.size, 0);
});
