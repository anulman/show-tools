import { PerformanceProcessor } from './runtime/performance-worklet.js';
import { PracticeEngine } from './practice-engine.js';
import type { EventDetails, EventType } from './practice-engine.js';
import { CONTROL_IDS } from '../../lib/performance/model.js';
import type { ChannelId, ChannelSettings, ChartControls, Control, CueAction, PadLight, PracticeEvent, PracticeState, RecordingState, StartOptions } from '../../lib/performance/model.js';

type ExecutableCue = Extract<CueAction, { timing: 'now' | 'bar' }>;
type PendingCue = { action: ExecutableCue; targetBeatId: number };

type PracticeMessage = { id: number } & (
  | { command: 'practice.start'; payload: StartOptions & { runId: string } }
  | { command: 'practice.stop'; payload?: object }
  | { command: 'practice.control'; payload: { control: Control; commandId?: string } }
  | { command: 'practice.channel'; payload: { channelId: ChannelId; settings: ChannelSettings } }
  | { command: 'practice.select'; payload: { channelId: ChannelId } }
  | { command: 'practice.automatic' | 'practice.click' | 'practice.microphone'; payload: { enabled: boolean } }
);

export class PracticeProcessor extends PerformanceProcessor {
  declare practice: PracticeEngine;
  declare microphoneReady: boolean;
  declare suppressedChannels: Set<ChannelId>;
  declare appliedCommands: Map<string, string>;
  declare controls: ChartControls | undefined;
  declare pendingCues: Map<ChannelId, PendingCue>;
  declare resumeLoops: Map<ChannelId, number>;
  declare clockBeatId: number;
  declare clockBeatFrame: number;
  declare usedCues: Set<ChannelId>;
  declare tapPositions: Map<ChannelId, number>;

  initializeOutput(options: { practice?: ConstructorParameters<typeof PracticeEngine>[0] }) {
    super.initializeOutput(options);
    this.practice = new PracticeEngine(options.practice);
    this.controls = options.practice?.program?.controls;
    this.tapPositions = new Map();
    this.pendingCues = new Map();
    this.resumeLoops = new Map();
    this.clockBeatId = 0;
    this.clockBeatFrame = 0;
    this.usedCues = new Set();
    this.microphoneReady = false;
    this.suppressedChannels = new Set();
    this.appliedCommands = new Map();
    const commit = this.recorder.commit.bind(this.recorder);
    this.recorder.commit = (slot, reason) => {
      commit(slot, reason);
      if (reason === 'limit' && slot.frames > 0 && this.practice.phase === 'playing') {
        this.sequencer.cancelRecording(slot.id);
        this.sampler.trigger(slot.id, slot.startFrame + slot.frames, 1, { loop: true });
      }
    };
    for (const id of CONTROL_IDS) this.sampler.setChannel(id, { gain: 0.8 });
  }

  practiceState(): PracticeState {
    const looping = CONTROL_IDS.filter(id => this.sampler.voices.some(voice => voice.sample?.id === id && voice.loop));
    const channels = CONTROL_IDS.map(id => {
      const channel = this.sampler.channels.get(id);
      const ready = this.sampler.has(id);
      const queued = this.pendingCues.get(id)?.action;
      const status: PracticeState['channels'][number]['status'] = queued?.kind === 'arm' ? 'armed'
        : queued?.kind === 'commit' || queued?.kind === 'commit-arm' ? 'stopping'
        : this.recorder.isRecording(id) ? 'recording' : looping.includes(id) ? 'looping' : ready ? 'ready' : 'empty';
      const active = looping.includes(id);
      const pending = this.pendingCues.get(id);
      let light: PadLight = { kind: 'off' };
      if (active && pending?.action.kind === 'stop') {
        const frames = (pending.targetBeatId - this.clockBeatId) * sampleRate * 60 / this.practice.bpm
          - (this.processedFrames - this.clockBeatFrame);
        light = { kind: 'releasing', remainingMs: Math.max(0, frames * 1000 / sampleRate) };
      } else if (active || pending || this.recorder.isRecording(id)) light = { kind: 'steady' };
      else if (!this.usedCues.has(id) && !['none', 'unsupported'].includes(this.currentCue(id).kind)) light = { kind: 'cue' };
      return { id, gain: channel?.gain ?? 0.8, muted: channel?.muted ?? false,
        looping: active, ready, status, light };
    });
    const active = channels.find(channel => channel.status === 'armed' || channel.status === 'recording' || channel.status === 'stopping');
    const recording: RecordingState | null = active && (active.status === 'armed' || active.status === 'recording' || active.status === 'stopping')
      ? { id: active.id, status: active.status } : null;
    return { ...this.practice.snapshot(), channels, looping, recording, microphone: this.microphoneReady, error: null };
  }

