import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assembleInstallationMap, commissionDial, commissionHardware, profileSnapshot, saveCommissionedProfile, switchFromEvidence, type CapturedSwitch, type PeripheralBaseProfile } from '../commissioning.js';

const source = { interfaceNumber: 0, eventTypes: [0, 1], keyCodes: [30, 31], relativeAxes: [] };
const base: PeripheralBaseProfile = { version: 2, origin: 'http://127.0.0.1:8443', tokenFile: '/home/test/token',
  helperExecutable: '/opt/show-tools/peripheral-host', bindingRevision: 1, jiggle: null };
function captured(controlId: CapturedSwitch['controlId'], code: number): CapturedSwitch { return { controlId, source, type: 1, code, evidencePath: '/tmp/synthetic/trial.ndjson' }; }
function evidence() {
  return [{ type: 'source', device: '/dev/input/event23', canonical: '/sys/synthetic/event23', eventClock: 'CLOCK_MONOTONIC', ...source },
    ...Array.from({ length: 3 }, () => [{ type: 'key', device: '/dev/input/event23', code: 30, value: 1 }, { type: 'key', device: '/dev/input/event23', code: 30, value: 0 }]).flat(),
    { type: 'terminal', schemaVersion: 2, trialId: 'synthetic', controlId: 'blue', complete: true, inputsClosed: true,
      requiresSuccessfulExit: true, error: null, keySignatures: [{ device: '/dev/input/event23', code: 30, presses: 3, releases: 3, repeats: 0 }] }];
}

test('a successful observer receipt identifies the actual source and three edges without factory defaults', () => {
  const result = switchFromEvidence({ values: evidence(), controlId: 'blue', trialId: 'synthetic', evidencePath: '/tmp/evidence', exitCode: 0 });
  assert.equal(result.code, 30);
  assert.deepEqual(result.source, source);
  assert.equal(result.controlId, 'blue');
  for (const exitCode of [1, null]) assert.throws(() => switchFromEvidence({ values: evidence(), controlId: 'blue', trialId: 'synthetic', evidencePath: '/tmp/evidence', exitCode }), /did not complete/);
  assert.throws(() => switchFromEvidence({ values: evidence(), controlId: 'yellow', trialId: 'synthetic', evidencePath: '/tmp/evidence', exitCode: 0 }), /did not complete/);
  const missingPair = evidence(); missingPair.splice(1, 2);
  assert.throws(() => switchFromEvidence({ values: missingPair, controlId: 'blue', trialId: 'synthetic', evidencePath: '/tmp/evidence', exitCode: 0 }), /three fresh/);
});

test('two observed controls share an exact selector; no axis or future controls are invented', () => {
  const inputMap = assembleInstallationMap({ switches: [captured('blue', 30), captured('yellow', 31)], leds: [{ controlId: 'blue', sdkChannel: 0 }, { controlId: 'yellow', sdkChannel: 1 }], confirmWiring: true });
  assert.equal(inputMap.sources.length, 1);
  assert.deepEqual(inputMap.sources[0], { kind: 'linux', id: 'source-1', ...source });
  assert.deepEqual(inputMap.switches.map(value => value.controlId), ['blue', 'yellow']);
  assert.equal(inputMap.axis, undefined);
  assert.throws(() => assembleInstallationMap({ switches: [captured('blue', 30), captured('yellow', 30)], leds: [], confirmWiring: false }), /alias/);
  assert.throws(() => assembleInstallationMap({ switches: [captured('blue', 30)], leds: [{ controlId: 'yellow', sdkChannel: 1 }], confirmWiring: true }), /configured switches/);
  assert.throws(() => assembleInstallationMap({ switches: [captured('blue', 30)], leds: [{ controlId: 'blue', sdkChannel: 0 }], confirmWiring: false }), /confirmed LED wiring/);
});

