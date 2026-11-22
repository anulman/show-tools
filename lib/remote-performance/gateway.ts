import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { MAX_CHART_BYTES } from './chart-overrides.js';
import { DESK_HEARTBEAT_MS } from './event-liveness.js';
import { BROWSER_DESK_PATH, HARDWARE_DESK_PATH, PRACTICE_ASSET_PATH, isDeskEntry } from './desk-paths.js';
import type { TunerState } from '../tuner/model.js';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Schema } from 'effect';
import { InputIntentStatusRequestSchema, NativeTargetSchema, AudioGoalSchema, type InputIntentStatus, type InputAttachOutcome, type DeskController, type DeskView, type AudioDecision, type NativeOutcome, type NativeTarget } from './session-schema.js';
import { decodeClientInputCommand, isPriorityCommand, TambourineAudition, type ClientInputCommand } from './commands.js';
import { InputBindingsSchema, decodeInputBindings, decodeInputAttach, type InputBindings, type InputAttach } from '../performance/input-bindings.js';

export interface Observation {
	type: 'session' | 'state' | 'event' | 'gap';
	[key: string]: unknown;
}

export interface Instrument {
	snapshot(): Observation | null;
	command(command: unknown): Promise<Outcome>;
	subscribe(listener: (observation: Observation) => void): () => void;
}

export interface GatewayConfig {
	host: string;
	port: number;
	origin: string;
	token: Buffer;
	staticRoot: string;
	tls?: { cert: Buffer; key: Buffer };
}

export type Outcome = { outcome: 'applied' | 'rejected'; error?: string; state?: unknown; lights?: number[]; tuner?: TunerState; demo?: import('./session-schema.js').NativePerformance['demo']; audition?: number | null; revision?: string; hostEpoch?: string } | { outcome: 'unknown' };
type Session = { readonly inputOwnerToken: string; highWater: number; inFlight: number; attached: boolean; results: Map<number, { request: string; result: Promise<Outcome | AudioDecision | NativeOutcome> }> };
type InputIntent = { target: NativeTarget; kindOfProducer: InputAttach['kind']; bindingGeneration: number; request: string; status: InputIntentStatus; result: Promise<InputAttachOutcome> };
type InputLease = InputAttach & { intent: InputIntent; target: NativeTarget; status: 'pending' | 'active' | 'quarantined'; pending: Promise<InputAttachOutcome>; revoking?: Promise<NativeOutcome> };

export class InputProducerRegistry {
  private readonly intents = new Map<object, Map<string, InputIntent>>();
  status(owner: object, intentId: string): InputIntentStatus {
    const intent = this.intents.get(owner)?.get(intentId);
    if (!intent) return { kind: 'unknown' };
    if (intent.status.kind === 'retired') return intent.status;
    const ended = this.controller.confirmedRetirement?.(intent.target);
    if (ended && ended.target.attempt === intent.target.attempt && ended.target.hostEpoch === intent.target.hostEpoch
      && ended.serverEpoch === this.controller.snapshot().serverEpoch)
      return { kind: 'retired', proof: { ...ended, kindOfProducer: intent.kindOfProducer, bindingGeneration: intent.bindingGeneration } };
    const current = this.current(intent.target);
    const currentBindingGeneration = current?.state.inputRouting?.bindingGeneration;
    if (current && currentBindingGeneration !== undefined && currentBindingGeneration > intent.bindingGeneration
      && (intent.status.kind !== 'admitted' || BigInt(current.revision) > BigInt(intent.status.receipt.admissionRevision))) {
      intent.status = { kind: 'retired', proof: { kind: 'binding-generation-retired', target: intent.target,
        serverEpoch: this.controller.snapshot().serverEpoch, kindOfProducer: intent.kindOfProducer,
        bindingGeneration: intent.bindingGeneration, currentBindingGeneration, replacementRevision: current.revision } };
    }
    return intent.status;
  }
  async readStatus(owner: object, intentId: string): Promise<InputIntentStatus> {
    const current = this.status(owner, intentId);
    if (current.kind === 'unknown' || current.kind === 'retired') return current;
    const intent = this.intents.get(owner)?.get(intentId);
    const lease = intent && this.owners.get(owner)?.get(intent.kindOfProducer);
    if (this.closed.has(owner) && lease && lease.intent === intent) {
      await lease.intent.result;
      const settled = this.status(owner, intentId);
      if (settled.kind === 'unknown' || settled.kind === 'retired') return settled;
      if (lease.revoking) await lease.revoking;
    }
    return this.status(owner, intentId);
  }
  isClosedAndEmpty(owner: object) {
    return this.closed.has(owner) && !this.intents.get(owner)?.size && !this.owners.has(owner);
  }
  private readonly owners = new Map<object, Map<InputAttach['kind'], InputLease>>();
  private readonly slots = new Map<number, InputLease>();
  private readonly closed = new WeakSet<object>();
  private readonly closing = new WeakMap<object, Promise<void>>();
  private generation = '';
  private highWatermark = 0;
  constructor(private readonly controller: DeskController) {}

