import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { NativePerformance } from '../../../lib/performance/wasm-performance.js';
import { CONTROL_IDS } from '../../../lib/performance/model.js';
import { encodeCompiledProgram } from '../../../lib/performance/compiled-native.js';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import danceYrselfClean from '../../../songs/dance-yrself-clean.js';
import { initialVoiceEffects, slapback } from '../../../lib/performance/vocal-effects.js';

const module = await WebAssembly.compile(await readFile(new URL('../wasm/manual-clock.wasm', import.meta.url)));
const sources = await Promise.all(['../runtime/beat-worklet.js', '../runtime/performance-worklet.js', '../practice-worklet.ts']
  .map(async path => (await sourceForVM(new URL(path, import.meta.url))).replace(/^import .*;\n/gm, '').replace(/export class /g, 'class ')));

for (const sampleRate of [44100, 48000]) test(`complete DYC worklet prepares its initial venue and five parent captures at ${sampleRate} Hz`, () => {
  const configurations = initialVoiceEffects(danceYrselfClean.compiled).map(configuration => configuration.profile === 0
    ? { ...configuration, effects: [{ kind: 'slapback', delayMs: 140, feedback: .2, wet: .4 }] } satisfies typeof configuration : configuration);
  const messages: { type: string; message?: string }[] = [];
  const processors = new Map<string, new (options: unknown) => { native: NativePerformance; process(inputs: unknown, outputs: unknown): boolean }>();
  const sandbox = { currentFrame: 0, sampleRate, WebAssembly, Float32Array, Float64Array, DataView, NativePerformance, CONTROL_IDS,
    AudioWorkletProcessor: class { port = { postMessage(message: { type: string; message?: string }) { messages.push(message); } }; },
    registerProcessor(name: string, processor: new (options: unknown) => { native: NativePerformance; process(inputs: unknown, outputs: unknown): boolean }) { processors.set(name, processor); } };
  vm.createContext(sandbox);
  vm.runInContext(sources.join('\n'), sandbox);
  const Processor = processors.get('practice');
  assert(Processor);
  const processor = new Processor({ processorOptions: { module, practice: {
    barCount: danceYrselfClean.chart.bars.length, endBar: danceYrselfClean.chart.annotatedThroughBar,
    compiledProgram: Array.from(encodeCompiledProgram(danceYrselfClean.compiled)), initialVoiceEffects: configurations,
  } } });
  assert.equal(messages[0]?.type, 'ready', messages[0]?.message ?? 'Worklet did not become ready');
  try {
    assert.equal(danceYrselfClean.chart.annotatedThroughBar, 218);
    const native = processor.native;
    const initialHeap = native.memory.buffer;
    assert.equal(initialHeap.byteLength, 448 * 1024 * 1024, 'the complete song fits the fixed production heap');
    assert.deepEqual(danceYrselfClean.compiled.takes.map(take => [take.voiceId, take.begin.bar, take.captureEnd?.bar]),
      [['whistle', 44, 47], ['bing-bong', 4, 6], ['drums-claps', 0, 3], ['cowbell', 8, 13], ['cowbell', 79, 85]]);
    assert.equal(native.state().compiledTakes?.length, 5);
    assert(native.state().compiledTakes?.every(take => !take.ready && take.frames === 0), 'prepared parents begin empty');
    assert.deepEqual(native.voiceEffects().map(({ profile, prepared, revision, effects }) => ({ profile, prepared, revision, effects })),
      configurations.map(configuration => ({ ...configuration, prepared: true, revision: 1 })));
    assert.doesNotThrow(() => native.prepareVoiceEffects(configurations), 'the usual Start acknowledgment reuses the prepared banks');
    assert.equal(processor.process([], [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128), new Float32Array(128)]]), true);
    assert.equal(native.memory.buffer, initialHeap, 'preparation acknowledgment and processing do not grow the heap');
  } finally { processor.native.dispose(); }
});

for (const sampleRate of [44100, 48000]) test(`complete All I Want prepares its cue tracks and vocal profiles at ${sampleRate} Hz`, async () => {
  const { default: song } = await import('../../../songs/all-i-want.js');
  assert(song.compiled);
  const configurations = initialVoiceEffects(song.compiled);
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, {
    env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: {
      fd_write(_fd: number, _vectors: number, _count: number, written: number) {
        new DataView(memory.buffer).setUint32(written, 0, true);
        return 0;
      },
      fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); },
    },
  });
  assert(instance.exports.memory instanceof WebAssembly.Memory);
  memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  const native = new NativePerformance({ api: instance.exports, sampleRate, clickGain: 0,
    compiledProgram: Array.from(encodeCompiledProgram(song.compiled)), initialVoiceEffects: configurations,
  });
  try {
    assert.deepEqual(native.state().compiledTakes?.map(take => take.ready), [false, false, false, false]);
    const installedEffects = [[], [], ['slapback', 'chorus'], ['slapback', 'chorus'], ['slapback'], []];
    const effectKinds = () => native.voiceEffects().map(({ effects }) => effects.map(effect => effect.kind));
    assert.deepEqual(effectKinds(), installedEffects);
    const custom = configurations.map(configuration => configuration.profile < 2
      ? { ...configuration, effects: [slapback()] } : configuration);
    native.prepareVoiceEffects(custom);
    assert.deepEqual(effectKinds(), [['slapback'], ['slapback'], ...installedEffects.slice(2)]);
    native.configureCompiled(Array.from(encodeCompiledProgram(danceYrselfClean.compiled)));
    assert.equal(native.state().compiledTakes?.length, 5);
    native.configureCompiled(Array.from(encodeCompiledProgram(song.compiled)));
    native.prepareVoiceEffects(configurations);
    assert.equal(native.state().compiledTakes?.length, 4);
    assert.deepEqual(effectKinds(), installedEffects);
  } finally { native.dispose(); }
});
