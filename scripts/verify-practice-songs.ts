import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { canonicalSongJson, inspectCompiledSong } from '../lib/performance/compiled-song.js';
import { compiledProgramBytes } from '../lib/performance/compiled-native.js';
import { NativePerformance } from '../lib/performance/wasm-performance.js';
import type { LiveEffectDefinition } from '../lib/performance/model.js';
import { PF } from '../lib/performance/wasm-abi.js';
import { compileMusicXmlSong, readMusicXmlSong, writeMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { prepareDeclaredExternalAssets } from '../lib/performance/external-assets.js';
import { DEFAULT_BUTTON_BINDINGS, PHYSICAL_SWITCH_IDS } from '../lib/performance/input-bindings.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'show-tools-practice-songs-'));
const execute = promisify(execFile);
const finite = Schema.Number.check(Schema.isFinite());
const ResultSchema = Schema.Struct({ frames: Schema.Int, physicalEvents: Schema.Int, externalTriggers: Schema.Int, phase: Schema.Int, bpm: finite, tempoHits: Schema.Int, events: Schema.Int, rotations: Schema.Int,
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
const build = join(directory, 'native');
await command('cmake', ['-S', 'lib/performance', '-B', build, '-DCMAKE_BUILD_TYPE=Release']);
await command('cmake', ['--build', build, '--target', 'compiled_song_host', '--parallel', '4']);
const module = await WebAssembly.compile(await readFile(join(root, 'ui/practice/wasm/manual-clock.wasm')));
const bindings = DEFAULT_BUTTON_BINDINGS;
const buttonByRow = new Map(bindings.flatMap(({ controlId, target }) => target.kind === 'cue-rows'
  ? target.rows.map(row => [row, 8 + PHYSICAL_SWITCH_IDS.indexOf(controlId)] as const)
  : []));
const results = [];
let failed = false;
for (const songId of ['dance-yrself-clean', 'drunk-girls', 'tribulations']) {
  const document = await readMusicXmlSong(await readFile(join(root, 'songs', `${songId}.musicxml`), 'utf8'));
  const canonical = await writeMusicXmlSong({ song: { ...document.song, inputBindings: bindings }, report: document.report,
    ...(document.source ? { source: document.source } : {}), ...(document.mapping ? { mapping: document.mapping } : {}),
    ...(document.voices ? { voices: document.voices } : {}) });
  const song = await compileMusicXmlSong(canonical);
  assert(song.executable, inspectCompiledSong(song));
  const assets = await prepareDeclaredExternalAssets(song.externalSamples);
  assert.equal(assets.length, song.externalSamples?.length ?? 0, 'Every external source in this acceptance fixture has embedded audio');
  const assetsList = join(directory, `${songId}-assets.tsv`);
  for (const asset of assets) await writeFile(join(directory, `${songId}-${asset.slot}.wav`), asset.bytes);
  await writeFile(assetsList, assets.map(asset => `${asset.slot}\t${join(directory, `${songId}-${asset.slot}.wav`)}`).join('\n') + (assets.length ? '\n' : ''));
  const expectedTempoHits = song.cues.filter(cue => cue.tempoBeatHint === 1).length;
  const expectedRotations = (song.rotation?.windows.length ?? 0) * 2;
  await writeFile(join(directory, `${songId}.musicxml`), canonical);
  await writeFile(join(directory, `${songId}.json`), canonicalSongJson(song));
  const bytes = compiledProgramBytes(song), artifact = join(directory, `${songId}.pfp`);
  await writeFile(artifact, bytes);
  function presses(rate: number) {
    const at = (position: number) => Math.ceil((song.chart.beatsPerBar + 1 + position) * rate * 60 / song.chart.bpm) + 1;
    const authored = new Map<string, { frame: number; button: number; value: number; windowEndCount: number; source: string; text: string }>();
    for (const cue of song.cues) {
      const frame = cue.bar === 0 ? 1 : at((cue.bar - 1) * song.chart.beatsPerBar + (cue.cueBeat ?? 0));
      const button = buttonByRow.get(cue.buttonId);
      assert(button !== undefined, "No physical button assigned to " + cue.buttonId);

      authored.set(`${frame}/${button}`, { frame, button, value: 1, windowEndCount: -1, source: cue.source.a1, text: cue.source.text });
    }
    const pads = [...authored.values()].flatMap(press => [press,
      { ...press, frame: press.frame + Math.max(1, Math.floor(rate / 20)), value: 0 }]);
    const rotations = (song.rotation?.windows ?? []).flatMap(window => [1, -1, 0].map((value, index) => ({
      frame: at((window.begin.bar - 1) * song.chart.beatsPerBar + window.begin.beat + [0, .25, .375][index]),
      button: 14, value, windowEndCount: (window.end.bar - 1) * song.chart.beatsPerBar + window.end.beat,
      source: window.source.a1, text: window.source.text,
    })));
    const external = (song.externalSamples ?? []).map(sample => ({
      frame: at((sample.begin.bar - 1) * song.chart.beatsPerBar + sample.begin.beat + .25),
      button: 16 + sample.slot, value: 0, windowEndCount: -1, source: sample.voiceId, text: 'synthetic external trigger',
    }));
    return [...pads, ...rotations, ...external].sort((a, b) => a.frame - b.frame || a.button - b.button || a.value - b.value);
  }
  function wasm(rate: number, plan: ReturnType<typeof presses>): Result {
    const maxFrames = Math.ceil((song.chart.bars.length * song.chart.beatsPerBar + song.chart.beatsPerBar + 1) * rate * 60 / 40) + 1024;
    let memory: WebAssembly.Memory;
    const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
      wasi_snapshot_preview1: { fd_write(_fd: number, _iov: number, _count: number, written: number) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; }, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); } } });
    if (!(instance.exports.memory instanceof WebAssembly.Memory)) throw new Error('Missing WASM memory');
    memory = instance.exports.memory;
    if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
    const native = new NativePerformance({ api: instance.exports, sampleRate: rate, mode: PF.PRACTICE, clickGain: 0 });
    let frame = 0, next = 0, events = 0, tempoHits = 0, rotations = 0, physicalEvents = 0, externalTriggers = 0;
    let releaseFrame: number | null = null;
    const rotationCutoffs: number[] = [];
    function clock() {
      const state = Array.from(native.query('pf_snapshot'));
      const tracker = native.trackerSnapshot();
      assert.equal(state[PF.FRAME], frame); assert.equal(tracker[0], frame, 'oracle uses a coherent current tracker frame');
      return { wholeCount: (state[PF.BAR_NUMBER] - 1) * song.chart.beatsPerBar + state[PF.BEAT_NUMBER] - 1,
        framesPerCount: rate * 60 / state[PF.BPM], nextBeatFrame: tracker[8] };
    }
    function expectedCutoff() {
      assert(releaseFrame !== null);
      return Math.ceil(releaseFrame);
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
      for (const asset of assets) native.prepareExternalWav(asset.slot, asset.bytes);
      const bindingGeneration = native.inputRouting().bindingGeneration;
      native.inputAttach({ producer: 0, session: 1, bindingGeneration, kind: 'physical', releasedMask: 63, heldMask: 0 });
      native.setMicrophone(true); native.setClick(false);
      native.setJiggleThresholds(1, 1);
      native.start({ runId: `${songId}-physical-input`, bpm: song.chart.bpm, countInBars: 1, startBar: 1, endBar: song.chart.bars.length, loop: false, automatic: false });
      drain();
      while (native.state().phase !== 'ended') {
        assert(['count-in', 'playing'].includes(native.state().phase), 'transport did not fault or stop early');
        assert(frame < maxFrames, 'performance stays within its declared song-duration guard');
        if (releaseFrame !== null) {
          const cutoff = expectedCutoff();
          const backup = native.voiceEffects()[PF.BACKUP_PROFILE];
          if (frame === cutoff - 1) assert.equal(backup.activity, 'live', 'source remains active through the frame before its predicted cutoff');
          if (frame >= cutoff) {
            assert.equal(frame, cutoff, 'fixture observes the exact predicted source cutoff frame');
            assert.equal(backup.rotationRemainingBeats, 0); assert.notEqual(backup.activity, 'live');
            rotationCutoffs.push(frame); releaseFrame = null;
          }
        }
        while (next < plan.length && plan[next].frame === frame) {
          const press = plan[next++];
          try {
            if (press.button >= 8 && press.button <= 14) native.inputEvent({ producer: 0, session: 1, bindingGeneration, sequence: ++physicalEvents, input: press.button - 8, value: press.value });
            else { native.control({ id: 'external', slot: press.button - 16 }); externalTriggers++; }
            if (press.button === 14 && press.value) {
              const backup = native.voiceEffects().find(voice => voice.profile === PF.BACKUP_PROFILE);
              assert(backup?.rotationEligible && backup.rotationRemainingBeats > 0, `rotation did not activate at ${press.source}`);
              const current = clock();
              const windowEndFrame = current.nextBeatFrame + (press.windowEndCount - current.wholeCount - 1) * current.framesPerCount;
              releaseFrame = Math.min(frame + (song.rotation?.inactivityBeats ?? 0) * current.framesPerCount, windowEndFrame);
              const predicted = releaseFrame;
              assert(Math.abs(frame + backup.rotationRemainingBeats * current.framesPerCount - predicted) < 1e-6,
                `native deadline differs from the independent full-inactivity/window-end oracle at ${press.source}`);
              rotations++;
            }
          }
          catch (error) { throw new Error(`Press rejected at frame ${frame}, ${press.source} ${press.text}: ${error instanceof Error ? error.message : String(error)}`); }
          drain();
        }
        let count = Math.min(1024, maxFrames - frame, next < plan.length ? plan[next].frame - frame : Infinity);
        if (releaseFrame !== null) {
          const cutoff = expectedCutoff();
          count = Math.min(count, (frame < cutoff - 1 ? cutoff - 1 : cutoff) - frame);
        }
        assert(count > 0); process(count);
      }
      assert.equal(next, plan.length);
      process(128, true);
      return { frames: frame, physicalEvents, externalTriggers, phase: PF.ENDED, bpm: native.state().bpm, tempoHits, events, rotations, rotationCutoffs, stems,
        takes: song.takes.map((_, index) => { const take = native.compiledTake(index); return { voice: take.voice, ready: Number(take.ready), frames: take.frames, period: take.period, revision: take.revision }; }) };
    } finally { native.dispose(); }
  }
  const reports = [];
  const metrics: readonly ('energy' | 'peak')[] = ['energy', 'peak'];
  for (const rate of [8000, 48000]) {
    const plan = presses(rate), script = join(directory, `${songId}-presses-${rate}.tsv`);
    await writeFile(script, plan.map(press => `${press.frame}\t${press.button}\t${press.value}\t${press.windowEndCount}`).join('\n') + '\n');
    await writeFile(join(directory, `${songId}-source-presses-${rate}.json`), JSON.stringify(plan, null, 2));
    let native: Result | null = null, browser: Result | null = null;
    const errors: string[] = [];
    try { native = decodeResult(JSON.parse(await command(join(build, 'compiled_song_host'), [artifact, script, String(rate), assetsList]))); }
    catch (error) { errors.push(`native: ${error instanceof Error ? error.message : String(error)}`); }
    try { browser = wasm(rate, plan); }
    catch (error) { errors.push(`WASM: ${error instanceof Error ? error.message : String(error)}`); }
    if (native && browser) {
      try {
        assert.deepEqual(native.takes, browser.takes); assert.equal(native.frames, browser.frames); assert.equal(native.events, browser.events);
        assert.equal(native.tempoHits, expectedTempoHits); assert.equal(browser.tempoHits, expectedTempoHits); assert.equal(native.takes.length, song.takes.length);
        const expectedPhysical = plan.filter(press => press.button >= 8 && press.button <= 14).length;
        assert.equal(native.physicalEvents, expectedPhysical); assert.equal(browser.physicalEvents, expectedPhysical);
        assert.equal(native.externalTriggers, assets.length); assert.equal(browser.externalTriggers, assets.length);
        assert.equal(native.rotations, expectedRotations); assert.equal(browser.rotations, expectedRotations);
        assert(native.rotationCutoffs.length >= (song.rotation?.windows.length ?? 0), 'Each rotation window reaches an inactivity or window-end cutoff');
        assert(native.rotationCutoffs.length <= expectedRotations, 'Movement before a prior cutoff can refresh one continuous span');
        assert.deepEqual(native.rotationCutoffs, browser.rotationCutoffs, 'native and WASM observe the same predicted source cutoff frames');
        assert(native.takes.every(take => take.ready && take.frames > 0 && take.period >= take.frames && take.revision === 1));
        for (let index = 0; index < 4; index++) {
          assert(native.stems[index].energy > 0);
          for (const key of metrics) assert(Math.abs(native.stems[index][key] - browser.stems[index][key]) <= 1e-6 * Math.max(1, Math.abs(native.stems[index][key])), `${key} differs for stem ${index}`);
          assert(Math.abs(native.stems[index].sum - browser.stems[index].sum) / native.frames <= 1e-7, `mean differs for stem ${index}`);
        }
      } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    failed ||= errors.length > 0;
    reports.push({ rate, status: errors.length ? 'FAIL' : 'PASS', native, wasm: browser, errors });
  }
  results.push({ songId, originalSourceDigest: document.song.source.digest, testSourceDigest: song.source.digest,
    status: reports.some(report => report.status === 'FAIL') ? 'FAIL' : 'PASS', reports });
}
const report = { artifactDirectory: directory, fixture: { inputBindings: bindings, holdMilliseconds: 50,
  meaning: 'Synthetic acceptance inputs using the default global button layout and a fixed test hold duration.',
  microphone: 'Periodic synthetic PCM', voiceEffects: 'Matching synthetic slapback and chorus profiles in both engines' }, results };
await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (failed) process.exitCode = 1;