  private current(target: NativeTarget) {
    const audio = this.controller.snapshot().audio;
    return audio.kind === 'ready' && audio.attempt === target.attempt && audio.performance.hostEpoch === target.hostEpoch
      ? audio.performance : null;
  }
  private refresh(target: NativeTarget) {
    const current = this.current(target);
    const routing = current?.state.inputRouting;
    if (!current || !routing) return null;
    const generation = JSON.stringify([target.attempt, target.hostEpoch, routing.bindingGeneration]);
    if (generation !== this.generation) {
      this.generation = generation; this.owners.clear(); this.slots.clear();
    }
    this.highWatermark = Math.max(this.highWatermark, routing.sessionHighWatermark);
    return { current, routing };
  }
  private remove(owner: object, lease: InputLease) {
    if (this.slots.get(lease.producer) !== lease) return;
    this.slots.delete(lease.producer);
    const roles = this.owners.get(owner);
    if (roles?.get(lease.kind) === lease) roles.delete(lease.kind);
    if (!roles?.size) this.owners.delete(owner);
  }
  priority(owner: object, target: NativeTarget, input: unknown) {
    let command: ClientInputCommand;
    try { command = decodeClientInputCommand(input); } catch { return false; }
    if (command.command !== 'inputEvent' || this.closed.has(owner)) return false;
    const lease = this.owners.get(owner)?.get(command.args.kind);
    const current = this.current(target);
    return !!lease && lease.status === 'active' && !!current && lease.target.attempt === target.attempt
      && lease.target.hostEpoch === target.hostEpoch && isPriorityCommand({ command: 'inputEvent', args: {
        producer: lease.producer, session: lease.session, bindingGeneration: command.args.bindingGeneration,
        sequence: command.args.sequence, input: command.args.input, value: command.args.value,
      } }, current.state);
  }
  async command(owner: object, target: NativeTarget, input: unknown): Promise<NativeOutcome> {
    if (this.closed.has(owner)) return { outcome: 'rejected', error: 'Input client is closed' };
    let command: ClientInputCommand;
    try { command = decodeClientInputCommand(input); }
    catch { return { outcome: 'rejected', error: 'Invalid identified input command' }; }
    if (command.command === 'inputAttach') return this.attachIntent(owner, target, command);
    const view = this.refresh(target);
    if (!view) return { outcome: 'rejected', error: 'Native input routing is unavailable' };
    const kind = command.args.kind;
    const existing = this.owners.get(owner)?.get(kind);
    if (!existing) return { outcome: 'rejected', error: 'Input producer is not attached' };
    await existing.pending;
    if (this.closed.has(owner)) return { outcome: 'rejected', error: 'Input client is closed' };
    if (command.command === 'inputRevoke') return this.revoke(owner, existing);
    const record = this.current(target)?.state.inputRouting?.producers.find(value => value.producer === existing.producer && value.session === existing.session);
    if (existing.status !== 'active' || command.args.bindingGeneration !== existing.bindingGeneration || !record)
      return { outcome: 'rejected', error: 'Input lease changed; release and reconnect' };
    return this.controller.command(target, { command: 'inputEvent', args: {
      producer: existing.producer, session: existing.session, bindingGeneration: existing.bindingGeneration,
      sequence: command.args.sequence, input: command.args.input, value: command.args.value,
    } });
  }
  private attachIntent(owner: object, target: NativeTarget, command: Extract<ClientInputCommand, { command: 'inputAttach' }>): Promise<InputAttachOutcome> {
    let ledger = this.intents.get(owner);
    if (!ledger) {
      if (this.intents.size >= MAX_SESSIONS) return Promise.resolve({ outcome: 'rejected', error: 'Input owner capacity reached' });
      ledger = new Map(); this.intents.set(owner, ledger);
    }
    const request = JSON.stringify([target, command.args]);
    const retained = ledger.get(command.args.intentId);
    if (retained) return retained.request === request ? retained.result : Promise.resolve({ outcome: 'rejected', error: 'Input intent identity reused' });
    if (ledger.size >= MAX_RESULTS) return Promise.resolve({ outcome: 'rejected', error: 'Input intent capacity reached' });
    const intent: InputIntent = { target, kindOfProducer: command.args.kind, bindingGeneration: command.args.bindingGeneration, request, status: { kind: 'pending' }, result: Promise.resolve({ outcome: 'unknown' }) };
    ledger.set(command.args.intentId, intent);
    const kind = command.args.kind;
    intent.result = (async (): Promise<InputAttachOutcome> => {
      const view = this.refresh(target);
      if (!view) return { outcome: 'rejected', error: 'Native input routing is unavailable' };
      const existing = this.owners.get(owner)?.get(kind);
      if (existing) return { outcome: 'rejected', error: 'Revoke this input producer before attaching again' };
      if (command.args.bindingGeneration !== view.routing.bindingGeneration)
        return { outcome: 'rejected', error: 'Input binding generation changed' };
      let producer = -1;
      for (let slot = 0; slot < 32; slot++) if (!this.slots.has(slot) && !view.routing.producers.some(value => value.producer === slot)) { producer = slot; break; }
      if (producer < 0) return { outcome: 'rejected', error: 'Input producer capacity reached' };
      if (this.highWatermark >= Number.MAX_SAFE_INTEGER) return { outcome: 'rejected', error: 'Input session identity exhausted' };
      let args: InputAttach;
      try { const { intentId: _intentId, ...initial } = command.args; args = decodeInputAttach({ ...initial, producer, session: this.highWatermark + 1 }); }
      catch { return { outcome: 'rejected', error: 'Invalid initial input state' }; }
      this.highWatermark = args.session;
      const lease: InputLease = { ...args, target, intent, status: 'pending', pending: Promise.resolve({ outcome: 'unknown' }) };
      let roles = this.owners.get(owner);
      if (!roles) { roles = new Map(); this.owners.set(owner, roles); }
      roles.set(kind, lease); this.slots.set(producer, lease);
      lease.pending = this.controller.command(target, { command: 'inputAttach', args }).catch(() => ({ outcome: 'unknown' as const })).then(result => {
        if (this.slots.get(producer) !== lease) return { outcome: 'unknown' as const };
        if (result.outcome === 'rejected') { this.remove(owner, lease); return result; }
        const routing = result.outcome === 'applied' ? result.state.inputRouting : undefined;
        if (result.outcome === 'applied' && result.hostEpoch === target.hostEpoch && routing?.bindingGeneration === args.bindingGeneration && routing.producers.some(value => value.producer === producer && value.session === args.session && value.kind === kind)) {
          const receipt = { target, producer, session: args.session, kind, bindingGeneration: args.bindingGeneration, admissionRevision: result.revision };
          intent.status = { kind: 'admitted', receipt };
          lease.status = 'active'; return { ...result, receipt };
        }
        lease.status = 'quarantined'; return { outcome: 'unknown' as const };
      });
      return lease.pending;
    })().catch(() => ({ outcome: 'unknown' as const })).then(result => {
      if (intent.status.kind === 'retired') return result;
      if (result.outcome === 'rejected') intent.status = { kind: 'retired', proof: { kind: 'rejected-before-admission', target, kindOfProducer: kind, bindingGeneration: command.args.bindingGeneration } };
      else if (result.outcome === 'unknown') intent.status = { kind: 'unknown' };
      return result;
    });
    return intent.result;
  }
  private revoke(owner: object, lease: InputLease): Promise<NativeOutcome> {
    if (lease.revoking) return lease.revoking;
    lease.status = 'quarantined';
    lease.revoking = this.controller.command(lease.target, { command: 'inputRevoke', args: { producer: lease.producer, session: lease.session } })
      .catch(() => ({ outcome: 'unknown' as const })).then(result => {
        const routing = result.outcome === 'applied' ? result.state.inputRouting : undefined;
        if (routing && !routing.producers.some(value => value.producer === lease.producer && value.session === lease.session))
          this.remove(owner, lease);
        if (routing && result.outcome === 'applied' && result.hostEpoch === lease.target.hostEpoch && lease.intent.status.kind === 'admitted'
          && BigInt(result.revision) > BigInt(lease.intent.status.receipt.admissionRevision)
          && !routing.producers.some(value => value.producer === lease.producer && value.session === lease.session))
          lease.intent.status = { kind: 'retired', proof: { kind: 'exact-revoke-applied', receipt: lease.intent.status.receipt, revocationRevision: result.revision } };
        return result;
      }).finally(() => { lease.revoking = undefined; });
    return lease.revoking;
  }
  close(owner: object) {
    const pending = this.closing.get(owner);
    if (pending) return pending;
    this.closed.add(owner);
    const leases = [...(this.owners.get(owner)?.values() ?? [])];
    const done = Promise.all(leases.map(async lease => {
      await lease.pending;
      if (this.slots.get(lease.producer) === lease) await this.revoke(owner, lease);
    })).then(() => {});
    this.closing.set(owner, done);
    return done;
  }
}
const MAX_SESSIONS = 128;
const MAX_RESULTS = 256;
const MAX_INPUT_STATUS_REQUESTS = 4096;
const MAX_BODY = 64 * 1024;
const MAX_CLIENTS = 128;
const MAX_EVENT_BUFFER = 4 * 1024 * 1024;
const decodeTakeAudioRequest = Schema.decodeUnknownSync(Schema.Struct({
  target: NativeTargetSchema,
  take: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 31 })),
  offset: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4294967295 })),
  frames: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4096 })),
  token: Schema.NonEmptyString.check(Schema.isMaxLength(128)),
}), { onExcessProperty: 'error' });
const requestFields = { sessionId: Schema.NonEmptyString, sequence: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })) };
const decodeCommand = Schema.decodeUnknownSync(Schema.Struct({ ...requestFields,
  command: Schema.Literals(['start', 'stop', 'recordDemo', 'audition', 'auditionTambourine', 'control', 'selectChannel', 'setChannel', 'setClick', 'configureVoiceProfile', 'configureJiggle', 'tuner', 'inputAttach', 'inputEvent', 'inputRevoke']),
  args: Schema.Record(Schema.String, Schema.Unknown), target: NativeTargetSchema,
}));
const decodeTambourine = Schema.decodeUnknownSync(TambourineAudition, { onExcessProperty: 'error' });
const decodeAudio = Schema.decodeUnknownSync(Schema.Struct({ ...requestFields, goal: AudioGoalSchema }));

