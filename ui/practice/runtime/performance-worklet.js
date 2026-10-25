import { BeatProcessor } from './beat-worklet.js';
import { SampleEngine, SampleRecorder } from '../../../lib/sampler/wasm-sampler.js';
import { AudioSequenceEngine } from '../../../lib/sequencer/audio-sequence-engine.js';

export class PerformanceProcessor extends BeatProcessor {
  initializeOutput(options) {
    this.performancePort = null;
    this.sampler = new SampleEngine({ api: this.api, sampleRate, maxVoices: options.maxVoices ?? 32, maxSeconds: options.maxSeconds ?? 30 });
    this.recorder = new SampleRecorder({ sampleRate, sampler: this.sampler, maxSeconds: options.maxSeconds ?? 30 });
    this.sequencer = new AudioSequenceEngine({ beatsPerBar: options.beatsPerBar ?? 4,
      play: (id, frame, gain, options) => this.sampler.trigger(id, frame, gain, options),
      stopSample: id => this.sampler.stop(id),
      hasSample: id => this.sampler.has(id),
      prepareRecording: (id, options) => this.recorder.prepare(id, options),
      startRecording: (id, frame) => this.recorder.start(id, frame),
      stopRecording: (id, frame) => this.recorder.stop(id, frame),
      isRecording: id => this.recorder.isRecording(id) });
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

  onBeat(id, frame, epoch) { this.sequencer.onBeat(id, frame, epoch); }

  processAudio(input, output, offset, begin, end, frameStart) {
    this.recorder.capture(input, offset + begin, end - begin, frameStart + begin);
    super.processAudio(input, output, offset, begin, end, frameStart);
    this.sampler.render(output, frameStart + begin, offset + begin, end - begin);
  }

  onTimelineReset(epoch, beatId) {
    this.sequencer.reset(beatId);
    this.recorder.stopAll('reset');
    this.sampler.stopAll();
  }

  disposeOutput() {
    this.sequencer.stop();
    this.recorder.stopAll('disposed');
    this.sampler.stopAll();
    this.sampler.dispose();
    this.performancePort?.close();
    this.performancePort = null;
  }
}

registerProcessor('performance', PerformanceProcessor);
