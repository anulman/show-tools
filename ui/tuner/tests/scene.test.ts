import assert from 'node:assert/strict';
import test from 'node:test';
import type { TunerState } from '../../../lib/tuner/model.js';
import { tunerSceneFrame, tunerSceneNoteLabel } from '../scene.js';

// Synthetic presentation input only. Production targets always come from native state.
const targets = [
  { midi: 48, letter: 'C', accidental: 0, octave: 3 },
  { midi: 50, letter: 'D', accidental: 0, octave: 3 },
  { midi: 52, letter: 'E', accidental: 0, octave: 3 },
  { midi: 53, letter: 'F', accidental: 0, octave: 3 },
  { midi: 55, letter: 'G', accidental: 0, octave: 3 },
  { midi: 57, letter: 'A', accidental: 0, octave: 3 },
  { midi: 59, letter: 'B', accidental: 0, octave: 3 },
  { midi: 60, letter: 'C', accidental: 0, octave: 4 },
];
const idle: TunerState = { revision: 7, root: 48, scale: 'major', step: 2, targets,
  complete: false, listening: true, preview: { kind: 'silent' }, pitch: { kind: 'unvoiced' } };
function pitched(note: TunerState['targets'][number]): TunerState {
  return { ...idle, pitch: { kind: 'pitched', note, midi: note.midi + 0.12,
    frequency: 130, cents: 12, confidence: 0.9, rms: 0.2 } };
}
function frame(state: TunerState | null) { return tunerSceneFrame({ state, timeSeconds: 2, aspect: '16:9' }); }

test('ordered native targets occupy the clockwise 300-degree arc with distinct tonics', () => {
  const actual = frame(idle);
  assert.deepEqual(actual.notches.map(notch => notch.note), targets);
  assert.equal(actual.notches[0]?.clockAngle, 210);
  assert.equal(actual.notches.at(-1)?.clockAngle, 510);
  assert.ok(actual.notches.every((notch, index) => index === 0 || notch.clockAngle > (actual.notches[index - 1]?.clockAngle ?? 0)));
  assert.ok((actual.notches[0]?.position.x ?? Infinity) < actual.center.x);
  assert.ok((actual.notches.at(-1)?.position.x ?? -Infinity) > actual.center.x);
  assert.equal(frame(pitched(targets[0])).hitIndex, 0);
  assert.equal(frame(pitched(targets[7])).hitIndex, 7);
});

test('a live match lights exactly its slot and a dimmer lower trail without confirming progress', () => {
  const state = pitched(targets[4]);
  const before = JSON.stringify(state);
  const actual = frame(state);
  assert.equal(actual.hitIndex, 4);
  assert.deepEqual(actual.notches.map(notch => notch.light), ['trail','trail','trail','trail','live','idle','idle','idle']);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.step, 2);
});

test('non-live states and invalid targets never retain a live hit or clamp to an endpoint', () => {
  for (const kind of ['off','microphone','warming','reference','unvoiced'] as const) {
    assert.ok(frame({ ...idle, pitch: { kind } }).notches.every(notch => notch.light === 'idle'));
  }
  for (const midi of [47,49,61,72]) {
    assert.equal(frame(pitched({ midi, letter: 'C', accidental: 0, octave: 4 })).hitIndex, null);
  }
  assert.equal(frame({ ...pitched(targets[2]), listening: false }).hitIndex, null);
  assert.equal(frame({ ...pitched(targets[2]), preview: { kind: 'scale', step: 2 } }).hitIndex, null);
  assert.deepEqual(frame(null).notches, []);
});

test('paired aspects translate geometry without scaling or changing the target layout', () => {
  const wide = frame(idle);
  const narrow = tunerSceneFrame({ state: idle, timeSeconds: 2, aspect: '4:3' });
  assert.equal(wide.width, 320); assert.equal(narrow.width, 240);
  assert.equal(wide.height, 180); assert.equal(narrow.height, 180);
  for (const [index, notch] of wide.notches.entries()) {
    const other = narrow.notches[index];
    assert.ok(other);
    assert.equal(notch.position.x - other.position.x, 40);
    assert.equal(notch.position.y, other.position.y);
    assert.equal(notch.labelPosition.x - other.labelPosition.x, 40);
    for (const coordinate of [other.position.x,other.position.y,other.labelPosition.x,other.labelPosition.y]) assert.ok(Number.isInteger(coordinate));
  }
});

test('native spelling and supplied chromatic target count are preserved', () => {
  assert.equal(tunerSceneNoteLabel({ midi: 51, letter: 'E', accidental: -1, octave: 3 }), 'Eb3');
  assert.equal(tunerSceneNoteLabel({ midi: 49, letter: 'D', accidental: -2, octave: -1 }), 'Dbb-1');
  const chromatic = Array.from({ length: 13 }, (_, index) => ({ midi: 48 + index, letter: 'C', accidental: 0, octave: 3 }));
  const actual = frame({ ...idle, scale: 'chromatic', targets: chromatic });
  assert.equal(actual.notches.length, 13);
  assert.equal(actual.notches.at(-1)?.clockAngle, 510);
});

test('explicit seeks are deterministic and do not retain a previous hit', () => {
  const input = { state: idle, timeSeconds: 1.5, aspect: '4:3' } as const;
  const initial = tunerSceneFrame(input);
  frame(pitched(targets[7]));
  assert.deepEqual(tunerSceneFrame(input), initial);
  assert.throws(() => tunerSceneFrame({ ...input, timeSeconds: NaN }), /time/);
});

test('long accidental labels clear the notches in the chromatic layout', () => {
  const targets = Array.from({ length:13 }, (_, index) => ({ midi:48 + index, letter:'E', accidental:-1, octave:-1 }));
  const actual = frame({ ...idle, scale:'chromatic', targets });
  for (const notch of actual.notches) {
    const width = notch.label.length * 6 - 1;
    const left = notch.labelPosition.x - Math.floor(width / 2);
    const top = notch.labelPosition.y - 3;
    const overlaps = left < notch.position.x + 2 && left + width > notch.position.x - 2
      && top < notch.position.y + 2 && top + 7 > notch.position.y - 2;
    assert.equal(overlaps,false,`Label ${notch.clockAngle} touches its notch`);
  }
});
