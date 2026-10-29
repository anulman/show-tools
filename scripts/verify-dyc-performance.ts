import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { compileSong, canonicalSongJson, inspectCompiledSong } from '../lib/performance/compiled-song.js';
import { compiledProgramBytes } from '../lib/performance/compiled-native.js';
import { NativePerformance } from '../lib/performance/wasm-performance.js';
import { CONTROL_IDS } from '../lib/performance/model.js';
import type { LiveEffectDefinition } from '../lib/performance/model.js';
import { PF } from '../lib/performance/wasm-abi.js';
import source from '../songs/dance-yrself-clean.source.json';
import mapping from '../songs/dance-yrself-clean.mapping.json';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'show-tools-dyc-'));
const execute = promisify(execFile);
const finite = Schema.Number.check(Schema.isFinite());
const ResultSchema = Schema.Struct({ frames: Schema.Int, phase: Schema.Int, bpm: finite, tempoHits: Schema.Int, events: Schema.Int, rotations: Schema.Int,
  rotationCutoffs: Schema.Array(Schema.Int),
  takes: Schema.Array(Schema.Struct({ voice: Schema.Int, ready: Schema.Int, frames: Schema.Int, period: Schema.Int, revision: Schema.Int })),
  stems: Schema.Array(Schema.Struct({ energy: finite, sum: finite, peak: finite, nonzero: Schema.Int })),
});
type Result = typeof ResultSchema.Type;
const decodeResult = Schema.decodeUnknownSync(ResultSchema);
async function command(binary: string, args: string[]) {
  try {
    const result = await execute(binary, args, { cwd: root, maxBuffer: 1024 * 1024 });
    await appendFile(join(directory, 'commands.log'), `${binary} ${args.join(' ')}\n${result.stdout}${result.stderr}`);
    return result.stdout;
  } catch (error) {
    if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string') throw new Error(error.stderr.trim() || error.message);
    throw error;
  }
}
const song = await compileSong(source, mapping);
await writeFile(join(directory, 'dance-yrself-clean.json'), canonicalSongJson(song));
await writeFile(join(directory, 'inspection.txt'), inspectCompiledSong(song));
assert(song.executable, `Artifacts: ${directory}\n${inspectCompiledSong(song)}`);
const bytes = compiledProgramBytes(song);
const artifact = join(directory, 'dance-yrself-clean.pfp');
await writeFile(artifact, bytes);
const build = join(directory, 'native');
await command('cmake', ['-S', 'lib/performance', '-B', build, '-DCMAKE_BUILD_TYPE=Release']);
await command('cmake', ['--build', build, '--target', 'compiled_song_host', '--parallel', '4']);
const module = await WebAssembly.compile(await readFile(join(root, 'ui/practice/wasm/manual-clock.wasm')));
function presses(rate: number) {
  const at = (position: number) => Math.ceil((song.chart.beatsPerBar + 1 + position) * rate * 60 / song.chart.bpm) + 1;
  const pads = song.cues.map(cue => ({ frame: cue.bar === 0 ? 1 : at((cue.bar - 1) * song.chart.beatsPerBar + (cue.cueBeat ?? 0)),
    button: CONTROL_IDS.indexOf(cue.buttonId), value: 0, windowEndCount: -1, source: cue.source.a1, text: cue.source.text }));
  assert.equal(song.rotation?.windows.length, 10, 'actual DYC declares all ten rotation spans');
  const rotations = song.rotation.windows.flatMap(window => [1, -1, 0].map((value, index) => ({
    frame: at((window.begin.bar - 1) * song.chart.beatsPerBar + window.begin.beat + [0, .25, .375][index]),
    button: 5, value, windowEndCount: (window.end.bar - 1) * song.chart.beatsPerBar + window.end.beat,
    source: window.source.a1, text: window.source.text,
  })));
  return [...pads, ...rotations].sort((a, b) => a.frame - b.frame || a.button - b.button);
}
function wasm(rate: number, plan: ReturnType<typeof presses>): Result {
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write(_fd: number, _iov: number, _count: number, written: number) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; }, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); } } });
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) throw new Error('Missing WASM memory');
  memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  const native = new NativePerformance({ api: instance.exports, sampleRate: rate, mode: PF.PRACTICE, clickGain: 0 });
  let frame = 0, next = 0, events = 0, tempoHits = 0, rotations = 0;
  let releaseCount: number | null = null;
  const rotationCutoffs: number[] = [];
  function clock() {
    const state = Array.from(native.query('pf_snapshot'));
    const tracker = native.trackerSnapshot();
    assert.equal(state[PF.FRAME], frame); assert.equal(tracker[0], frame, 'oracle uses a coherent current tracker frame');
    return { wholeCount: (state[PF.BAR_NUMBER] - 1) * song.chart.beatsPerBar + state[PF.BEAT_NUMBER] - 1,
      framesPerCount: rate * 60 / state[PF.BPM], nextBeatFrame: tracker[8] }; // BT_S_NEXT_BEAT_FRAME
  }
  function expectedCutoff() {
    assert(releaseCount !== null);
    const current = clock();
    return Math.ceil(current.nextBeatFrame + (releaseCount - current.wholeCount - 1) * current.framesPerCount);
  }
  const stems = Array.from({ length: 4 }, () => ({ energy: 0, sum: 0, peak: 0, nonzero: 0 }));
  function drain() {
    for (const event of native.events()) {
      events++;
      if (event.type === 'tempo-hit') tempoHits++;
      if (event.type === 'fault' || event.type === 'control' && !event.applied) throw new Error(`Native event failure at ${event.frame}: ${event.error}`);
    }
  }
  function process(count: number, silence = false) {
    const input = Float32Array.from({ length: count }, (_, index) => ((frame + index) % 97 - 48) / 256);
    const output = Array.from({ length: 4 }, () => new Float32Array(count));
    native.process(input, output.slice(0, 2), count, output.slice(2));
    for (const [index, samples] of output.entries()) for (const value of samples) {
      assert(Number.isFinite(value));
      if (silence) assert.equal(value, 0, 'all output stops after range completion');
      stems[index].energy += value * value; stems[index].sum += value;
      stems[index].peak = Math.max(stems[index].peak, Math.abs(value)); stems[index].nonzero += Number(value !== 0);
    }
    frame += count; drain();
  }
  try {
    native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => {
      const effects: LiveEffectDefinition[] = [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }];
      if (profile === PF.BACKUP_PROFILE) effects.push({ kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 });
      return { profile, effects };
    }));
    const pointer = native.call('malloc', bytes.length);
    try { new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes); native.call('pf_load_compiled_bytes', native.handle, pointer, bytes.length); }
    finally { native.invoke('free', pointer); }
    native.setMicrophone(true); native.setClick(false);
    native.start({ runId: 'dyc-scripted-input', bpm: song.chart.bpm, countInBars: 1, startBar: 1, endBar: song.chart.bars.length, loop: false, automatic: false });
    drain();
    while (native.state().phase !== 'ended') {
      assert(['count-in', 'playing'].includes(native.state().phase), 'transport did not fault or stop early');
      assert(frame < rate * 500);
      if (releaseCount !== null) {
        const cutoff = expectedCutoff();
        const backup = native.voiceEffects()[PF.BACKUP_PROFILE];
        if (frame === cutoff - 1) assert.equal(backup.activity, 'live', 'source remains active through the frame before its predicted cutoff');
        if (frame >= cutoff) {
          assert.equal(frame, cutoff, 'fixture observes the exact predicted source cutoff frame');
          assert.equal(backup.rotationRemainingBeats, 0); assert.notEqual(backup.activity, 'live');
          rotationCutoffs.push(frame); releaseCount = null;
        }
      }
      while (next < plan.length && plan[next].frame === frame) {
        const press = plan[next++];
        try {
          native.control(press.button === 5 ? { id: 'knob', value: press.value } : { id: CONTROL_IDS[press.button] });
          if (press.button === 5 && press.value) {
            const backup = native.voiceEffects().find(voice => voice.profile === PF.BACKUP_PROFILE);
            assert(backup?.rotationEligible && backup.rotationRemainingBeats > 0, `rotation did not activate at ${press.source}`);
            const current = clock();
            const quarter = [1, 2, 3, 4].find(index => current.nextBeatFrame - (1 - index / 4) * current.framesPerCount > frame);
            assert(quarter !== undefined, 'a strict future quarter boundary exists');
            releaseCount = Math.min(current.wholeCount + quarter / 4, press.windowEndCount);
            const predicted = current.nextBeatFrame + (releaseCount - current.wholeCount - 1) * current.framesPerCount;
            assert(Math.abs(frame + backup.rotationRemainingBeats * current.framesPerCount - predicted) < 1e-6,
              `native deadline differs from the independent next-quarter/window-end oracle at ${press.source}`);
            rotations++;
          }
        }
        catch (error) { throw new Error(`Press rejected at frame ${frame}, ${press.source} ${press.text}: ${error instanceof Error ? error.message : String(error)}`); }
        drain();
      }
      let count = Math.min(1024, rate * 500 - frame, next < plan.length ? plan[next].frame - frame : Infinity);
      if (releaseCount !== null) {
        const cutoff = expectedCutoff();
        count = Math.min(count, (frame < cutoff - 1 ? cutoff - 1 : cutoff) - frame);
      }
      assert(count > 0); process(count);
    }
    assert.equal(next, plan.length);
    process(128, true);
    return { frames: frame, phase: PF.ENDED, bpm: native.state().bpm, tempoHits, events, rotations, rotationCutoffs, stems,
      takes: song.takes.map((_, index) => { const take = native.compiledTake(index); return { voice: take.voice, ready: Number(take.ready), frames: take.frames, period: take.period, revision: take.revision }; }) };
  } finally { native.dispose(); }
}
const reports = [];
let failed = false;
for (const rate of [44100, 48000]) {
  const plan = presses(rate), script = join(directory, `presses-${rate}.tsv`);
  await writeFile(script, plan.map(press => `${press.frame}\t${press.button}\t${press.value}\t${press.windowEndCount}`).join('\n') + '\n');
  await writeFile(join(directory, `source-presses-${rate}.json`), JSON.stringify(plan, null, 2));
  let native: Result | null = null, browser: Result | null = null;
  const errors: string[] = [];
  try { native = decodeResult(JSON.parse(await command(join(build, 'compiled_song_host'), [artifact, script, String(rate)]))); }
  catch (error) { errors.push(`native: ${error instanceof Error ? error.message : String(error)}`); }
  try { browser = wasm(rate, plan); }
  catch (error) { errors.push(`WASM: ${error instanceof Error ? error.message : String(error)}`); }
  if (native && browser) {
    try {
      assert.deepEqual(native.takes, browser.takes); assert.equal(native.frames, browser.frames); assert.equal(native.events, browser.events);
      assert.equal(native.tempoHits, 2); assert.equal(browser.tempoHits, 2); assert.equal(native.takes.length, 9);
      assert.equal(native.rotations, 20); assert.equal(browser.rotations, 20);
      assert.equal(native.rotationCutoffs.length, 20);
      assert.deepEqual(native.rotationCutoffs, browser.rotationCutoffs, 'native and WASM observe the same twenty predicted source cutoff frames');
      assert(native.takes.every(take => take.ready && take.frames > 0 && take.period >= take.frames && take.revision === 1));
      for (let index = 0; index < 4; index++) {
        assert(native.stems[index].energy > 0);
        for (const key of ['energy', 'peak'] as const) assert(Math.abs(native.stems[index][key] - browser.stems[index][key]) <= 1e-6 * Math.max(1, Math.abs(native.stems[index][key])), `${key} differs for stem ${index}`);
        assert(Math.abs(native.stems[index].sum - browser.stems[index].sum) / native.frames <= 1e-7, `mean differs for stem ${index}`);
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  failed ||= errors.length > 0;
  reports.push({ rate, status: errors.length ? 'FAIL' : 'PASS', native, wasm: browser, errors });
}
const report = { artifactDirectory: directory, sourceDigest: song.source.digest, mappingDigest: song.mappingDigest, reports };
await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (failed) process.exitCode = 1;
