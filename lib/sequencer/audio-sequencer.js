export class AudioSequencer {
  constructor({ endpoint }) {
    if (!endpoint || typeof endpoint.request !== 'function' || typeof endpoint.subscribe !== 'function') {
      throw new TypeError('An audio endpoint is required');
    }
    this.endpoint = endpoint;
    this.disposed = false;
    this.detachers = new Set();
  }

  request(command, payload = {}) {
    if (this.disposed) return Promise.reject(new Error('Audio sequencer disposed'));
    return this.endpoint.request(command, payload);
  }

  define(pattern) { return this.request('sequence.define', { pattern }); }
  queue(id, { quantize = 'bar' } = {}) { return this.request('sequence.queue', { patternId: id, quantize }); }
  cancelQueue() { return this.request('sequence.cancel'); }
  markOne() { return this.request('sequence.markOne'); }
  armRecording(sampleId, { action, quantize = 'bar', maxSeconds = 30, loop = true } = {}) {
    return this.request('sequence.record', { sampleId, action, quantize, maxSeconds, loop });
  }
  cancelRecording(sampleId) { return this.request('sequence.recordCancel', { sampleId }); }
  cue(sampleId, { quantize = 'bar', gain = 1 } = {}) { return this.request('sequence.cue', { sampleId, quantize, gain }); }
  stopSample(sampleId, { quantize = 'bar' } = {}) { return this.request('sequence.sampleStop', { sampleId, quantize }); }
  cancelCue(sampleId) { return this.request('sequence.cueCancel', { sampleId }); }
  stopAll() { return this.request('performance.stopAll'); }
  snapshot() { return this.endpoint.snapshot()?.sequencer || null; }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('A listener is required');
    if (this.disposed) return () => {};
    const detach = this.endpoint.subscribe(state => listener(state.sequencer || null));
    const remove = () => { detach(); this.detachers.delete(remove); };
    this.detachers.add(remove);
    return remove;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const detach of this.detachers) detach();
  }
}
