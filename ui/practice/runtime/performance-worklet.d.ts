export class PerformanceProcessor extends AudioWorkletProcessor {
  sampler: import('../../../lib/sampler/sample-engine.js').SampleEngine;
  recorder: import('../../../lib/sampler/sample-recorder.js').SampleRecorder;
  sequencer: import('../../../lib/sequencer/audio-sequence-engine.js').AudioSequenceEngine;
  performancePort: MessagePort | null;
  disposed: boolean;
  clickEnabled: boolean;
  clickStartFrame: number;
  processedFrames: number;
  activeClick: Float32Array;
  clicks: Float32Array[];
  initializeOutput(options: object): void;
  performanceState(): object;
  command(message: { id: number; command: string; payload?: unknown }): void;
  onBeat(id: number, frame: number, epoch: number): void;
  onTimelineReset(epoch: number, beatId: number): void;
}
