import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assembleInstallationMap, matchingDialAxes, motionFromEvidence, commissionDial, commissionHardware, profileSnapshot, saveCommissionedProfile, switchFromEvidence, type CapturedSwitch, type PeripheralBaseProfile } from '../commissioning.js';

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

test('terminal switch claims must match the actual event device, code and repeat count', () => {
  for (const field of ['code', 'device', 'repeats']) {
    const values = evidence().map(value => value.type !== 'terminal' ? value : { ...value, keySignatures: [{
      device: field === 'device' ? '/dev/input/event99' : '/dev/input/event23',
      code: field === 'code' ? 31 : 30, presses: 3, releases: 3, repeats: field === 'repeats' ? 1 : 0,
    }] });
    assert.throws(() => switchFromEvidence({ values, controlId: 'blue', trialId: 'synthetic', evidencePath: '/tmp/evidence', exitCode: 0 }), /contradicts/);
  }
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

test('blank setup replaces stale mappings and prompts for LEDs on the four arcade buttons only', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-all-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'peripheral.json');
  const oldMap = assembleInstallationMap({
    switches: [captured('blue', 30), captured('pedal', 31)],
    leds: [{ controlId: 'pedal', sdkChannel: 6 }],
    confirmWiring: true,
  });
  await saveCommissionedProfile(path, null, { ...base, inputMap: oldMap });
  const ids = ['blue', 'yellow', 'red', 'green', 'pedal', 'mushroom'];
  const answers = ['', '', '', '', '', '', '', '1', '2', '3', '49', 'yes'];
  const prompts: string[] = [];
  const completeSource = { ...source, keyCodes: [40, 41, 42, 43, 44, 45] };
  const profile = await commissionHardware({
    profilePath: path, baseProfile: { ...base, bindingRevision: 2 }, includeAxis: false,
    service: { inspect: async () => ({ active: false }), stop: async () => {}, start: async () => {} },
    audioOff: async () => {},
    capture: async id => ({ ...captured(id, 40 + ids.indexOf(id)), source: completeSource }),
    io: { question: async prompt => {
      prompts.push(prompt);
      const answer = answers.shift();
      assert(typeof answer === 'string', 'unexpected setup prompt');
      return answer;
    }, write: () => {} },
  });
  assert.equal(answers.length, 0);
  assert.equal(prompts.filter(prompt => prompt.startsWith('LED output for ')).length, 4);
  assert.deepEqual(profile.inputMap.switches.map(value => value.controlId), ids);
  assert.deepEqual(profile.inputMap.leds.map(value => [value.controlId, value.sdkChannel]),
    [['blue', 0], ['yellow', 1], ['red', 2], ['green', 48]]);
  assert.equal(await readFile(path, 'utf8'), JSON.stringify(profile, null, 2) + '\n');
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


function motionEvidence() {
  const events = [5, -5, 5, -5].map(value => ({ type: 'motion', device: '/dev/input/event24', eventType: 2, code: 1, value }));
  return [{ type: 'source', device: '/dev/input/event24', canonical: '/sys/synthetic/event24', eventClock: 'CLOCK_MONOTONIC',
    interfaceNumber: 2, eventTypes: [0, 2], keyCodes: [], relativeAxes: [1] }, ...events,
    { type: 'terminal', schemaVersion: 1, trialId: 'motion-synthetic', controlId: 'knob', operatorDirection: 'clockwise',
      complete: true, inputsClosed: true, requiresSuccessfulExit: true, error: null, deviceWrites: false,
      observedAxes: [{ device: '/dev/input/event24', interfaceNumber: 2, eventType: 2, code: 1, samples: 4, delta: 0, positiveCounts: 10, negativeCounts: 10 }] }];
}

test('zero net dial displacement remains valid nonzero motion with direction reversals', () => {
  const axes = motionFromEvidence({ values: motionEvidence(), direction: 'clockwise', trialId: 'motion-synthetic', exitCode: 0 });
  assert.equal(axes.length, 1); assert.equal(axes[0].delta, 0); assert.equal(axes[0].samples, 4);
  assert.equal(axes[0].positiveCounts, 10); assert.equal(axes[0].negativeCounts, 10);
  assert.throws(() => motionFromEvidence({ values: motionEvidence(), direction: 'counterclockwise', trialId: 'motion-synthetic', exitCode: 0 }), /did not complete/);
});

test('bootstrap matches only opposite motion from the same attachment and qualified axis', () => {
  const [baseAxis] = motionFromEvidence({ values: motionEvidence(), direction: 'clockwise', trialId: 'motion-synthetic', exitCode: 0 });
  const clockwise = { attachment: 'same-usb', axes: [{ ...baseAxis, delta: 804 }] };
  const opposite = { ...baseAxis, delta: -2467 };
  const counterclockwise = { attachment: 'same-usb', axes: [opposite] };
  assert.deepEqual(matchingDialAxes(clockwise, counterclockwise), [{ axis: clockwise.axes[0], counterclockwiseDelta: -2467 }]);
  assert.throws(() => matchingDialAxes(clockwise, { ...counterclockwise, attachment: 'reattached' }), /attachment changed/);
  for (const axis of [{ ...opposite, delta: 2467 }, { ...opposite, delta: 0 }, { ...opposite, code: 0 }])
    assert.throws(() => matchingDialAxes(clockwise, { ...counterclockwise, axes: [axis] }), /No common axis/);
});

test('dial reports must match actual durable raw samples and source capabilities', () => {
  const missing = motionEvidence(); missing.splice(1, 1);
  assert.throws(() => motionFromEvidence({ values: missing, direction: 'clockwise', trialId: 'motion-synthetic', exitCode: 0 }), /sample counts/);
  const duplicateSource = motionEvidence(); duplicateSource.splice(1, 0, { type: 'source', device: '/dev/input/event99', canonical: '/sys/synthetic/event99',
    eventClock: 'CLOCK_MONOTONIC', interfaceNumber: 2, eventTypes: [0, 2], keyCodes: [], relativeAxes: [1] });
  assert.throws(() => motionFromEvidence({ values: duplicateSource, direction: 'clockwise', trialId: 'motion-synthetic', exitCode: 0 }), /do not select one/);
});

test('a schema-valid profile larger than the installed runtime limit is never published', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-bounds-')));
  const path = join(directory, 'peripheral.json');
  const identities: CapturedSwitch['controlId'][] = ['blue', 'yellow', 'red', 'green', 'pedal', 'mushroom'];
  const inputMap = assembleInstallationMap({ switches: identities.map((controlId, index) => ({ controlId,
    source: { interfaceNumber: index, eventTypes: [0, 1], keyCodes: Array.from({ length: 1000 }, (_, code) => code), relativeAxes: [] },
    type: 1, code: index, evidencePath: '/tmp/synthetic' })), leds: [], confirmWiring: false });
  try {
    await assert.rejects(saveCommissionedProfile(path, null, { ...base, inputMap }), /16 KiB/);
    assert.equal(await profileSnapshot(path), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const stage of ['before-save', 'after-save']) test(`button commissioning cancellation ${stage} reports publication truthfully and does not start the service`, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-cancel-')));
  const path = join(directory, 'peripheral.json');
  const old = Buffer.from('original private operator profile');
  await writeFile(path, old, { mode: 0o600 });
  const controller = new AbortController();
  const answers = ['blue,yellow', '', '', 'none', 'none'];
  let checks = 0, started = false;
  try {
    await assert.rejects(commissionHardware({ profilePath: path, baseProfile: base, signal: controller.signal,
      service: { inspect: async () => ({ active: true }), stop: async () => {}, start: async () => { started = true; } },
      audioOff: async () => { if (++checks === 4 && stage === 'before-save') controller.abort(new Error('cancel before save')); },
      io: { question: async () => answers.shift() ?? '', write: message => { if (stage === 'after-save' && message.startsWith('Saved')) controller.abort(new Error('cancel after save')); } },
      capture: async controlId => captured(controlId, controlId === 'blue' ? 30 : 31), includeAxis: false }),
    stage === 'before-save' ? /cancel before save/ : /Configuration saved.*left stopped/);
    assert.equal(started, false);
    if (stage === 'before-save') assert.deepEqual(await readFile(path), old);
    else assert.equal(JSON.parse(await readFile(path, 'utf8')).inputMap.switches.length, 2);
    await assert.rejects(readFile(path + '.commissioning.lock'), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an already cancelled publication preserves the old profile', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-save-cancel-')));
  const path = join(directory, 'peripheral.json');
  const profile = { ...base, inputMap: assembleInstallationMap({ switches: [captured('blue', 30)], leds: [], confirmWiring: false }) };
  try {
    await saveCommissionedProfile(path, null, profile);
    const old = await profileSnapshot(path);
    const controller = new AbortController(); controller.abort(new Error('cancel publication'));
    await assert.rejects(saveCommissionedProfile(path, old, { ...profile, bindingRevision: 2 }, controller.signal), /cancel publication/);
    assert.deepEqual(await profileSnapshot(path), old);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
