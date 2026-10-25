import { SampleEngine, SampleRecorder } from '../sampler/wasm-sampler.js';
import { AudioSequenceEngine } from '../sequencer/wasm-sequencer.js';
import { CONTROL_IDS } from './model.js';
import type { ChannelId, ChartControls, Control, CueAction, PadLight, Phase, PracticeEvent, PracticeState, Program, StartOptions } from './model.js';
import { PF } from './wasm-abi.js';
import { ST } from '../sampler/wasm-abi.js';

const BLOCK = 8192;
const PHASES: readonly Phase[] = ['idle', 'count-in', 'playing', 'ended'];
const STATUSES: readonly PracticeState['channels'][number]['status'][] = ['empty', 'ready', 'armed', 'recording', 'stopping', 'looping'];
type Options = { api: WebAssembly.Exports; sampleRate: number; mode?: number; maxVoices?: number; maxSeconds?: number; clickGain?: number;
  bpm?: number; beatsPerBar?: number; barCount?: number; endBar?: number; runId?: string; program?: Program };

export class NativePerformance {
  readonly api: WebAssembly.Exports;
  readonly memory: WebAssembly.Memory;
  readonly sampleRate: number;
  readonly handle: number;
  readonly trackerHandle: number;
  readonly sampler: SampleEngine;
  readonly recorder: SampleRecorder;
  readonly sequencer: AudioSequenceEngine;
  readonly scratch: number;
  readonly trackerPointer: number;
  readonly trackerEventPointer: number;
  readonly eventPointer: number;
  readonly commandPointer: number;
  readonly allocations: number[] = [];
  readonly commandIds = new Map<number, string>();
  runId: string;
  disposed = false;

  constructor({ api, sampleRate, mode = PF.PRACTICE, maxVoices = 32, maxSeconds = 30, clickGain = 1, ...song }: Options) {
    if (!(api.memory instanceof WebAssembly.Memory)) throw new Error('Performance WASM memory is unavailable');
    const beatsPerBar = song.beatsPerBar ?? 4;
    if (!Number.isFinite(sampleRate) || !Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > ST.MAX_VOICES
      || !Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 30 || !Number.isInteger(mode) || mode < PF.TRACKER || mode > PF.PRACTICE
      || !Number.isSafeInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 2147483647 || mode === PF.PRACTICE && beatsPerBar !== 4) throw new Error('Invalid native performance options');
    this.api = api; this.memory = api.memory; this.sampleRate = sampleRate; this.runId = song.runId ?? 'unstarted';
    if (this.call('pf_abi_version') !== PF.ABI_VERSION) throw new Error('Performance WASM ABI mismatch. Rebuild and reload practice.');
    this.handle = this.call('pf_create', sampleRate, mode, maxVoices, maxSeconds, beatsPerBar);
    if (!this.handle) throw new Error('Could not create native performance engine');
    let sampler: SampleEngine | undefined;
    let sequencer: AudioSequenceEngine | undefined;
    try {
      this.trackerHandle = this.call('pf_tracker', this.handle);
      this.sampler = sampler = new SampleEngine({ api, sampleRate, maxVoices, maxSeconds, handle: this.call('pf_sampler', this.handle) });
      this.recorder = new SampleRecorder({ sampler, sampleRate, maxSeconds });
      this.sequencer = sequencer = new AudioSequenceEngine({ sampler, beatsPerBar: song.beatsPerBar ?? 4, handle: this.call('pf_sequencer', this.handle) });
      this.scratch = this.allocate(128 * 8);
      this.trackerPointer = this.allocate(22 * 8);
      this.trackerEventPointer = this.allocate(512 * 12 * 8);
      this.eventPointer = this.allocate(PF.EVENT_CAPACITY * PF.EVENT_FIELDS * 8);
      this.commandPointer = this.allocate(801);
      this.call('pf_set_click_gain', this.handle, clickGain);
      if (mode === PF.PRACTICE) {
        sampler.ids.push(...CONTROL_IDS);
        this.configure(song);
      }
    } catch (error) {
      sequencer?.dispose(); sampler?.dispose();
      this.invoke('pf_destroy', this.handle);
      for (const pointer of this.allocations) this.invoke('free', pointer);
      throw error;
    }
  }

