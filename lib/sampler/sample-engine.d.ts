export class SampleEngine {
  constructor(options: { sampleRate: number; maxVoices?: number });
  channels: Map<string, { id: string; gain: number; muted: boolean }>;
  voices: { sample: import('./sample-recorder.js').RecordingSample | null; loop: boolean; sourceOffset: number; sourceEnd: number; slice: import('./sample-recorder.js').HitSlice | null }[];
  trigger(id: string, frame: number, gain?: number, options?: { loop?: boolean; trimStart?: boolean; slice?: number; variant?: string }): void;
  stopAll(): void;
  has(id: string): boolean;
  hasVariant(id: string, key: string): boolean;
  hasSlice(id: string, index: number, variant?: string): boolean;
  sliceSlots(id: string, variant?: string): number;
  setChannel(id: string, settings?: import('../performance/model.js').ChannelSettings): void;
  snapshot(): object;
}