  performanceState() {
    return { ...super.performanceState(), practice: this.practiceState() };
  }

  publishPractice(type: EventType, details: EventDetails = {}) {
    const event: PracticeEvent = { ...this.practice.event(type, details), state: this.practiceState() };
    this.performancePort?.postMessage({ event, state: this.performanceState() });
  }

  silence() {
    this.sequencer.stop();
    this.pendingCues.clear();
    this.resumeLoops.clear();
    this.usedCues.clear();
    this.tapPositions.clear();
    this.recorder.stopAll('stopped');
    this.sampler.stopAll();
    this.clickEnabled = false;
    this.clickStartFrame = -Infinity;
  }

  syncClick() {
    this.clickEnabled = this.practice.phase === 'count-in' || (this.practice.phase === 'playing' && this.practice.click);
    if (!this.clickEnabled) this.clickStartFrame = -Infinity;
  }

  currentCue(id: ChannelId): CueAction {
    if (this.practice.phase === 'count-in') return this.controls?.leadIn[id] || { kind: 'none' };
    if (this.practice.phase === 'playing' && this.practice.bar !== null) {
      return this.controls?.bars[this.practice.bar - 1]?.[id] || { kind: 'none' };
    }
    return { kind: 'none' };
  }

  nextBarBeatId(): number {
    if (this.practice.lastBeatId === null) {
      return this.clockBeatId + 1 + (this.practice.phase === 'count-in' ? this.practice.countInBeats : 0);
    }
    if (this.practice.phase === 'count-in') return this.practice.lastBeatId + this.practice.countInRemaining;
    return this.practice.lastBeatId + this.practice.beatsPerBar - (this.practice.beat || 1) + 1;
  }

  executeCue(id: ChannelId, action: ExecutableCue, frame: number): void {
    switch (action.kind) {
      case 'arm':
        this.recorder.start(id, frame);
        this.suppressedChannels.delete(id);
        break;
      case 'commit':
      case 'commit-arm': {
        const committed = this.recorder.stop(id, frame);
        if (committed) {
          this.sampler.trigger(id, Math.ceil(frame), 1, { loop: true });
          this.suppressedChannels.delete(id);
        }
        if (action.kind === 'commit-arm') this.recorder.startNext(id, frame);
        break;
      }
      case 'stop':
        this.sequencer.silence(id);
        this.suppressedChannels.add(id);
        break;
      case 'play':
        this.sampler.trigger(id, Math.ceil(frame), 1, { loop: true });
        this.suppressedChannels.delete(id);
        break;
      default: {
        const exhaustive: never = action;
        throw new Error(`Unknown chart action ${String(exhaustive)}`);
      }
    }
  }

