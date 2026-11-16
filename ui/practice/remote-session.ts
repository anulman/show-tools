import type { TunerPort, TunerState } from '../../lib/tuner/model.js';
import { HardwareKeyRejectedError } from './hardware-auth.js';
import { VOICE_PROFILE_COUNT } from '../../lib/performance/model.js';
import { decodeDeskBootstrap, decodeDeskPublication, decodeAudioDecision, decodeNativeOutcome, decodeInputAttachOutcome, decodeInputIntentStatus } from './remote-schema.js';
import type { DeskView, NativePerformance, NativeTarget, InputIntentStatus, InputAttachOutcome, NativeOutcome, InputLeaseReceipt } from '../../lib/remote-performance/session-schema.js';
import type { ChannelId, ChannelSettings, Control, PracticeEvent, PracticeState, StartOptions, LiveEffectDefinition, VoiceEffectConfiguration } from '../../lib/performance/model.js';
import type { InputAttachArgs, InputEventArgs, InputRevokeArgs } from './musical-input-policy.js';

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
  private constructor(private readonly token: string, private readonly sessionId: string, private readonly inputOwnerToken: string, private latest: DeskView) { this.updateEndpoint(); }
  static async connect(token: string) {
    const response = await fetch('/api/session', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (response.status === 401 || response.status === 403) throw new HardwareKeyRejectedError();
    if (!response.ok) throw new Error(`Remote desk failed (${response.status})`);
    const bootstrap = decodeDeskBootstrap(await readJson(response));
    return new RemoteDesk(token, bootstrap.sessionId, bootstrap.inputOwnerToken, bootstrap.view);
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
  async inputIntentStatus(intentId: string) {
    const response = await fetch('/api/input-intent-status', { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputOwnerToken: this.inputOwnerToken, intentId }), cache: 'no-store' });
    if (!response.ok) throw new Error('Input cleanup readback unavailable. Reconnect remains blocked.');
    return decodeInputIntentStatus(await readJson(response));
  }
  async command(endpoint: RemoteSession, target: NativeTarget, command: string, args: object) {
    if (this.endpoint !== endpoint) throw new Error('Hardware audio session is stale.');
    let result: NativeOutcome | InputAttachOutcome;
    try {
      const response = await this.post('/api/command', { target, command, args });
      result = command === 'inputAttach' ? decodeInputAttachOutcome(response) : decodeNativeOutcome(response);
      endpoint.observeInputOutcome(command, args, result);
    }
    catch (error) { this.disconnect(error); throw new Error('Remote command outcome unknown. Input recovery is blocked. On the host, use ./show-tools session audio off to end the old engine.', { cause: error }); }
    if (result.outcome !== 'applied') {
      if (result.outcome === 'unknown') this.disconnect(new Error(result.error || 'Native input disposition unknown'));
      throw new Error(result.error || `Remote command ${result.outcome}`);
    }
    if (this.endpoint !== endpoint || result.hostEpoch !== target.hostEpoch) { endpoint.invalidate(); throw new Error('Hardware audio session is stale.'); }
    endpoint.observe(result);
    return endpoint.snapshot();
  }
  async dispose() { this.disposed = true; this.connectionState = { kind: 'disconnected', error: 'Detached from desk' }; this.abort.abort(); this.endpoint?.invalidate(); this.listeners.clear(); }
}

