import { BeatTracker } from './runtime/beat-tracker.js';
import { AudioEndpoint } from '../../lib/sampler/audio-endpoint.js';
import { Sampler } from '../../lib/sampler/sampler.js';
import { CONTROL_IDS } from '../../lib/performance/model.js';
import type { ChannelId, ChannelSettings, Chart, ChartMetadata, Control, PracticeEvent, PracticeState, Program, StartOptions } from '../../lib/performance/model.js';

type AudioOptions = { chart: Chart; program?: Program };
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
  readonly listeners = new Set<(state: PracticeState) => void>();
  readonly eventListeners = new Set<(event: PracticeEvent) => void>();
  readonly onMessage: (event: MessageEvent<{ event?: PracticeEvent }>) => void;
  readonly detachState: () => void;
  readonly detachTracker: () => void;
  latest: PracticeState;
  error: string | null = null;
  microphone = false;
  recordingVoice: { stream: MediaStream; node: MediaStreamAudioSourceNode } | null = null;
  disposed = false;
  runCounter = 0;
  startGeneration = 0;

  static async create({ chart, program }: AudioOptions) {
    if (!chart?.bars?.length) throw new Error('A parsed chart is required');
    let audio: PracticeAudio | undefined;
    let tracker: BeatTracker | undefined;
    const sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      tracker = await BeatTracker.create({ startingBpm: chart.bpm,
        wasmUrl: new URL('./wasm/manual-clock.wasm', import.meta.url),
        workletUrl: new URL('./practice-worklet.js', import.meta.url), processorName: 'practice', outputChannels: 2,
        processorOptions: { practice: { bpm: chart.bpm, beatsPerBar: chart.beatsPerBar, runId: `${sessionId}-ready`,
          barCount: chart.bars.length, endBar: chart.annotatedThroughBar || chart.bars.length, program } } });
      await tracker.setManual();
      const channel = new MessageChannel();
      tracker.node.port.postMessage({ type: 'performance-connect', port: channel.port2 }, [channel.port2]);
      const endpoint = new AudioEndpoint(channel.port1);
      audio = new PracticeAudio({ tracker, endpoint, chart, sessionId });
      await endpoint.request('state');
      return audio;
    } catch (error) {
      if (audio) await audio.dispose();
      else await tracker?.dispose();
      throw error;
    }
  }

  constructor({ tracker, endpoint, chart, sessionId }: AdapterOptions) {
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
    tracker.node.connect(this.recordDestination);
    this.outputStream = this.recordDestination.stream;
    this.chartMetadata = { spreadsheetId: chart.spreadsheetId, sheetId: chart.sheetId,
      columns: chart.bars.map(bar => bar.column), leadInColumn: chart.leadInColumn };
    this.onMessage = ({ data }) => {
      if (!data?.event) return;
      const event = { ...data.event, state: { ...data.event.state, chart: this.chartMetadata } };
      if (event.type === 'fault') this.fail(new Error(event.error || 'The performance stopped'));
      for (const listener of this.eventListeners) {
        try { listener(event); } catch (error) { globalThis.reportError?.(error); }
      }
    };
    endpoint.port.addEventListener('message', this.onMessage);
    this.detachState = endpoint.subscribe(state => {
      if (!state.practice) return;
      this.latest = state.practice;
      this.publish();
    });
    this.detachTracker = tracker.subscribe(state => {
      const wasMicrophone = this.microphone;
      this.microphone = state.source?.kind === 'microphone';
      this.syncRecordingVoice();
      if (wasMicrophone && !this.microphone && !this.disposed) {
        endpoint.request('practice.microphone', { enabled: false }).catch(error => this.fail(error));
      }
      if (state.lifecycle === 'faulted') this.fail(new Error(state.error || 'Audio processing stopped'));
      this.publish();
    });
  }

  syncRecordingVoice() {
    const stream = this.disposed ? null : this.tracker.microphoneStream;
    if (this.recordingVoice?.stream === stream) return;
    this.recordingVoice?.node.disconnect();
    this.recordingVoice = null;
    if (!stream) return;
    const node = this.tracker.context.createMediaStreamSource(stream);
    node.connect(this.recordDestination);
    this.recordingVoice = { stream, node };
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
    await this.tracker.setManualBpm(bpm);
    if (generation !== this.startGeneration) return this.snapshot();
    return this.request('practice.start', { ...options, bpm, runId: `${this.sessionId}-${++this.runCounter}` });
  }

  stop() { this.startGeneration++; return this.request('practice.stop'); }
  control(control: Control, options: { commandId?: string } | string = {}) {
    if (control?.id === 'mushroom') this.startGeneration++;
    const commandId = typeof options === 'string' ? options : options.commandId;
    return this.request('practice.control', { control, commandId });
  }
  setChannel(channelId: ChannelId, settings: ChannelSettings) { return this.request('practice.channel', { channelId, settings }); }
  selectChannel(channelId: ChannelId) { return this.request('practice.select', { channelId }); }
  setAutomatic(enabled: boolean) { return this.request('practice.automatic', { enabled }); }
  setClick(enabled: boolean) { return this.request('practice.click', { enabled }); }

  async enableMicrophone() {
    try {
      await this.tracker.startListening();
      await this.request('practice.microphone', { enabled: true });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async disableMicrophone() {
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
    this.disposed = true;
    this.syncRecordingVoice();
    this.detachState?.();
    this.detachTracker?.();
    this.endpoint.port.removeEventListener('message', this.onMessage);
    this.recordDestination.stream.getTracks().forEach(track => track.stop());
    this.tracker.node.disconnect();
    this.recordDestination.disconnect();
    this.endpoint.dispose();
    await Promise.all([this.sampler.dispose(), this.tracker.dispose()]);
    this.listeners.clear();
    this.eventListeners.clear();
  }
}
