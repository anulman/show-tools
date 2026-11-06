import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { NativePerformance } from '../../../lib/performance/wasm-performance.js';
import { CONTROL_IDS } from '../../../lib/performance/model.js';
import { encodeCompiledProgram } from '../../../lib/performance/compiled-native.js';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import song from '../../../songs/dance-yrself-clean.js';
import { initialVoiceEffects } from '../voice-effects.js';

const module = await WebAssembly.compile(await readFile(new URL('../wasm/manual-clock.wasm', import.meta.url)));
const sources = await Promise.all(['../runtime/beat-worklet.js', '../runtime/performance-worklet.js', '../practice-worklet.ts']
  .map(async path => (await sourceForVM(new URL(path, import.meta.url))).replace(/^import .*;\n/gm, '').replace(/export class /g, 'class ')));

for (const sampleRate of [44100, 48000]) test(`complete DYC worklet prepares its initial venue and five parent captures at ${sampleRate} Hz`, () => {
  const configurations = initialVoiceEffects().map(configuration => configuration.profile === 0
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
    barCount: song.chart.bars.length, endBar: song.chart.annotatedThroughBar,
    compiledProgram: Array.from(encodeCompiledProgram(song.compiled)), initialVoiceEffects: configurations,
  } } });
  assert.equal(messages[0]?.type, 'ready', messages[0]?.message ?? 'Worklet did not become ready');
  try {
    assert.equal(song.chart.annotatedThroughBar, 218);
    const native = processor.native;
    const initialHeap = native.memory.buffer;
    assert.equal(initialHeap.byteLength, 256 * 1024 * 1024, 'the complete song fits the fixed production heap');
    assert.deepEqual(song.compiled.takes.map(take => [take.voiceId, take.begin.bar, take.captureEnd?.bar]),
      [['whistle', 45, 47], ['bing-bong', 5, 7], ['drums-claps', 1, 3], ['cowbell', 8, 13], ['cowbell', 79, 85]]);
    assert.equal(native.state().compiledTakes?.length, 5);
    assert(native.state().compiledTakes?.every(take => !take.ready && take.frames === 0), 'prepared parents begin empty');
    assert.deepEqual(native.voiceEffects().map(({ profile, prepared, revision, effects }) => ({ profile, prepared, revision, effects })),
      configurations.map(configuration => ({ ...configuration, prepared: true, revision: 1 })));
    assert.doesNotThrow(() => native.prepareVoiceEffects(configurations), 'the usual Start acknowledgment reuses the prepared banks');
    assert.equal(processor.process([], [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128), new Float32Array(128)]]), true);
    assert.equal(native.memory.buffer, initialHeap, 'preparation acknowledgment and processing do not grow the heap');
  } finally { processor.native.dispose(); }
});
