const SNAPSHOT_SIZE = 22;
const EVENT_SIZE = 12;
const EVENT_CAPACITY = 64;
const TELEMETRY_CAPACITY = 512;
const INPUT_CAPACITY = 8192;

export class BeatProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameOrigin = currentFrame;
    this.hasProcessed = false;
    this.disposed = false;
    this.clickEnabled = false;
    this.clickStartFrame = -Infinity;
    this.processedFrames = 0;
    this.epoch = 1;
    this.barStartSerial = 0;
    this.telemetry = new Float64Array(TELEMETRY_CAPACITY * EVENT_SIZE);
    this.telemetryHead = 0;
    this.telemetryCount = 0;
    this.telemetryDrops = 0;
    this.clicks = [{ frequency: 1400, gain: 0.08 }, { frequency: 2100, gain: 0.12 }].map(({ frequency, gain }) => {
      const click = new Float32Array(Math.ceil(sampleRate * 0.012) + 1);
      for (let index = 0; index < click.length - 1; index++) {
        const seconds = index / sampleRate;
        click[index] = gain * Math.cos(2 * Math.PI * frequency * seconds) *
          Math.exp(-seconds / 0.002) * (1 - index / (click.length - 1));
      }
      return click;
    });
    this.activeClick = this.clicks[0];
    try {
      let memory;
      const instance = new WebAssembly.Instance(options.processorOptions.module, {
        env: {
          abort: () => { throw new Error('WASM aborted'); },
          emscripten_notify_memory_growth: () => {},
        },
        wasi_snapshot_preview1: {
          fd_write: (descriptor, vectors, count, written) => {
            const view = new DataView(memory.buffer);
            let length = 0;
            for (let index = 0; index < count; index++) length += view.getUint32(vectors + index * 8 + 4, true);
            view.setUint32(written, length, true);
            return 0;
          },
          fd_close: () => 0,
          fd_seek: () => 0,
          proc_exit: code => { throw new Error(`WASM exited (${code})`); },
        },
      });
      this.api = instance.exports;
      memory = this.api.memory;
      this.api._initialize?.();
      this.tracker = this.api.bt_create(sampleRate);
      if (!this.tracker) throw new Error('Could not allocate the beat tracker');
      this.inputPointer = this.api.malloc(INPUT_CAPACITY * 4);
      this.snapshotPointer = this.api.malloc(SNAPSHOT_SIZE * 8);
      this.eventPointer = this.api.malloc(EVENT_CAPACITY * EVENT_SIZE * 8);
      if (!this.inputPointer || !this.snapshotPointer || !this.eventPointer) {
        throw new Error('Could not allocate audio buffers');
      }
      this.input = new Float32Array(this.api.memory.buffer, this.inputPointer, INPUT_CAPACITY);
      this.state = new Float64Array(this.api.memory.buffer, this.snapshotPointer, SNAPSHOT_SIZE);
      this.events = new Float64Array(this.api.memory.buffer, this.eventPointer, EVENT_CAPACITY * EVENT_SIZE);
      this.initializeOutput(options.processorOptions);
      this.port.onmessage = event => this.receive(event.data);
      this.reply({ type: 'ready' });
    } catch (error) {
      this.disposed = true;
      this.port.postMessage({ type: 'fault', message: error.message });
    }
  }

  reply(message) {
    this.api.bt_snapshot(this.tracker, this.snapshotPointer);
    if (this.epoch !== this.state[1]) {
      this.epoch = this.state[1];
      this.barStartSerial = this.state[9];
      this.telemetryHead = this.telemetryCount = 0;
      this.clickStartFrame = -Infinity;
      this.onTimelineReset(this.epoch, this.state[9]);
    }
    this.drainEvents();
    const events = new Array(this.telemetryCount * EVENT_SIZE);
    for (let index = 0; index < this.telemetryCount; index++) {
      const source = ((this.telemetryHead + index) % TELEMETRY_CAPACITY) * EVENT_SIZE;
      for (let field = 0; field < EVENT_SIZE; field++) events[index * EVENT_SIZE + field] = this.telemetry[source + field];
    }
    this.telemetryHead = this.telemetryCount = 0;
    this.state[17] += this.telemetryDrops;
    this.port.postMessage({ ...message, snapshot: Array.from(this.state),
      events, clickEnabled: this.clickEnabled,
      contextFrame: this.frameOrigin + this.state[0], memoryBytes: this.api.memory.buffer.byteLength });
  }

  initializeOutput(options) {}

  onBeat(id, frame, epoch) {}

  onTimelineReset(epoch, beatId) {}

  disposeOutput() {}

  processAudio(input, output, offset, begin, end, frameStart) {
    this.renderClick(output, offset, begin, end, frameStart);
  }

  renderClick(output, offset, begin, end, frameStart) {
    if (!this.clickEnabled) return;
    const click = this.activeClick;
    for (let index = begin; index < end; index++) {
      const age = frameStart + index - this.clickStartFrame;
      if (age < 0 || age >= click.length - 1) continue;
      const sample = Math.floor(age);
      const fraction = age - sample;
      const value = click[sample] + fraction * (click[sample + 1] - click[sample]);
      for (let channel = 0; channel < output.length; channel++) output[channel][offset + index] += value;
    }
  }

  drainEvents(output = null, offset = 0, length = 0, frameStart = 0, input = null) {
    let cursor = 0;
    let count;
    do {
      count = this.api.bt_drain_events(this.tracker, this.eventPointer, EVENT_CAPACITY);
      for (let index = 0; index < count; index++) {
        const source = index * EVENT_SIZE;
        if (this.events[source] === 1 && this.events[source + 4] === this.epoch) {
          if (output) {
            const end = Math.max(cursor, Math.min(length, Math.ceil(this.events[source + 2] - frameStart)));
            this.processAudio(input, output, offset, cursor, end, frameStart);
            cursor = end;
          }
          if (this.clickEnabled) {
            this.clickStartFrame = this.events[source + 2];
            this.activeClick = this.clicks[(this.events[source + 1] - this.barStartSerial - 1) % 4 === 0 ? 1 : 0];
          }
          this.onBeat(this.events[source + 1], this.events[source + 2], this.events[source + 4]);
        }
        if (this.telemetryCount === TELEMETRY_CAPACITY) {
          this.telemetryHead = (this.telemetryHead + 1) % TELEMETRY_CAPACITY;
          this.telemetryCount--;
          this.telemetryDrops++;
        }
        const destination = ((this.telemetryHead + this.telemetryCount++) % TELEMETRY_CAPACITY) * EVENT_SIZE;
        for (let field = 0; field < EVENT_SIZE; field++) this.telemetry[destination + field] = this.events[source + field];
      }
    } while (count === EVENT_CAPACITY);
    if (output) this.processAudio(input, output, offset, cursor, length, frameStart);
  }

  receive(message) {
    if (this.disposed) return;
    if (message.type === 'poll') {
      this.reply({ type: 'state', id: message.id });
    } else if (message.type === 'click') {
      this.clickEnabled = message.enabled === true;
      if (!this.clickEnabled) this.clickStartFrame = -Infinity;
      this.reply({ type: 'ack', id: message.id });
    } else if (message.type === 'command') {
      this.api.bt_snapshot(this.tracker, this.snapshotPointer);
      const requested = message.contextFrame - this.frameOrigin;
      const frame = message.command === 3 ? Math.min(this.state[0], requested) :
        Math.max(0, Math.min(this.state[0], requested));
      const result = this.api.bt_command(this.tracker, message.command, message.value,
        frame, message.sequence, message.epoch);
      this.reply({ type: 'ack', id: message.id, result });
    } else if (message.type === 'dispose') {
      this.disposeOutput();
      this.api.bt_destroy(this.tracker);
      this.api.free(this.inputPointer);
      this.api.free(this.snapshotPointer);
      this.api.free(this.eventPointer);
      this.disposed = true;
      this.port.postMessage({ type: 'disposed', id: message.id });
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    for (let channel = 0; channel < output.length; channel++) output[channel].fill(0);
    if (this.disposed) return false;
    if (!this.hasProcessed) {
      this.frameOrigin = currentFrame;
      this.hasProcessed = true;
      this.reply({ type: 'started' });
    }
    const frames = output[0]?.length || inputs[0]?.[0]?.length || 0;
    const input = inputs[0]?.[0];
    for (let offset = 0; offset < frames; offset += INPUT_CAPACITY) {
      const length = Math.min(INPUT_CAPACITY, frames - offset);
      if (input) {
        for (let index = 0; index < length; index++) this.input[index] = input[offset + index];
      }
      this.api.bt_process(this.tracker, input ? this.inputPointer : 0, length);
      this.drainEvents(output, offset, length, this.processedFrames, input);
      this.processedFrames += length;
    }
    return true;
  }
}

registerProcessor('beat-tracker', BeatProcessor);
