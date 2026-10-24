function identifier(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonempty string`);
  return value;
}

export class AudioSequenceEngine {
  constructor({ beatsPerBar = 4, play, stopSample, hasSample, prepareRecording, startRecording, stopRecording, isRecording = () => false }) {
    if (!Number.isSafeInteger(beatsPerBar) || beatsPerBar < 1) throw new TypeError('beatsPerBar must be a positive integer');
    if (typeof play !== 'function' || typeof hasSample !== 'function') throw new TypeError('play and hasSample functions are required');
    this.beatsPerBar = beatsPerBar;
    this.play = play;
    this.stopSample = stopSample;
    this.hasSample = hasSample;
    this.prepareRecording = prepareRecording;
    this.startRecording = startRecording;
    this.stopRecording = stopRecording;
    this.isRecording = isRecording;
    this.recordArms = new Map();
    this.cues = new Map();
    this.skippedEvents = 0;
    this.patterns = new Map();
    this.epoch = null;
    this.launches = 0;
    this.playedEvents = 0;
    this.reset();
  }

  define(input) {
    if (!input || typeof input !== 'object') throw new TypeError('Pattern must be an object');
    const id = identifier(input.id, 'Pattern id');
    const label = input.label === undefined ? id : identifier(input.label, 'Pattern label');
    const lengthBeats = input.lengthBeats;
    if (!Number.isSafeInteger(lengthBeats) || lengthBeats < 1) throw new TypeError('lengthBeats must be a positive integer');
    if (!Array.isArray(input.events)) throw new TypeError('Pattern events must be an array');
    const events = new Map();
    for (const event of input.events) {
      if (!event || !Number.isSafeInteger(event.atBeat) || event.atBeat < 0 || event.atBeat >= lengthBeats) {
        throw new TypeError('Event atBeat must be a whole beat within the pattern');
      }
      const sampleId = identifier(event.sampleId, 'Sample id');
      if (!this.hasSample(sampleId)) throw new Error(`Unknown sample ${sampleId}`);
      const gain = event.gain === undefined ? 1 : event.gain;
      if (!Number.isFinite(gain) || gain < 0) throw new TypeError('Event gain must be finite and nonnegative');
      if (!events.has(event.atBeat)) events.set(event.atBeat, []);
      events.get(event.atBeat).push({ sampleId, gain });
    }
    this.patterns.set(id, { id, label, lengthBeats, events });
    return this.snapshot();
  }

  nextBar() {
    const next = this.lastBeatId + 1;
    if (this.markNextOne || this.barOrigin === null) return next;
    return this.barOrigin + Math.ceil((next - this.barOrigin) / this.beatsPerBar) * this.beatsPerBar;
  }

  queue(id, quantize = 'bar') {
    const pattern = this.patterns.get(id);
    if (!pattern) throw new Error(`Unknown pattern ${id}`);
    this.pending = { pattern, quantize, targetBeatId: this.target(quantize) };
    return this.snapshot();
  }

  target(quantize) {
    if (quantize !== 'beat' && quantize !== 'bar') throw new TypeError('Quantize must be beat or bar');
    return quantize === 'bar' ? this.nextBar() : this.lastBeatId + 1;
  }

  armRecording(sampleId, { action, quantize = 'bar', maxSeconds = 30, loop = true } = {}) {
    identifier(sampleId, 'Sample id');
    if (!this.prepareRecording || !this.startRecording || !this.stopRecording) throw new Error('Recording is unavailable');
    if (action !== 'start' && action !== 'stop') throw new TypeError('Recording action must be start or stop');
    if (typeof loop !== 'boolean') throw new TypeError('Loop must be boolean');
    const targetBeatId = this.target(quantize);
    if (action === 'start') {
      if (this.isRecording(sampleId)) throw new Error(`Sample ${sampleId} is already recording`);
      this.prepareRecording(sampleId, { maxSeconds });
    }
    this.recordArms.set(sampleId, { sampleId, action, quantize, targetBeatId, loop });
    return this.snapshot();
  }

  cancelRecording(sampleId) { this.recordArms.delete(sampleId); return this.snapshot(); }

  cue(sampleId, { quantize = 'bar', gain = 1 } = {}) {
    identifier(sampleId, 'Sample id');
    if (!this.hasSample(sampleId)) throw new Error(`Unknown sample ${sampleId}`);
    if (!Number.isFinite(gain) || gain < 0) throw new TypeError('Cue gain must be finite and nonnegative');
    const targetBeatId = this.target(quantize);
    const stop = this.recordArms.get(sampleId);
    if (this.isRecording(sampleId) && !(stop?.action === 'stop' && stop.targetBeatId <= targetBeatId)) {
      throw new Error(`Stop recording sample ${sampleId} before cueing playback`);
    }
    this.cues.set(sampleId, { sampleId, action: 'play', quantize, targetBeatId, gain });
    return this.snapshot();
  }

  cueStop(sampleId, { quantize = 'bar' } = {}) {
    identifier(sampleId, 'Sample id');
    if (!this.stopSample) throw new Error('Sample stopping is unavailable');
    this.cues.set(sampleId, { sampleId, action: 'stop', quantize, targetBeatId: this.target(quantize) });
    return this.snapshot();
  }

  silence(sampleId) {
    identifier(sampleId, 'Sample id');
    this.cues.delete(sampleId);
    const arm = this.recordArms.get(sampleId);
    if (arm?.action === 'stop') arm.loop = false;
    this.stopSample(sampleId);
    return this.snapshot();
  }

  cancelCue(sampleId) { this.cues.delete(sampleId); return this.snapshot(); }

  cancelQueue() { this.pending = null; return this.snapshot(); }

  markOne() {
    this.markNextOne = true;
    this.reanchorBars(this.lastBeatId + 1);
    return this.snapshot();
  }

  reanchorBars(beatId) {
    if (this.pending?.quantize === 'bar') this.pending.targetBeatId = beatId;
    for (const arm of this.recordArms.values()) if (arm.quantize === 'bar') arm.targetBeatId = beatId;
    for (const cue of this.cues.values()) if (cue.quantize === 'bar') cue.targetBeatId = beatId;
  }

  stop() {
    this.pending = null;
    this.active = null;
    this.recordArms.clear();
    this.cues.clear();
    return this.snapshot();
  }

  reset(beatId = 0) {
    this.pending = null;
    this.active = null;
    this.recordArms.clear();
    this.cues.clear();
    this.lastBeatId = beatId;
    this.lastFrame = null;
    this.barOrigin = null;
    this.markNextOne = false;
    this.epoch = null;
  }

  onBeat(id, frame, epoch) {
    if (this.epoch !== null && epoch !== this.epoch) this.reset(id - 1);
    this.epoch = epoch;
    if (id <= this.lastBeatId) return;
    this.lastBeatId = id;
    this.lastFrame = frame;
    if (this.barOrigin === null || this.markNextOne) {
      this.barOrigin = id;
      this.markNextOne = false;
      this.reanchorBars(id);
    }
    for (const [sampleId, arm] of this.recordArms) {
      if (id < arm.targetBeatId) continue;
      this.recordArms.delete(sampleId);
      if (arm.action === 'start') {
        this.stopSample?.(sampleId);
        this.startRecording(sampleId, frame);
      } else {
        const committed = this.stopRecording(sampleId, frame);
        if (committed && arm.loop) this.play(sampleId, Math.ceil(frame), 1, { loop: true });
      }
    }
    for (const [sampleId, cue] of this.cues) {
      if (id < cue.targetBeatId) continue;
      this.cues.delete(sampleId);
      if (cue.action === 'stop') this.silence(sampleId);
      else if (this.isRecording(sampleId)) this.skippedEvents++;
      else { this.play(sampleId, frame, cue.gain); this.playedEvents++; }
    }
    if (this.pending && id >= this.pending.targetBeatId) {
      this.active = { pattern: this.pending.pattern, startBeatId: id, positionBeat: 0 };
      this.pending = null;
      this.launches++;
    }
    if (!this.active) return;
    const position = id - this.active.startBeatId;
    if (position >= this.active.pattern.lengthBeats) { this.active = null; return; }
    this.active.positionBeat = position;
    const events = this.active.pattern.events.get(position);
    if (events) for (const event of events) {
      if (this.isRecording(event.sampleId)) this.skippedEvents++;
      else { this.play(event.sampleId, frame, event.gain); this.playedEvents++; }
    }
  }

  snapshot() {
    const describe = pattern => ({ id: pattern.id, label: pattern.label, lengthBeats: pattern.lengthBeats });
    const distance = this.barOrigin === null ? 0 : this.lastBeatId - this.barOrigin;
    return {
      status: this.pending || this.cues.size || this.recordArms.size ? 'queued' : this.active ? 'playing' : 'ready',
      playing: this.active ? { ...describe(this.active.pattern), positionBeat: this.active.positionBeat } : null,
      queued: this.pending ? { id: this.pending.pattern.id, label: this.pending.pattern.label,
        quantize: this.pending.quantize, targetBeatId: this.pending.targetBeatId } : null,
      bar: this.barOrigin === null ? 1 : Math.floor(distance / this.beatsPerBar) + 1,
      beat: this.barOrigin === null ? 1 : distance % this.beatsPerBar + 1,
      beatsPerBar: this.beatsPerBar,
      recordArms: Array.from(this.recordArms.values(), arm => ({ ...arm })),
      cues: Array.from(this.cues.values(), cue => ({ sampleId: cue.sampleId, action: cue.action, quantize: cue.quantize, targetBeatId: cue.targetBeatId })),
      patterns: Array.from(this.patterns.values(), describe),
      metadata: { epoch: this.epoch, beatId: this.lastBeatId, frame: this.lastFrame,
        barOrigin: this.barOrigin, markNextOne: this.markNextOne,
        launches: this.launches, playedEvents: this.playedEvents, skippedEvents: this.skippedEvents },
    };
  }
}
