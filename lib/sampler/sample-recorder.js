export class SampleRecorder {
  constructor({ sampleRate, sampler, maxSeconds = 30, maxSlots = 8 }) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid recording sample rate');
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 30) throw new Error('Recording limit must be at most 30 seconds');
    if (!Number.isInteger(maxSlots) || maxSlots < 1) throw new Error('Invalid recording slot limit');
    if (!sampler || typeof sampler.installCaptured !== 'function') throw new Error('A SampleEngine is required');
    this.sampleRate = sampleRate;
    this.sampler = sampler;
    this.maxSeconds = maxSeconds;
    this.maxSlots = maxSlots;
    this.slots = new Map();
    this.nextSlots = new Map();
    this.slotList = [];
    this.processedFrames = 0;
    this.transientQuietFrames = Math.max(1, Math.ceil(sampleRate * 0.015));
    this.transientDecay = Math.exp(-1 / (sampleRate * 0.003));
  }

  createSlot(id, maxSeconds, index, transients, variantKey) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Sample ID is required');
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > this.maxSeconds) {
      throw new Error(`Recording limit must be between 0 and ${this.maxSeconds} seconds`);
    }
    if (variantKey !== undefined && transients?.key !== undefined && variantKey !== transients.key) {
      throw new Error('Capture variant keys must match');
    }
    const capacity = Math.floor(maxSeconds * this.sampleRate);
    if (capacity < 1) throw new Error('Recording limit must allow at least one frame');
    const windows = [];
    if (transients !== undefined) {
      const { expectedFrames, radiusFrames } = transients;
      if (!Array.isArray(expectedFrames) || !expectedFrames.length || expectedFrames.length > 16 ||
          !Number.isFinite(radiusFrames) || radiusFrames <= 0) throw new Error('Invalid transient hints');
      for (let hit = 0; hit < expectedFrames.length; hit++) {
        const frame = expectedFrames[hit];
        if (!Number.isFinite(frame) || frame < 0 || frame >= capacity ||
            (hit > 0 && frame <= expectedFrames[hit - 1])) throw new Error('Transient hints must be ordered recording frames');
        const previous = expectedFrames[hit - 1];
        const next = expectedFrames[hit + 1];
        windows.push({ begin: Math.max(0, Math.ceil(frame - radiusFrames), previous === undefined ? 0 : Math.ceil((previous + frame) / 2)),
          end: Math.min(capacity, Math.ceil(frame + radiusFrames), next === undefined ? capacity : Math.ceil((frame + next) / 2)),
          score: 0, startFrame: -1, endFrame: -1, quietFrames: 0, level: 0, noiseFloor: 0, slice: { startFrame: 0, endFrame: 0, targetFrame: Math.round(frame) } });
      }
    }
    const buffer = new Float32Array(capacity);
    const sample = { id, channels: [buffer], length: 0, sampleRate: this.sampleRate,
      ratio: this.sampleRate / this.sampler.sampleRate, onsetFrame: 0, slices: windows.map(() => null), variantKey: variantKey ?? transients?.key };
    return { id, buffer, sample, index, prepared: true, recording: false,
      frames: 0, startFrame: 0, maxSeconds, peak: 0, onsetFound: false, windows, envelope: 0, reason: 'prepared' };
  }

  prepare(id, { maxSeconds = this.maxSeconds, transients, variantKey } = {}) {
    const previous = this.slots.get(id);
    if (previous?.recording) throw new Error(`Sample is already recording: ${id}`);
    if (!previous && this.slots.size >= this.maxSlots) throw new Error('Recording slot limit reached');
    const slot = this.createSlot(id, maxSeconds, previous ? previous.index : this.slotList.length, transients, variantKey);
    this.sampler.prepareCapture(id, slot.sample.variantKey);
    this.cancelNext(id);
    this.slots.set(id, slot);
    this.slotList[slot.index] = slot;
  }

  prepareNext(id, { maxSeconds = this.maxSeconds, transients, variantKey } = {}) {
    const current = this.slots.get(id);
    if (!current) throw new Error(`Recording slot is not prepared: ${id}`);
    const slot = this.createSlot(id, maxSeconds, current.index, transients, variantKey);
    this.sampler.prepareCapture(id, slot.sample.variantKey);
    this.nextSlots.set(id, slot);
  }

  startNext(id, frame) {
    if (!Number.isFinite(frame)) throw new Error('Invalid recording start frame');
    if (this.isRecording(id)) throw new Error(`Commit recording before starting the next take: ${id}`);
    const slot = this.nextSlots.get(id);
    if (!slot) throw new Error(`Next recording slot is not prepared: ${id}`);
    this.nextSlots.delete(id);
    this.slots.set(id, slot);
    this.slotList[slot.index] = slot;
    this.activate(slot, frame);
  }

  cancelNext(id) { this.nextSlots.delete(id); }

  start(id, frame) {
    if (!Number.isFinite(frame)) throw new Error('Invalid recording start frame');
    const slot = this.slots.get(id);
    if (slot?.recording) throw new Error(`Sample is already recording: ${id}`);
    if (!slot?.prepared) throw new Error(`Recording slot is not prepared: ${id}`);
    this.activate(slot, frame);
  }

  activate(slot, frame) {
    slot.recording = true;
    slot.prepared = false;
    slot.startFrame = Math.max(Math.ceil(frame), this.processedFrames);
    slot.reason = null;
  }

  stop(id, frame, reason = 'stopped') {
    if (!Number.isFinite(frame)) throw new Error('Invalid recording stop frame');
    const slot = this.slots.get(id);
    if (!slot?.recording) return;
    slot.frames = Math.min(slot.frames, Math.max(0, Math.ceil(frame) - slot.startFrame));
    this.commit(slot, reason);
    return slot.frames > 0;
  }

  commit(slot, reason) {
    slot.recording = false;
    slot.reason = reason;
    if (slot.sample.onsetFrame >= slot.frames) slot.sample.onsetFrame = 0;
    for (let hit = 0; hit < slot.windows.length; hit++) {
      const detected = slot.windows[hit];
      if (detected.startFrame < 0 || detected.startFrame >= slot.frames) continue;
      let endFrame = detected.endFrame >= 0 ? Math.min(detected.endFrame, slot.frames) : slot.frames;
      for (let next = hit + 1; next < slot.windows.length; next++) {
        if (slot.windows[next].startFrame >= 0 && slot.windows[next].startFrame < slot.frames) {
          endFrame = Math.min(endFrame, slot.windows[next].startFrame);
          break;
        }
        endFrame = Math.min(endFrame, slot.windows[next].begin);
      }
      const nextTarget = slot.windows[hit + 1]?.slice.targetFrame;
      if (nextTarget !== undefined) endFrame = Math.min(endFrame, detected.startFrame + nextTarget - detected.slice.targetFrame);
      detected.slice.startFrame = detected.startFrame;
      detected.slice.endFrame = endFrame;
      slot.sample.slices[hit] = detected.slice;
    }
    if (slot.frames > 0) this.sampler.installCaptured(slot.sample, slot.frames);
  }

  isRecording(id) { return this.slots.get(id)?.recording === true; }

  capture(input, inputOffset, length, frameStart) {
    const endFrame = frameStart + length;
    for (let slotIndex = 0; slotIndex < this.slotList.length; slotIndex++) {
      const slot = this.slotList[slotIndex];
      if (!slot.recording) continue;
      const begin = Math.max(0, slot.startFrame - frameStart);
      for (let index = begin; index < length && slot.frames < slot.buffer.length; index++) {
        const raw = input?.[inputOffset + index] ?? 0;
        const value = Number.isFinite(raw) ? raw : 0;
        if (!slot.onsetFound && Math.abs(value) > 0.005) {
          slot.sample.onsetFrame = slot.frames;
          slot.onsetFound = true;
        }
        const magnitude = Math.abs(value);
        const attack = magnitude - slot.envelope;
        if (magnitude > 0.01 && magnitude > slot.envelope * 1.8 + 0.005) {
          for (let hit = 0; hit < slot.windows.length; hit++) {
            const window = slot.windows[hit];
            if (slot.frames >= window.begin && slot.frames < window.end && attack > window.score) {
              window.score = attack;
              window.startFrame = slot.frames;
              window.endFrame = -1;
              window.quietFrames = 0;
              window.level = magnitude;
              window.noiseFloor = slot.envelope;
            }
          }
        }
        for (let hit = 0; hit < slot.windows.length; hit++) {
          const window = slot.windows[hit];
          if (window.startFrame < 0 || window.endFrame >= 0) continue;
          window.quietFrames = magnitude < Math.max(0.005, window.level * 0.02, window.noiseFloor * 1.5) ? window.quietFrames + 1 : 0;
          if (window.quietFrames >= this.transientQuietFrames) window.endFrame = slot.frames - window.quietFrames + 1;
        }
        slot.envelope = Math.max(magnitude, slot.envelope * this.transientDecay);
        slot.buffer[slot.frames++] = value;
        slot.peak = Math.max(slot.peak, Math.abs(value));
      }
      if (slot.frames === slot.buffer.length) this.commit(slot, 'limit');
    }
    this.processedFrames = Math.max(this.processedFrames, endFrame);
  }

  stopAll(reason = 'stopped') {
    this.nextSlots.clear();
    for (let index = 0; index < this.slotList.length; index++) {
      const slot = this.slotList[index];
      if (slot.recording) this.commit(slot, reason);
    }
  }

  snapshot() {
    return Array.from(this.slots.values(), slot => ({ id: slot.id, recording: slot.recording,
      frames: slot.frames, duration: slot.frames / this.sampleRate,
      maxSeconds: slot.maxSeconds, peak: slot.peak, reason: slot.reason }));
  }
}
