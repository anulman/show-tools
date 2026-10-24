import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));

function createTracker(rate = 48000) {
  let instance;
  instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: {
    fd_close: () => 0,
    fd_seek: () => 29,
    fd_write: (_fd, _iovs, _count, written) => {
      new DataView(instance.exports.memory.buffer).setUint32(written, 0, true);
      return 0;
    },
    proc_exit: code => { throw new Error(`WASM exit ${code}`); },
  } });
  const engine = instance.exports;
  engine._initialize();
  const tracker = engine.bt_create(rate);
  assert(tracker, 'manual tracker initializes without an audio detector');
  const snapshot = engine.malloc(22 * 8);
  const events = engine.malloc(512 * 12 * 8);
  const input = engine.malloc(128 * 4);
  let sequence = 0;
  const state = () => {
    engine.bt_snapshot(tracker, snapshot);
    return Array.from(new Float64Array(engine.memory.buffer, snapshot, 22));
  };
  return {
    engine,
    state,
    command(type, value = 0) {
      const s = state();
      return engine.bt_command(tracker, type, value, s[0], ++sequence, s[1]);
    },
    render(frames, chunk = 128, withInput = false) {
      const trace = [];
      for (let frame = 0; frame < frames; frame += chunk) {
        const length = Math.min(chunk, frames - frame);
        if (withInput) new Float32Array(engine.memory.buffer, input, length).fill(0.25);
        engine.bt_process(tracker, withInput ? input : 0, length);
        const count = engine.bt_drain_events(tracker, events, 512);
        const values = new Float64Array(engine.memory.buffer, events, count * 12);
        for (let index = 0; index < count; index++) trace.push(Array.from(values.subarray(index * 12, (index + 1) * 12)));
      }
      return trace;
    },
    dispose() {
      engine.bt_destroy(tracker);
      for (const pointer of [snapshot, events, input]) engine.free(pointer);
    },
  };
}

test('manual WASM emits exact 98 BPM crossings with and without microphone PCM', () => {
  const traces = [];
  for (const [chunk, withInput] of [[127, false], [128, true]]) {
    const t = createTracker();
    assert.equal(t.command(5), 0);
    assert.equal(t.command(1, 98), 0);
    const events = t.render(48000 * 10, chunk, withInput);
    const clocks = events.filter(event => event[0] === 1);
    assert.equal(clocks.length, 16);
    for (const [index, clock] of clocks.entries()) {
      assert.equal(clock[1], index + 1);
      assert(Math.abs(clock[2] - (index + 1) * 48000 * 60 / 98) < 1e-6);
    }
    assert.equal(events.filter(event => event[0] === 2 || event[0] === 3).length, 0);
    assert.equal(t.state()[6], 98);
    assert.equal(t.state()[3], 1);
    assert.equal(t.state()[19], 0);
    traces.push(clocks.map(event => event.slice(0, 7)));
    t.dispose();
  }
  assert.deepEqual(traces[0], traces[1]);
});

test('manual WASM preserves reset, reseed, and lifecycle commands', () => {
  const t = createTracker();
  assert.equal(t.command(2, 120), 0);
  assert.equal(t.render(48000).filter(event => event[0] === 1).length, 2);
  assert.equal(t.command(7), 0);
  assert.equal(t.state()[6], 120);
  assert.equal(t.command(6), 0);
  const epoch = t.state()[1];
  assert.equal(epoch, 2);
  assert.equal(t.render(48000).filter(event => event[0] === 1).length, 0);
  assert.equal(t.command(1, 60), 0);
  const events = t.render(48001).filter(event => event[0] === 1);
  assert.equal(events.length, 1);
  assert.equal(events[0][4], epoch);
  assert(Math.abs(events[0][2] - 144000) < 1e-6);
  t.dispose();
});
