export class AudioEndpoint {
  constructor(port: MessagePort);
  port: MessagePort;
  request(command: string, payload?: object): Promise<unknown>;
  subscribe(listener: (state: { takeAudioToken?: string; practice?: import('../performance/model.js').PracticeState; tuner?: import('../tuner/model.js').TunerState; tuningBank?: import('../tuner/model.js').TuningBankState }) => void): () => void;
  dispose(): void;
}
