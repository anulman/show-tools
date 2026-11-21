import { PerformanceProcessor } from './runtime/performance-worklet.js';
import type { ChannelId, ChannelSettings, Control, LiveEffectDefinition, VoiceEffectConfiguration, StartOptions } from '../../lib/performance/model.js';
import type { TunerCommand, TuningBankOptions } from '../../lib/tuner/model.js';
import type { InputAttachArgs, InputEventArgs, InputRevokeArgs } from './musical-input-policy.js';

type PracticeMessage = { id: number } & (
  | { command: 'practice.start'; payload: StartOptions & { runId: string } }
  | { command: 'practice.stop'; payload?: object }
  | { command: 'practice.audition-tambourine'; payload: { velocity: number; slot?: number } }
  | { command: 'practice.take-audio'; payload: import('../../lib/performance/take-audio.js').TakeAudioRequest }
  | { command: 'practice.peripheral-lights'; payload: { enabled: boolean } }
  | { command: 'practice.jiggle'; payload: { minimumTravel: number; minimumReversal: number } }
  | { command: 'practice.external-wav'; payload: { slot: number; bytes: Uint8Array } }
  | { command: 'practice.tuning-bank'; payload: { options: TuningBankOptions } }
  | { command: 'practice.tuner'; payload: { command: TunerCommand } }
  | { command: 'practice.effects'; payload: { effects: readonly LiveEffectDefinition[] } }
  | { command: 'practice.voice-effects'; payload: { configurations: readonly VoiceEffectConfiguration[] } }
  | { command: 'practice.control'; payload: { control: Control; commandId?: string } }
  | { command: 'practice.input-attach'; payload: InputAttachArgs }
  | { command: 'practice.input-event'; payload: InputEventArgs }
  | { command: 'practice.input-revoke'; payload: InputRevokeArgs }
  | { command: 'practice.channel'; payload: { channelId: ChannelId; settings: ChannelSettings } }
  | { command: 'practice.select'; payload: { channelId: ChannelId } }
  | { command: 'practice.automatic' | 'practice.click' | 'practice.microphone'; payload: { enabled: boolean } }
);

export class PracticeProcessor extends PerformanceProcessor {
  peripheralLights = false;
  private readonly inputProducers = new Map<InputAttachArgs['kind'], { producer: number; session: number; bindingGeneration: number }>();
  private inputAttach(args: InputAttachArgs) {
    const routing = this.native.inputRouting();
    if (routing.bindingGeneration !== args.bindingGeneration) throw new Error('Input binding generation changed');
    const previous = this.inputProducers.get(args.kind);
    if (previous && routing.producers.some(value => value.producer === previous.producer && value.session === previous.session))
      throw new Error('This input role is already attached');
    this.inputProducers.delete(args.kind);
    const current = routing;
    const producer = Array.from({ length: 32 }, (_, index) => index).find(index => !current.producers.some(value => value.producer === index));
    if (producer === undefined) throw new Error('Native input producer table is full');
    if (current.sessionHighWatermark >= Number.MAX_SAFE_INTEGER) throw new Error('Native input sessions exhausted');
    const session = current.sessionHighWatermark + 1;
    this.native.inputAttach({ producer, session, bindingGeneration: args.bindingGeneration, kind: args.kind,
      releasedMask: args.releasedMask, heldMask: args.heldMask });
    this.inputProducers.set(args.kind, { producer, session, bindingGeneration: args.bindingGeneration });
  }
  private inputEvent(args: InputEventArgs) {
    const owner = this.inputProducers.get(args.kind);
    if (!owner || owner.bindingGeneration !== args.bindingGeneration) throw new Error('Input producer is not attached to these bindings');
    this.native.inputEvent({ ...owner, sequence: args.sequence, input: args.input, value: args.value });
  }
  private inputRevoke(args: InputRevokeArgs) {
    const owner = this.inputProducers.get(args.kind);
    if (!owner) return;
    const active = this.native.inputRouting().producers.some(value => value.producer === owner.producer && value.session === owner.session);
    if (active) this.native.inputRevoke({ producer: owner.producer, session: owner.session });
    this.inputProducers.delete(args.kind);
  }
  nativeMode() { return 2; }
  practiceState() { return this.native.state(); }
  performanceState() { return { ...super.performanceState(), practice: this.native.state(), takeAudioToken: this.native.takeAudioToken(), tuner: this.native.tunerState(), tuningBank: this.native.tuningBankState() }; }
  publishNativeEvents() {
    if (this.peripheralLights) this.performancePort?.postMessage({ lights: Array.from(this.native.lightOutput()) });
    for (const event of this.native.events()) {
      const contextFrame = event.type === 'beat' && event.frame !== undefined ? this.frameOrigin + event.frame : undefined;
      this.performancePort?.postMessage({ event, contextFrame, state: this.performanceState() });
    }
  }
  command(message: PracticeMessage) {
    const { id, command } = message;
    if (!command?.startsWith('practice.')) return super.command(message);
    try {
      if (this.disposed) throw new Error('Practice audio is disposed');
      if (command === 'practice.take-audio') {
        const value = this.native.takeAudio(message.payload);
        this.performancePort?.postMessage({ id, ok: true, value }, [value.buffer]);
        return;
      }
      switch (command) {
        case 'practice.start': this.native.start(message.payload); break;
        case 'practice.audition-tambourine': this.native.auditionTambourine(message.payload.velocity, message.payload.slot); break;
        case 'practice.stop': this.native.stop(); break;
        case 'practice.peripheral-lights': this.peripheralLights = message.payload.enabled; break;
        case 'practice.jiggle': this.native.setJiggleThresholds(message.payload.minimumTravel, message.payload.minimumReversal); break;
        case 'practice.external-wav': this.native.prepareExternalWav(message.payload.slot, message.payload.bytes); break;
        case 'practice.tuning-bank': this.native.prepareTuningBank(message.payload.options); break;
        case 'practice.tuner': this.native.tunerCommand(message.payload.command); break;
        case 'practice.effects': this.native.prepareLiveEffects(message.payload.effects); break;
        case 'practice.voice-effects': this.native.prepareVoiceEffects(message.payload.configurations); break;
        case 'practice.control': this.native.control(message.payload.control, message.payload.commandId); break;
        case 'practice.input-attach': this.inputAttach(message.payload); break;
        case 'practice.input-event': this.inputEvent(message.payload); break;
        case 'practice.input-revoke': this.inputRevoke(message.payload); break;
        case 'practice.channel': this.native.setChannel(message.payload.channelId, message.payload.settings); break;
        case 'practice.select': this.native.selectChannel(message.payload.channelId); break;
        case 'practice.automatic': this.native.setAutomatic(message.payload.enabled); break;
        case 'practice.click': this.native.setClick(message.payload.enabled); break;
        case 'practice.microphone': this.native.setMicrophone(message.payload.enabled); break;
        default: { const exhaustive: never = message; throw new Error(`Unknown practice command ${String(exhaustive)}`); }
      }
      this.publishNativeEvents();
      this.performancePort?.postMessage({ id, ok: true, state: this.performanceState() });
    } catch (error) {
      this.publishNativeEvents();
      this.performancePort?.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error), state: this.performanceState() });
    }
  }
}

registerProcessor('practice', PracticeProcessor);
