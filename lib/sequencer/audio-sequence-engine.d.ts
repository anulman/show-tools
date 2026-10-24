export class AudioSequenceEngine {
  lastBeatId: number;
  recordArms: Map<string, { action: 'start' | 'stop' }>;
  snapshot(): LegacySequencerSnapshot;
  cancelRecording(id: string): void;
  armRecording(id: string, options: { action: 'start' | 'stop'; quantize: 'bar' | 'beat'; maxSeconds?: number; loop?: boolean }): void;
  silence(id: string): void;
  markOne(): void;
  stop(): void;
}
