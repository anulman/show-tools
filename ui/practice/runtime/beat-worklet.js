import { NativePerformance } from '../../../lib/performance/wasm-performance.js';

export class BeatProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameOrigin = currentFrame;
    this.hasProcessed = false;
    this.disposed = false;
    try {
      let memory;
      const instance = new WebAssembly.Instance(options.processorOptions.module, {
        env: { abort: () => { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
        wasi_snapshot_preview1: {
          fd_write: (_descriptor, vectors, count, written) => {
            const view = new DataView(memory.buffer);
            let length = 0;
            for (let index = 0; index < count; index++) length += view.getUint32(vectors + index * 8 + 4, true);
            view.setUint32(written, length, true);
            return 0;
          },
          fd_close: () => 0, fd_seek: () => 0,
          proc_exit: code => { throw new Error(`WASM exited (${code})`); },
        },
      });
      this.api = instance.exports;
      memory = this.api.memory;
      this.api._initialize?.();
      const config = options.processorOptions;
      this.native = new NativePerformance({ api: this.api, sampleRate, mode: this.nativeMode(),
        maxVoices: config.maxVoices ?? 32, maxSeconds: config.maxSeconds ?? 30,
        clickGain: config.clickGain ?? 1, beatsPerBar: config.beatsPerBar ?? 4, ...config.practice });
      this.tracker = this.native.trackerHandle;
      this.initializeOutput(config);
      this.port.onmessage = event => this.receive(event.data);
      this.reply({ type: 'ready' });
    } catch (error) {
      this.native?.dispose();
      this.disposed = true;
      this.port.postMessage({ type: 'fault', message: error.message });
    }
  }

  nativeMode() { return 0; }
  initializeOutput() {}
  publishNativeEvents() { this.native.events(); }
  disposeOutput() {}
  get processedFrames() { return this.native?.processedFrames ?? 0; }
  get epoch() { return this.native.trackerSnapshot()[1]; }
  get clickEnabled() { return this.native.clickEnabled; }

  reply(message) {
    this.native.flush();
    this.publishNativeEvents();
    const snapshot = this.native.trackerSnapshot();
    this.port.postMessage({ ...message, snapshot, events: this.native.trackerEvents(), clickEnabled: this.native.clickEnabled,
      contextFrame: this.frameOrigin + snapshot[0], memoryBytes: this.api.memory.buffer.byteLength });
  }

  receive(message) {
    if (message.type === 'dispose') {
      if (!this.disposed) { this.disposeOutput(); this.native.dispose(); this.disposed = true; }
      this.port.postMessage({ type: 'disposed', id: message.id });
      return;
    }
    if (this.disposed) return;
    try {
      if (message.type === 'poll') this.reply({ type: 'state', id: message.id });
      else if (message.type === 'click') { this.native.setClick(message.enabled); this.reply({ type: 'ack', id: message.id }); }
      else if (message.type === 'command') {
        const current = this.native.trackerSnapshot()[0];
        const requested = message.contextFrame - this.frameOrigin;
        const frame = message.command === 3 ? Math.min(current, requested) : Math.max(0, Math.min(current, requested));
        const result = this.native.clockCommand(message.command, message.value, frame, message.sequence, message.epoch);
        this.reply({ type: 'ack', id: message.id, result });
      }
    } catch (error) { this.port.postMessage({ type: 'fault', message: error.message, id: message.id }); }
  }

  process(inputs, outputs) {
    if (this.disposed) return false;
    const output = outputs[0];
    if (!this.hasProcessed) {
      this.frameOrigin = currentFrame; this.hasProcessed = true; this.reply({ type: 'started' });
    }
    try {
      this.native.process(inputs[0]?.[0], output, output[0]?.length || 0);
      this.publishNativeEvents();
      return true;
    } catch (error) {
      for (const channel of output) channel.fill(0);
      this.port.postMessage({ type: 'fault', message: error.message });
      return true;
    }
  }
}

registerProcessor('beat-tracker', BeatProcessor);
