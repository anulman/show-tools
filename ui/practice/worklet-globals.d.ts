declare const sampleRate: number;
declare const currentFrame: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}

declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

interface LegacySample {
  id: string;
  channels: Float32Array[];
  length: number;
  sampleRate: number;
  ratio: number;
}

interface LegacyRecordingSlot {
  id: string;
  buffer: Float32Array;
  sample: LegacySample;
  index: number;
  prepared: boolean;
  frames: number;
  startFrame: number;
  maxSeconds: number;
  peak: number;
  recording: boolean;
  reason: string | null;
}

interface LegacySequencerSnapshot {
  recordArms: { sampleId: string; action: 'start' | 'stop' }[];
}
