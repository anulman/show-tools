import assert from 'node:assert/strict';
import { parseSheetCues } from '../../lib/performance/sheet-cues.js';

let cases = 0;
const operations = ['cr', 'cx', 'r', 'c', 'x', 'p', 'g', 'h'];
const names = [null, 'lead', 'day'];
const subdivisions = ['', 'e', '&', 'a'];
for (const meter of [4, 6]) for (let press = 0; press < meter * 4; press++) {
  const prefix = `${Math.floor(press / 4) + 1}${subdivisions[press % 4]}`;
  const executions = ['', 'b', ...Array.from({ length: meter * 4 }, (_, index) => `${Math.floor(index / 4) + 1}${subdivisions[index % 4]}`)];
  for (const operation of operations) for (const sourceName of names) for (const suffix of executions) {
    const token = `${prefix}${operation}${sourceName === null ? '' : `(${sourceName})`}${suffix}`;
    const parsed = parseSheetCues(token, meter);
    assert.equal(parsed.kind, 'parsed', token);
    if (parsed.kind !== 'parsed') throw new Error('PARSE');
    const index = executions.indexOf(suffix) - 2;
    const execution = suffix === '' ? { kind: 'now' } : suffix === 'b' ? { kind: 'next-bar' }
      : { kind: 'beat', beat: index / 4, barOffset: index < press ? 1 : 0 };
    assert.deepEqual(parsed.actions, [{ operation, sourceName, pressBeat: press / 4, execution }], 'FINITE_GRAMMAR_MEANING');
    cases++;
  }
  for (let next = 0; next < meter; next++) {
    const parsed = parseSheetCues(`(${next + 1})&cr1 &cx2`, meter);
    assert.equal(parsed.kind, 'parsed', 'SILENT_ANCHOR');
    if (parsed.kind !== 'parsed') throw new Error('PARSE');
    assert.equal(parsed.actions[0].pressBeat, next + .5, 'SILENT_ANCHOR');
    assert.equal(parsed.actions[1].pressBeat, next + .5, 'CELL_LOCAL_INHERITANCE');
    const fresh = parseSheetCues('&cx2', meter);
    assert.equal(fresh.kind, 'parsed');
    if (fresh.kind !== 'parsed') throw new Error('PARSE');
    assert.equal(fresh.actions[0].pressBeat, .5, 'CELL_LOCAL_RESET');
    cases++;
  }
}
for (const token of ['0p', '7p', '(7)&r', 'r()', 'r(3)', 'rr', 'cxx', '1p&p', '1p*', 'clb', '(3)4r', 'r(lead day)', '1.5p', '1pb2']) {
  assert.equal(parseSheetCues(token).kind, 'invalid', 'MALFORMED_REJECTION'); cases++;
}
for (const meter of [4, 6]) for (let press = 0; press < meter * 4; press++) {
  const prefix = `${Math.floor(press / 4) + 1}${subdivisions[press % 4]}`;
  for (const first of operations) for (const second of operations) for (const suffix of ['', 'b', '1', String(meter)]) {
    const parsed = parseSheetCues(`${prefix}${first}(lead)${suffix}+${second}(day)b`, meter);
    assert.equal(parsed.kind, 'parsed', 'GROUP_PARSE');
    if (parsed.kind !== 'parsed') throw new Error('PARSE');
    assert.deepEqual(parsed.actions.map(action => action.pressBeat), [press / 4, press / 4], 'GROUP_SHARED_PRESS');
    assert.deepEqual(parsed.actions.map(action => action.group), [1, 1], 'GROUP_IDENTITY');
    assert.deepEqual(parsed.actions.map(action => action.operation), [first, second], 'GROUP_ACTION_ORDER');
    assert.deepEqual(parsed.actions.map(action => action.sourceName), ['lead', 'day'], 'GROUP_SOURCE_IDENTITY');
    assert.deepEqual(parsed.actions[1].execution, { kind: 'next-bar' }, 'GROUP_EXPLICIT_EXECUTION');
    cases++;
  }
  assert.deepEqual(parseSheetCues(`${prefix}x(lead+day)b`, meter), parseSheetCues(`${prefix}x(lead)b+x(day)b`, meter), 'GROUP_STOP_EQUIVALENCE');
  cases++;
}
assert.equal(cases, 32390, 'FINITE_DOMAIN_CARDINALITY');
let edgeCases = 0;
const now = { kind: 'now' };
for (const meter of [4, 6]) for (let press = 0; press < meter * 4; press++) {
  const prefix = `${Math.floor(press / 4) + 1}${subdivisions[press % 4]}`;
  for (const [first, second] of [['lead', 'day'], ['day', 'lead']]) {
    assert.deepEqual(parseSheetCues(`${prefix}ru(${first})`, meter), { kind: 'parsed', actions: [
      { operation: 'ru', sourceName: first, pressBeat: press / 4, execution: now },
    ] }, 'RELEASE_ARM_MEANING');
    assert.deepEqual(parseSheetCues(`${prefix}cx(${first})+ru(${second})`, meter), { kind: 'parsed', actions: [
      { operation: 'cx', sourceName: first, pressBeat: press / 4, execution: now, group: 1 },
      { operation: 'ru', sourceName: second, pressBeat: press / 4, execution: now, group: 1 },
    ] }, 'RELEASE_ARM_GROUP');
    assert.deepEqual(parseSheetCues(`${prefix}pp(${first}+${second})`, meter), { kind: 'parsed', actions: [
      { operation: 'pp', sourceName: `${first}+${second}`, pressBeat: press / 4, execution: now },
    ] }, 'PLAYBACK_PAIR_ORDER');
    for (const token of [`${prefix}ru(${first}+${second})`, `${prefix}ru(${first})b`,
      `${prefix}pp(${first})`, `${prefix}pp(${first}+${first})`,
      `${prefix}pp(${first}+${second})b`, `${prefix}pp(${first}+${second})+x`]) {
      assert.equal(parseSheetCues(token, meter).kind, 'invalid', 'EDGE_GRAMMAR_REJECTION');
    }
    edgeCases += 9;
  }
}
for (const meter of [4, 6]) for (const token of ['ru', 'ru(lead)', '2ru', 'pp(lead+day)', '2pp']) {
  assert.equal(parseSheetCues(token, meter).kind, 'invalid', 'EDGE_ANCHOR_OR_NAME_REQUIRED');
  edgeCases++;
}
assert.equal(edgeCases, 730, 'EDGE_DOMAIN_CARDINALITY');
process.stdout.write(JSON.stringify({ status: 'PASS-finite-real-parser', cases: cases + edgeCases, originalCases: cases, edgeCases,
  domain: '4/4 and 6/8; every sixteenth press, execution and group in the original grammar, plus bounded release arms and ordered playback pairs' }) + '\n');
