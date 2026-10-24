export class Sampler {
  constructor({ audioContext, endpoint }) {
    if (!audioContext || !endpoint) throw new Error('Sampler needs an AudioContext and AudioEndpoint');
    this.context = audioContext;
    this.endpoint = endpoint;
    this.disposed = false;
    this.pending = new Set();
    this.listeners = new Set();
    this.latest = { ready: false, samples: [], recordings: [], activeVoices: 0, looping: [], volume: 1, metadata: {} };
    this.detach = endpoint.subscribe(state => {
      if (!state.sampler || this.disposed) return;
      this.latest = state.sampler;
      for (const listener of this.listeners) {
        try { listener(this.latest); } catch (error) { globalThis.reportError?.(error); }
      }
    });
  }

  perform(action) {
    if (this.disposed) return Promise.reject(new Error('Sampler disposed'));
    return new Promise((resolve, reject) => {
      this.pending.add(reject);
      let result;
      try { result = action(); }
      catch (error) {
        this.pending.delete(reject);
        reject(error);
        return;
      }
      Promise.resolve(result).then(() => {
        this.pending.delete(reject);
        resolve(this.snapshot());
      }, error => {
        this.pending.delete(reject);
        reject(error);
      });
    });
  }

  sendPCM(id, channels, sampleRate) {
    if (this.disposed) throw new Error('Sampler disposed');
    if (!Array.isArray(channels) || channels.some(channel => !(channel instanceof Float32Array))) {
      throw new Error('PCM channels must be Float32Arrays');
    }
    const copies = channels.map(channel => new Float32Array(channel));
    return this.endpoint.request('sample.load', { sampleId: id, channels: copies, sampleRate },
      copies.map(channel => channel.buffer));
  }

  sendAudioBuffer(id, buffer) {
    const channels = [];
    for (let index = 0; index < buffer.numberOfChannels; index++) channels.push(buffer.getChannelData(index));
    return this.sendPCM(id, channels, buffer.sampleRate);
  }

  load(id, audioBuffer) { return this.perform(() => this.sendAudioBuffer(id, audioBuffer)); }
  loadPCM(id, channels, sampleRate) { return this.perform(() => this.sendPCM(id, channels, sampleRate)); }

  loadURL(id, url) {
    return this.perform(async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Sample unavailable (${response.status})`);
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      return this.sendAudioBuffer(id, buffer);
    });
  }

  loadFile(id, file) {
    return this.perform(async () => {
      const buffer = await this.context.decodeAudioData(await file.arrayBuffer());
      return this.sendAudioBuffer(id, buffer);
    });
  }

  trigger(id, { gain = 1, when = this.context.currentTime } = {}) {
    return this.perform(() => this.endpoint.request('sample.trigger', { sampleId: id, gain, when }));
  }

  startRecording(id, { maxSeconds = 30 } = {}) {
    return this.perform(() => this.endpoint.request('record.start', { sampleId: id, maxSeconds }));
  }

  stopRecording(id) {
    return this.perform(() => this.endpoint.request('record.stop', { sampleId: id }));
  }

  stop(id) { return this.perform(() => this.endpoint.request('sample.stop', { sampleId: id })); }

  setVolume(volume) { return this.perform(() => this.endpoint.request('sample.volume', { volume })); }
  stopAll() { return this.perform(() => this.endpoint.request('sample.stopAll')); }
  snapshot() { return this.latest; }

  subscribe(listener) {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    for (const reject of this.pending) reject(new Error('Sampler disposed'));
    this.pending.clear();
    this.latest = { ...this.latest, ready: false };
    this.listeners.clear();
  }
}
