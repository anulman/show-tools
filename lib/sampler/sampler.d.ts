export class Sampler {
  constructor(options: { audioContext: AudioContext; endpoint: import('./audio-endpoint.js').AudioEndpoint });
  loadPCM(id: string, channels: Float32Array[], sampleRate: number): Promise<unknown>;
  loadFile(id: string, file: File): Promise<unknown>;
  dispose(): Promise<void>;
}
