import { BeatProcessor } from './beat-worklet.js';

export class PerformanceProcessor extends BeatProcessor {
  nativeMode() { return 1; }

  initializeOutput() {
    this.performancePort = null;
    this.sampler = this.native.sampler;
    this.recorder = this.native.recorder;
    this.sequencer = this.native.sequencer;
  }

  receive(message) {
    if (message.type === 'performance-connect') {
      if (this.disposed || !message.port) return;
      this.performancePort?.close();
      this.performancePort = message.port;
      this.performancePort.onmessage = event => this.command(event.data);
      this.performancePort.start();
      this.performancePort.postMessage({ state: this.performanceState() });
      return;
    }
    super.receive(message);
  }

  performanceState() {
    return { sampler: { ...this.sampler.snapshot(), ready: !this.disposed, recordings: this.recorder.snapshot() }, sequencer: this.sequencer.snapshot() };
  }

  command({ id, command, payload = {} }) {
    let value;
    try {
      if (this.disposed) throw new Error('Performance processor disposed');
      switch (command) {
        case 'sample.load':
          value = this.sampler.load(payload.sampleId, payload.channels, payload.sampleRate);
          break;
        case 'sample.trigger': {
          if (this.recorder.isRecording(payload.sampleId)) throw new Error('Stop recording before playback');
          const when = payload.when === undefined ? (this.frameOrigin + this.processedFrames) / sampleRate : payload.when;
          if (!Number.isFinite(when) || when < 0) throw new TypeError('when must be finite nonnegative context seconds');
          value = this.sampler.trigger(payload.sampleId, when * sampleRate - this.frameOrigin, payload.gain ?? 1);
          break;
        }
        case 'sample.stop': value = this.sequencer.silence(payload.sampleId); break;
        case 'record.start':
          if (this.native.liveEffects().stageCount > 0) throw new Error('Use the compiled song pad to capture processed voice; direct sampler recording does not capture the effects stem.');
          this.recorder.prepare(payload.sampleId, { maxSeconds: payload.maxSeconds ?? 30 });
          this.sequencer.cancelRecording(payload.sampleId);
          this.sampler.stop(payload.sampleId);
          value = this.recorder.start(payload.sampleId, this.processedFrames);
          break;
        case 'record.stop':
          this.sequencer.cancelRecording(payload.sampleId);
          value = this.recorder.stop(payload.sampleId, this.processedFrames);
          break;
        case 'sequence.record':
          if (payload.action === 'start' && this.native.liveEffects().stageCount > 0) throw new Error('Use the compiled song pad to capture processed voice; direct sampler recording does not capture the effects stem.');
          value = this.sequencer.armRecording(payload.sampleId, payload);
          break;
        case 'sequence.recordCancel': value = this.sequencer.cancelRecording(payload.sampleId); break;
        case 'sequence.cue': value = this.sequencer.cue(payload.sampleId, payload); break;
        case 'sequence.sampleStop': value = this.sequencer.cueStop(payload.sampleId, payload); break;
        case 'sequence.cueCancel': value = this.sequencer.cancelCue(payload.sampleId); break;
        case 'sample.volume': value = this.sampler.setVolume(payload.volume); break;
        case 'sample.stopAll':
          this.sequencer.stop();
          this.recorder.stopAll('stopped');
          value = this.sampler.stopAll();
          break;
        case 'sequence.define': value = this.sequencer.define(payload.pattern); break;
        case 'sequence.queue': value = this.sequencer.queue(payload.patternId, payload.quantize); break;
        case 'sequence.cancel': value = this.sequencer.cancelQueue(); break;
        case 'sequence.markOne': value = this.sequencer.markOne(); break;
        case 'performance.stopAll':
          if (this.nativeMode() === 2) { this.native.stop(); break; }
          this.sequencer.stop();
          this.recorder.stopAll('stopped');
          this.sampler.stopAll();
          break;
        case 'state': break;
        default: throw new Error(`Unknown performance command ${command}`);
      }
      this.performancePort.postMessage({ id, ok: true, value, state: this.performanceState() });
    } catch (error) {
      this.performancePort.postMessage({ id, ok: false, error: error.message, state: this.performanceState() });
    }
  }

  disposeOutput() {
    this.performancePort?.close();
    this.performancePort = null;
  }
}

registerProcessor('performance', PerformanceProcessor);