export class RemoteSession {
  get inputScope() { return JSON.stringify([this.target.attempt, this.target.hostEpoch]); }
  private readonly listeners = new Set<(state: PracticeState) => void>();
  private readonly tunerListeners = new Set<(state: TunerState) => void>();
  readonly tuner: TunerPort;
  private readonly eventListeners = new Set<(event: PracticeEvent) => void>();
  readonly outputStream = undefined;
  readonly monitoringRelationship = 'unknown' as const;
  readonly requiresInputRetirementProof = true;
  private readonly inputAttempts = new Map<InputAttachArgs['kind'], { intentId: string; args: InputAttachArgs; status: InputIntentStatus }>();
  private valid = true;
  private latest: NativePerformance;
  constructor(private readonly desk: RemoteDesk, private readonly target: NativeTarget, performance: NativePerformance) {
    this.latest = performance;
    this.tuner = {
      snapshot: () => { if (!this.valid) throw new Error('Hardware audio session is stale.'); return this.latest.tuner; },
      subscribe: listener => { if (!this.valid) throw new Error('Hardware audio session is stale.'); this.tunerListeners.add(listener); listener(this.latest.tuner); return () => { this.tunerListeners.delete(listener); }; },
      command: async command => { await this.command('tuner', command); if (!this.valid) throw new Error('Hardware audio session is stale.'); return this.latest.tuner; },
    };
  }
  matches(target: NativeTarget) { return this.valid && target.attempt === this.target.attempt && target.hostEpoch === this.target.hostEpoch; }
  invalidate() { this.valid = false; this.listeners.clear(); this.eventListeners.clear(); this.tunerListeners.clear(); }
  observe(performance: NativePerformance) {
    if (!this.valid || performance.hostEpoch !== this.target.hostEpoch || BigInt(performance.revision) <= BigInt(this.latest.revision)) return;
    this.latest = performance; for (const listener of this.listeners) listener(performance.state);
    for (const listener of this.tunerListeners) listener(performance.tuner);
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
  private receiptMatches(receipt: InputLeaseReceipt, args: InputAttachArgs) {
    return receipt.target.attempt === this.target.attempt && receipt.target.hostEpoch === this.target.hostEpoch
      && receipt.kind === args.kind && receipt.bindingGeneration === args.bindingGeneration;
  }
  observeInputOutcome(command: string, args: object, result: NativeOutcome | InputAttachOutcome) {
    if (command !== 'inputAttach' && command !== 'inputRevoke') return;
    const attempt = [...this.inputAttempts.values()].find(value => 'kind' in args && value.args.kind === args.kind);
    if (!attempt) return;
    const kind = attempt.args.kind;
    if (command === 'inputAttach') {
      if (result.outcome === 'applied') {
        const routing = result.state.inputRouting;
        if (!('receipt' in result) || !this.receiptMatches(result.receipt, attempt.args)
          || result.hostEpoch !== this.target.hostEpoch || result.revision !== result.receipt.admissionRevision
          || routing?.bindingGeneration !== attempt.args.bindingGeneration
          || !routing.producers.some(value => value.producer === result.receipt.producer && value.session === result.receipt.session && value.kind === kind)) {
          attempt.status = { kind: 'unknown' };
          throw new Error('Native input admission receipt is inconsistent');
        }
        attempt.status = { kind: 'admitted', receipt: result.receipt };
      }
      else if (result.outcome === 'rejected') attempt.status = { kind: 'retired', proof: {
        kind: 'rejected-before-admission', target: this.target, kindOfProducer: kind, bindingGeneration: attempt.args.bindingGeneration } };
      else attempt.status = { kind: 'unknown' };
    } else if (result.outcome === 'applied' && attempt.status.kind === 'admitted') {
      const receipt = attempt.status.receipt;
      if (result.hostEpoch === this.target.hostEpoch && BigInt(result.revision) > BigInt(receipt.admissionRevision)
        && result.state.inputRouting && !result.state.inputRouting.producers.some(value => value.producer === receipt.producer && value.session === receipt.session))
        attempt.status = { kind: 'retired', proof: { kind: 'exact-revoke-applied', receipt, revocationRevision: result.revision } };
    }
  }
  async inputAttach(args: InputAttachArgs) {
    if (this.inputAttempts.has(args.kind)) throw new Error('Prior input cleanup is unconfirmed. Reconnect remains blocked.');
    const attempt: { intentId: string; args: InputAttachArgs; status: InputIntentStatus } = { intentId: crypto.randomUUID(), args, status: { kind: 'pending' } };
    this.inputAttempts.set(args.kind, attempt);
    try { return await this.command('inputAttach', { ...args, intentId: attempt.intentId }); }
    catch (error) { if (attempt.status.kind === 'pending') attempt.status = { kind: 'unknown' }; throw error; }
  }
  inputEvent(args: InputEventArgs) { return this.command('inputEvent', args); }
  async inputRevoke(args: InputRevokeArgs) {
    const attempt = this.inputAttempts.get(args.kind);
    if (!attempt) return this.command('inputRevoke', args);
    let cleanupError: unknown;
    if (this.valid && attempt.status.kind === 'admitted') {
      try { await this.command('inputRevoke', args); } catch (error) { cleanupError = error; }
    }
    if (attempt.status.kind !== 'retired') {
      const status = await this.desk.inputIntentStatus(attempt.intentId);
      if (status.kind === 'admitted' && this.receiptMatches(status.receipt, attempt.args)
        && (attempt.status.kind !== 'admitted' || status.receipt.producer === attempt.status.receipt.producer && status.receipt.session === attempt.status.receipt.session
          && status.receipt.admissionRevision === attempt.status.receipt.admissionRevision)) attempt.status = status;
      if (status.kind === 'retired') {
        const proof = status.proof;
        const matches = proof.kind === 'rejected-before-admission'
          ? attempt.status.kind !== 'admitted' && proof.target.attempt === this.target.attempt && proof.target.hostEpoch === this.target.hostEpoch
            && proof.kindOfProducer === args.kind && proof.bindingGeneration === attempt.args.bindingGeneration
          : this.receiptMatches(proof.receipt, attempt.args) && BigInt(proof.revocationRevision) > BigInt(proof.receipt.admissionRevision)
            && (attempt.status.kind !== 'admitted' || proof.receipt.producer === attempt.status.receipt.producer && proof.receipt.session === attempt.status.receipt.session && proof.receipt.admissionRevision === attempt.status.receipt.admissionRevision);
        if (matches) attempt.status = status;
      }
    }
    if (attempt.status.kind !== 'retired') throw cleanupError ?? new Error('Hardware audio session is stale or input cleanup is unconfirmed. Reconnect remains blocked. On the host, use ./show-tools session audio off to end the old engine.');
    this.inputAttempts.delete(args.kind);
    return this.snapshot();
  }
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
