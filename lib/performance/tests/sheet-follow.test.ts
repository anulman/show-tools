import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileSheetFollow } from '../sheet-follow.js';

const bars = (texts: readonly string[], first = 1) => texts.map((text, index) => ({ text, bar: index + first, a1: `A${index + first}` }));

test('piano follows ordered pitch pairs at the preceding bar’s beat 4 and releases on the written beat', () => {
  const score = ['A3', 'A3', 'G3', 'G3', 'F3', 'F3', 'A3', 'G3', 'A3', 'A3', "G3'", "G3'", "F3'", "A3'", ''];
  const { events, issues } = compileSheetFollow({
    kind: 'piano', bars: bars(score), beatsPerBar: 4, beat: 3,
    take: { begin: { bar: 1, beat: 3 }, end: { bar: 10, beat: 3 } }, stop: { bar: 14, beat: 3 },
  });
  assert.deepEqual(issues, []);
  assert.deepEqual(events.map(({ at, window }) => [at.bar, at.beat, window?.beginCount ?? null]), [
    [10, 3, 4], [11, 3, 8], [12, 3, 12], [13, 3, 20], [14, 3, null],
  ]);
});

test('piano identifies the unmatched written entrance in its original cell', () => {
  const { events, issues } = compileSheetFollow({
    kind: 'piano', bars: bars(['A3', 'A3', "F3'", '']), beatsPerBar: 4, beat: 3,
    take: { begin: { bar: 1, beat: 3 }, end: { bar: 2, beat: 3 } }, stop: { bar: 3, beat: 3 },
  });
  assert.deepEqual(events, []);
  assert.deepEqual(issues.map(issue => issue.a1), ['A3']);
});

test('guitar follows restart, short cycle, long suffix, isolated sustain and release', () => {
  const c3 = '[4(C3)-', c4 = '- 2(C4)-', lateC4 = '- (2)&(C4)-', d4 = '- 4(D4)-';
  const sustain = '-(C4)-', cut = '-3] ', suffix = '- (2)&(F4)- 3(E4)- 4(D4)-';
  const regular = [c4, d4, lateC4];
  const long = [...regular, d4, lateC4, suffix, lateC4];
  const source = [`/1/${c3}`, ...regular, `${cut}/2/${c3}`, ...regular, `${cut}/3/${c3}`, ...regular, `${cut}/4/${c3}`, ...long];
  const playing = [sustain, sustain, d4, lateC4, cut + c3, ...regular, cut + c3, ...regular, cut + c3, ...long,
    cut + c3, c4, cut + c3, ...regular, sustain, sustain, d4, lateC4, cut + c3, ...regular, cut + c3, ...regular, ''];
  const { events, issues } = compileSheetFollow({
    kind: 'guitar', bars: bars([...source, ...playing], 10), beatsPerBar: 4, beat: 2.5,
    take: { begin: { bar: 10, beat: 2.5 }, end: { bar: 30, beat: 2.5 } },
    restarts: [52], stop: { bar: 68, beat: 0 },
  });
  assert.deepEqual(issues, []);
  const byBar = new Map(events.map(event => [event.at.bar, event]));
  assert.deepEqual([30, 31, 34, 38, 42, 48, 52, 55, 56, 57, 60, 64].map(bar => (byBar.get(bar)?.window?.beginCount ?? -4) / 4 + 10),
    [29, 29, 10, 14, 22, 28, 10, 29, 29, 29, 14, 18]);
  assert.deepEqual(byBar.get(68), { at: { bar: 68, beat: 0 }, window: null });
});
