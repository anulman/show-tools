const COMMAND = { seed: 1, bpm: 2, tap: 3, follow: 4, manual: 5, reset: 6, fresh: 7 };
const STATUS = ['listening', 'following', 'coasting'];
const RESULTS = ['OK', 'Invalid value', 'Duplicate command', 'Old timeline', 'Command queue full',
  'Clock already started', 'Out-of-order command'];

export class BeatTracker {
  static async create({ audioContext, startingBpm = null,
    wasmUrl = new URL('../../../lib/beat-tracker/dist/beat-tracker.wasm', import.meta.url),
    workletUrl = new URL('./beat-worklet.js', import.meta.url),
    processorName = 'beat-tracker', processorOptions = {}, outputChannels = 1 } = {}) {
    const ownsContext = !audioContext;
    const context = audioContext || new AudioContext({ latencyHint: 'interactive' });
    const resume = context.resume();
    resume.catch(() => {});
    const tracker = new BeatTracker(context, ownsContext);
    try {
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error(`WASM unavailable (${response.status}). Run scripts/build-wasm.sh.`);
      const module = await WebAssembly.compile(await response.arrayBuffer());
      await context.audioWorklet.addModule(workletUrl);
      tracker.node = new AudioWorkletNode(context, processorName, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [outputChannels],
        channelCount: 1, channelCountMode: 'explicit', processorOptions: { ...processorOptions, module },
      });
      await tracker.awaitReady();
      await resume;
      const started = tracker.awaitStarted();
      tracker.node.connect(context.destination);
      await started;
      tracker.lifecycle = context.state === 'running' ? 'running' : 'suspended';
      context.addEventListener('statechange', tracker.onContextState);
      tracker.pollTimer = setInterval(() => tracker.poll(), 33);
      if (startingBpm !== null) await tracker.command('seed', startingBpm);
      tracker.publish();
      return tracker;
    } catch (error) {
      await tracker.dispose();
      throw error;
    }
  }

  constructor(context, ownsContext) {
    this.context = context;
    this.ownsContext = ownsContext;
    this.lifecycle = 'initializing';
    this.source = { kind: 'off' };
    this.captureGeneration = 0;
    this.sequence = 0;
    this.requestId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.latest = null;
    this.pollPending = false;
    this.clickEnabled = false;
    this.onContextState = () => {
      if (this.lifecycle === 'disposed' || this.lifecycle === 'faulted') return;
      this.lifecycle = this.context.state === 'running' ? 'running' : 'suspended';
      if (this.lifecycle === 'running') this.command('fresh').catch(error => this.fault(error.message));
      this.publish();
    };
  }

  awaitReady() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio processor did not become ready')), 10000);
      this.node.onprocessorerror = () => {
        const error = new Error('Audio processor stopped. Reload the demo to restart.');
        clearTimeout(timeout);
        reject(error);
        this.fault(error.message);
      };
      this.node.port.onmessage = ({ data }) => {
        if (data.type === 'fault') {
          clearTimeout(timeout);
          reject(new Error(data.message));
          this.fault(data.message);
          return;
        }
        if (data.snapshot) this.accept(data);
        if (data.type === 'ready') { clearTimeout(timeout); resolve(); }
        if (data.type === 'started' && this.startWait) {
          clearTimeout(this.startWait.timeout);
          this.startWait.resolve();
          this.startWait = null;
        }
        if (data.type === 'state') this.pollPending = false;
        const pending = this.pending.get(data.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(data.id);
          if (data.result) pending.reject(new Error(RESULTS[data.result] || 'Command failed'));
          else pending.resolve(this.snapshot());
        }
      };
    });
  }

  awaitStarted() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio processing did not start. Allow audio and try again.')), 10000);
      this.startWait = { resolve, reject, timeout };
    });
  }

  accept(message) {
    const s = message.snapshot;
    if (this.latest && (s[1] < this.latest.epoch ||
      (s[1] === this.latest.epoch && s[2] < this.latest.revision))) return;
    this.clickEnabled = message.clickEnabled === true;
    const events = [];
    for (let offset = 0; offset < message.events.length; offset += 12) {
      const e = message.events.slice(offset, offset + 12);
      if (e[4] === s[1]) events.push({ type: ['unknown', 'clock', 'detection', 'accepted', 'ack'][e[0]],
        id: e[1], frame: e[2], availableFrame: e[3], epoch: e[4], revision: e[5], bpm: e[6],
        confidence: e[7], phaseError: e[8], result: e[9], command: e[10], sequence: e[11] });
    }
    this.latest = { frame: s[0], epoch: s[1], revision: s[2], mode: s[3] ? 'manual' : 'follow',
      status: STATUS[s[4]], started: Boolean(s[5]), bpm: s[6], phase: s[7], nextBeatFrame: s[8],
      beatId: s[9], rawBpm: s[10], confidence: s[11], targetBpm: s[12], phaseError: s[13],
      rms: s[14], peak: s[15], observationAge: s[16], droppedEvents: s[17], detectedFrame: s[18],
      acceptedCount: s[19], sampleRate: s[20], rejection: s[21], contextFrame: message.contextFrame,
      memoryBytes: message.memoryBytes };
    this.publish(events);
  }

  snapshot() {
    return { ...this.latest, lifecycle: this.lifecycle, clickEnabled: this.clickEnabled,
      source: { ...this.source, node: undefined, stream: undefined }, error: this.error || null };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot(), []);
    return () => this.listeners.delete(listener);
  }

  publish(events = []) {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state, events);
  }

  poll() {
    if (this.pollPending || this.lifecycle !== 'running') return;
    this.pollPending = true;
    this.node.port.postMessage({ type: 'poll', id: ++this.requestId });
  }

  command(name, value = 0, timestamp = performance.now()) {
    const contextFrame = this.context.currentTime * this.context.sampleRate +
      (timestamp - performance.now()) * this.context.sampleRate / 1000;
    return this.request({ type: 'command', command: COMMAND[name], value,
      contextFrame, sequence: ++this.sequence, epoch: this.latest?.epoch || 0 });
  }

  request(message) {
    if (!this.node || this.lifecycle === 'disposed' || this.lifecycle === 'faulted') {
      return Promise.reject(new Error('Beat tracker is not available'));
    }
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Audio command timed out. Resume audio and try again.'));
      }, 5000);
      this.pending.set(id, { resolve, reject, timeout });
      this.node.port.postMessage({ ...message, id });
    });
  }

  async resume() {
    if (this.lifecycle === 'disposed' || this.lifecycle === 'faulted') throw new Error('Reload to restart audio');
    await this.context.resume();
  }

  setManualBpm(bpm) { return this.command('bpm', Number(bpm)); }
  setClickEnabled(enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('Click enabled must be a boolean'));
    return this.request({ type: 'click', enabled });
  }
  tap(timestamp = performance.now()) {
    if (timestamp > 1e12) timestamp -= performance.timeOrigin;
    return this.command('tap', 0, timestamp);
  }
  setMode(mode) {
    if (mode !== 'follow' && mode !== 'manual') return Promise.reject(new Error('Unknown control mode'));
    return this.command(mode);
  }
  follow() { return this.setMode('follow'); }
  setManual() { return this.setMode('manual'); }

  async reset({ startingBpm = null } = {}) {
    await this.command('reset');
    if (startingBpm !== null) await this.command('seed', startingBpm);
    return this.snapshot();
  }

  async startListening({ deviceId } = {}) {
    const resumed = this.resume();
    resumed.catch(() => {});
    if (this.source.kind === 'microphone') return resumed;
    if (this.source.kind === 'requesting') return this.capturePromise;
    this.releaseSource();
    const generation = this.captureGeneration;
    const cancelled = new Promise(resolve => { this.cancelCapture = () => resolve(null); });
    this.source = { kind: 'requesting' };
    this.publish();
    this.capturePromise = (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires localhost or HTTPS');
        const requested = navigator.mediaDevices.getUserMedia({ audio: {
          channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        } }).then(stream => {
          if (generation !== this.captureGeneration || this.lifecycle === 'disposed' || this.lifecycle === 'faulted') {
            stream.getTracks().forEach(track => track.stop());
            return null;
          }
          this.source.stream = stream;
          return stream;
        });
        const ready = await Promise.race([Promise.all([requested, resumed]), cancelled]);
        if (!ready || generation !== this.captureGeneration) return;
        const [stream] = ready;
        await this.command('fresh');
        if (generation !== this.captureGeneration) return;
        const node = this.context.createMediaStreamSource(stream);
        const track = stream.getAudioTracks()[0];
        this.source = { kind: 'microphone', node, stream, muted: track.muted, settings: track.getSettings() };
        track.onended = () => { if (generation === this.captureGeneration) this.stopListening(); };
        track.onmute = () => { if (this.source.stream === stream) { this.source.muted = true; this.publish(); } };
        track.onunmute = () => { if (this.source.stream === stream) { this.source.muted = false; this.publish(); } };
        node.connect(this.node);
        this.cancelCapture = null;
        this.publish();
      } catch (error) {
        if (generation === this.captureGeneration) { this.releaseSource(); this.publish(); throw error; }
      }
    })();
    return this.capturePromise;
  }

  releaseSource() {
    ++this.captureGeneration;
    this.cancelCapture?.();
    this.cancelCapture = null;
    this.source.node?.disconnect();
    if (this.source.kind === 'test' || this.source.kind === 'fixture') this.source.node?.stop();
    this.source.stream?.getTracks().forEach(track => track.stop());
    this.source = { kind: 'off' };
  }

  async stopListening() {
    this.releaseSource();
    this.publish();
    if (this.lifecycle !== 'disposed' && this.lifecycle !== 'faulted') await this.command('fresh');
  }

  get microphoneStream() {
    return this.source.kind === 'microphone' ? this.source.stream : null;
  }

  async startFixture(samples, sampleRate = this.context.sampleRate, { loop = false, kind = 'fixture', bpm } = {}) {
    const resumed = this.resume();
    this.releaseSource();
    const generation = this.captureGeneration;
    await resumed;
    await this.command('fresh');
    if (generation !== this.captureGeneration) return;
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.loop = loop;
    this.source = { kind, node, bpm };
    node.onended = () => { if (this.source.node === node) this.stopListening(); };
    node.connect(this.node);
    node.start();
    this.publish();
  }

  startTestRhythm(bpm = 120) {
    bpm = Number(bpm);
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) return Promise.reject(new Error('Use a test tempo from 40 to 240 BPM'));
    const rate = this.context.sampleRate;
    const duration = 16 * 60 / bpm;
    const samples = new Float32Array(Math.round(duration * rate));
    let random = 1979;
    for (let beat = 0; beat < 16; beat++) {
      const start = Math.round(beat * 60 / bpm * rate);
      for (let index = 0; index < rate * 0.035 && start + index < samples.length; index++) {
        random = (Math.imul(random, 1664525) + 1013904223) | 0;
        samples[start + index] = (random / 2147483648) * Math.exp(-index / (rate * 0.007)) * 0.7;
      }
    }
    return this.startFixture(samples, rate, { loop: true, kind: 'test', bpm });
  }

  fault(message) {
    this.error = message;
    this.lifecycle = 'faulted';
    clearInterval(this.pollTimer);
    this.releaseSource();
    this.pollPending = false;
    if (this.startWait) {
      clearTimeout(this.startWait.timeout);
      this.startWait.reject(new Error(message));
      this.startWait = null;
    }
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error(message)); }
    this.pending.clear();
    this.publish();
  }

  async dispose() {
    if (this.lifecycle === 'disposed') return;
    this.lifecycle = 'disposed';
    clearInterval(this.pollTimer);
    this.releaseSource();
    this.context.removeEventListener('statechange', this.onContextState);
    if (this.startWait) {
      clearTimeout(this.startWait.timeout);
      this.startWait.reject(new Error('Beat tracker disposed'));
      this.startWait = null;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Beat tracker disposed'));
    }
    this.pending.clear();
    this.node?.port.postMessage({ type: 'dispose' });
    this.node?.disconnect();
    if (this.ownsContext && this.context.state !== 'closed') await this.context.close();
    this.publish();
    this.listeners.clear();
  }
}
