import { PerformanceProcessor } from './runtime/performance-worklet.js';
import type { ChannelId, ChannelSettings, Control, StartOptions } from '../../lib/performance/model.js';

type PracticeMessage = { id: number } & (
  | { command: 'practice.start'; payload: StartOptions & { runId: string } }
  | { command: 'practice.stop'; payload?: object }
  | { command: 'practice.control'; payload: { control: Control; commandId?: string } }
  | { command: 'practice.channel'; payload: { channelId: ChannelId; settings: ChannelSettings } }
  | { command: 'practice.select'; payload: { channelId: ChannelId } }
  | { command: 'practice.automatic' | 'practice.click' | 'practice.microphone'; payload: { enabled: boolean } }
);

export class PracticeProcessor extends PerformanceProcessor {
  nativeMode() { return 2; }
  practiceState() { return this.native.state(); }
  performanceState() { return { ...super.performanceState(), practice: this.native.state() }; }
  publishNativeEvents() {
    for (const event of this.native.events()) this.performancePort?.postMessage({ event, state: this.performanceState() });
  }
  command(message: PracticeMessage) {
    const { id, command } = message;
    if (!command?.startsWith('practice.')) return super.command(message);
    try {
      if (this.disposed) throw new Error('Practice audio is disposed');
      switch (command) {
        case 'practice.start': this.native.start(message.payload); break;
        case 'practice.stop': this.native.stop(); break;
        case 'practice.control': this.native.control(message.payload.control, message.payload.commandId); break;
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