  pressPad(id: ChannelId): void {
    this.practice.selectChannel(id);
    const action = this.currentCue(id);
    if (action.kind === 'none') return;
    if (action.kind === 'unsupported') throw new Error(`Unsupported chart cue ${action.notation}`);
    if (action.kind === 'tap') {
      if (!this.sampler.has(id)) throw new Error('Capture or load a sample before playing this channel');
      const key = action.beats.join(',');
      const variant = this.sampler.hasVariant(id, key) ? key : undefined;
      if (variant === undefined && this.sampler.sliceSlots(id) > 0) {
        throw new Error('Capture this hit pattern before playing its chart cue.');
      }
      const sliceCount = this.sampler.sliceSlots(id, variant);
      const slice = sliceCount > 0 ? this.tapPositions.get(id) || 0 : undefined;
      if (slice !== undefined && !this.sampler.hasSlice(id, slice, variant)) {
        throw new Error(`Hit ${slice + 1} was not detected. Record this channel again near its charted beats.`);
      }
      if (this.sampler.voices.some(voice => voice.sample?.id === id && voice.loop)) {
        this.resumeLoops.set(id, this.nextBarBeatId());
      }
      this.sequencer.silence(id);
      this.sampler.trigger(id, this.processedFrames, 1, slice === undefined ? { trimStart: true } : { slice, variant });
      this.usedCues.add(id);
      if (slice !== undefined) this.tapPositions.set(id, (slice + 1) % sliceCount);
      return;
    }
    if (action.kind === 'stop' || action.kind === 'play' || action.kind === 'commit' || action.kind === 'commit-arm') {
      this.resumeLoops.delete(id);
    }
    const targetBeatId = action.timing === 'bar' ? this.nextBarBeatId() : this.clockBeatId;
    const previous = this.pendingCues.get(id);
    if (previous?.action.kind === action.kind && previous.targetBeatId === targetBeatId) return;
    if (action.kind === 'arm' || action.kind === 'commit-arm') {
      if (!this.microphoneReady) throw new Error('Enable the microphone before recording');
      const hint = action.capture;
      const framesPerBeat = sampleRate * 60 / this.practice.bpm;
      const options = { maxSeconds: 30, ...(hint ? { transients: {
        key: hint.beats.join(','),
        expectedFrames: hint.beats.map(beat => Math.round(beat * framesPerBeat)),
        radiusFrames: Math.round(hint.radiusBeats * framesPerBeat),
      } } : {}) };
      if (action.kind === 'arm') this.recorder.prepare(id, options);
      else {
        if (!this.recorder.isRecording(id)) throw new Error('This channel has no recording to commit');
        this.recorder.prepareNext(id, options);
      }
    } else if (action.kind === 'commit' && !this.recorder.isRecording(id)) {
      throw new Error('This channel has no recording to commit');
    } else if (action.kind === 'play' && !this.sampler.has(id)) {
      throw new Error('Capture or load a sample before playing this channel');
    }
    if (previous?.action.kind === 'commit-arm' && action.kind !== 'commit-arm') this.recorder.cancelNext(id);
    if (action.timing === 'bar') this.pendingCues.set(id, { action, targetBeatId });
    else {
      this.pendingCues.delete(id);
      this.executeCue(id, action, this.processedFrames);
    }
    this.usedCues.add(id);
  }

  applyControl(control: Control) {
    if (!control || typeof control !== 'object') throw new Error('A control is required');
    switch (control.id) {
      case 'L1':
      case 'L2':
      case 'R1':
      case 'R2':
        this.pressPad(control.id);
        break;
      case 'mushroom':
        this.practice.stop();
        this.silence();
        break;
      case 'knob':
        if (!Number.isFinite(control.value)) throw new Error('Knob value must be between zero and one');
        this.sampler.setChannel(this.practice.selectedChannel, { gain: control.value });
        break;
      default: {
        const exhaustive: never = control;
        throw new Error(`Unknown control ${String(exhaustive)}`);
      }
    }
  }

