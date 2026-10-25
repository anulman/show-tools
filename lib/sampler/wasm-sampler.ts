export interface TransientHints { expectedFrames: number[]; radiusFrames: number; key?: string }
export interface HitSlice { startFrame: number; endFrame: number; targetFrame: number }
export interface RecordingOptions { maxSeconds?: number; variantKey?: string; transients?: TransientHints }
type Settings = { gain?: number; muted?: boolean };
const BLOCK = 8192;

export class SampleEngine {
  readonly api: WebAssembly.Exports;
  readonly memory: WebAssembly.Memory;
  readonly sampleRate: number;
  readonly maxVoices: number;
  readonly handle: number;
  readonly ownsHandle: boolean;
  readonly ids: string[] = [];
  readonly variantKeys = new Map<string, string[]>();
  readonly scratch: number;
  readonly inputPointer: number;
  readonly leftPointer: number;
  readonly rightPointer: number;
  readonly input: Float32Array;
  readonly left: Float32Array;
  readonly right: Float32Array;
  disposed = false;

  constructor({ api, sampleRate, maxVoices = 32, maxSlots = 8, maxSeconds = 30, handle }: {
    api: WebAssembly.Exports; sampleRate: number; maxVoices?: number; maxSlots?: number; maxSeconds?: number; handle?: number;
  }) {
    if (!Number.isFinite(sampleRate) || sampleRate < ST.MIN_SAMPLE_RATE || sampleRate > ST.MAX_SAMPLE_RATE) throw new Error('Invalid sample rate');
    if (!Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > ST.MAX_VOICES) throw new Error('Invalid voice limit');
    if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > ST.CHANNELS) throw new Error('Invalid recording slot limit');
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 30) throw new Error('Invalid recording limit');
    if (!(api.memory instanceof WebAssembly.Memory)) throw new Error('Sampler WASM memory is unavailable');
    this.api = api;
    this.memory = api.memory;
    this.sampleRate = sampleRate;
    this.maxVoices = maxVoices;
    this.ownsHandle = handle === undefined;
    this.handle = handle ?? this.call('st_create', sampleRate, maxVoices, maxSlots, maxSeconds);
    if (!this.handle) throw new Error('Could not create C++ sampler');
    const allocated: number[] = [];
    try {
      const allocate = (bytes: number) => { const pointer = this.allocate(bytes); allocated.push(pointer); return pointer; };
      this.scratch = allocate(32 * 8);
      this.inputPointer = allocate(BLOCK * 4);
      this.leftPointer = allocate(BLOCK * 4);
      this.rightPointer = allocate(BLOCK * 4);
      this.input = new Float32Array(this.memory.buffer, this.inputPointer, BLOCK);
      this.left = new Float32Array(this.memory.buffer, this.leftPointer, BLOCK);
      this.right = new Float32Array(this.memory.buffer, this.rightPointer, BLOCK);
    } catch (error) {
      for (const pointer of allocated) this.invoke('free', pointer);
      if (this.ownsHandle) this.invoke('st_destroy', this.handle);
      throw error;
    }
  }

  invoke(name: string, ...args: number[]): unknown {
    if (this.disposed) throw new Error('Sampler is disposed');
    const fn = this.api[name];
    if (typeof fn !== 'function') throw new Error(`Sampler WASM export is missing: ${name}`);
    return fn(...args);
  }

  call(name: string, ...args: number[]): number {
    const result = this.invoke(name, ...args);
    if (typeof result !== 'number') throw new Error(`Invalid sampler WASM result: ${name}`);
    if (result < 0) throw new Error(this.error());
    return result;
  }

  error(): string {
    const pointer = this.invoke('st_error', this.handle);
    if (typeof pointer !== 'number' || !pointer) return 'C++ sampler command failed';
    const bytes = new Uint8Array(this.memory.buffer, pointer);
    let text = '';
    for (let index = 0; index < bytes.length && bytes[index]; index++) text += String.fromCharCode(bytes[index]);
    return text;
  }

  allocate(bytes: number) {
    const pointer = this.call('malloc', bytes);
    if (!pointer) throw new Error('Sampler WASM memory limit reached');
    return pointer;
  }

  index(id: string, create = true): number {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Sample ID is required');
    const index = this.ids.indexOf(id);
    if (index >= 0 || !create) return index;
    if (this.ids.length === ST.CHANNELS) throw new Error('Sampler channel limit reached');
    return this.ids.length;
  }

  remember(id: string, index: number) { if (index === this.ids.length) this.ids.push(id); }

  variant(id: string, key?: string, create = false): number {
    if (key === undefined) return -1;
    if (typeof key !== 'string' || !key.trim() || key.length > 128) throw new Error('Invalid capture variant key');
    const keys = this.variantKeys.get(id) || [];
    const index = keys.indexOf(key);
    if (index >= 0 || !create) return index >= 0 ? index : -2;
    if (keys.length === ST.VARIANTS) throw new Error('Capture variant limit reached');
    const channel = this.index(id);
    this.call('st_reserve_variant', this.handle, channel, keys.length);
    keys.push(key);
    this.remember(id, channel);
    this.variantKeys.set(id, keys);
    return keys.length - 1;
  }

  query(name: string, ...args: number[]): Float64Array {
    this.invoke(name, this.handle, ...args, this.scratch);
    return new Float64Array(this.memory.buffer, this.scratch, 32);
  }

  load(id: string, channels: Float32Array[], sourceRate: number) {
    const index = this.index(id);
    if (!Number.isFinite(sourceRate) || sourceRate <= 0) throw new Error('Invalid source sample rate');
    if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) throw new Error('Samples need one or two PCM channels');
    const length = channels[0]?.length;
    if (!length) throw new Error('PCM channels must not be empty');
    if (!channels.every(channel => channel instanceof Float32Array && channel.length === length)) throw new Error('PCM channels must be equal-length Float32Arrays');
    const staging = this.allocate(length * channels.length * 4);
    try {
      channels.forEach((channel, index) => new Float32Array(this.memory.buffer, staging + index * length * 4, length).set(channel));
      this.call('st_load', this.handle, index, staging, channels.length === 2 ? staging + length * 4 : 0, length, sourceRate);
      this.remember(id, index);
    } finally { this.invoke('free', staging); }
  }

  prepareCapture(id: string, key?: string) { const index = this.index(id); this.variant(id, key, true); this.remember(id, index); }
  has(id: string) { const index = this.index(id, false); return index >= 0 && this.call('st_has', this.handle, index, -1) === 1; }
  isLooping(id: string) { const index = this.index(id, false); return index >= 0 && this.call('st_is_looping', this.handle, index) === 1; }
  hasVariant(id: string, key: string) { const index = this.index(id, false), variant = this.variant(id, key); return index >= 0 && variant >= 0 && this.call('st_has', this.handle, index, variant) === 1; }
  sliceSlots(id: string, key?: string) { const index = this.index(id, false), variant = this.variant(id, key); return index < 0 || variant === -2 ? 0 : this.call('st_slice_count', this.handle, index, variant); }
  hasSlice(id: string, slice: number, key?: string) { const index = this.index(id, false), variant = this.variant(id, key); return index >= 0 && variant !== -2 && Number.isInteger(slice) && slice >= 0 && slice < ST.HITS && this.call('st_has_slice', this.handle, index, slice, variant) === 1; }

  sampleFor(id: string, key?: string) {
    const index = this.index(id, false), variant = this.variant(id, key);
    if (index < 0 || variant === -2) return null;
    const info = Array.from(this.query('st_sample_info', index, variant));
    if (!info[ST.SAMPLE_PRESENT]) return null;
    const slices = Array.from({ length: info[ST.SAMPLE_SLICES] }, (_, hit): HitSlice | null => {
      const slice = this.query('st_sample_slice', index, variant, hit);
      return slice[ST.SLICE_PRESENT] ? { startFrame: slice[ST.SLICE_START], endFrame: slice[ST.SLICE_END], targetFrame: slice[ST.SLICE_TARGET] } : null;
    });
    return { id, channels: Array.from({ length: info[ST.SAMPLE_CHANNELS] }, (_, channel) => new Float32Array(this.memory.buffer, info[ST.SAMPLE_LEFT + channel], info[ST.SAMPLE_CAPACITY])),
      length: info[ST.SAMPLE_LENGTH], sampleRate: info[ST.SAMPLE_RATE], ratio: info[ST.SAMPLE_RATE] / this.sampleRate, onsetFrame: info[ST.SAMPLE_ONSET], slices,
      variantKey: info[ST.SAMPLE_VARIANT] < 0 ? undefined : this.variantKeys.get(id)?.[info[ST.SAMPLE_VARIANT]] };
  }

  get samples() { return new Map(this.ids.map(id => [id, this.sampleFor(id)])); }
  get variants() { return new Map(Array.from(this.variantKeys, ([id, keys]) => [id, new Map(keys.map(key => [key, this.sampleFor(id, key)]))])); }
  get channels() {
    const result = new Map<string, { id: string; gain: number; muted: boolean }>();
    this.ids.forEach((id, index) => { const info = this.query('st_channel_info', index); if (info[ST.CHANNEL_CONFIGURED]) result.set(id, { id, gain: info[ST.CHANNEL_GAIN], muted: info[ST.CHANNEL_MUTED] === 1 }); });
    return result;
  }
  get voices() {
    return Array.from({ length: this.maxVoices }, (_, index) => {
      const info = this.query('st_voice_info', index);
      return { sample: info[ST.VOICE_CHANNEL] < 0 ? null : { id: this.ids[info[ST.VOICE_CHANNEL]] }, loop: info[ST.VOICE_LOOP] === 1,
        frame: info[ST.VOICE_FRAME], gain: info[ST.VOICE_GAIN], serial: info[ST.VOICE_SERIAL], sourceOffset: info[ST.VOICE_SOURCE_OFFSET], sourceEnd: info[ST.VOICE_SOURCE_END] };
    });
  }
  get processedFrames() { return this.query('st_stats')[ST.STATS_RENDER_FRAME]; }
  get triggeredVoices() { return this.query('st_stats')[ST.STATS_TRIGGERED]; }
  get stolenVoices() { return this.query('st_stats')[ST.STATS_STOLEN]; }
  get lateTriggers() { return this.query('st_stats')[ST.STATS_LATE]; }
  get maxLateFrames() { return this.query('st_stats')[ST.STATS_MAX_LATE]; }
  get volume() { return this.query('st_stats')[ST.STATS_VOLUME]; }

  trigger(id: string, frame: number, gain = 1, { loop = false, trimStart = false, slice, variant }: { loop?: boolean; trimStart?: boolean; slice?: number; variant?: string } = {}) {
    if (!Number.isFinite(frame)) throw new Error('Invalid sample start frame');
    if (!Number.isFinite(gain) || gain < 0) throw new Error('Invalid sample gain');
    if (typeof loop !== 'boolean') throw new Error('Invalid loop option');
    if (typeof trimStart !== 'boolean') throw new Error('Invalid trimStart option');
    if (variant === undefined ? !this.has(id) : !this.hasVariant(id, variant)) throw new Error(`Unknown sample: ${id}`);
    if (slice !== undefined && !this.hasSlice(id, slice, variant)) throw new Error(`Recorded hit ${slice + 1} is missing: ${id}`);
    this.call('st_trigger', this.handle, this.index(id), frame, gain, (loop ? ST.LOOP : 0) | (trimStart ? ST.TRIM_START : 0), slice ?? -1, this.variant(id, variant));
  }
  setVolume(volume: number) {
    if (!Number.isFinite(volume) || volume < 0) throw new Error('Invalid volume');
    this.call('st_set_volume', this.handle, volume);
  }
  setChannel(id: string, settings: Settings = {}) {
    const previous = this.channels.get(id);
    const gain = settings.gain === undefined ? previous?.gain ?? 1 : settings.gain;
    const muted = settings.muted === undefined ? previous?.muted ?? false : settings.muted;
    if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new Error('Channel gain must be between zero and one');
    if (typeof muted !== 'boolean') throw new Error('Channel mute must be boolean');
    const index = this.index(id);
    this.call('st_set_channel', this.handle, index, gain, Number(muted));
    this.remember(id, index);
  }
  stop(id: string) { const index = this.index(id, false); if (index >= 0) this.invoke('st_stop_voices', this.handle, index); }
  stopAll() { this.invoke('st_stop_all_voices', this.handle); }

  render(outputs: Float32Array[], frameStart: number, outputOffset: number, length: number) {
    for (let offset = 0; offset < length; offset += BLOCK) {
      const count = Math.min(BLOCK, length - offset);
      this.left.fill(0, 0, count); this.right.fill(0, 0, count);
      this.invoke('st_render', this.handle, this.leftPointer, outputs[1] ? this.rightPointer : 0, count, frameStart + offset);
      for (let frame = 0; frame < count; frame++) {
        if (outputs[0]) outputs[0][outputOffset + offset + frame] += this.left[frame];
        if (outputs[1]) outputs[1][outputOffset + offset + frame] += this.right[frame];
      }
    }
  }

  snapshot() {
    const stats = Array.from(this.query('st_stats'));
    const samples = this.ids.flatMap(id => { const sample = this.sampleFor(id); return sample ? [{ id, channels: sample.channels.length, length: sample.length, sampleRate: sample.sampleRate, duration: sample.length / sample.sampleRate }] : []; });
    const voices = this.voices.filter(voice => voice.sample);
    return { ready: true, samples, activeVoices: voices.length, looping: voices.filter(voice => voice.loop).map(voice => voice.sample?.id), volume: stats[ST.STATS_VOLUME],
      channels: Array.from(this.channels.values()), metadata: { backend: 'cpp-wasm', sampleRate: stats[ST.STATS_RATE], maxVoices: stats[ST.STATS_VOICES], processedFrames: stats[ST.STATS_RENDER_FRAME], triggeredVoices: stats[ST.STATS_TRIGGERED], stolenVoices: stats[ST.STATS_STOLEN], lateTriggers: stats[ST.STATS_LATE], maxLateFrames: stats[ST.STATS_MAX_LATE], memoryBytes: stats[ST.STATS_MEMORY_BYTES] } };
  }

  dispose() {
    if (this.disposed) return;
    if (this.ownsHandle) this.invoke('st_destroy', this.handle);
    for (const pointer of [this.scratch, this.inputPointer, this.leftPointer, this.rightPointer]) this.invoke('free', pointer);
    this.disposed = true;
  }
}

