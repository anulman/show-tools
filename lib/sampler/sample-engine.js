export class SampleEngine {
  constructor({ sampleRate, maxVoices = 32 }) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid sample rate');
    if (!Number.isInteger(maxVoices) || maxVoices < 1) throw new Error('Invalid voice limit');
    this.sampleRate = sampleRate;
    this.samples = new Map();
    this.variants = new Map();
    this.channels = new Map();
    this.voices = Array.from({ length: maxVoices }, () => ({ sample: null, frame: 0, gain: 1, serial: 0, loop: false, sourceOffset: 0, sourceEnd: 0, slice: null }));
    this.volume = 1;
    this.processedFrames = 0;
    this.triggeredVoices = 0;
    this.stolenVoices = 0;
    this.lateTriggers = 0;
    this.maxLateFrames = 0;
  }

  load(id, channels, sourceRate) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Sample ID is required');
    if (!Number.isFinite(sourceRate) || sourceRate <= 0) throw new Error('Invalid source sample rate');
    if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) {
      throw new Error('Samples need one or two PCM channels');
    }
    const length = channels[0]?.length;
    if (!length) throw new Error('PCM channels must not be empty');
    let onsetFrame = length;
    for (const channel of channels) {
      if (!(channel instanceof Float32Array) || channel.length !== length) {
        throw new Error('PCM channels must be equal-length Float32Arrays');
      }
      for (let index = 0; index < length; index++) {
        if (!Number.isFinite(channel[index])) throw new Error('PCM must contain finite values');
        if (index < onsetFrame && Math.abs(channel[index]) > 0.005) onsetFrame = index;
      }
    }
    this.samples.set(id, { id, channels, length, sampleRate: sourceRate, ratio: sourceRate / this.sampleRate,
      onsetFrame: onsetFrame === length ? 0 : onsetFrame });
    const variants = this.variants.get(id);
    if (variants) for (const key of variants.keys()) variants.set(key, null);
  }

  installCaptured(sample, length) {
    if (sample.variantKey !== undefined && !this.variants.get(sample.id)?.has(sample.variantKey)) {
      throw new Error('Capture variant must be prepared before recording');
    }
    sample.length = length;
    this.samples.set(sample.id, sample);
    if (sample.variantKey !== undefined) this.variants.get(sample.id).set(sample.variantKey, sample);
  }

  prepareCapture(id, key) {
    if (key !== undefined) {
      if (typeof key !== 'string' || !key.trim() || key.length > 128) throw new Error('Invalid capture variant key');
      let variants = this.variants.get(id);
      if (!variants) { variants = new Map(); this.variants.set(id, variants); }
      if (!variants.has(key)) {
        if (variants.size >= 16) throw new Error('Capture variant limit reached');
        variants.set(key, null);
      }
    }
    if (!this.samples.has(id)) this.samples.set(id, null);
  }

  has(id) { return Boolean(this.samples.get(id)); }

  hasVariant(id, key) { return Boolean(this.variants.get(id)?.get(key)); }

  sliceSlots(id, variant) { return this.sampleFor(id, variant)?.slices?.length || 0; }

  hasSlice(id, index, variant) { return Number.isInteger(index) && index >= 0 && Boolean(this.sampleFor(id, variant)?.slices?.[index]); }

  sampleFor(id, variant) { return variant === undefined ? this.samples.get(id) : this.variants.get(id)?.get(variant); }

  trigger(id, frame, gain = 1, { loop = false, trimStart = false, slice, variant } = {}) {
    const sample = this.sampleFor(id, variant);
    if (!sample) throw new Error(`Unknown sample: ${id}`);
    if (!Number.isFinite(frame)) throw new Error('Invalid sample start frame');
    if (!Number.isFinite(gain) || gain < 0) throw new Error('Invalid sample gain');
    if (typeof loop !== 'boolean') throw new Error('Invalid loop option');
    if (typeof trimStart !== 'boolean') throw new Error('Invalid trimStart option');
    if (slice !== undefined && !this.hasSlice(id, slice, variant)) throw new Error(`Recorded hit ${slice + 1} is missing: ${id}`);
    if (slice !== undefined && loop) throw new Error('A hit slice cannot loop');
    const selected = slice === undefined ? null : sample.slices[slice];
    if (loop) this.stop(id);
    if (Math.ceil(frame) < this.processedFrames) {
      this.lateTriggers++;
      this.maxLateFrames = Math.max(this.maxLateFrames, this.processedFrames - frame);
      frame = this.processedFrames;
    }
    let voice = null;
    for (const candidate of this.voices) {
      if (!candidate.sample) { voice = candidate; break; }
      if (!voice || candidate.serial < voice.serial) voice = candidate;
    }
    if (voice.sample) this.stolenVoices++;
    voice.sample = sample;
    voice.frame = frame;
    voice.gain = gain;
    voice.loop = loop;
    voice.sourceOffset = selected ? selected.startFrame : trimStart ? sample.onsetFrame : 0;
    voice.sourceEnd = selected ? selected.endFrame : sample.length;
    voice.slice = selected;
    voice.serial = ++this.triggeredVoices;
  }

  setVolume(value) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid volume');
    this.volume = value;
  }

  setChannel(id, { gain = this.channels.get(id)?.gain ?? 1, muted = this.channels.get(id)?.muted ?? false } = {}) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Channel ID is required');
    if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new Error('Channel gain must be between zero and one');
    if (typeof muted !== 'boolean') throw new Error('Channel mute must be boolean');
    this.channels.set(id, { id, gain, muted });
  }

  stop(id) {
    for (const voice of this.voices) if (voice.sample?.id === id) voice.sample = null;
  }

  stopAll() {
    for (const voice of this.voices) voice.sample = null;
  }

  render(outputs, frameStart, outputOffset, length) {
    const left = outputs[0];
    const right = outputs[1];
    for (let voiceIndex = 0; voiceIndex < this.voices.length; voiceIndex++) {
      const voice = this.voices[voiceIndex];
      const sample = voice.sample;
      if (!sample) continue;
      const begin = Math.max(0, Math.ceil(voice.frame - frameStart));
      const sourceLeft = sample.channels[0];
      const sourceRight = sample.channels[1] || sourceLeft;
      const channel = this.channels.get(sample.id);
      const gain = voice.gain * this.volume * (channel?.muted ? 0 : channel?.gain ?? 1);
      for (let index = begin; index < length; index++) {
        const age = (frameStart + index - voice.frame) * sample.ratio + voice.sourceOffset;
        let position = voice.loop ? age % sample.length : age;
        let sourceEnd = voice.sourceEnd;
        if (position >= sourceEnd) { voice.sample = null; break; }
        if (!voice.slice && sample.slices?.length) {
          let selected = null;
          for (let hit = 0; hit < sample.slices.length; hit++) {
            const slice = sample.slices[hit];
            if (slice && position >= slice.targetFrame && position < slice.targetFrame + slice.endFrame - slice.startFrame) {
              selected = slice;
              break;
            }
          }
          if (!selected) continue;
          position += selected.startFrame - selected.targetFrame;
          sourceEnd = selected.endFrame;
        }
        const base = Math.floor(position);
        const fraction = position - base;
        const next = voice.loop && !sample.slices?.length ? (base + 1) % sample.length : base + 1;
        const l = sourceLeft[base] + fraction * ((next < sourceEnd ? sourceLeft[next] : 0) - sourceLeft[base]);
        const r = sourceRight[base] + fraction * ((next < sourceEnd ? sourceRight[next] : 0) - sourceRight[base]);
        if (right) {
          left[outputOffset + index] += l * gain;
          right[outputOffset + index] += r * gain;
        } else if (left) {
          left[outputOffset + index] += (l + r) * 0.5 * gain;
        }
      }
      if (!voice.loop && (frameStart + length - voice.frame) * sample.ratio + voice.sourceOffset >= voice.sourceEnd) voice.sample = null;
    }
    this.processedFrames = Math.max(this.processedFrames, frameStart + length);
  }

  snapshot() {
    const samples = [];
    let memoryBytes = 0;
    for (const sample of this.samples.values()) {
      if (!sample) continue;
      samples.push({ id: sample.id, channels: sample.channels.length, length: sample.length,
        sampleRate: sample.sampleRate, duration: sample.length / sample.sampleRate });
      for (const channel of sample.channels) memoryBytes += channel.byteLength;
    }
    let activeVoices = 0;
    const looping = [];
    for (const voice of this.voices) if (voice.sample) {
      activeVoices++;
      if (voice.loop) looping.push(voice.sample.id);
    }
    return { ready: true, samples, activeVoices, looping, volume: this.volume,
      channels: Array.from(this.channels.values(), channel => ({ ...channel })),
      metadata: { sampleRate: this.sampleRate, maxVoices: this.voices.length,
        processedFrames: this.processedFrames, triggeredVoices: this.triggeredVoices,
        stolenVoices: this.stolenVoices, lateTriggers: this.lateTriggers,
        maxLateFrames: this.maxLateFrames, memoryBytes } };
  }
}
