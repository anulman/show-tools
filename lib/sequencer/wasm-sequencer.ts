import { SampleEngine } from '../sampler/wasm-sampler.js';
import { SQ } from './wasm-abi.js';

type Pattern = { id: string; label?: string; lengthBeats: number; events: { atBeat: number; sampleId: string; gain?: number }[] };
type Quantize = 'beat' | 'bar';

export class AudioSequenceEngine {
  readonly sampler: SampleEngine;
  readonly handle: number;
  readonly ownsHandle: boolean;
  readonly scratch: number;
  readonly names: string[] = [];
  readonly descriptions = new Map<number, { id: string; label: string; lengthBeats: number }>();
  disposed = false;

  constructor({ sampler, beatsPerBar = 4, handle }: { sampler: SampleEngine; beatsPerBar?: number; handle?: number }) {
    if (!Number.isSafeInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 2147483647) throw new Error('beatsPerBar must be a positive 32-bit integer');
    this.sampler = sampler;
    this.ownsHandle = handle === undefined;
    this.handle = handle ?? sampler.call('sq_create', sampler.handle, beatsPerBar);
    if (!this.handle) throw new Error('Could not create native sequencer');
    try { this.scratch = sampler.allocate(32 * 8); }
    catch (error) { if (this.ownsHandle) sampler.invoke('sq_destroy', this.handle); throw error; }
  }

  call(name: string, ...args: number[]) {
    if (this.disposed) throw new Error('Sequencer is disposed');
    const result = this.sampler.invoke(name, this.handle, ...args);
    if (typeof result === 'number' && result < 0) {
      const pointer = this.sampler.invoke('sq_error', this.handle);
      if (typeof pointer !== 'number') throw new Error('Invalid native sequencer error');
      const bytes = new Uint8Array(this.sampler.memory.buffer, pointer);
      let message = '';
      for (let index = 0; bytes[index]; index++) message += String.fromCharCode(bytes[index]);
      throw new Error(message);
    }
    return typeof result === 'number' ? result : 0;
  }
  query(name: string, ...args: number[]) {
    this.call(name, ...args, this.scratch);
    return new Float64Array(this.sampler.memory.buffer, this.scratch, 32);
  }
  quantize(value: Quantize) { if (value !== 'beat' && value !== 'bar') throw new Error('Quantize must be beat or bar'); return value === 'bar' ? SQ.BAR : SQ.BEAT; }
  identifier(value: string) { if (typeof value !== 'string' || !value.trim()) throw new Error('ID must be a nonempty string'); return value; }

  define(input: Pattern) {
    const id = this.identifier(input.id), label = this.identifier(input.label === undefined ? id : input.label);
    let index = this.names.indexOf(id);
    if (index < 0) index = this.names.length;
    if (index >= SQ.PATTERNS) throw new Error('Pattern limit reached');
    if (!Number.isSafeInteger(input.lengthBeats) || input.lengthBeats < 1 || !Array.isArray(input.events) || input.events.length > SQ.EVENTS) throw new Error('Invalid pattern');
    const events = new Float64Array(input.events.length * 3);
    input.events.forEach((event, offset) => {
      if (!Number.isSafeInteger(event.atBeat) || event.atBeat < 0 || event.atBeat >= input.lengthBeats) throw new Error('Event atBeat must be a whole beat within the pattern');
      if (!this.sampler.has(event.sampleId)) throw new Error(`Unknown sample ${event.sampleId}`);
      const gain = event.gain === undefined ? 1 : event.gain;
      if (!Number.isFinite(gain) || gain < 0) throw new Error('Event gain must be finite and nonnegative');
      events.set([event.atBeat, this.sampler.index(event.sampleId, false), gain], offset * 3);
    });
    const pointer = events.length ? this.sampler.allocate(events.byteLength) : 0;
    try {
      if (pointer) new Float64Array(this.sampler.memory.buffer, pointer, events.length).set(events);
      this.call('sq_define', index, input.lengthBeats, pointer, input.events.length);
    } finally { if (pointer) this.sampler.invoke('free', pointer); }
    if (index === this.names.length) this.names.push(id);
    const info = this.query('sq_pattern_info', index);
    this.descriptions.set(info[SQ.PATTERN_VERSION], { id, label, lengthBeats: input.lengthBeats });
    return this.snapshot();
  }
  queue(id: string, quantize: Quantize = 'bar') {
    const index = this.names.indexOf(id);
    if (index < 0) throw new Error(`Unknown pattern ${id}`);
    this.call('sq_queue', index, this.quantize(quantize)); return this.snapshot();
  }
  nextBar() { return this.call('sq_next_bar'); }
  cancelQueue() { this.call('sq_cancel_queue'); return this.snapshot(); }
  markOne() { this.call('sq_mark_one'); return this.snapshot(); }
  stop() { this.call('sq_stop'); return this.snapshot(); }
  reset(beatId = 0) { this.call('sq_reset', beatId); }
  onBeat(id: number, frame: number, epoch: number) { this.call('sq_on_beat', id, frame, epoch); }
  armRecording(id: string, { action, quantize = 'bar', maxSeconds = 30, loop = true }: { action: 'start' | 'stop'; quantize?: Quantize; maxSeconds?: number; loop?: boolean }) {
    if (action !== 'start' && action !== 'stop' || typeof loop !== 'boolean' || !Number.isFinite(maxSeconds)) throw new Error('Invalid recording options');
    const index = this.sampler.index(id);
    this.call('sq_arm_recording', index, action === 'start' ? SQ.START : SQ.STOP, this.quantize(quantize), maxSeconds, Number(loop));
    this.sampler.remember(id, index); return this.snapshot();
  }
  cancelRecording(id: string) { const index = this.sampler.index(id, false); if (index >= 0) this.call('sq_cancel_recording', index); return this.snapshot(); }
  cue(id: string, { quantize = 'bar', gain = 1 }: { quantize?: Quantize; gain?: number } = {}) {
    if (!this.sampler.has(id)) throw new Error(`Unknown sample ${id}`);
    if (!Number.isFinite(gain) || gain < 0) throw new Error('Cue gain must be finite and nonnegative');
    this.call('sq_cue', this.sampler.index(id, false), SQ.PLAY, this.quantize(quantize), gain); return this.snapshot();
  }
  cueStop(id: string, { quantize = 'bar' }: { quantize?: Quantize } = {}) {
    const index = this.sampler.index(id);
    this.call('sq_cue', index, SQ.STOP, this.quantize(quantize), 1); this.sampler.remember(id, index); return this.snapshot();
  }
  cancelCue(id: string) { const index = this.sampler.index(id, false); if (index >= 0) this.call('sq_cancel_cue', index); return this.snapshot(); }
  silence(id: string) { const index = this.sampler.index(id, false); if (index >= 0) this.call('sq_silence', index); return this.snapshot(); }

