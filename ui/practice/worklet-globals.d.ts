declare const sampleRate: number;
declare const currentFrame: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}

declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

interface LegacySequencerSnapshot {
  recordArms: { sampleId: string; action: 'start' | 'stop' }[];
}
