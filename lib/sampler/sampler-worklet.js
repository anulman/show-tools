import { SampleEngine } from './sample-engine.js';
import { SampleRecorder } from './sample-recorder.js';

export class SamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new SampleEngine({ sampleRate });
    this.recorder = new SampleRecorder({ sampleRate, sampler: this.engine });
    this.processedFrames = currentFrame;
    this.engine.processedFrames = currentFrame;
    this.disposed = false;
    this.port.onmessage = ({ data }) => this.receive(data);
    this.port.postMessage({ state: this.snapshot() });
  }

  snapshot() {
    return { sampler: { ...this.engine.snapshot(), recordings: this.recorder.snapshot(), ready: !this.disposed } };
  }

  receive({ id, command, payload = {} }) {
    try {
      if (this.disposed) throw new Error('Sampler processor disposed');
      switch (command) {
        case 'state': break;
        case 'sample.load': this.engine.load(payload.sampleId, payload.channels, payload.sampleRate); break;
        case 'sample.trigger':
          if (!Number.isFinite(payload.when)) throw new Error('Invalid sample start time');
          if (this.recorder.isRecording(payload.sampleId)) throw new Error(`Sample is recording: ${payload.sampleId}`);
          this.engine.processedFrames = Math.max(this.engine.processedFrames, currentFrame);
          this.engine.trigger(payload.sampleId, payload.when * sampleRate, payload.gain);
          break;
        case 'sample.stop': this.engine.stop(payload.sampleId); break;
        case 'sample.volume': this.engine.setVolume(payload.volume); break;
        case 'record.start':
          this.recorder.prepare(payload.sampleId, { maxSeconds: payload.maxSeconds });
          this.engine.stop(payload.sampleId);
          this.recorder.start(payload.sampleId, Math.max(this.processedFrames, currentFrame));
          break;
        case 'record.stop':
          this.recorder.stop(payload.sampleId, Math.max(this.processedFrames, currentFrame));
          break;
        case 'sample.stopAll': this.recorder.stopAll(); this.engine.stopAll(); break;
        case 'dispose': this.recorder.stopAll('disposed'); this.engine.stopAll(); this.disposed = true; break;
        default: throw new Error(`Unknown audio command: ${command}`);
      }
      this.port.postMessage({ id, ok: true, state: this.snapshot() });
    } catch (error) {
      this.port.postMessage({ id, ok: false, error: error.message, state: this.snapshot() });
    }
  }

  process(inputs, outputs) {
    const channels = outputs[0];
    if (channels) {
      for (const channel of channels) channel.fill(0);
      const length = channels[0]?.length || 0;
      if (!this.disposed) {
        this.recorder.capture(inputs[0]?.[0], 0, length, currentFrame);
        this.engine.render(channels, currentFrame, 0, length);
      }
      this.processedFrames = currentFrame + length;
    }
    return !this.disposed;
  }
}

registerProcessor('sampler', SamplerProcessor);
