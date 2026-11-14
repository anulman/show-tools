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
    assert.equal(parsed.kind, 'parsed');
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
process.stdout.write(JSON.stringify({ status: 'PASS-finite-real-parser', cases, domain: '4/4 and 6/8; every sixteenth press, 8 operations, 3 source names, immediate/next-bar/every sixteenth execution; inherited silent anchors and fresh cells; 14 malformed controls' }) + '\n');
