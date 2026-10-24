export interface TransientHints { expectedFrames: number[]; radiusFrames: number; key?: string }
export interface HitSlice { startFrame: number; endFrame: number; targetFrame: number }
export interface RecordingOptions { maxSeconds?: number; transients?: TransientHints }

export interface RecordingSample {
  id: string;
  channels: Float32Array[];
  length: number;
  sampleRate: number;
  ratio: number;
  onsetFrame: number;
  slices?: (HitSlice | null)[];
  variantKey?: string;
}

export interface RecordingSlot {
  id: string;
  buffer: Float32Array;
  sample: RecordingSample;
  index: number;
  prepared: boolean;
  recording: boolean;
  frames: number;
  startFrame: number;
  maxSeconds: number;
  peak: number;
  onsetFound: boolean;
  windows: { begin: number; end: number; score: number; startFrame: number; endFrame: number; quietFrames: number; level: number; slice: HitSlice }[];
  envelope: number;
  reason: string | null;
}

export interface RecordingSnapshot {
  id: string;
  recording: boolean;
  frames: number;
  duration: number;
  maxSeconds: number;
  peak: number;
  reason: string | null;
}

export class SampleRecorder {
  constructor(options: { sampleRate: number; sampler: import('./sample-engine.js').SampleEngine; maxSeconds?: number; maxSlots?: number });
  slots: Map<string, RecordingSlot>;
  nextSlots: Map<string, RecordingSlot>;
  slotList: RecordingSlot[];
  processedFrames: number;
  prepare(id: string, options?: RecordingOptions): void;
  prepareNext(id: string, options?: RecordingOptions): void;
  start(id: string, frame: number): void;
  startNext(id: string, frame: number): void;
  cancelNext(id: string): void;
  stop(id: string, frame: number, reason?: string): boolean | undefined;
  commit(slot: RecordingSlot, reason: string): void;
  capture(input: Float32Array | null | undefined, inputOffset: number, length: number, frameStart: number): void;
  isRecording(id: string): boolean;
  stopAll(reason?: string): void;
  snapshot(): RecordingSnapshot[];
}
