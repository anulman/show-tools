import { SampleEngine, SampleRecorder } from '../sampler/wasm-sampler.js';
import { AudioSequenceEngine } from '../sequencer/wasm-sequencer.js';
import { CONTROL_IDS } from './model.js';
import type { ChannelId, ChartControls, CompiledTakeState, Control, CueAction, LiveEffectDefinition, LiveEffectsState, VoiceEffectConfiguration, VoiceEffectsState, PadLight, Phase, PracticeEvent, PracticeState, Program, StartOptions, TempoHitState } from './model.js';
import { PF } from './wasm-abi.js';
import { ST } from '../sampler/wasm-abi.js';

const BLOCK = 8192;
const PHASES: readonly Phase[] = ['idle', 'count-in', 'playing', 'ended'];
const STATUSES: readonly PracticeState['channels'][number]['status'][] = ['empty', 'ready', 'armed', 'recording', 'stopping', 'looping'];
const PLAYBACK_STATES: readonly CompiledTakeState['playback'][] = ['idle', 'playing', 'releasing'];
type Options = { api: WebAssembly.Exports; sampleRate: number; mode?: number; maxVoices?: number; maxSeconds?: number; clickGain?: number;
  bpm?: number; beatsPerBar?: number; barCount?: number; endBar?: number; runId?: string; program?: Program; compiledProgram?: readonly number[]; initialVoiceEffects?: readonly VoiceEffectConfiguration[] };

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
  readonly effectPointer: number;
  readonly effectCountPointer: number;
  readonly effectRevisionPointer: number;
  readonly liveLeftPointer: number;
  readonly liveRightPointer: number;
  readonly liveLeft: Float32Array;
  readonly liveRight: Float32Array;
  readonly allocations: number[] = [];
  readonly commandIds = new Map<number, string>();
  runId: string;
  disposed = false;
  private compiledTakeCount = 0;

  constructor({ api, sampleRate, mode = PF.PRACTICE, maxVoices = 32, maxSeconds = 30, clickGain = 1, initialVoiceEffects, ...song }: Options) {
    if (!(api.memory instanceof WebAssembly.Memory)) throw new Error('Performance WASM memory is unavailable');
    const beatsPerBar = song.beatsPerBar ?? 4;
    if (!Number.isFinite(sampleRate) || !Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > ST.MAX_VOICES
      || !Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 30 || !Number.isInteger(mode) || mode < PF.TRACKER || mode > PF.PRACTICE
      || !Number.isSafeInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 2147483647 || mode === PF.PRACTICE && beatsPerBar !== 4 && beatsPerBar !== 6) throw new Error('Invalid native performance options');
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
      this.effectPointer = this.allocate(PF.VOICE_PROFILES * PF.MAX_LIVE_EFFECTS * PF.EFFECT_BYTES);
      this.effectCountPointer = this.allocate(PF.VOICE_PROFILES * 4);
      this.effectRevisionPointer = this.allocate(PF.VOICE_PROFILES * 4);
      this.liveLeftPointer = this.allocate(BLOCK * 4);
      this.liveRightPointer = this.allocate(BLOCK * 4);
      this.liveLeft = new Float32Array(this.memory.buffer, this.liveLeftPointer, BLOCK);
      this.liveRight = new Float32Array(this.memory.buffer, this.liveRightPointer, BLOCK);
      this.call('pf_set_click_gain', this.handle, clickGain);
      if (mode === PF.PRACTICE) {
        sampler.ids.push(...CONTROL_IDS);
        if (initialVoiceEffects) this.prepareVoiceEffects(initialVoiceEffects);
        if (song.compiledProgram) this.configureCompiled(song.compiledProgram);
        else this.configure(song);
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
      this.compiledTakeCount = 0;
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
  configureCompiled(program: readonly number[]) {
    if (!Array.isArray(program) || program.length < PF.COMPILED_HEADER_FIELDS || program.some(value => !Number.isFinite(value))) throw new Error('Invalid compiled native program');
    const pointer = this.call('malloc', program.length * 8);
    if (!pointer) throw new Error('Performance WASM memory limit reached');
    try {
      new Float64Array(this.memory.buffer, pointer, program.length).set(program);
      this.call('pf_configure_compiled', this.handle, pointer, program.length);
      this.compiledTakeCount = program[8];
    } finally { this.invoke('free', pointer); }
  }
  compiledTake(index: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= PF.COMPILED_MAX_TAKES) throw new Error('Invalid compiled take index');
    const info = this.query('pf_compiled_take_info', index);
    return { voice: info[PF.TAKE_VOICE], ready: info[PF.TAKE_READY] === 1, frames: info[PF.TAKE_LENGTH],
      capacity: info[PF.TAKE_CAPACITY], revision: info[PF.TAKE_REVISION], phase: info[PF.TAKE_PHASE], playbackState: info[PF.TAKE_PLAYBACK_STATE], period: info[PF.TAKE_PERIOD],
      sourceEndFrames: info[PF.TAKE_SOURCE_END] < 0 ? null : info[PF.TAKE_SOURCE_END] };
  }
  tempoHitInfo(): TempoHitState {
    const info = this.query('pf_tempo_info');
    return { count: info[PF.TEMPO_COUNT], latest: info[PF.TEMPO_COUNT] ? {
      frame: info[PF.TEMPO_FRAME], beatHint: info[PF.TEMPO_HINT] === 1 ? 1 : null,
      source: info[PF.TEMPO_SOURCE] === 1 ? 'chart' : 'pedal', estimated: info[PF.TEMPO_ESTIMATED] === 1, bpm: info[PF.TEMPO_BPM],
    } : null };
  }
  prepareLiveEffects(effects: readonly LiveEffectDefinition[]) {
    this.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects })));
    return this.liveEffects();
  }
  prepareVoiceEffects(configurations: readonly VoiceEffectConfiguration[]): readonly VoiceEffectsState[] {
    if (!Array.isArray(configurations) || configurations.length !== PF.VOICE_PROFILES) throw new Error('Configure all six voice profiles');
    const profiles = new Map<number, readonly LiveEffectDefinition[]>();
    for (const configuration of configurations) {
      if (!configuration || !Number.isInteger(configuration.profile) || configuration.profile < 0 || configuration.profile >= PF.VOICE_PROFILES
        || profiles.has(configuration.profile) || !Array.isArray(configuration.effects) || configuration.effects.length > PF.MAX_LIVE_EFFECTS) throw new Error('Invalid voice effects configuration');
      for (const effect of configuration.effects) {
        if (!effect || typeof effect !== 'object' || !Number.isFinite(effect.wet) || effect.wet < 0 || effect.wet > 1) throw new Error('Invalid voice effect');
        if (effect.kind === 'slapback') {
          if (!Number.isFinite(effect.delayMs) || effect.delayMs < 40 || effect.delayMs > 250 || !Number.isFinite(effect.feedback) || effect.feedback < 0 || effect.feedback > .7) throw new Error('Invalid slapback effect');
        } else if (effect.kind === 'chorus') {
          if (!Number.isFinite(effect.rateHz) || effect.rateHz < .05 || effect.rateHz > 5 || !Number.isFinite(effect.depthMs) || effect.depthMs < 0 || effect.depthMs > 9
            || !Number.isFinite(effect.baseDelayMs) || effect.baseDelayMs < 10 || effect.baseDelayMs > 40) throw new Error('Invalid chorus effect');
        } else throw new Error('Unsupported voice effect');
      }
      profiles.set(configuration.profile, configuration.effects);
    }
    const old = this.voiceEffects();
    const view = new DataView(this.memory.buffer, this.effectPointer, PF.VOICE_PROFILES * PF.MAX_LIVE_EFFECTS * PF.EFFECT_BYTES);
    const counts = new Uint32Array(this.memory.buffer, this.effectCountPointer, PF.VOICE_PROFILES);
    const revisions = new Uint32Array(this.memory.buffer, this.effectRevisionPointer, PF.VOICE_PROFILES);
    let stage = 0, allUnchanged = true;
    for (const previous of old) {
      const effects = profiles.get(previous.profile);
      if (!effects) throw new Error('Missing voice profile');
      const unchanged = previous.prepared && effects.length === previous.effects.length && effects.every((effect, index) => {
        const before = previous.effects[index];
        return before?.kind === effect.kind && effect.wet === before.wet && (effect.kind === 'slapback' && before.kind === 'slapback'
          ? effect.delayMs === before.delayMs && effect.feedback === before.feedback
          : effect.kind === 'chorus' && before.kind === 'chorus' && effect.rateHz === before.rateHz && effect.depthMs === before.depthMs && effect.baseDelayMs === before.baseDelayMs);
      });
      if (!unchanged && previous.revision >= 4294967295) throw new Error('Voice effect revision limit reached. Reload practice.');
      allUnchanged &&= unchanged;
      counts[previous.profile] = effects.length; revisions[previous.profile] = unchanged ? Math.max(1, previous.revision) : previous.revision + 1;
      for (const effect of effects) {
        const offset = stage++ * PF.EFFECT_BYTES;
        view.setUint32(offset + PF.EFFECT_TYPE_OFFSET, effect.kind === 'slapback' ? PF.EFFECT_SLAPBACK : PF.EFFECT_CHORUS, true);
        view.setUint32(offset + PF.EFFECT_VERSION_OFFSET, 1, true);
        if (effect.kind === 'slapback') {
          view.setFloat64(offset + PF.EFFECT_DELAY_OFFSET, effect.delayMs, true); view.setFloat64(offset + PF.EFFECT_FEEDBACK_OFFSET, effect.feedback, true); view.setFloat64(offset + PF.EFFECT_WET_OFFSET, effect.wet, true);
        } else {
          view.setFloat64(offset + PF.EFFECT_CHORUS_RATE_OFFSET, effect.rateHz, true); view.setFloat64(offset + PF.EFFECT_CHORUS_DEPTH_OFFSET, effect.depthMs, true);
          view.setFloat64(offset + PF.EFFECT_CHORUS_DELAY_OFFSET, effect.baseDelayMs, true); view.setFloat64(offset + PF.EFFECT_CHORUS_WET_OFFSET, effect.wet, true);
        }
      }
    }
    const phase = this.decode(Array.from(this.query('pf_snapshot'))).phase;
    if (allUnchanged && (phase === 'playing' || phase === 'count-in')) return old;
    this.call('pf_prepare_voice_effects', this.handle, stage ? this.effectPointer : 0, this.effectCountPointer, this.effectRevisionPointer);
    return this.voiceEffects();
  }
  voiceEffects(): readonly VoiceEffectsState[] {
    const activity: readonly VoiceEffectsState['activity'][] = ['standby', 'live', 'tail', 'capture'];
    return Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => {
      const data = Array.from(this.query('pf_voice_info', profile));
      const effects = Array.from({ length: data[PF.VOICE_STAGE_COUNT] }, (_, stage): LiveEffectDefinition => {
        const effect = this.query('pf_voice_effect_info', profile, stage);
        if (effect[PF.VOICE_EFFECT_TYPE] === PF.EFFECT_SLAPBACK) return { kind: 'slapback', delayMs: effect[PF.VOICE_EFFECT_PARAMETER_0], feedback: effect[PF.VOICE_EFFECT_PARAMETER_1], wet: effect[PF.VOICE_EFFECT_PARAMETER_2] };
        if (effect[PF.VOICE_EFFECT_TYPE] === PF.EFFECT_CHORUS) return { kind: 'chorus', rateHz: effect[PF.VOICE_EFFECT_PARAMETER_0], depthMs: effect[PF.VOICE_EFFECT_PARAMETER_1], baseDelayMs: effect[PF.VOICE_EFFECT_PARAMETER_2], wet: effect[PF.VOICE_EFFECT_PARAMETER_3] };
        throw new Error('Unknown native voice effect');
      });
      return { profile, effects, prepared: data[PF.VOICE_PREPARED] === 1, revision: data[PF.VOICE_REVISION], activity: activity[data[PF.VOICE_ACTIVITY]] ?? 'standby',
        rotationEligible: data[PF.VOICE_ROTATION_ELIGIBLE] === 1, rotationRemainingBeats: data[PF.VOICE_ROTATION_REMAINING] };
    });
  }
  liveEffects(): LiveEffectsState {
    const data = this.query('pf_live_info');
    const stageCount = data[PF.LIVE_STAGE_COUNT];
    return { prepared: data[PF.LIVE_PREPARED] === 1, active: data[PF.LIVE_ACTIVE] === 1,
      revision: data[PF.LIVE_REVISION], stageCount, captureSupported: data[PF.LIVE_CAPTURE_SUPPORTED] === 1 };
  }
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
    else if (control.id === 'tempo') id = 6;
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
    const active = channels.find(channel => channel.status === 'recording')
      ?? channels.find(channel => channel.status === 'armed') ?? channels.find(channel => channel.status === 'stopping');
    const recording = active && (active.status === 'armed' || active.status === 'recording' || active.status === 'stopping') ? { id: active.id, status: active.status } : null;
    return { phase, bar: data[PF.BAR_NUMBER] < 0 ? null : data[PF.BAR_NUMBER], beat: data[PF.BEAT_NUMBER] < 0 ? null : data[PF.BEAT_NUMBER], countInRemaining: data[PF.COUNT_IN_REMAINING], bpm: data[PF.BPM],
      startBar: data[PF.START_BAR], endBar: data[PF.END_BAR], loop: data[PF.LOOP] === 1, automatic: data[PF.AUTOMATIC] === 1, click: data[PF.CLICK] === 1, selectedChannel: CONTROL_IDS[data[PF.SELECTED_CHANNEL]],
      runId: this.runId, seq: data[PF.SEQUENCE], channels, looping: channels.filter(channel => channel.looping).map(channel => channel.id), recording, microphone: data[PF.MICROPHONE] === 1, error: data[PF.ERROR] ? this.message(data[PF.ERROR]) : null };
  }
  state(): PracticeState {
    const state = { ...this.decode(Array.from(this.query('pf_snapshot'))), liveEffects: this.liveEffects(), voiceEffects: this.voiceEffects(), tempoHits: this.tempoHitInfo() };
    if (!this.compiledTakeCount) return state;
    const compiledTakes = Array.from({ length: this.compiledTakeCount }, (_, index): CompiledTakeState => {
      const take = this.compiledTake(index);
      const playback = PLAYBACK_STATES[take.playbackState];
      if (!playback) throw new Error('Invalid native take playback state');
      return { index, ready: take.ready, frames: take.frames, period: take.period, playback, sourceEndFrames: take.sourceEndFrames };
    });
    return { ...state, compiledTakes };
  }
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
      const type = event[PF.EVENT_TYPE] === PF.BEAT ? 'beat' : event[PF.EVENT_TYPE] === PF.CONTROL ? 'control' : event[PF.EVENT_TYPE] === PF.FAULT ? 'fault' : event[PF.EVENT_TYPE] === PF.TEMPO_HIT ? 'tempo-hit' : 'state';
      const state = this.decode(event.subarray(PF.EVENT_STATE, PF.EVENT_CHANNELS), event.subarray(PF.EVENT_CHANNELS));
      const result: PracticeEvent = { v: 1, runId: this.runId, seq: event[PF.EVENT_SEQUENCE], type, state };
      if (event[PF.EVENT_FRAME] >= 0) { result.frame = event[PF.EVENT_FRAME]; result.sampleRate = event[PF.EVENT_RATE]; }
      if (event[PF.EVENT_ERROR]) result.error = this.message(event[PF.EVENT_ERROR]);
      if (type === 'control') {
        const id = event[PF.EVENT_CONTROL];
        result.control = id === 4 ? { id: 'mushroom' } : id === 5 ? { id: 'knob', value: event[PF.EVENT_VALUE] } : id === 6 ? { id: 'tempo' } : { id: CONTROL_IDS[id] };
        result.applied = event[PF.EVENT_APPLIED] === 1;
        const commandId = this.commandIds.get(result.seq);
        if (commandId) { result.commandId = commandId; this.commandIds.delete(result.seq); }
      }
      if (type === 'tempo-hit') result.tempoHit = { beatHint: event[PF.EVENT_VALUE] === 1 ? 1 : null,
        source: event[PF.EVENT_CONTROL] === 1 ? 'chart' : 'pedal', estimated: event[PF.EVENT_APPLIED] === 1 };
      if (event[PF.EVENT_CUE] >= 0) result.cueIndex = event[PF.EVENT_CUE];
      return result;
    });
  }
  process(input: Float32Array | null | undefined, outputs: Float32Array[], length: number, liveOutputs?: Float32Array[]) {
    for (let offset = 0; offset < length; offset += BLOCK) {
      const count = Math.min(BLOCK, length - offset);
      if (input) { const block = input.subarray(offset, offset + count); this.sampler.input.set(block); this.sampler.input.fill(0, block.length, count); }
      this.sampler.left.fill(0, 0, count); this.sampler.right.fill(0, 0, count);
      if (liveOutputs) {
        this.liveLeft.fill(0, 0, count); this.liveRight.fill(0, 0, count);
        this.call('pf_process_stems', this.handle, input ? this.sampler.inputPointer : 0,
          this.sampler.leftPointer, outputs[1] ? this.sampler.rightPointer : 0,
          liveOutputs[0] ? this.liveLeftPointer : 0, liveOutputs[1] ? this.liveRightPointer : 0, count);
        liveOutputs[0]?.set(this.liveLeft.subarray(0, count), offset);
        liveOutputs[1]?.set(this.liveRight.subarray(0, count), offset);
      } else {
        this.call('pf_process', this.handle, input ? this.sampler.inputPointer : 0, this.sampler.leftPointer, outputs[1] ? this.sampler.rightPointer : 0, count);
      }
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
