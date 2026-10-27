import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/video/wasm/video-pose.wasm', import.meta.url)));
const instance = await WebAssembly.instantiate(module, {});
const { vp_pose: pose, vp_sway: sway, vp_breath: breath } = instance.exports;
assert.equal(typeof pose, 'function');
assert.equal(typeof sway, 'function');
assert.equal(typeof breath, 'function');
if (typeof pose !== 'function' || typeof sway !== 'function' || typeof breath !== 'function') throw new Error('Missing video pose exports');

test('standalone module needs no host imports', () => {
  assert.deepEqual(WebAssembly.Module.imports(module), []);
});

test('held poses respect exact boundaries and direct seeks', () => {
  for (let model = 0; model < 8; model++) {
    for (const [quarter, expected] of [[8, 0], [5, 2], [2, 1], [0, 0], [7, 0], [6, 1], [-3, 2], [4.999, 1]]) {
      assert.equal(pose(quarter, model), expected);
    }
    assert.equal(sway(3, model), sway(11, model));
    assert.equal(breath(3, model), breath(11, model));
  }
});

test('all models have bounded visible motion', () => {
  for (let model = 0; model < 8; model++) {
    assert.notEqual(sway(2, model), sway(6, model));
    assert.notEqual(breath(0, model), breath(1, model));
    for (let i = -1000; i <= 1000; i++) {
      const quarter = i / 100;
      assert(Math.abs(sway(quarter, model)) <= 0.010000001);
      assert(breath(quarter, model) >= 0 && breath(quarter, model) <= 0.008000001);
    }
  }
});
