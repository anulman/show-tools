export class PerformanceProcessor extends AudioWorkletProcessor {
  sampler: import('../../../lib/sampler/wasm-sampler.js').SampleEngine;
  recorder: import('../../../lib/sampler/wasm-sampler.js').SampleRecorder;
  sequencer: import('../../../lib/sequencer/wasm-sequencer.js').AudioSequenceEngine;
  native: import('../../../lib/performance/wasm-performance.js').NativePerformance;
  performancePort: MessagePort | null;
  disposed: boolean;
  processedFrames: number;
  nativeMode(): number;
  initializeOutput(options: object): void;
  performanceState(): object;
  command(message: { id: number; command: string; payload?: unknown }): void;
}
