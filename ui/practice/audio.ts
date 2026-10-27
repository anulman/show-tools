import { BeatTracker } from './runtime/beat-tracker.js';
import { AudioEndpoint } from '../../lib/sampler/audio-endpoint.js';
import { Sampler } from '../../lib/sampler/sampler.js';
import { CONTROL_IDS } from '../../lib/performance/model.js';
import { encodeCompiledProgram } from '../../lib/performance/compiled-native.js';
import type { CompiledSong } from '../../lib/performance/compiled-song.js';
import type { ChannelId, ChannelSettings, Chart, ChartMetadata, Control, PracticeEvent, PracticeState, Program, StartOptions, LiveEffectDefinition } from '../../lib/performance/model.js';

export type MonitoringRelationship = 'unknown' | 'different-devices' | 'same-usb-interface' | 'same-non-usb';
type MonitoringConfirmation = { kind: 'unconfirmed' } | { kind: 'confirmed'; stream: MediaStream; relationship: Exclude<MonitoringRelationship, 'unknown'> };

type AudioOptions = { chart: Chart; program?: Program; compiled?: CompiledSong };
type AdapterOptions = AudioOptions & { tracker: BeatTracker; endpoint: AudioEndpoint; sessionId: string };

export class PracticeAudio {
  readonly tracker: BeatTracker;
  readonly endpoint: AudioEndpoint;
  readonly chart: Chart;
  readonly sampler: Sampler;
  readonly sessionId: string;
  readonly chartMetadata: ChartMetadata;
  readonly outputStream: MediaStream;
  readonly recordDestination: MediaStreamAudioDestinationNode;
  readonly liveMonitor: GainNode;
  readonly listeners = new Set<(state: PracticeState) => void>();
  readonly eventListeners = new Set<(event: PracticeEvent) => void>();
  readonly onMessage: (event: MessageEvent<{ event?: PracticeEvent }>) => void;
  readonly detachState: () => void;
  readonly detachTracker: () => void;
  readonly onDeviceChange: () => void;
  latest: PracticeState;
  error: string | null = null;
  microphone = false;
  monitoring: MonitoringConfirmation = { kind: 'unconfirmed' };
  disposed = false;
  runCounter = 0;
  startGeneration = 0;
  microphoneGeneration = 0;

