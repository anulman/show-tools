import { VOICE_PROFILE_COUNT } from '../../lib/performance/model.js';
import { decodeBootstrap, decodePublication, decodeResult } from './remote-schema.js';
import type { ChannelId, ChannelSettings, Control, PracticeEvent, PracticeState, SongScript, StartOptions, LiveEffectDefinition, VoiceEffectConfiguration } from '../../lib/performance/model.js';

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw new Error('Remote response is too large');
  return JSON.parse(text);
}

export class RemoteSession {
  readonly listeners = new Set<(state: PracticeState) => void>();
  readonly eventListeners = new Set<(event: PracticeEvent) => void>();
  readonly abort = new AbortController();
  readonly outputStream = undefined;
  readonly monitoringRelationship = 'unknown' as const;
  private sequence = 0;
  private disposed = false;
  private connected = false;
  private revision: bigint;
  private constructor(readonly token: string, readonly sessionId: string, readonly hostEpoch: string, revision: string, public song: SongScript, private latest: PracticeState) { this.revision = BigInt(revision); }
  static async create(token: string) {
    const response = await fetch('/api/session', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Remote session failed (${response.status})`);
    const bootstrap = decodeBootstrap(await readJson(response));
    const session = new RemoteSession(token, bootstrap.sessionId, bootstrap.hostEpoch, bootstrap.revision, bootstrap.song, bootstrap.state);
    return session;
  }
  get microphone() { return this.latest.microphone; }
  snapshot() { return this.latest; }
  subscribe(listener: (state: PracticeState) => void) { this.listeners.add(listener); listener(this.latest); return () => this.listeners.delete(listener); }
  onEvent(listener: (event: PracticeEvent) => void) { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  private publish(state: PracticeState) { this.latest = state; for (const listener of this.listeners) listener(state); }
  private disconnect(error: string) {
    this.connected = false;
    this.abort.abort();
    if (!this.disposed) this.publish({ ...this.latest, error });
  }
  private observe(hostEpoch: string, revision: string, state: PracticeState) {
    if (hostEpoch !== this.hostEpoch) throw new Error('Remote host changed. Refresh to reconnect.');
    const next = BigInt(revision);
    if (next <= this.revision) return false;
    this.revision = next;
    this.publish(state);
    return true;
  }
  async listen(onSong: (song: SongScript) => void = () => {}) {
    try {
      const response = await fetch('/api/events', { headers: { Authorization: `Bearer ${this.token}`, 'X-Session-Id': this.sessionId }, signal: this.abort.signal, cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error(`Remote events failed (${response.status})`);
      this.connected = true;
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error('Remote connection closed. Refresh to reconnect.');
        pending = (pending + value).replace(/\r\n/g, '\n');
        if (pending.length > 8 * 1024 * 1024) throw new Error('Remote event frame is too large.');
        let end: number;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, end); pending = pending.slice(end + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const publication = decodePublication(JSON.parse(data));
          if (publication.type === 'gap') throw new Error('Remote events were lost. Refresh to reconnect.');
          if (publication.type === 'event') { for (const listener of this.eventListeners) listener(publication.event); }
          else {
            const current = BigInt(publication.revision) >= this.revision;
            this.observe(publication.hostEpoch, publication.revision, publication.state);
            if (current && publication.type === 'session') { this.song = publication.song; onSong(publication.song); }
          }
        }
      }
    } catch (error) {
      if (!this.disposed) this.disconnect(error instanceof Error ? error.message : String(error));
    }
  }
  private async command(command: string, args: object = {}) {
    if (this.disposed || !this.connected) throw new Error('Remote session is disconnected. Refresh to reconnect.');
    let response: Response;
    try {
      response = await fetch('/api/command', { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, sequence: ++this.sequence, command, args }) });
    } catch (error) { this.disconnect('Remote command outcome unknown. Refresh to reconnect.'); throw new Error('Remote command outcome unknown. Refresh to reconnect.', { cause: error }); }
    if (!response.ok) { this.disconnect(`Remote command outcome unknown (${response.status}). Refresh to reconnect.`); throw new Error(`Remote command outcome unknown (${response.status})`); }
    let result: ReturnType<typeof decodeResult>;
    try { result = decodeResult(await readJson(response)); }
    catch (error) { this.disconnect('Invalid command result. Refresh to reconnect.'); throw new Error('Invalid command result; outcome unknown.', { cause: error }); }
    if (result.outcome !== 'applied') {
      if (result.outcome === 'unknown') this.disconnect('Remote command outcome unknown. Refresh to reconnect.');
      throw new Error(result.error || `Remote command ${result.outcome}`);
    }
    try { this.observe(result.hostEpoch, result.revision, result.state); }
    catch (error) { this.disconnect('Remote host changed. Refresh to reconnect.'); throw error; }
    return this.latest;
  }
  start(options: StartOptions = {}) { return this.command('start', options); }
  stop() { return this.command('stop'); }
  control(control: Control, options: { commandId?: string } | string = {}) { return this.command('control', { control, commandId: typeof options === 'string' ? options : options.commandId }); }
  selectChannel(channelId: ChannelId) { return this.command('selectChannel', { channelId }); }
  setChannel(channelId: ChannelId, settings: ChannelSettings) { return this.command('setChannel', { channelId, settings }); }
  setClick(enabled: boolean) { return this.command('setClick', { enabled }); }
  configureVoiceEffects(_configurations: readonly VoiceEffectConfiguration[]): Promise<PracticeState> { throw new Error('Select a voice profile to edit.'); }
  configureVoiceProfile(profile: number, effects: readonly LiveEffectDefinition[]) {
    const voices = this.latest.voiceEffects;
    if (!voices || voices.length !== VOICE_PROFILE_COUNT || voices.some(voice => !voice.prepared)) throw new Error('Host effect profiles are not ready. Refresh to reconnect.');
    const selected = voices.find(voice => voice.profile === profile);
    if (!selected) throw new Error('Voice profile is unavailable.');
    return this.command('configureVoiceProfile', { profile, effects, expectedRevision: selected.revision });
  }
  async disableMicrophone(_generation?: number) {}
  async enableMicrophone(): Promise<number> { throw new Error('Microphone belongs to the remote host'); }
  setMonitoringRelationship() { throw new Error('Monitoring belongs to the remote host'); }
  async dispose() { this.disposed = true; this.connected = false; this.abort.abort(); this.listeners.clear(); this.eventListeners.clear(); }
}