test('profile publication validates first and refuses to overwrite a concurrent operator edit', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-profile-')));
  const path = join(directory, 'peripheral.json');
  const inputMap = assembleInstallationMap({ switches: [captured('blue', 30)], leds: [], confirmWiring: false });
  try {
    await saveCommissionedProfile(path, null, { ...base, inputMap });
    const original = await profileSnapshot(path); assert(original);
    const saved = JSON.parse(original.toString()); assert.equal(saved.inputMap.switches[0].controlId, 'blue');
    await writeFile(path, 'concurrent operator edit', { mode: 0o600 });
    await assert.rejects(saveCommissionedProfile(path, original, { ...base, inputMap }), /changed during/);
    assert.equal(await readFile(path, 'utf8'), 'concurrent operator edit');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const failed of [false, true]) test(`commissioning ${failed ? 'failure preserves' : 'success replaces'} the profile and restores only its service`, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-flow-')));
  const path = join(directory, 'peripheral.json');
  const old = Buffer.from('original private operator profile');
  await writeFile(path, old, { mode: 0o600 });
  const answers = ['blue,yellow', '', '', '1', '2', 'yes'];
  const actions: string[] = [];
  try {
    const operation = commissionHardware({ profilePath: path, baseProfile: base,
      service: { inspect: async () => { actions.push('inspect'); return { active: true }; }, stop: async () => { actions.push('stop'); }, start: async () => { actions.push('start'); } },
      audioOff: async () => { actions.push('audio-off-checked'); }, io: { question: async () => { const answer = answers.shift(); if (answer === undefined) throw Error('unexpected prompt'); return answer; }, write: () => {} },
      capture: async controlId => { actions.push('capture-' + controlId); if (failed && controlId === 'yellow') throw Error('synthetic ambiguous key'); return captured(controlId, controlId === 'blue' ? 30 : 31); }, includeAxis: false });
    if (failed) { await assert.rejects(operation, /ambiguous key/); assert.deepEqual(await readFile(path), old); }
    else { const profile = await operation; assert.equal(profile.inputMap.switches.length, 2); assert.equal(profile.jiggle, null); assert.equal(profile.inputMap.leds[1].sdkChannel, 1); }
    assert.equal(actions.filter(value => value === 'stop').length, 1);
    assert.equal(actions.filter(value => value === 'start').length, 1);
    assert(actions.indexOf('audio-off-checked') < actions.indexOf('stop'));
    assert(actions.indexOf('stop') < actions.indexOf('capture-blue'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a live audio transition blocks save and automatic service restoration without stopping audio', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-audio-')));
  const path = join(directory, 'peripheral.json');
  await writeFile(path, 'original', { mode: 0o600 });
  const answers = ['blue,yellow', '', '', 'none', 'none'];
  let checks = 0, started = false;
  try {
    await assert.rejects(commissionHardware({ profilePath: path, baseProfile: base,
      service: { inspect: async () => ({ active: true }), stop: async () => {}, start: async () => { started = true; } },
      audioOff: async () => { if (++checks >= 4) throw Error('Audio is running'); },
      io: { question: async () => answers.shift() ?? '', write: () => {} },
      capture: async controlId => captured(controlId, controlId === 'blue' ? 30 : 31), includeAxis: false }), /left stopped/);
    assert.equal(started, false);
    assert.equal(await readFile(path, 'utf8'), 'original');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a second commissioning terminal cannot stop the service or capture concurrently', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-lock-')));
  const path = join(directory, 'peripheral.json');
  const answers = ['blue,yellow', ''];
  let entered = () => {};
  let leave = () => {};
  const capturing = new Promise<void>(resolve => { entered = resolve; });
  const release = new Promise<void>(resolve => { leave = resolve; });
  const shared = { profilePath: path, baseProfile: base,
    service: { inspect: async () => ({ active: false }), stop: async () => {}, start: async () => {} },
    audioOff: async () => {}, io: { question: async () => answers.shift() ?? '', write: () => {} }, includeAxis: false };
  const running = commissionHardware({ ...shared, capture: async () => { entered(); await release; throw Error('synthetic cancellation'); } });
  const completed = assert.rejects(running, /synthetic cancellation/);
  try {
    await capturing;
    await assert.rejects(commissionHardware({ ...shared, capture: async () => { throw Error('must not capture'); } }), /already active/);
    leave(); await completed;
    assert.equal(await profileSnapshot(path), null);
  } finally { leave(); await completed; await rm(directory, { recursive: true, force: true }); }
});

test('all six identities and an explicitly observed relative-Y source fit the installation schema', () => {
  const completeSource = { ...source, keyCodes: [30, 31, 32, 33, 34, 35] };
  const identities: CapturedSwitch['controlId'][] = ['blue', 'yellow', 'red', 'green', 'pedal', 'mushroom'];
  const switches = identities.map((controlId, index) => ({ ...captured(controlId, 30 + index), source: completeSource }));
  const inputMap = assembleInstallationMap({ switches, leds: [
    { controlId: 'blue', sdkChannel: 0 }, { controlId: 'yellow', sdkChannel: 1 },
    { controlId: 'red', sdkChannel: 2 }, { controlId: 'green', sdkChannel: 48 }], confirmWiring: true,
    axis: { source: { interfaceNumber: 2, eventTypes: [0, 2], keyCodes: [], relativeAxes: [1] }, type: 2, code: 1, evidencePath: '/tmp/synthetic-axis' } });
  assert.equal(inputMap.switches.length, 6); assert.equal(inputMap.sources.length, 2);
  assert.equal(inputMap.axis?.code, 1); assert.equal(inputMap.leds[3].sdkChannel, 48);
});

test('adding an observed dial preserves existing switches, LEDs and explicit jiggle values', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-axis-')));
  const path = join(directory, 'peripheral.json');
  const inputMap = assembleInstallationMap({ switches: [captured('blue', 30), captured('yellow', 31)], leds: [{ controlId: 'blue', sdkChannel: 0 }], confirmWiring: true });
  const original = { ...base, inputMap, jiggle: { minimumTravel: 4, minimumReversal: 2 } };
  await saveCommissionedProfile(path, null, original);
  let restored = false;
  try {
    const profile = await commissionDial({ profilePath: path, service: { inspect: async () => ({ active: true }), stop: async () => {}, start: async () => { restored = true; } },
      audioOff: async () => {}, io: { question: async () => '', write: () => {} },
      captureAxis: async () => ({ source: { interfaceNumber: 2, eventTypes: [0, 2], keyCodes: [], relativeAxes: [1] }, type: 2, code: 1, evidencePath: '/tmp/synthetic-axis' }) });
    assert.deepEqual(profile.inputMap.switches, original.inputMap.switches);
    assert.deepEqual(profile.inputMap.leds, original.inputMap.leds);
    assert.deepEqual(profile.jiggle, original.jiggle);
    assert.equal(profile.bindingRevision, 2); assert.equal(profile.inputMap.axis?.sourceId, 'source-2');
    assert(restored);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
