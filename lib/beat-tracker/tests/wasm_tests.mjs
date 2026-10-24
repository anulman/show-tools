import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const S = { frame: 0, epoch: 1, mode: 3, status: 4, started: 5, bpm: 6, phase: 7, drops: 17, accepted: 19 };
export async function loadEngine() {
  const module = await WebAssembly.compile(await readFile(new URL('../dist/beat-tracker.wasm', import.meta.url)));
  let instance;
  const wasi = { fd_close: () => 0, fd_seek: () => 29, proc_exit: code => { throw Error(`WASM exit ${code}`); },
    fd_write(fd, iovs, count, written) {
      const view = new DataView(instance.exports.memory.buffer);
      let bytes = 0;
      for (let i = 0; i < count; i++) bytes += view.getUint32(iovs + i * 8 + 4, true);
      view.setUint32(written, bytes, true);
      return 0;
    } };
  assert(WebAssembly.Module.imports(module).every(i => i.module === 'wasi_snapshot_preview1'), 'unexpected host import');
  instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi });
  instance.exports._initialize();
  return instance.exports;
}
export class Tracker {
  constructor(engine, rate = 48000) {
    this.e = engine; this.ptr = engine.bt_create(rate);
    assert(this.ptr, 'tracker allocation');
    this.audio = engine.malloc(2048 * 4); this.snapshot = engine.malloc(22 * 8); this.events = engine.malloc(512 * 12 * 8);
    assert(this.audio && this.snapshot && this.events, 'scratch allocation');
  }
  state() { this.e.bt_snapshot(this.ptr, this.snapshot); return [...new Float64Array(this.e.memory.buffer, this.snapshot, 22)]; }
  command(type, value = 0, frame = this.state()[0], sequence = 1, epoch = this.state()[1]) {
    return this.e.bt_command(this.ptr, type, value, frame, sequence, epoch);
  }
  process(count, audio) {
    assert(count <= 2048);
    if (audio) new Float32Array(this.e.memory.buffer, this.audio, count).set(audio.subarray(0, count));
    this.e.bt_process(this.ptr, audio ? this.audio : 0, count);
  }
  advance(count, chunk = 128) { for (let n = 0; n < count; n += chunk) this.process(Math.min(chunk, count - n)); }
  drain() {
    const count = this.e.bt_drain_events(this.ptr, this.events, 512);
    const values = new Float64Array(this.e.memory.buffer, this.events, count * 12);
    return Array.from({ length: count }, (_, i) => [...values.subarray(i * 12, i * 12 + 12)]);
  }
  observe(beat, bpm, confidence = 1, level = 0.1) { return this.e.bt_observe(this.ptr, beat, this.state()[0], bpm, confidence, level); }
  destroy() { this.e.bt_destroy(this.ptr); for (const p of [this.audio, this.snapshot, this.events]) this.e.free(p); this.ptr = 0; }
}
export function pulsePCM(seconds = 50, activeSeconds = 30, rate = 48000) {
  const pcm = new Float32Array(seconds * rate); let random = 1979;
  for (let frame = 0; frame < activeSeconds * rate; frame++) {
    const age = frame % (rate / 2);
    if (age < rate * 0.035) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      pcm[frame] = (random | 0) / 2147483648 * Math.exp(-age / (rate * 0.007)) * 0.7;
    }
  }
  return pcm;
}
function clockTrace(e, chunk) {
  const t = new Tracker(e); const result = [];
  assert.equal(t.command(1, 123), 0); assert.equal(t.command(2, 110, 100003, 2), 0);
  for (let frame = 0; frame < 240000; frame += chunk) {
    t.process(Math.min(chunk, 240000 - frame));
    result.push(...t.drain().filter(v => v[0] === 1).map(v => [v[1], v[2], v[3]]));
  }
  assert.equal(t.state()[S.bpm], 110); assert.equal(t.state()[S.mode], 1);
  t.destroy(); return result;
}
export async function runTests() {
  const e = await loadEngine(), memory = e.memory.buffer.byteLength;
  for (const rate of [0, NaN, 7999, 48000.5, 192001]) assert.equal(e.bt_create(rate), 0);
  for (const rate of [8000, 192000]) new Tracker(e, rate).destroy();
  e.bt_destroy(0); e.bt_process(0, 0, 128);
  assert.deepEqual(clockTrace(e, 128), clockTrace(e, 127));
  assert.deepEqual(clockTrace(e, 128), clockTrace(e, 1));
  let t = new Tracker(e);
  t.advance(48000); assert.equal(t.state()[S.started], 0);
  assert.equal(t.command(3, 0, -24000, 1), 0);
  assert.equal(t.command(3, 0, 0, 2), 0);
  assert.equal(t.state()[S.bpm], 120); assert.equal(t.state()[S.mode], 1);
  assert.equal(t.command(1, 100, -1, 3), 1);
  assert.equal(t.command(1, 100, 48000, 3), 5);
  assert.equal(t.command(1, 100, 48000, 3), 5);
  const duplicateAck = t.drain().at(-1);
  assert.equal(duplicateAck[9], 5, 'duplicate ACK preserves original already-started result');
  assert.equal(t.command(2, 130, 60000, 4), 0);
  assert.equal(t.command(6, 0, 48000, 5), 0);
  const resetEvents = t.drain();
  assert(resetEvents.some(v => v[0] === 4 && v[11] === 4 && v[9] === 3 && v[4] === 2), 'reset ACKs canceled queued command in new epoch');
  assert.equal(t.state()[S.mode], 1); assert.equal(t.state()[S.epoch], 2); assert.equal(t.state()[S.started], 0);
  assert.equal(t.command(6, 0, 48000, 5, 1), 0, 'reset retry replays success across epoch boundary');
  assert.deepEqual(t.drain(), [resetEvents.at(-1)], 'retry replays full original reset ACK');
  assert.equal(t.command(1, 120, 48000, 6, 1), 3);
  t.advance(20000); assert.equal(t.state()[S.started], 0); t.destroy();
  t = new Tracker(e);
  for (let seq = 1; seq <= 64; seq++) assert.equal(t.command(2, 120, 1000000 + seq, seq), 0);
  assert.equal(t.command(2, 120, 1000065, 65), 4); t.destroy();
  t = new Tracker(e);
  for (const bpm of [39.9, 240.1, NaN, Infinity]) assert.equal(t.command(1, bpm), 1);
  t.process(128, Float32Array.from({ length: 128 }, (_, i) => i % 3 === 0 ? NaN : i % 3 === 1 ? Infinity : 2));
  assert(t.state().every(Number.isFinite)); assert(t.state()[15] <= 1);
  t.destroy(); t = new Tracker(e);
  assert.equal(t.command(6, 0, 128, 1), 1, 'future reset cannot allocate on audio thread');
  assert.equal(t.command(7, 0, 128, 2), 1, 'future fresh cannot allocate on audio thread');
  for (let seq = 3; seq < 603; seq++) t.command(0, 0, 0, seq);
  assert(t.state()[S.drops] > 0); assert.equal(t.drain().length, 512); assert.equal(t.drain().length, 0); t.destroy();
  t = new Tracker(e); assert.equal(t.command(1, 120), 0);
  for (let beat = 1; beat <= 12; beat++) { t.advance(24000); t.observe(t.state()[0] - 1000, 120); }
  assert(t.state()[S.accepted] > 0, 'historical ideal observations reach follower');
  const accepted = t.state()[S.accepted]; t.command(5, 0, t.state()[0], 2);
  t.advance(24000); assert.equal(t.observe(t.state()[0], 180), 1); assert.equal(t.state()[S.accepted], 0);
  assert(accepted > 0); t.advance(20 * 48000); assert.equal(t.state()[S.status], 2); assert.equal(t.state()[S.bpm], 120);
  t.destroy();
  const pcm = pulsePCM(); t = new Tracker(e); t.command(1, 120);
  let detections = 0, accepts = 0, silentDetections = 0, clocks = 0, firstAccept = Infinity;
  for (let frame = 0; frame < pcm.length; frame += 128) {
    t.process(Math.min(128, pcm.length - frame), pcm.subarray(frame, frame + 128));
    for (const v of t.drain()) {
      if (v[0] === 1) clocks++;
      if (v[0] === 2) { detections++; if (v[3] > 31 * 48000) silentDetections++; }
      if (v[0] === 3) { accepts++; firstAccept = Math.min(firstAccept, v[3] / 48000); }
    }
    if (frame + 128 === 30 * 48000) assert.equal(t.command(7, 0, frame + 128, 2), 0);
  }
  assert(detections > 0 && accepts > 0 && clocks > 0, 'actual aubio pulses, follower and clock all ran');
  assert(firstAccept <= 8); assert.equal(silentDetections, 0, 'silence getters cannot fabricate pulse events');
  assert.equal(t.state()[S.accepted], 0); assert.equal(t.state()[S.status], 2); t.destroy();
  const training = pulsePCM(20, 20), audio = new Float32Array(128);
  const freshness = [];
  for (const command of [6, 7]) for (const signal of ['tone', 'noise', 'silence']) {
    t = new Tracker(e); const control = new Tracker(e);
    let trainingAccepted = 0;
    for (let frame = 0; frame < training.length; frame += 128) {
      t.process(128, training.subarray(frame, frame + 128));
      trainingAccepted += t.drain().filter(v => v[0] === 3).length;
    }
    assert(trainingAccepted > 0 && t.state()[S.started], 'reset/fresh fixture genuinely acquired via aubio');
    assert.equal(t.command(command, 0, training.length, 1), 0);
    t.drain(); let random = 1979;
    const treatmentTrace = [], controlTrace = [];
    for (let frame = 0; frame < 8 * 48000; frame += 128) {
      for (let i = 0; i < 128; i++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        audio[i] = signal === 'tone' ? 0.3 * Math.sin(2 * Math.PI * 440 * (frame + i) / 48000)
          : signal === 'noise' ? (random | 0) / 2147483648 * 0.3 : 0;
      }
      t.process(128, audio); control.process(128, audio);
      for (const [tracker, trace, origin] of [[t, treatmentTrace, training.length], [control, controlTrace, 0]])
        for (const event of tracker.drain()) if (event[0] === 2) trace.push([event[2] - origin, event[3] - origin, event[6], event[7]]);
    }
    assert.deepEqual(treatmentTrace, controlTrace, `${command}/${signal} detector trace equals fresh control`);
    assert.equal(t.state()[S.accepted], control.state()[S.accepted], `${command}/${signal} accepted count equals fresh control`);
    if (signal === 'silence') {
      assert.equal(control.state()[S.accepted], 0);
      assert.equal(t.state()[command === 6 ? S.started : S.status], command === 6 ? 0 : 2);
    }
    freshness.push({ command, signal, trainingAccepted, detections: treatmentTrace.length, accepted: t.state()[S.accepted], controlAccepted: control.state()[S.accepted] });
    t.destroy(); control.destroy();
  }
  for (let i = 0; i < 50; i++) new Tracker(e).destroy();
  assert.equal(e.memory.buffer.byteLength, memory, 'fixed WASM memory');
  console.log(JSON.stringify({ verdict: 'PASS', actualWasm: true, detections, accepts, clocks, firstAcceptSeconds: firstAccept, memoryBytes: memory, freshness,
    scope: 'WASM exact clock traces across 1/127/128 blocks; ideal observations and real PCM; native/WASM binary trace parity not asserted' }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runTests();
