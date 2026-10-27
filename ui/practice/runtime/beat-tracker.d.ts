export interface TrackerState { source: { kind: string }; lifecycle: string; error?: string | null }
export class BeatTracker {
  static create(options: { startingBpm?: number; wasmUrl?: URL; workletUrl?: URL; processorName?: string; outputChannels?: number; outputChannelCounts?: number[]; processorOptions?: object }): Promise<BeatTracker>;
  context: AudioContext;
  node: AudioWorkletNode;
  lifecycle: string;
  readonly microphoneStream: MediaStream | null;
  setManual(): Promise<unknown>;
  setManualBpm(bpm: number): Promise<unknown>;
  resume(): Promise<void>;
  startListening(options?: { deviceId?: string }): Promise<void>;
  stopListening(): Promise<void>;
  subscribe(listener: (state: TrackerState) => void): () => void;
  dispose(): Promise<void>;
}