export class SampleRecorder {
  readonly sampler: SampleEngine;
  readonly sampleRate: number;
  readonly maxSeconds: number;
  readonly maxSlots: number;
  readonly reasons: (string | null)[] = [null, 'prepared', 'limit', 'stopped', 'reset', 'microphone-off', 'disposed'];

  constructor({ sampleRate, sampler, maxSeconds = 30, maxSlots = 8 }: { sampleRate: number; sampler: SampleEngine; maxSeconds?: number; maxSlots?: number }) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate !== sampler.sampleRate) throw new Error('Invalid recording sample rate');
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 30) throw new Error('Recording limit must be at most 30 seconds');
    if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > ST.CHANNELS) throw new Error('Invalid recording slot limit');
    this.sampler = sampler; this.sampleRate = sampleRate; this.maxSeconds = maxSeconds; this.maxSlots = maxSlots;
  }
  reason(value: string) { let index = this.reasons.indexOf(value); if (index < 0) { index = this.reasons.length; this.reasons.push(value); } return index; }
  slot(id: string, next = false) {
    const index = this.sampler.index(id, false);
    if (index < 0) return undefined;
    const info = Array.from(this.sampler.query('st_slot_info', index, Number(next)));
    if (!info[ST.SLOT_PRESENT]) return undefined;
    const windows = Array.from({ length: info[ST.SLOT_WINDOWS] }, (_, hit) => {
      const window = this.sampler.query('st_window_info', index, Number(next), hit);
      return { begin: window[ST.WINDOW_BEGIN], end: window[ST.WINDOW_END], score: window[ST.WINDOW_SCORE], startFrame: window[ST.WINDOW_START], endFrame: window[ST.WINDOW_STOP], quietFrames: window[ST.WINDOW_QUIET], level: window[ST.WINDOW_LEVEL], noiseFloor: window[ST.WINDOW_NOISE], slice: { targetFrame: window[ST.WINDOW_TARGET], startFrame: window[ST.WINDOW_SLICE_START], endFrame: window[ST.WINDOW_SLICE_END] } };
    });
    const buffer = new Float32Array(this.sampler.memory.buffer, info[ST.SLOT_BUFFER], info[ST.SLOT_CAPACITY]);
    const variantKey = info[ST.SLOT_VARIANT] < 0 ? undefined : this.sampler.variantKeys.get(id)?.[info[ST.SLOT_VARIANT]];
    return { id, buffer, frames: info[ST.SLOT_FRAMES], startFrame: info[ST.SLOT_START], maxSeconds: info[ST.SLOT_SECONDS], peak: info[ST.SLOT_PEAK], reason: this.reasons[info[ST.SLOT_REASON]] ?? null,
      recording: info[ST.SLOT_RECORDING] === 1, prepared: info[ST.SLOT_PREPARED] === 1, onsetFound: info[ST.SLOT_ONSET_FOUND] === 1, envelope: info[ST.SLOT_ENVELOPE], windows,
      sample: { id, channels: [buffer], length: info[ST.SLOT_FRAMES], sampleRate: this.sampleRate, onsetFrame: info[ST.SLOT_ONSET], variantKey } };
  }
  get slots() { return new Map(this.sampler.ids.flatMap(id => { const slot = this.slot(id); return slot ? [[id, slot]] : []; })); }
  get nextSlots() { return new Map(this.sampler.ids.flatMap(id => { const slot = this.slot(id, true); return slot ? [[id, slot]] : []; })); }
  get slotList() { return Array.from(this.slots.values()); }
  get processedFrames() { return this.sampler.query('st_stats')[ST.STATS_CAPTURE_FRAME]; }

  prepareSlot(id: string, next: boolean, { maxSeconds = this.maxSeconds, transients, variantKey }: RecordingOptions = {}) {
    if (variantKey !== undefined && transients?.key !== undefined && variantKey !== transients.key) throw new Error('Capture variant keys must match');
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > this.maxSeconds) throw new Error(`Recording limit must be between 0 and ${this.maxSeconds} seconds`);
    if (!next && !this.slots.has(id) && this.slots.size >= this.maxSlots) throw new Error('Recording slot limit reached');
    if (transients && (!Array.isArray(transients.expectedFrames) || !transients.expectedFrames.length || transients.expectedFrames.length > ST.HITS)) throw new Error('Invalid transient hints');
    if (transients && (!Number.isFinite(transients.radiusFrames) || transients.radiusFrames <= 0)) throw new Error('Invalid transient hints');
    if (transients && !transients.expectedFrames.every(Number.isFinite)) throw new Error('Transient hints must be ordered recording frames');
    const index = this.sampler.index(id);
    const key = variantKey ?? transients?.key;
    const knownVariant = this.sampler.variant(id, key);
    const keys = this.sampler.variantKeys.get(id) || [];
    if (knownVariant === -2 && keys.length === ST.VARIANTS) throw new Error('Capture variant limit reached');
    const variant = knownVariant === -2 ? keys.length : knownVariant;
    const expected = new Float64Array(this.sampler.memory.buffer, this.sampler.scratch, 32);
    expected.set(transients?.expectedFrames || []);
    this.sampler.call('st_prepare', this.sampler.handle, index, Number(next), maxSeconds, variant, this.sampler.scratch, transients?.expectedFrames.length || 0, transients?.radiusFrames || 0);
    this.sampler.remember(id, index);
    if (knownVariant === -2 && key !== undefined) {
      keys.push(key);
      this.sampler.variantKeys.set(id, keys);
    }
  }
  prepare(id: string, options?: RecordingOptions) { this.prepareSlot(id, false, options); }
  prepareNext(id: string, options?: RecordingOptions) { this.prepareSlot(id, true, options); }
  start(id: string, frame: number) {
    if (!Number.isFinite(frame)) throw new Error('Invalid recording start frame');
    this.sampler.call('st_start', this.sampler.handle, this.sampler.index(id), frame, 0);
  }
  startNext(id: string, frame: number) {
    if (!Number.isFinite(frame)) throw new Error('Invalid recording start frame');
    this.sampler.call('st_start', this.sampler.handle, this.sampler.index(id), frame, 1);
  }
  cancelNext(id: string) { const index = this.sampler.index(id, false); if (index >= 0) this.sampler.invoke('st_cancel_next', this.sampler.handle, index); }
  isRecording(id: string) { return this.slot(id)?.recording === true; }
  stop(id: string, frame: number, reason = 'stopped') {
    if (!Number.isFinite(frame)) throw new Error('Invalid recording stop frame');
    const index = this.sampler.index(id, false);
    return index >= 0 && this.sampler.call('st_stop', this.sampler.handle, index, frame, this.reason(reason)) === 1;
  }
  commit(slot: { id: string; frames: number; startFrame: number }, reason: string) { this.sampler.call('st_commit', this.sampler.handle, this.sampler.index(slot.id), this.reason(reason)); }
  capture(input: Float32Array | null | undefined, inputOffset: number, length: number, frameStart: number) {
    for (let offset = 0; offset < length; offset += BLOCK) {
      const count = Math.min(BLOCK, length - offset);
      if (input) {
        const block = input.subarray(inputOffset + offset, inputOffset + offset + count);
        this.sampler.input.set(block);
        this.sampler.input.fill(0, block.length, count);
      }
      const result = this.sampler.invoke('st_capture', this.sampler.handle, input ? this.sampler.inputPointer : 0, count, frameStart + offset);
      if (typeof result !== 'number') throw new Error('Invalid sampler capture result');
      const limited = result >>> 0;
      if (limited) this.sampler.ids.forEach((id, index) => { if (limited & (1 << index)) { const slot = this.slot(id); if (slot) this.commit(slot, 'limit'); } });
    }
  }
  stopAll(reason = 'stopped') { this.sampler.invoke('st_stop_all_recordings', this.sampler.handle, this.reason(reason)); }
  snapshot() { return this.slotList.map(slot => ({ id: slot.id, recording: slot.recording, frames: slot.frames, duration: slot.frames / this.sampleRate, maxSeconds: slot.maxSeconds, peak: slot.peak, reason: slot.reason })); }
}
import { ST } from './wasm-abi.js';