  static async create({ chart, program, compiled }: AudioOptions) {
    if (!chart?.bars?.length) throw new Error('A parsed chart is required');
    let audio: PracticeAudio | undefined;
    let tracker: BeatTracker | undefined;
    const sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      tracker = await BeatTracker.create({
        wasmUrl: new URL('./wasm/manual-clock.wasm', import.meta.url),
        workletUrl: new URL('./practice-worklet.js', import.meta.url), processorName: 'practice', outputChannelCounts: [2, 2],
        processorOptions: { practice: { bpm: chart.bpm, beatsPerBar: chart.beatsPerBar, runId: `${sessionId}-ready`,
          barCount: chart.bars.length, endBar: chart.annotatedThroughBar || chart.bars.length, program,
          compiledProgram: compiled ? Array.from(encodeCompiledProgram(compiled)) : undefined } } });
      const channel = new MessageChannel();
      tracker.node.port.postMessage({ type: 'performance-connect', port: channel.port2 }, [channel.port2]);
      const endpoint = new AudioEndpoint(channel.port1);
      audio = new PracticeAudio({ tracker, endpoint, chart, compiled, sessionId });
      await endpoint.request('state');
      return audio;
    } catch (error) {
      if (audio) await audio.dispose();
      else await tracker?.dispose();
      throw error;
    }
  }

  constructor({ tracker, endpoint, chart, compiled, sessionId }: AdapterOptions) {
    this.tracker = tracker;
    this.endpoint = endpoint;
    this.chart = chart;
    this.sampler = new Sampler({ audioContext: tracker.context, endpoint });
    this.latest = { phase: 'idle', bar: null, beat: null, countInRemaining: 0, bpm: chart.bpm,
      startBar: 1, endBar: chart.annotatedThroughBar || chart.bars.length, loop: true, automatic: true, click: false,
      selectedChannel: 'R1', runId: `${sessionId}-ready`, seq: 0, channels: CONTROL_IDS.map(id => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })),
      looping: [], recording: null, microphone: false, error: null };
    this.sessionId = sessionId;
    this.recordDestination = tracker.context.createMediaStreamDestination();
    tracker.node.connect(this.recordDestination, 0);
    tracker.node.connect(this.recordDestination, 1);
    this.liveMonitor = tracker.context.createGain();
    this.liveMonitor.gain.value = 0;
    this.liveMonitor.channelCount = 2;
    this.liveMonitor.channelCountMode = 'explicit';
    tracker.node.connect(this.liveMonitor, 1);
    this.liveMonitor.connect(tracker.context.destination);
    this.outputStream = this.recordDestination.stream;
    this.onDeviceChange = () => { this.clearMonitoring(); this.publish(); };
    globalThis.navigator?.mediaDevices?.addEventListener('devicechange', this.onDeviceChange);
    tracker.context.addEventListener?.('sinkchange', this.onDeviceChange);
    this.chartMetadata = { spreadsheetId: chart.spreadsheetId, sheetId: chart.sheetId,
      columns: chart.bars.map(bar => bar.column), leadInColumn: chart.leadInColumn };
    this.onMessage = ({ data }) => {
      if (!data?.event) return;
      const event = { ...data.event, state: { ...data.event.state, chart: this.chartMetadata } };
      const cue = event.cueIndex === undefined ? undefined : compiled?.cues[event.cueIndex];
      if (cue && event.error) event.error = `${cue.source.a1} ${cue.source.text}: ${event.error}`;
      if (event.type === 'fault') this.fail(new Error(event.error || 'The performance stopped'));
      for (const listener of this.eventListeners) {
        try { listener(event); } catch (error) { globalThis.reportError?.(error); }
      }
    };
    endpoint.port.addEventListener('message', this.onMessage);
    this.detachState = endpoint.subscribe(state => {
      if (!state.practice) return;
      this.latest = state.practice;
      this.syncMonitoring();
      this.publish();
    });
    this.detachTracker = tracker.subscribe(state => {
      const wasMicrophone = this.microphone;
      this.microphone = state.source?.kind === 'microphone';
      this.syncMonitoring();
      if (wasMicrophone && !this.microphone && !this.disposed) {
        endpoint.request('practice.microphone', { enabled: false }).catch(error => this.fail(error));
      }
      if (state.lifecycle === 'faulted') { this.clearMonitoring(); this.fail(new Error(state.error || 'Audio processing stopped')); }
      this.publish();
    });
  }

  get monitoringRelationship(): MonitoringRelationship {
    return this.monitoring.kind === 'confirmed' ? this.monitoring.relationship : 'unknown';
  }

  clearMonitoring() {
    this.monitoring = { kind: 'unconfirmed' };
    if (this.liveMonitor) this.liveMonitor.gain.value = 0;
  }

  syncMonitoring() {
    const stream = this.disposed ? null : this.tracker.microphoneStream;
    if (this.monitoring.kind === 'confirmed' && this.monitoring.stream !== stream) this.clearMonitoring();
    const eligible = this.monitoring.kind === 'confirmed'
      && (this.monitoring.relationship === 'different-devices' || this.monitoring.relationship === 'same-usb-interface');
    this.liveMonitor.gain.value = Number(eligible && Boolean(stream) && this.latest.liveEffects?.active === true && !this.disposed);
  }

  setMonitoringRelationship(relationship: MonitoringRelationship) {
    if (!['unknown', 'different-devices', 'same-usb-interface', 'same-non-usb'].includes(relationship)) throw new Error('Unknown monitoring setup');
    this.clearMonitoring();
    if (relationship !== 'unknown') {
      const stream = this.tracker.microphoneStream;
      if (!stream || this.disposed) throw new Error('Start the microphone before confirming the monitoring setup');
      this.monitoring = { kind: 'confirmed', stream, relationship };
    }
    this.syncMonitoring();
    this.publish();
  }

  snapshot(): PracticeState {
    return { ...this.latest, microphone: this.microphone || false, error: this.error,
      lifecycle: this.tracker.lifecycle, chart: this.chartMetadata };
  }

  subscribe(listener: (state: PracticeState) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: (event: PracticeEvent) => void) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  publish() {
    if (this.disposed) return;
    const state = this.snapshot();
    for (const listener of this.listeners) {
      try { listener(state); } catch (error) { globalThis.reportError?.(error); }
    }
  }

  fail(error: unknown) {
    this.error = error instanceof Error ? error.message : String(error);
    this.publish();
  }

  async request(command: string, payload: object = {}) {
    if (this.disposed) throw new Error('Practice audio is disposed');
    try {
      this.error = null;
      await this.endpoint.request(command, payload);
      return this.snapshot();
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async start(options: StartOptions = {}) {
    if (this.latest?.phase === 'playing' || this.latest?.phase === 'count-in') throw new Error('Stop before starting another run');
    const bpm = Number(options.bpm ?? this.chart.bpm);
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('Tempo must be between 40 and 240 BPM');
    const generation = ++this.startGeneration;
    await this.tracker.resume();
    if (generation !== this.startGeneration) return this.snapshot();
    return this.request('practice.start', { ...options, bpm, runId: `${this.sessionId}-${++this.runCounter}` });
  }

  stop() { this.startGeneration++; this.microphoneGeneration++; this.clearMonitoring(); return this.request('practice.stop'); }
  control(control: Control, options: { commandId?: string } | string = {}) {
    if (control?.id === 'mushroom') { this.startGeneration++; this.microphoneGeneration++; this.clearMonitoring(); }
    const commandId = typeof options === 'string' ? options : options.commandId;
    return this.request('practice.control', { control, commandId });
  }
  configureLiveEffects(effects: readonly LiveEffectDefinition[]) { return this.request('practice.effects', { effects }); }
  setChannel(channelId: ChannelId, settings: ChannelSettings) { return this.request('practice.channel', { channelId, settings }); }
  selectChannel(channelId: ChannelId) { return this.request('practice.select', { channelId }); }
  setAutomatic(enabled: boolean) { return this.request('practice.automatic', { enabled }); }
  setClick(enabled: boolean) { return this.request('practice.click', { enabled }); }

  async setOutputDevice(deviceId: string) {
    if (this.latest.phase === 'playing' || this.latest.phase === 'count-in') throw new Error('Stop practice before changing the output device.');
    const context = this.tracker.context;
    if (!('setSinkId' in context) || typeof context.setSinkId !== 'function') {
      if (deviceId) throw new Error('This browser uses the system output device. Choose it in your operating system sound settings.');
      return;
    }
    this.clearMonitoring();
    await context.setSinkId(deviceId || 'default');
  }

  async enableMicrophone(options: { deviceId?: string } = {}) {
    if (this.disposed) throw new Error('Practice audio is disposed');
    const generation = ++this.microphoneGeneration;
    try {
      await this.tracker.startListening(options);
      if (this.disposed || generation !== this.microphoneGeneration || !this.tracker.microphoneStream) return generation;
      await this.request('practice.microphone', { enabled: true });
      return generation;
    } catch (error) {
      if (generation === this.microphoneGeneration) {
        await this.disableMicrophone(generation).catch(() => {});
        this.fail(error);
      }
      throw error;
    }
  }

  async disableMicrophone(expectedGeneration?: number) {
    if (expectedGeneration !== undefined && expectedGeneration !== this.microphoneGeneration) return;
    this.microphoneGeneration++;
    this.clearMonitoring();
    const [stopped, notified] = await Promise.allSettled([
      this.tracker.stopListening(),
      this.request('practice.microphone', { enabled: false }),
    ]);
    if (notified.status === 'rejected') throw notified.reason;
    if (stopped.status === 'rejected') throw stopped.reason;
  }

  async loadFile(id: ChannelId, file: File) {
    if (this.latest?.phase === 'playing' || this.latest?.phase === 'count-in') throw new Error('Stop before loading a sound');
    await this.sampler.loadFile(id, file);
  }

  async dispose() {
    if (this.disposed) return;
    this.startGeneration++;
    this.microphoneGeneration++;
    this.disposed = true;
    this.clearMonitoring();
    this.detachState?.();
    this.detachTracker?.();
    globalThis.navigator?.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
    this.tracker.context?.removeEventListener?.('sinkchange', this.onDeviceChange);
    this.endpoint.port.removeEventListener('message', this.onMessage);
    this.recordDestination.stream.getTracks().forEach(track => track.stop());
    this.tracker.node.disconnect();
    this.recordDestination.disconnect();
    this.liveMonitor?.disconnect();
    this.endpoint.dispose();
    await Promise.all([this.sampler.dispose(), this.tracker.dispose()]);
    this.listeners.clear();
    this.eventListeners.clear();
  }
}