  command(message: PracticeMessage) {
    const { id, command } = message;
    if (!command?.startsWith('practice.')) return super.command(message);
    try {
      if (this.disposed) throw new Error('Practice audio is disposed');
      switch (command) {
        case 'practice.start':
          this.practice.start(message.payload);
          this.silence();
          this.suppressedChannels.clear();
          this.syncClick();
          break;
        case 'practice.stop': this.practice.stop(); this.silence(); break;
        case 'practice.control': {
          const payload = message.payload;
          const commandId = payload.commandId;
          if (commandId !== undefined && (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 200)) {
            throw new Error('Command ID must be a nonempty string of at most 200 characters');
          }
          const signature = JSON.stringify(payload.control);
          if (commandId && this.appliedCommands.has(commandId)) {
            if (this.appliedCommands.get(commandId) !== signature) throw new Error('Command ID was already used for another control');
          } else {
            this.applyControl(payload.control);
            if (commandId) {
              this.appliedCommands.set(commandId, signature);
              const oldestCommand = this.appliedCommands.keys().next().value;
              if (this.appliedCommands.size > 256 && oldestCommand) this.appliedCommands.delete(oldestCommand);
            }
          }
          break;
        }
        case 'practice.channel':
          if (!CONTROL_IDS.includes(message.payload.channelId)) throw new Error('Unknown channel');
          this.sampler.setChannel(message.payload.channelId, message.payload.settings);
          break;
        case 'practice.select': this.practice.selectChannel(message.payload.channelId); break;
        case 'practice.automatic': this.practice.setAutomatic(message.payload.enabled); break;
        case 'practice.click':
          this.practice.setClick(message.payload.enabled);
          this.syncClick();
          break;
        case 'practice.microphone':
          if (typeof message.payload.enabled !== 'boolean') throw new Error('Microphone state must be boolean');
          this.microphoneReady = message.payload.enabled;
          if (!message.payload.enabled) {
            for (const arm of this.sequencer.snapshot().recordArms) this.sequencer.cancelRecording(arm.sampleId);
            this.pendingCues.clear();
            this.resumeLoops.clear();
            this.recorder.stopAll('microphone-off');
          }
          break;
        default: {
          const exhaustive: never = message;
          throw new Error(`Unknown practice command ${String(exhaustive)}`);
        }
      }
      this.publishPractice(command === 'practice.control' ? 'control' : 'state',
        message.command === 'practice.control' ? { control: message.payload.control, applied: true,
          ...(message.payload.commandId ? { commandId: message.payload.commandId } : {}) } : {});
      this.performancePort?.postMessage({ id, ok: true, state: this.performanceState() });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (message.command === 'practice.control' && message.payload.commandId) {
        this.publishPractice('control', { control: message.payload.control, commandId: message.payload.commandId, applied: false, error: errorMessage });
      }
      this.performancePort?.postMessage({ id, ok: false, error: errorMessage, state: this.performanceState() });
    }
  }

  onBeat(id: number, frame: number, epoch: number) {
    this.clockBeatId = id;
    this.clockBeatFrame = frame;
    const result = this.practice.onBeat(id, epoch);
    this.syncClick();
    if (result && !result.stopped && result.downbeat) {
      this.tapPositions.clear();
      this.usedCues.clear();
      this.activeClick = this.clicks[1];
      if (this.practice.positionBeat === 0 || this.practice.countInElapsed === 1) this.sequencer.markOne();
    } else this.activeClick = this.clicks[0];
    super.onBeat(id, frame, epoch);
    if (!result) return;
    if (!result.stopped) for (const [channelId, resumeBeatId] of this.resumeLoops) {
      if (id < resumeBeatId) continue;
      this.resumeLoops.delete(channelId);
      this.sampler.trigger(channelId, Math.ceil(frame), 1, { loop: true });
    }
    if (!result.stopped) for (const [channelId, pending] of this.pendingCues) {
      if (id < pending.targetBeatId) continue;
      this.pendingCues.delete(channelId);
      this.executeCue(channelId, pending.action, frame);
    }
    if (result.stopped) this.silence();
    else for (const trigger of result.triggers) {
      const sampleId = trigger.sampleId;
      const looping = this.sampler.voices.some(voice => voice.sample?.id === sampleId && voice.loop);
      if (this.sampler.has(sampleId) && !looping && !this.suppressedChannels.has(sampleId) && !this.recorder.isRecording(sampleId)
        && this.sequencer.recordArms.get(sampleId)?.action !== 'start') {
        this.sampler.trigger(sampleId, frame, trigger.gain ?? 1);
      }
    }
    this.publishPractice(result.fault ? 'fault' : 'beat', { frame, sampleRate, ...(result.fault ? { error: result.fault } : {}) });
  }

  onTimelineReset(epoch: number, beatId: number) {
    super.onTimelineReset(epoch, beatId);
    this.practice?.stop();
    this.pendingCues?.clear();
    this.resumeLoops?.clear();
    this.clockBeatId = beatId;
    this.clickEnabled = false;
    this.clickStartFrame = -Infinity;
  }
}

registerProcessor('practice', PracticeProcessor);
