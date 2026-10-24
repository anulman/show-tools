// Node kernel measurement; this cannot establish browser AudioWorklet underruns.
// Profile separately: node --cpu-prof --cpu-prof-dir=build-wasm/verification scripts/measure-wasm.mjs --profile
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { loadEngine, Tracker, pulsePCM, S } from '../tests/wasm_tests.mjs';

const profile = process.argv.includes('--profile');
const rate = 48000, block = 128, quantumUs = block / rate * 1e6;
const pcm = pulsePCM(50, 30); // Generate outside timing; identical PCM for both drivers.
const e = await loadEngine();
const commandOutput = (name, args = []) => { try { return execFileSync(name, args, { encoding: 'utf8' }).trim(); } catch { return 'unavailable'; } };
const environment = { node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model,
  cores: cpus().length, uptime: commandOutput('uptime'), physicalCoreQuery: platform() === 'darwin' ? commandOutput('sysctl', ['-n', 'hw.ncpu']) : commandOutput('nproc') };
const quantile = (values, q) => values[Math.min(values.length - 1, Math.floor(values.length * q))];
const summarize = values => { const sorted = [...values].sort((a, b) => a - b); return {
  p50Us: quantile(sorted, 0.5), p99Us: quantile(sorted, 0.99), maxUs: sorted.at(-1),
  overQuantum: values.filter(v => v > quantumUs).length, overHalfQuantum: values.filter(v => v > quantumUs / 2).length }; };

function run(kind, pass) {
  const t = new Tracker(e); assert.equal(t.command(1, 120), 0); t.drain();
  const memoryBytes = e.memory.buffer.byteLength, audio = new Float32Array(e.memory.buffer, t.audio, block);
  const snapshot = new Float64Array(e.memory.buffer, t.snapshot, 22);
  const events = new Float64Array(e.memory.buffer, t.events, 512 * 12);
  const durations = [], active = [], silent = [], hopBursts = [];
  const counts = { clocks: 0, detections: 0, accepted: 0, silentDetections: 0, faults: 0 };
  let checksum = 0, lastBeatFrame = -1, lastBeatId = -1, lastFrame = 0;
  // A driver with the same copies, clock calls and output reads, but no DSP work.
  const processBlock = kind === 'engine' ? () => e.bt_process(t.ptr, t.audio, block) : () => {
    snapshot[0] = lastFrame + block; snapshot[6] = 120; return 0;
  };
  for (let frame = 0; frame < pcm.length; frame += block) {
    const begin = performance.now();
    audio.set(pcm.subarray(frame, frame + block));
    processBlock();
    const count = kind === 'engine' ? e.bt_drain_events(t.ptr, t.events, 512) : 0;
    if (kind === 'engine') e.bt_snapshot(t.ptr, t.snapshot);
    checksum += audio[0] + snapshot[0] + snapshot[6];
    if (snapshot[0] !== frame + block || !Number.isFinite(snapshot[6]) || snapshot[17] !== 0) counts.faults++;
    for (let i = 0; i < count; i++) {
      const offset = i * 12, type = events[offset], eventFrame = events[offset + 2];
      checksum += type + eventFrame;
      if (type === 1) {
        counts.clocks++;
        if (eventFrame <= lastBeatFrame || events[offset + 1] <= lastBeatId || events[offset + 3] < eventFrame) counts.faults++;
        lastBeatFrame = eventFrame; lastBeatId = events[offset + 1];
      }
      if (type === 2) { counts.detections++; if (events[offset + 3] > 31 * rate) counts.silentDetections++; }
      if (type === 3) counts.accepted++;
    }
    lastFrame = frame + block;
    const us = (performance.now() - begin) * 1000;
    durations.push(us); (frame < rate * 30 ? active : silent).push(us);
    // Aubio's 512-frame analysis hop causes bursts every fourth render quantum.
    if ((frame + block) % 512 === 0) hopBursts.push(us);
    if (frame + block === rate * 30 && kind === 'engine') {
      if (t.command(7, 0, frame + block, 2) !== 0) counts.faults++;
      t.drain();
    }
  }
  const final = t.state();
  if (kind === 'engine' && (!counts.clocks || !counts.detections || !counts.accepted || counts.silentDetections || final[S.status] !== 2 || final[S.accepted] !== 0)) counts.faults++;
  if (e.memory.buffer.byteLength !== memoryBytes) counts.faults++;
  t.destroy();
  return { kind, pass, callbacks: durations.length, audioSeconds: pcm.length / rate, memoryBytes, checksum, counts,
    all: summarize(durations), active: summarize(active), silence: summarize(silent), analysisHop: summarize(hopBursts) };
}

if (profile) {
  // Results from profiler instrumentation are intentionally excluded from timing reports.
  const result = run('engine', 0);
  console.log(JSON.stringify({ profileOnly: true, counts: result.counts, checksum: result.checksum, environment }, null, 2));
  assert.equal(result.counts.faults, 0);
} else {
  // Warm both call paths before the five alternating measured passes.
  run('engine', -1); run('noop', -1);
  const runs = [];
  for (let pass = 1; pass <= 5; pass++) {
    for (const kind of pass % 2 ? ['engine', 'noop'] : ['noop', 'engine']) runs.push(run(kind, pass));
  }
  const aggregate = {};
  for (const kind of ['engine', 'noop']) {
    const selected = runs.filter(r => r.kind === kind), p99 = selected.map(r => r.all.p99Us).sort((a, b) => a - b);
    aggregate[kind] = { p99MedianUs: p99[2], p99RangeUs: [p99[0], p99[4]], worstCallbackUs: Math.max(...selected.map(r => r.all.maxUs)),
      deadlineMisses: selected.reduce((n, r) => n + r.all.overQuantum, 0), faults: selected.reduce((n, r) => n + r.counts.faults, 0) };
  }
  console.log(JSON.stringify({ claim: 'Observed Node optimized WASM kernel callback costs versus a 128-frame/48-kHz quantum; not browser underrun proof',
    quantumUs, environment, baselineMeaning: 'No-op driver overhead only; no speedup ratio is claimed', aggregate, runs }, null, 2));
  assert.equal(aggregate.engine.faults + aggregate.noop.faults, 0, 'correctness failures invalidate timing');
}