  invoke(name: string, ...args: number[]): unknown {
    if (this.disposed) throw new Error('Performance engine is disposed');
    const fn = this.api[name];
    if (typeof fn !== 'function') throw new Error(`Performance WASM export is missing: ${name}`);
    return fn(...args);
  }
  call(name: string, ...args: number[]): number {
    const result = this.invoke(name, ...args);
    if (typeof result !== 'number') throw new Error(`Invalid performance WASM result: ${name}`);
    if (result < 0) throw new Error(this.error());
    return result;
  }
  text(pointer: unknown) {
    if (typeof pointer !== 'number' || !pointer) return 'Native performance command failed';
    const bytes = new Uint8Array(this.memory.buffer, pointer);
    let result = '';
    for (let index = 0; bytes[index]; index++) result += String.fromCharCode(bytes[index]);
    return result;
  }
  error() { return this.text(this.invoke('pf_error', this.handle)); }
  message(code: number) { return this.text(this.invoke('pf_message', code)); }
  allocate(bytes: number) { const pointer = this.call('malloc', bytes); if (!pointer) throw new Error('Performance WASM memory limit reached'); this.allocations.push(pointer); return pointer; }
  query(name: string, ...args: number[]) { this.invoke(name, this.handle, ...args, this.scratch); return new Float64Array(this.memory.buffer, this.scratch, 128); }
  boolean(value: boolean, name: string) { if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`); return Number(value); }
  channel(id: ChannelId) { const index = CONTROL_IDS.indexOf(id); if (index < 0) throw new Error('Unknown channel'); return index; }

  configure({ bpm = 120, beatsPerBar = 4, barCount = 1, endBar = barCount, program = { lengthBeats: 4, events: [] } }: Omit<Options, 'api' | 'sampleRate'> = {}) {
    if (!Number.isFinite(bpm) || !Number.isSafeInteger(beatsPerBar) || !Number.isSafeInteger(barCount) || !Number.isSafeInteger(endBar)
      || !Number.isSafeInteger(program.lengthBeats)) throw new Error('Invalid song configuration');
    if (bpm < 40 || bpm > 240 || beatsPerBar !== 4 || barCount < 1 || barCount > PF.MAX_BARS || endBar < 1 || endBar > barCount
      || program.lengthBeats < 1 || program.lengthBeats > 2147483647 || program.events.length > PF.MAX_EVENTS) throw new Error('Invalid song configuration');
    const keys = new Map(Array.from(this.sampler.variantKeys, ([id, names]) => [id, [...names]]));
    const variant = (id: ChannelId, key: string) => {
      const names = keys.get(id) || [];
      let index = names.indexOf(key);
      if (index < 0) { if (names.length >= 16) throw new Error('Capture variant limit reached'); index = names.length; names.push(key); keys.set(id, names); }
      return index;
    };
    const kinds = { none: PF.NONE, unsupported: PF.UNSUPPORTED, tap: PF.TAP, arm: PF.ARM, commit: PF.COMMIT, 'commit-arm': PF.COMMIT_ARM, stop: PF.STOP, play: PF.PLAY };
    const controls: ChartControls | undefined = program.controls;
    if (controls) for (const row of [controls.leadIn, ...controls.bars]) for (const id of CONTROL_IDS) {
      const cue = row[id];
      if ('capture' in cue && cue.capture) variant(id, cue.capture.kind === 'sparse' ? cue.capture.beats.join(',') : cue.capture.variantKey);
    }
    for (const cue of program.barPlayback || []) variant(cue.channelId, cue.variantKey);
    const rows: number[] = [];
    const addCue = (bar: number, id: ChannelId, cue: CueAction) => {
      const row = new Array<number>(PF.CUE_FIELDS).fill(0);
      row[PF.CUE_BAR] = bar; row[PF.CUE_CHANNEL] = this.channel(id); row[PF.CUE_KIND] = kinds[cue.kind]; row[PF.CUE_VARIANT] = -1;
      if ('timing' in cue) row[PF.CUE_TIMING] = cue.timing === 'bar' ? PF.BAR : PF.NOW;
      if (cue.kind === 'tap') {
        if (cue.beats.length > 16) throw new Error('A cue supports at most 16 hits');
        row[PF.CUE_VARIANT] = keys.get(id)?.indexOf(cue.beats.join(',')) ?? -1; row[PF.CUE_HITS] = cue.beats.length;
        cue.beats.forEach((beat, index) => { row[PF.CUE_POSITIONS + index] = beat; });
      } else if ('capture' in cue && cue.capture) {
        const capture = cue.capture;
        row[PF.CUE_CAPTURE] = capture.kind === 'sparse' ? PF.SPARSE : PF.WHOLE_BAR;
        row[PF.CUE_VARIANT] = variant(id, capture.kind === 'sparse' ? capture.beats.join(',') : capture.variantKey);
        if (capture.kind === 'sparse') {
          if (capture.beats.length > 16) throw new Error('A cue supports at most 16 hits');
          row[PF.CUE_HITS] = capture.beats.length; row[PF.CUE_RADIUS] = capture.radiusBeats;
          capture.beats.forEach((beat, index) => { row[PF.CUE_POSITIONS + index] = beat; });
        }
      }
      rows.push(...row);
    };
    if (controls) {
      CONTROL_IDS.forEach(id => addCue(0, id, controls.leadIn[id]));
      controls.bars.forEach((row, index) => CONTROL_IDS.forEach(id => addCue(index + 1, id, row[id])));
    }
    const events = program.events.flatMap(event => {
      if (!Number.isSafeInteger(event.atBeat) || !Number.isFinite(event.gain ?? 1)) throw new Error('Invalid program event');
      return [event.atBeat, this.channel(event.sampleId), event.gain ?? 1];
    });
    const playback = (program.barPlayback || []).flatMap(cue => [cue.bar, this.channel(cue.channelId), variant(cue.channelId, cue.variantKey)]);
    const pointers: number[] = [];
    const upload = (values: number[]) => {
      if (!values.length) return 0;
      const pointer = this.call('malloc', values.length * 8);
      if (!pointer) throw new Error('Performance WASM memory limit reached');
      pointers.push(pointer); new Float64Array(this.memory.buffer, pointer, values.length).set(values); return pointer;
    };
    try {
      const eventPointer = upload(events), cuePointer = upload(rows), playbackPointer = upload(playback);
      this.call('pf_configure', this.handle, bpm, beatsPerBar, barCount, endBar, program.lengthBeats, eventPointer, events.length / 3, cuePointer, rows.length / PF.CUE_FIELDS, playbackPointer, playback.length / 3);
      this.sampler.variantKeys.clear();
      for (const [id, names] of keys) this.sampler.variantKeys.set(id, names);
    } finally { for (const pointer of pointers) this.invoke('free', pointer); }
  }

  start({ runId, bpm = this.state().bpm, countInBars = 1, startBar = 1, endBar = this.state().endBar, loop = true, automatic = false }: StartOptions & { runId: string }) {
    if (typeof runId !== 'string' || !runId.trim()) throw new Error('A run ID is required');
    if (!Number.isFinite(bpm) || !Number.isSafeInteger(countInBars) || !Number.isSafeInteger(startBar) || !Number.isSafeInteger(endBar)) throw new Error('Invalid start options');
    const barCount = this.query('pf_snapshot')[PF.BAR_COUNT];
    if (bpm < 40 || bpm > 240 || countInBars < 0 || countInBars > 4 || startBar < 1 || endBar < startBar || endBar > barCount) throw new Error('Invalid start options');
    this.call('pf_start', this.handle, bpm, countInBars, startBar, endBar, this.boolean(loop, 'Loop'), this.boolean(automatic, 'Automatic'));
    this.runId = runId; this.commandIds.clear();
  }
  stop() { this.invoke('pf_stop', this.handle); }
  selectChannel(id: ChannelId) { this.call('pf_select', this.handle, this.channel(id)); }
  setAutomatic(value: boolean) { this.call('pf_set_automatic', this.handle, this.boolean(value, 'Automatic')); }
  setClick(value: boolean) { this.call('pf_set_click', this.handle, this.boolean(value, 'Click')); }
  setMicrophone(value: boolean) { this.call('pf_set_microphone', this.handle, this.boolean(value, 'Microphone')); }
  setChannel(id: ChannelId, { gain, muted }: { gain?: number; muted?: boolean }) {
    const channel = this.channel(id), old = this.query('pf_channel_info', channel);
    const nextGain = gain === undefined ? old[PF.CHANNEL_GAIN] : gain;
    const nextMuted = muted === undefined ? old[PF.CHANNEL_MUTED] === 1 : muted;
    if (!Number.isFinite(nextGain)) throw new Error('Invalid channel gain');
    this.call('pf_set_channel', this.handle, channel, nextGain, this.boolean(nextMuted, 'Mute'));
  }
  control(control: Control, commandId?: string) {
    if (commandId !== undefined && (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 200)) throw new Error('Command ID must be a nonempty string of at most 200 characters');
    const units = new Uint16Array(this.memory.buffer, this.commandPointer, commandId?.length || 0);
    for (let index = 0; index < units.length; index++) units[index] = commandId?.charCodeAt(index) ?? 0;
    let id: number;
    if (control.id === 'mushroom') id = 4;
    else if (control.id === 'knob') { if (!Number.isFinite(control.value)) throw new Error('Invalid knob value'); id = 5; }
    else id = this.channel(control.id);
    const result = this.invoke('pf_control', this.handle, id, control.id === 'knob' ? control.value : 0, commandId ? this.commandPointer : 0, units.length);
    if (commandId) this.commandIds.set(this.query('pf_snapshot')[PF.SEQUENCE], commandId);
    if (result !== 0) throw new Error(this.error());
  }

  decode(data: ArrayLike<number>, channelData?: ArrayLike<number>): PracticeState {
    const phase = PHASES[data[PF.PHASE]];
    if (!phase) throw new Error('Invalid native transport phase');
    const channels = CONTROL_IDS.map((id, index) => {
      const info = channelData ? Array.from({ length: PF.CHANNEL_FIELDS }, (_, field) => channelData[index * PF.CHANNEL_FIELDS + field]) : Array.from(this.query('pf_channel_info', index));
      const status = STATUSES[info[PF.CHANNEL_STATUS]];
      if (!status) throw new Error('Invalid native channel status');
      const light: PadLight = info[PF.CHANNEL_LIGHT] === PF.RELEASING ? { kind: 'releasing', remainingMs: info[PF.CHANNEL_RELEASE_MS] }
        : { kind: info[PF.CHANNEL_LIGHT] === PF.CUE ? 'cue' : info[PF.CHANNEL_LIGHT] === PF.STEADY ? 'steady' : 'off' };
      return { id, gain: info[PF.CHANNEL_GAIN], muted: info[PF.CHANNEL_MUTED] === 1, looping: info[PF.CHANNEL_LOOPING] === 1, ready: info[PF.CHANNEL_READY] === 1, status, light };
    });
    const active = channels.find(channel => channel.status === 'armed' || channel.status === 'recording' || channel.status === 'stopping');
    const recording = active && (active.status === 'armed' || active.status === 'recording' || active.status === 'stopping') ? { id: active.id, status: active.status } : null;
    return { phase, bar: data[PF.BAR_NUMBER] < 0 ? null : data[PF.BAR_NUMBER], beat: data[PF.BEAT_NUMBER] < 0 ? null : data[PF.BEAT_NUMBER], countInRemaining: data[PF.COUNT_IN_REMAINING], bpm: data[PF.BPM],
      startBar: data[PF.START_BAR], endBar: data[PF.END_BAR], loop: data[PF.LOOP] === 1, automatic: data[PF.AUTOMATIC] === 1, click: data[PF.CLICK] === 1, selectedChannel: CONTROL_IDS[data[PF.SELECTED_CHANNEL]],
      runId: this.runId, seq: data[PF.SEQUENCE], channels, looping: channels.filter(channel => channel.looping).map(channel => channel.id), recording, microphone: data[PF.MICROPHONE] === 1, error: data[PF.ERROR] ? this.message(data[PF.ERROR]) : null };
  }
  state() { return this.decode(Array.from(this.query('pf_snapshot'))); }
  snapshot() { return this.state(); }
  get processedFrames() { return this.query('pf_snapshot')[PF.FRAME]; }
  get clickEnabled() { return this.query('pf_snapshot')[PF.CLICK_ENABLED] === 1; }
  onBeat(id: number, frame: number, epoch: number) { return this.call('pf_on_beat', this.handle, id, frame, epoch); }
  clockCommand(type: number, value: number, frame: number, sequence: number, epoch: number) { return this.call('pf_clock_command', this.handle, type, value, frame, sequence, epoch); }
  flush() { this.invoke('pf_flush', this.handle); }
  trackerSnapshot() {
    this.invoke('bt_snapshot', this.trackerHandle, this.trackerPointer);
    const state = Array.from(new Float64Array(this.memory.buffer, this.trackerPointer, 22));
    state[17] += this.query('pf_snapshot')[PF.TRACKER_DROPS]; return state;
  }
  trackerEvents() {
    const count = this.call('pf_drain_tracker_events', this.handle, this.trackerEventPointer, 512);
    return Array.from(new Float64Array(this.memory.buffer, this.trackerEventPointer, count * 12));
  }
  events(): PracticeEvent[] {
    const count = this.call('pf_drain_events', this.handle, this.eventPointer, PF.EVENT_CAPACITY);
    const rows = new Float64Array(this.memory.buffer, this.eventPointer, count * PF.EVENT_FIELDS);
    return Array.from({ length: count }, (_, index): PracticeEvent => {
      const event = rows.subarray(index * PF.EVENT_FIELDS, (index + 1) * PF.EVENT_FIELDS);
      const type = event[PF.EVENT_TYPE] === PF.BEAT ? 'beat' : event[PF.EVENT_TYPE] === PF.CONTROL ? 'control' : event[PF.EVENT_TYPE] === PF.FAULT ? 'fault' : 'state';
      const state = this.decode(event.subarray(PF.EVENT_STATE, PF.EVENT_CHANNELS), event.subarray(PF.EVENT_CHANNELS));
      const result: PracticeEvent = { v: 1, runId: this.runId, seq: event[PF.EVENT_SEQUENCE], type, state };
      if (event[PF.EVENT_FRAME] >= 0) { result.frame = event[PF.EVENT_FRAME]; result.sampleRate = event[PF.EVENT_RATE]; }
      if (event[PF.EVENT_ERROR]) result.error = this.message(event[PF.EVENT_ERROR]);
      if (type === 'control') {
        const id = event[PF.EVENT_CONTROL];
        result.control = id === 4 ? { id: 'mushroom' } : id === 5 ? { id: 'knob', value: event[PF.EVENT_VALUE] } : { id: CONTROL_IDS[id] };
        result.applied = event[PF.EVENT_APPLIED] === 1;
        const commandId = this.commandIds.get(result.seq);
        if (commandId) { result.commandId = commandId; this.commandIds.delete(result.seq); }
      }
      return result;
    });
  }
  process(input: Float32Array | null | undefined, outputs: Float32Array[], length: number) {
    for (let offset = 0; offset < length; offset += BLOCK) {
      const count = Math.min(BLOCK, length - offset);
      if (input) { const block = input.subarray(offset, offset + count); this.sampler.input.set(block); this.sampler.input.fill(0, block.length, count); }
      this.sampler.left.fill(0, 0, count); this.sampler.right.fill(0, 0, count);
      this.call('pf_process', this.handle, input ? this.sampler.inputPointer : 0, this.sampler.leftPointer, outputs[1] ? this.sampler.rightPointer : 0, count);
      outputs[0]?.set(this.sampler.left.subarray(0, count), offset);
      outputs[1]?.set(this.sampler.right.subarray(0, count), offset);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.sequencer.dispose(); this.sampler.dispose();
    this.invoke('pf_destroy', this.handle);
    for (const pointer of this.allocations) this.invoke('free', pointer);
    this.disposed = true;
  }
}
