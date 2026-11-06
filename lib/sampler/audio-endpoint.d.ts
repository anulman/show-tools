export class AudioEndpoint {
  constructor(port: MessagePort);
  port: MessagePort;
  request(command: string, payload?: object): Promise<unknown>;
  subscribe(listener: (state: { practice?: import('../performance/model.js').PracticeState; tuner?: import('../tuner/model.js').TunerState }) => void): () => void;
  dispose(): void;
}