function json(response: ServerResponse, status: number, value: unknown) {
	response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage, limit = MAX_BODY): Promise<unknown> {
	const chunks: Buffer[] = [];
	let length = 0;
	for await (const chunk of request) {
		const bytes = Buffer.from(chunk);
		length += bytes.length;
		if (length > limit) throw new Error('Body too large');
		chunks.push(bytes);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const contentTypes: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
	'.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

export interface SongActions {
  choices(): readonly { id: string; title: string; packageDigest: string }[];
  select(id: string, expectedRevision: string): Promise<AudioDecision>;
  bindings(expectedRevision: string, values: InputBindings): Promise<AudioDecision>;
  publishChart?(expectedRevision: string, xml: string): Promise<AudioDecision>;
}
const configurationFields = { ...requestFields, expectedRevision: Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,19})$/)) };
const decodeSongSelection = Schema.decodeUnknownSync(Schema.Struct({ ...configurationFields, songId: Schema.NonEmptyString.check(Schema.isMaxLength(256)) }), { onExcessProperty: 'error' });
const decodeButtonBindings = Schema.decodeUnknownSync(Schema.Struct({ ...configurationFields, bindings: InputBindingsSchema }), { onExcessProperty: 'error' });

const decodeChartUpdate = Schema.decodeUnknownSync(Schema.Struct({ ...configurationFields,
  musicXml: Schema.NonEmptyString }), { onExcessProperty: 'error' });