  snapshot() {
    const state = Array.from(this.query('sq_snapshot'));
    const active = this.descriptions.get(state[SQ.ACTIVE_VERSION]);
    const pending = this.descriptions.get(state[SQ.PENDING_VERSION]);
    const patterns = this.names.flatMap((id, index) => {
      const info = this.query('sq_pattern_info', index), description = this.descriptions.get(info[SQ.PATTERN_VERSION]);
      return description ? [{ ...description }] : [];
    });
    const recordArms = this.sampler.ids.flatMap((sampleId, index) => {
      const arm = this.query('sq_record_info', index);
      return arm[SQ.RECORD_PRESENT] ? [{ sampleId, action: arm[SQ.RECORD_ACTION] === SQ.START ? 'start' : 'stop', quantize: arm[SQ.RECORD_QUANTIZE] === SQ.BAR ? 'bar' : 'beat', targetBeatId: arm[SQ.RECORD_TARGET], loop: arm[SQ.RECORD_LOOP] === 1, order: arm[SQ.RECORD_ORDER] }] : [];
    }).sort((a, b) => a.order - b.order).map(({ order, ...arm }) => arm);
    const cues = this.sampler.ids.flatMap((sampleId, index) => {
      const cue = this.query('sq_cue_info', index);
      return cue[SQ.CUE_PRESENT] ? [{ sampleId, action: cue[SQ.CUE_ACTION] === SQ.STOP ? 'stop' : 'play', quantize: cue[SQ.CUE_QUANTIZE] === SQ.BAR ? 'bar' : 'beat', targetBeatId: cue[SQ.CUE_TARGET], order: cue[SQ.CUE_ORDER] }] : [];
    }).sort((a, b) => a.order - b.order).map(({ order, ...cue }) => cue);
    const liveVersions = new Set([state[SQ.ACTIVE_VERSION], state[SQ.PENDING_VERSION]]);
    this.names.forEach((id, index) => liveVersions.add(this.query('sq_pattern_info', index)[SQ.PATTERN_VERSION]));
    for (const version of this.descriptions.keys()) if (!liveVersions.has(version)) this.descriptions.delete(version);
    return { status: ['ready', 'playing', 'queued'][state[SQ.STATUS]],
      playing: active ? { ...active, positionBeat: state[SQ.POSITION] } : null,
      queued: pending ? { id: pending.id, label: pending.label, quantize: state[SQ.PENDING_QUANTIZE] === SQ.BAR ? 'bar' : 'beat', targetBeatId: state[SQ.PENDING_TARGET] } : null,
      bar: state[SQ.BAR_NUMBER], beat: state[SQ.BEAT_NUMBER], beatsPerBar: state[SQ.BEATS_PER_BAR], recordArms, cues, patterns,
      metadata: { backend: 'cpp-wasm', epoch: state[SQ.EPOCH] < 0 ? null : state[SQ.EPOCH], beatId: state[SQ.BEAT_ID], frame: state[SQ.FRAME] < 0 ? null : state[SQ.FRAME], barOrigin: state[SQ.BAR_ORIGIN] < 0 ? null : state[SQ.BAR_ORIGIN], markNextOne: state[SQ.MARK_NEXT_ONE] === 1, launches: state[SQ.LAUNCHES], playedEvents: state[SQ.PLAYED], skippedEvents: state[SQ.SKIPPED] } };
  }
  get lastBeatId() { return this.query('sq_snapshot')[SQ.BEAT_ID]; }
  get recordArms() { return new Map(this.snapshot().recordArms.map(arm => [arm.sampleId, arm])); }
  dispose() {
    if (this.disposed) return;
    if (this.ownsHandle) this.call('sq_destroy');
    this.sampler.invoke('free', this.scratch); this.disposed = true;
  }
}
