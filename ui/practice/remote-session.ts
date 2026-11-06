import { VOICE_PROFILE_COUNT } from '../../lib/performance/model.js';
import { decodeDeskBootstrap, decodeDeskPublication, decodeAudioDecision, decodeNativeOutcome } from './remote-schema.js';
import type { DeskView, NativePerformance, NativeTarget } from '../../lib/remote-performance/session-schema.js';
import type { ChannelId, ChannelSettings, Control, PracticeEvent, PracticeState, StartOptions, LiveEffectDefinition, VoiceEffectConfiguration } from '../../lib/performance/model.js';

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw new Error('Remote response is too large');
  return JSON.parse(text);
}

export type RemoteConnection =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected' }
  | { readonly kind: 'disconnected'; readonly error: string };

export class RemoteDesk {
  private readonly listeners = new Set<(view: DeskView) => void>();
  private readonly abort = new AbortController();
  private sequence = 0;
  private connectionState: RemoteConnection = { kind: 'connecting' };
  private disposed = false;
  private endpoint: RemoteSession | undefined;
  private constructor(private readonly token: string, private readonly sessionId: string, private latest: DeskView) { this.updateEndpoint(); }
  static async connect(token: string) {
    const response = await fetch('/api/session', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Remote desk failed (${response.status})`);
    const bootstrap = decodeDeskBootstrap(await readJson(response));
    return new RemoteDesk(token, bootstrap.sessionId, bootstrap.view);
  }
  snapshot() { return this.latest; }
  get connection(): RemoteConnection { return this.connectionState; }
  subscribe(listener: (view: DeskView) => void) { this.listeners.add(listener); listener(this.latest); return () => this.listeners.delete(listener); }
  performance() {
    if (this.connectionState.kind !== 'connected' || !this.endpoint) throw new Error('Hardware audio is unavailable. Enable audio and wait for ready.');
    return this.endpoint;
  }
  private updateEndpoint() {
    const audio = this.latest.audio;
    if (audio.kind !== 'ready') { this.endpoint?.invalidate(); this.endpoint = undefined; return; }
    if (!this.endpoint?.matches({ attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch })) {
      this.endpoint?.invalidate();
      this.endpoint = new RemoteSession(this, { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch }, audio.performance);
    } else this.endpoint.observe(audio.performance);
  }
  private observe(view: DeskView) {
    if (view.serverEpoch !== this.latest.serverEpoch) throw new Error('Desk server restarted. Reconnect to the desk.');
    if (BigInt(view.revision) < BigInt(this.latest.revision)) return;
    this.latest = view; this.updateEndpoint();
    for (const listener of this.listeners) listener(view);
  }
  private disconnect(error: unknown) {
    this.connectionState = { kind: 'disconnected', error: error instanceof Error ? error.message : String(error) };
    this.endpoint?.invalidate(); this.endpoint = undefined; this.abort.abort();
    if (!this.disposed) for (const listener of this.listeners) listener(this.latest);
  }
  async listen() {
    try {
      const response = await fetch('/api/events', { headers: { Authorization: `Bearer ${this.token}`, 'X-Session-Id': this.sessionId }, signal: this.abort.signal, cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error(`Remote events failed (${response.status})`);
      this.connectionState = { kind: 'connected' };
      this.observe(this.latest);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error('Remote connection closed. Reconnect to the desk.');
        pending = (pending + value).replace(/\r\n/g, '\n');
        if (pending.length > 8 * 1024 * 1024) throw new Error('Remote event frame is too large.');
        let end: number;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, end); pending = pending.slice(end + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const publication = decodeDeskPublication(JSON.parse(data));
          if (publication.type === 'gap') throw new Error('Remote events were lost. Reconnect to the desk.');
          if (publication.type === 'desk') this.observe(publication.view);
          else if (publication.type === 'event') {
            if (this.latest.audio.kind === 'ready' && publication.attempt === this.latest.audio.attempt) this.endpoint?.event(publication.event);
          } else {
            if (publication.serverEpoch !== this.latest.serverEpoch) throw new Error('Desk server restarted. Reconnect to the desk.');
            const audio = this.latest.audio;
            if (audio.kind === 'ready' && audio.attempt === publication.attempt && audio.performance.hostEpoch === publication.performance.hostEpoch)
              this.observe({ ...this.latest, revision: publication.revision, audio: { ...audio, performance: publication.performance } });
          }
        }
      }
    } catch (error) { if (!this.disposed) this.disconnect(error); }
  }
  private async post(route: string, body: object) {
    if (this.connectionState.kind !== 'connected' || this.disposed) throw new Error('Remote desk is disconnected. Reconnect to the desk.');
    const response = await fetch(route, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: this.sessionId, sequence: ++this.sequence, ...body }) });
    if (!response.ok) throw new Error(`Remote request failed (${response.status}); outcome unknown.`);
    return readJson(response);
  }
  private async setAudio(goal: 'on' | 'off') {
    const decision = decodeAudioDecision(await this.post('/api/audio', { goal }));
    this.observe(decision.view);
    if (decision.outcome === 'rejected') throw new Error(decision.error);
    return this.latest;
  }
  enableAudio() { return this.setAudio('on'); }
  terminateAudio() { return this.setAudio('off'); }
  async command(endpoint: RemoteSession, target: NativeTarget, command: string, args: object) {
    if (this.endpoint !== endpoint) throw new Error('Hardware audio session is stale.');
    let result: ReturnType<typeof decodeNativeOutcome>;
    try { result = decodeNativeOutcome(await this.post('/api/command', { target, command, args })); }
    catch (error) { endpoint.invalidate(); throw new Error('Remote command outcome unknown. Terminate audio before enabling it again.', { cause: error }); }
    if (result.outcome !== 'applied') {
      if (result.outcome === 'unknown') endpoint.invalidate();
      throw new Error(result.error || `Remote command ${result.outcome}`);
    }
    if (this.endpoint !== endpoint || result.hostEpoch !== target.hostEpoch) { endpoint.invalidate(); throw new Error('Hardware audio session is stale.'); }
    endpoint.observe(result);
    return endpoint.snapshot();
  }
  async dispose() { this.disposed = true; this.connectionState = { kind: 'disconnected', error: 'Detached from desk' }; this.abort.abort(); this.endpoint?.invalidate(); this.listeners.clear(); }
}

export class RemoteSession {
  private readonly listeners = new Set<(state: PracticeState) => void>();
  private readonly eventListeners = new Set<(event: PracticeEvent) => void>();
  readonly outputStream = undefined;
  readonly monitoringRelationship = 'unknown' as const;
  private valid = true;
  private latest: NativePerformance;
  constructor(private readonly desk: RemoteDesk, private readonly target: NativeTarget, performance: NativePerformance) { this.latest = performance; }
  matches(target: NativeTarget) { return this.valid && target.attempt === this.target.attempt && target.hostEpoch === this.target.hostEpoch; }
  invalidate() { this.valid = false; this.listeners.clear(); this.eventListeners.clear(); }
  observe(performance: NativePerformance) {
    if (!this.valid || performance.hostEpoch !== this.target.hostEpoch || BigInt(performance.revision) <= BigInt(this.latest.revision)) return;
    this.latest = performance; for (const listener of this.listeners) listener(performance.state);
  }
  event(event: PracticeEvent) { for (const listener of this.eventListeners) listener(event); }
  get microphone() { return this.latest.state.microphone; }
  snapshot() { return this.latest.state; }
  subscribe(listener: (state: PracticeState) => void) { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener); }
  onEvent(listener: (event: PracticeEvent) => void) { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  private command(command: string, args: object = {}) {
    if (!this.valid) return Promise.reject(new Error('Hardware audio session is stale.'));
    return this.desk.command(this, this.target, command, args);
  }
  start(options: StartOptions = {}) { return this.command('start', options); }
  stop() { return this.command('stop'); }
  control(control: Control, options: { commandId?: string } | string = {}) { return this.command('control', { control, commandId: typeof options === 'string' ? options : options.commandId }); }
  selectChannel(channelId: ChannelId) { return this.command('selectChannel', { channelId }); }
  setChannel(channelId: ChannelId, settings: ChannelSettings) { return this.command('setChannel', { channelId, settings }); }
  setClick(enabled: boolean) { return this.command('setClick', { enabled }); }
  configureVoiceEffects(_configurations: readonly VoiceEffectConfiguration[]): Promise<PracticeState> { throw new Error('Select a voice profile to edit.'); }
  configureVoiceProfile(profile: number, effects: readonly LiveEffectDefinition[]) {
    const voices = this.latest.state.voiceEffects;
    if (!voices || voices.length !== VOICE_PROFILE_COUNT || voices.some(voice => !voice.prepared)) throw new Error('Host effect profiles are not ready. Refresh to reconnect.');
    const selected = voices.find(voice => voice.profile === profile);
    if (!selected) throw new Error('Voice profile is unavailable.');
    return this.command('configureVoiceProfile', { profile, effects, expectedRevision: selected.revision });
  }
  async disableMicrophone(_generation?: number) {}
  async enableMicrophone(): Promise<number> { throw new Error('Microphone belongs to the remote host'); }
  setMonitoringRelationship() { throw new Error('Monitoring belongs to the remote host'); }
  async dispose() { this.invalidate(); }
}