function deskWireView(view: DeskView): DeskView {
  const { compiled } = view.song;
  if (!compiled?.authoredCues) return view;
  const { authoredCues: _, ...runtime } = compiled;
  return { ...view, song: { ...view.song, compiled: runtime } };
}

function deskWireOutcome(outcome: Outcome | AudioDecision | NativeOutcome) {
  return 'view' in outcome ? { ...outcome, view: deskWireView(outcome.view) } : outcome;
}

export function createGateway(config: GatewayConfig, controller: DeskController, songs?: SongActions) {
	if (config.token.length < 32) throw new Error('Token must contain at least 32 bytes');
	const origin = new URL(config.origin);
	if (origin.origin !== config.origin) throw new Error('Origin must be an exact origin');
	if (!config.tls && !['127.0.0.1', '::1', 'localhost'].includes(config.host)) {
		throw new Error('TLS is required for non-loopback listeners');
	}
	if ((config.tls ? 'https:' : 'http:') !== origin.protocol) throw new Error('Origin protocol does not match listener');
	const sessions = new Map<string, Session>();
	const inputs = new InputProducerRegistry(controller);
  let receivingChart = false;
  const inputOwners = new Map<string, { owner: Session; reads: number }>();
  let audition: { owner: Session; target: NativeTarget } | undefined;
  let auditionTransition = Promise.resolve();
  const queueAudition = <T>(operation: () => Promise<T>) => {
    const next = auditionTransition.then(operation);
    auditionTransition = next.then(() => {}, () => {});
    return next;
  };
  const isAuditionTarget = (target: NativeTarget) => {
    const view = controller.snapshot();
    return view.song.id === 'tribulations' && view.audio.kind === 'ready'
      && view.audio.attempt === target.attempt && view.audio.performance.hostEpoch === target.hostEpoch;
  };
  const sendAudition = (target: NativeTarget, args: typeof TambourineAudition.Type): Promise<NativeOutcome> =>
    controller.command(target, { command: 'auditionTambourine', args }).catch(() => ({ outcome: 'unknown' }));
  const endAudition = async (lease: NonNullable<typeof audition>) => {
    if (lease !== audition) return { outcome: 'rejected' as const, error: 'This session has no Tambourine audition' };
    const result = await sendAudition(lease.target, { velocity: -1 });
    if (result.outcome === 'applied' || !isAuditionTarget(lease.target)) audition = undefined;
    return result;
  };
  const commandAudition = (owner: Session, target: NativeTarget, input: unknown): Promise<NativeOutcome> => {
    let args: typeof TambourineAudition.Type;
    try { args = decodeTambourine(input); }
    catch { return Promise.resolve({ outcome: 'rejected', error: 'Invalid Tambourine audition velocity' }); }
    const { velocity } = args;
    return queueAudition(async () => {
      if (!owner.attached || !isAuditionTarget(target))
        return { outcome: 'rejected', error: 'Connect to hardware audio with Tribulations selected' };
      if (audition && !isAuditionTarget(audition.target)) audition = undefined;
      if (audition && audition.owner !== owner && !audition.owner.attached) await endAudition(audition);
      if (!owner.attached || !isAuditionTarget(target))
        return { outcome: 'rejected', error: 'Tambourine audition target changed' };
      if (audition && audition.owner !== owner)
        return { outcome: 'rejected', error: 'Another desk holds the Tambourine audition' };
      if (velocity !== 0 && !audition)
        return { outcome: 'rejected', error: 'Start Tambourine audition first' };
      if (velocity === -1 && audition) return endAudition(audition);
      const result = await sendAudition(target, args);
      if (velocity === 0 && result.outcome !== 'rejected') audition = { owner, target };
      return result;
    });
  };
  const closeSession = (sessionId: string, session: Session) => {
    if (sessions.get(sessionId) !== session) return;
    sessions.delete(sessionId);
    session.attached = false;
    void queueAudition(async () => { if (audition?.owner === session) await endAudition(audition); });
    void inputs.close(session);
    if (inputs.isClosedAndEmpty(session)) inputOwners.delete(session.inputOwnerToken);
  };
  const decodeIntentStatusRequest = Schema.decodeUnknownSync(InputIntentStatusRequestSchema, { onExcessProperty: 'error' });
	const clients = new Set<ServerResponse>();
	const send = (client: ServerResponse, data: Buffer) => {
		if (client.destroyed || client.writableLength + data.length > MAX_EVENT_BUFFER) {
			clients.delete(client); client.destroy(); return;
		}
		client.write(data);
	};
	const unsubscribe = controller.subscribe((observation) => {
		const publication = observation.type === 'desk' ? { ...observation, view: deskWireView(observation.view) } : observation;
		const data = Buffer.from(`data: ${JSON.stringify(publication)}\n\n`);
		for (const client of clients) send(client, data);
	});
	const heartbeat = setInterval(() => {
		for (const client of clients) send(client, Buffer.from(': show-tools-heartbeat\n\n'));
	}, DESK_HEARTBEAT_MS);
	heartbeat.unref();
	const authenticated = (request: IncomingMessage) => {
		const header = request.headers.authorization;
		if (!header?.startsWith('Bearer ')) return false;
		const supplied = Buffer.from(header.slice(7));
		return supplied.length === config.token.length && timingSafeEqual(supplied, config.token);
	};
	const handler = async (request: IncomingMessage, response: ServerResponse) => {
		let url: URL;
		try {
			if (!request.url || request.url.length > 8192) throw new Error('Invalid request target');
			url = new URL(request.url, config.origin);
		} catch { return json(response, 400, { error: 'Invalid request target' }); }
    const path = url.pathname;
    if (request.method === 'GET' && path === '/api/desk-mode') {
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return response.end('hardware');
    }
		if (path.startsWith('/api/')) {
			if (!authenticated(request)) return json(response, 401, { error: 'Unauthorized' });
			if (request.headers.origin && request.headers.origin !== config.origin) return json(response, 403, { error: 'Invalid origin' });
			if (request.method === 'GET' && path === '/api/session') {
				const snapshot = controller.snapshot();
				if (sessions.size >= MAX_SESSIONS || inputOwners.size >= MAX_SESSIONS) return json(response, 503, { error: 'Session capacity reached' });
				const sessionId = randomBytes(32).toString('hex');
        const inputOwnerToken = randomBytes(32).toString('hex');
				const session: Session = { inputOwnerToken, highWater: 0, inFlight: 0, attached: false, results: new Map() };
        inputOwners.set(inputOwnerToken, { owner: session, reads: 0 });
				sessions.set(sessionId, session);
				setTimeout(() => { if (!session.attached) closeSession(sessionId, session); }, 30_000).unref();
				return json(response, 200, { view: deskWireView(snapshot), sessionId, inputOwnerToken });
			}
      if (request.method === 'POST' && path === '/api/input-intent-status') {
        if (request.headers.origin !== config.origin) return json(response, 403, { error: 'Origin required' });
        let input: ReturnType<typeof decodeIntentStatusRequest>;
        try { input = decodeIntentStatusRequest(await readBody(request)); }
        catch { return json(response, 400, { error: 'Invalid input intent readback' }); }
        const original = inputOwners.get(input.inputOwnerToken);
        if (original && ++original.reads > MAX_INPUT_STATUS_REQUESTS) return json(response, 429, { error: 'Input readback capacity reached' });
        return json(response, 200, original ? await inputs.readStatus(original.owner, input.intentId) : { kind: 'unknown' });
      }
			if (request.method === 'GET' && path === '/api/songs') return songs ? json(response, 200, { songs: songs.choices() }) : json(response, 404, { error: 'Song catalog is not configured' });
      if ((request.method === 'GET' || request.method === 'HEAD') && path === '/api/demo-recording') {
        const demo = await controller.openDemo?.().catch(() => null);
        if (!demo) return json(response, 404, { error: 'No completed demo' });
        response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': demo.bytes, 'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="practice-demo.wav"' });
        if (request.method === 'HEAD') {
          await demo.file.close();
          return response.end();
        }
        await pipeline(demo.file.createReadStream(), response).catch(() => response.destroy());
        return;
      }
      if (request.method === 'POST' && path === '/api/take-audio') {
        if (request.headers.origin !== config.origin) return json(response, 403, { error: 'Origin required' });
        let input: ReturnType<typeof decodeTakeAudioRequest>;
        try { input = decodeTakeAudioRequest(await readBody(request)); }
        catch { return json(response, 400, { error: 'Invalid sample request' }); }
        if (!controller.takeAudio) return json(response, 404, { error: 'Sample downloads are unavailable on this host' });
        try {
          const bytes = await controller.takeAudio(input.target, input);
          response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
          return response.end(bytes);
        } catch { return json(response, 409, { error: 'Sample unavailable or practice changed. Stop practice and retry.' }); }
      }
			if (request.method === 'GET' && path === '/api/status') return json(response, 200, deskWireView(controller.snapshot()));
			if (request.method === 'GET' && path === '/api/events') {
				if (clients.size >= MAX_CLIENTS) return json(response, 503, { error: 'Observer capacity reached' });
				const sessionId = request.headers['x-session-id'];
				const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
				if (!session || session.attached) return json(response, 409, { error: 'Session expired or already attached' });
				session.attached = true;
				response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
				clients.add(response);
				request.on('close', () => { clients.delete(response); closeSession(sessionId as string, session); });
				response.on('error', () => { clients.delete(response); response.destroy(); });
				const snapshot = controller.snapshot();
				if (snapshot) send(response, Buffer.from(`data: ${JSON.stringify({ type: 'desk', view: deskWireView(snapshot) })}\n\n`));
				return;
			}
			if (request.method === 'POST' && ['/api/command', '/api/audio', '/api/song', '/api/button-bindings', '/api/chart'].includes(path)) {
				if (request.headers.origin !== config.origin) return json(response, 403, { error: 'Origin required' });
        const chart = path === '/api/chart';
        if (chart && receivingChart) return json(response, 409, { error: 'A chart upload is already in progress' });
        if (chart) receivingChart = true;
        let body: ReturnType<typeof decodeCommand> | ReturnType<typeof decodeAudio> | ReturnType<typeof decodeSongSelection>
          | ReturnType<typeof decodeButtonBindings> | ReturnType<typeof decodeChartUpdate>;
        try {
          const input = await readBody(request, chart ? MAX_CHART_BYTES * 2 + MAX_BODY : MAX_BODY);
          body = chart ? decodeChartUpdate(input) : path === '/api/audio' ? decodeAudio(input) : path === '/api/song' ? decodeSongSelection(input)
            : path === '/api/button-bindings' ? decodeButtonBindings(input) : decodeCommand(input);
          if ('musicXml' in body && Buffer.byteLength(body.musicXml) > MAX_CHART_BYTES) return json(response, 413, { error: 'MusicXML exceeds 4 MiB' });
        } catch { return json(response, 400, { error: 'Invalid body' }); }
        finally { if (chart) receivingChart = false; }
				const session = sessions.get(body.sessionId);
				if (!session) return json(response, 409, { error: 'Session expired' });
				const sequence = Number(body.sequence);
				const requestKey = createHash('sha256').update(JSON.stringify([path, body])).digest('hex');
				const retained = session.results.get(sequence);
				if (retained) {
					if (retained.request !== requestKey) return json(response, 409, { error: 'Command identity reused' });
					return json(response, 200, deskWireOutcome(await retained.result));
				}
				if (sequence <= session.highWater) return json(response, 409, { error: 'Command expired' });
				const priority = 'command' in body && (body.command.startsWith('input')
					? inputs.priority(session, body.target, { command: body.command, args: body.args })
					: isPriorityCommand({ command: body.command, args: body.args }));
				if (!("goal" in body && body.goal === 'off') && session.inFlight >= MAX_RESULTS + (priority ? 1 : 0)) return json(response, 503, { error: 'Command capacity reached' });
				session.highWater = sequence;
				session.inFlight++;
				const result: Promise<Outcome | AudioDecision | NativeOutcome> = ('goal' in body
					? Promise.resolve(controller.setAudio(body.goal))
          : 'musicXml' in body ? songs?.publishChart?.(body.expectedRevision, body.musicXml) ?? Promise.resolve({ outcome: 'rejected' as const, error: 'Chart updates are unavailable on this desk', view: controller.snapshot() })
          : 'expectedRevision' in body ? songs ? 'bindings' in body ? songs.bindings(body.expectedRevision, decodeInputBindings(body.bindings)) : songs.select(body.songId, body.expectedRevision) : Promise.resolve({ outcome: 'rejected' as const, error: 'Song configuration is unavailable', view: controller.snapshot() })
					: body.command === 'auditionTambourine' ? commandAudition(session, body.target, body.args)
					: body.command.startsWith('input') ? inputs.command(session, body.target, { command: body.command, args: body.args })
						: controller.command(body.target, { command: body.command, args: body.args })).catch(
					() => ({ outcome: 'unknown' } as const),
				).finally(() => { session.inFlight--; });
				session.results.set(sequence, { request: requestKey, result });
				if (session.results.size > MAX_RESULTS) session.results.delete(session.results.keys().next().value!);
				return json(response, 200, deskWireOutcome(await result));
			}
			return json(response, 404, { error: 'Not found' });
		}
		if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed' });
		let relative: string;
		try { relative = decodeURIComponent(path); } catch { return json(response, 400, { error: 'Invalid path' }); }
    const pins = url.searchParams.getAll('__show_tools_build');
    const pin = pins[0];
    if (pins.length > 1 || (pin !== undefined && !/^[a-f0-9]{64}$/.test(pin)))
      return json(response, 400, { error: 'Invalid build identity' });
    const browserEntry = isDeskEntry(relative, BROWSER_DESK_PATH);
    const selectedBrowser = !url.searchParams.has('remote') && (browserEntry || url.searchParams.has('browser'));
    if (pin === undefined && (browserEntry || isDeskEntry(relative, HARDWARE_DESK_PATH) || isDeskEntry(relative, PRACTICE_ASSET_PATH))) {
      const destination = selectedBrowser ? BROWSER_DESK_PATH : HARDWARE_DESK_PATH;
      if (relative !== destination && relative !== destination + 'index.html') {
        response.writeHead(302, { location: destination + url.search, 'cache-control': 'no-store' });
        return response.end();
      }
    }
    const live = relative.startsWith(HARDWARE_DESK_PATH);
    const alias = live ? HARDWARE_DESK_PATH : relative.startsWith(BROWSER_DESK_PATH) ? BROWSER_DESK_PATH : undefined;
    if (alias) {
      const asset = relative.slice(alias.length);
      if (asset.includes('\\') || asset.split('/').includes('..') || (live && request.headers['service-worker'] === 'script'))
        return json(response, 404, { error: 'Not found' });
      relative = PRACTICE_ASSET_PATH + asset;
    }
		const root = await realpath(config.staticRoot);
    if (pin !== undefined) {
      try {
        const manifest = await realpath(resolve(root, '.' + PRACTICE_ASSET_PATH + 'offline-manifest.json'));
        if (!manifest.startsWith(root + sep)) return json(response, 409, { error: 'Requested build is unavailable' });
        const value: unknown = JSON.parse(await readFile(manifest, 'utf8'));
        if (!value || typeof value !== 'object' || !('cacheId' in value) || value.cacheId !== pin)
          return json(response, 409, { error: 'Requested build is unavailable' });
      } catch { return json(response, 409, { error: 'Requested build is unavailable' }); }
    }

		const file = resolve(root, `.${relative.endsWith('/') ? `${relative}index.html` : relative}`);
		if (!file.startsWith(root + sep)) return json(response, 404, { error: 'Not found' });
		try {
      const actual = await realpath(file);
      if (!actual.startsWith(root + sep) || (live && actual === resolve(root, '.' + PRACTICE_ASSET_PATH + 'sw.js')) || !(await stat(actual)).isFile())
        return json(response, 404, { error: 'Not found' });
			response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
			if (request.method === 'HEAD') return response.end();
			createReadStream(actual).on('error', () => response.destroy()).pipe(response);
		} catch { json(response, 404, { error: 'Not found' }); }
	};
	const safeHandler = (request: IncomingMessage, response: ServerResponse) => {
		void handler(request, response).catch(() => {
			if (response.headersSent) response.destroy();
			else json(response, 500, { error: 'Internal server error' });
		});
	};
	const server = config.tls ? createHttpsServer(config.tls, safeHandler) : createServer(safeHandler);
	server.on('close', () => { clearInterval(heartbeat); unsubscribe(); for (const client of clients) client.destroy(); for (const [id, session] of sessions) closeSession(id, session); });
	return server;
}
