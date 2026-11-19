import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Readable } from 'node:stream';
import { Schema } from 'effect';
import { decodeDeskBootstrap, decodeDeskPublication, decodeNativeOutcome, decodeInputAttachOutcome, decodeInputIntentStatus, DeskViewSchema, type InputLeaseReceipt, type InputIntentStatus, type NativePerformance, type NativeTarget } from '../remote-performance/session-schema.js';
import { PHYSICAL_SWITCH_IDS } from '../performance/model.js';
import { decodeBrowserInput, physicalReadyMasks, type HelperInput, type HelperReady } from './browser-protocol.js';
import { DESK_HEARTBEAT_MS, DESK_STREAM_IDLE_MS } from '../remote-performance/event-liveness.js';
import { ConnectAddressSchema, connectionOptions } from '../remote-performance/connection-options.js';

const integer = (minimum: number, maximum = Number.MAX_SAFE_INTEGER) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const path = Schema.NonEmptyString.check(Schema.isPattern(/^\//));
const physical = Schema.Literals(PHYSICAL_SWITCH_IDS);
const sourceId = Schema.NonEmptyString.check(Schema.isMaxLength(32), Schema.isPattern(/^[A-Za-z0-9_-]+$/));
const capabilities = Schema.Array(integer(0, 65535)).check(Schema.isMaxLength(1024),
	Schema.makeFilter(values => values.every((value, index) => index === 0 || value > values[index - 1]) || 'Capabilities must be sorted and unique'));
const selector = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('linux'), id: sourceId, interfaceNumber: integer(0, 255), eventTypes: capabilities, keyCodes: capabilities, relativeAxes: capabilities }),
	Schema.Struct({ kind: Schema.Literal('hid'), id: sourceId, interfaceNumber: integer(0, 255), usagePage: integer(1, 65535), usage: integer(1, 65535) }),
]);
const rawInput = { sourceId, type: integer(0, 65535), code: integer(0, 65535) };
export const PeripheralInputMapSchema = Schema.Struct({
	sources: Schema.NonEmptyArray(selector).check(Schema.isMaxLength(8)),
	switches: Schema.Array(Schema.Struct({ controlId: physical, ...rawInput })).check(Schema.isMaxLength(6)),
	axis: Schema.optionalKey(Schema.Struct(rawInput)),
	leds: Schema.Array(Schema.Struct({ controlId: physical, sdkChannel: integer(0, 95) })).check(Schema.isMaxLength(6)),
	confirmWiring: Schema.Boolean,
}).check(Schema.makeFilter(map => {
	if ((!map.switches.length && !map.axis) || (map.leds.length && !map.confirmWiring)) return 'Require explicit inputs and confirmed LED wiring when mapped';
	if (new Set(map.sources.map(value => value.id)).size !== map.sources.length) return 'Duplicate source ID';
	if (new Set(map.sources.map(value => value.kind)).size !== 1) return 'A map belongs to one host platform';
	const signatures = map.sources.map(value => value.kind === 'linux'
		? JSON.stringify([value.interfaceNumber, value.eventTypes, value.keyCodes, value.relativeAxes])
		: JSON.stringify([value.interfaceNumber, value.usagePage, value.usage]));
	if (new Set(signatures).size !== signatures.length) return 'Duplicate source selector';
	if (new Set(map.switches.map(value => value.controlId)).size !== map.switches.length) return 'Duplicate physical switch';
	if (new Set(map.leds.map(value => value.controlId)).size !== map.leds.length || new Set(map.leds.map(value => value.sdkChannel)).size !== map.leds.length) return 'Duplicate LED identity or SDK channel';
	const inputs = [...map.switches.map(value => ({ ...value, axis: false })), ...(map.axis ? [{ ...map.axis, axis: true }] : [])];
	if (new Set(inputs.map(value => JSON.stringify([value.sourceId, value.type, value.code]))).size !== inputs.length) return 'Raw inputs cannot alias physical controls';
	const used = new Set<string>();
	for (const input of inputs) {
		const source = map.sources.find(value => value.id === input.sourceId);
		if (!source) return 'Input source is not declared';
		used.add(source.id);
		if (source.kind === 'linux') {
			if (input.type !== (input.axis ? 2 : 1) || !source.eventTypes.includes(input.type)
				|| !(input.axis ? source.relativeAxes : source.keyCodes).includes(input.code)) return 'Input is absent from Linux capabilities';
		} else if (!input.type || !input.code) return 'HID element usages must be positive';
	}
	return used.size === map.sources.length || 'Every source must supply an input';
}));
export type PeripheralInputMap = typeof PeripheralInputMapSchema.Type;
export const decodePeripheralInputMap = Schema.decodeUnknownSync(PeripheralInputMapSchema, { onExcessProperty: 'error' });
export const PeripheralBridgeConfigSchema = Schema.Struct({
	version: Schema.Literal(2), origin: Schema.NonEmptyString,
	connectAddress: Schema.optionalKey(ConnectAddressSchema),
	tokenFile: path, caFile: Schema.optionalKey(path), helperExecutable: path,
	inputMap: PeripheralInputMapSchema, bindingRevision: integer(1),
	jiggle: Schema.Union([Schema.Null, Schema.Struct({ minimumTravel: integer(1, 32767), minimumReversal: integer(1, 32767) })
		.check(Schema.makeFilter(value => value.minimumReversal <= value.minimumTravel || 'Reversal threshold exceeds travel threshold'))]),
});
export type PeripheralBridgeConfig = typeof PeripheralBridgeConfigSchema.Type;
export const decodePeripheralBridgeConfig = Schema.decodeUnknownSync(PeripheralBridgeConfigSchema, { onExcessProperty: 'error' });
const decodeInput = decodeBrowserInput;
const decodeView = Schema.decodeUnknownSync(DeskViewSchema);

export function peripheralHelperArgs(session: number, map: PeripheralInputMap): string[] {
	const args = [String(session), '--map-version', '2'];
	const list = (values: readonly number[]) => values.length ? values.join(',') : '-';
	for (const source of map.sources) args.push(...(source.kind === 'linux'
		? ['--linux-source', source.id, String(source.interfaceNumber), list(source.eventTypes), list(source.keyCodes), list(source.relativeAxes)]
		: ['--hid-source', source.id, String(source.interfaceNumber), String(source.usagePage), String(source.usage)]));
	for (const input of map.switches) args.push('--switch', input.controlId, input.sourceId, String(input.type), String(input.code));
	if (map.axis) args.push('--axis', 'knob', map.axis.sourceId, String(map.axis.type), String(map.axis.code));
	for (const led of map.leds) args.push('--led', led.controlId, String(led.sdkChannel));
	if (map.confirmWiring) args.push('--confirm-wiring');
	return args;
}
export function validateHelperReady(ready: HelperReady, map: PeripheralInputMap): void {
	const expected = new Set(map.switches.map(value => value.controlId));
	if (expected.size !== ready.switches.length || ready.switches.some(value => !expected.has(value.controlId)))
		throw new Error('Helper ready switches differ from the configured physical map');
}

export async function* boundedLines(input: Readable, maximum: number) {
	let pending = Buffer.alloc(0);
	for await (const chunk of input) {
		pending = Buffer.concat([pending, Buffer.from(chunk)]);
		let end: number;
		while ((end = pending.indexOf(10)) >= 0) {
			if (end > maximum) throw new Error('Peripheral stream line exceeds its size limit');
			yield pending.subarray(0, end).toString('utf8').replace(/\r$/, '');
			pending = pending.subarray(end + 1);
		}
		if (pending.length > maximum) throw new Error('Peripheral stream line exceeds its size limit');
	}
	if (pending.length) throw new Error('Peripheral stream ended with an incomplete line');
}

const MUSICAL_KNOB = 6;
const OBSERVED_KNOB = 7;
type KnobInput = typeof MUSICAL_KNOB | typeof OBSERVED_KNOB;

export interface PhysicalInputEvent { readonly sequence: number; readonly input: number; readonly value: number }
export class PeripheralRelay {
	private ready = false;
	private lastSequence = 0;
	private pending: PhysicalInputEvent[] = [];
	private switches = new Set<string>();
	private pumping = false;
	private closed = false;
	private idle: Promise<void> = Promise.resolve();
	private enabled = false;
	constructor(private readonly session: number, private readonly send: (event: PhysicalInputEvent) => Promise<void>, private readonly failed: (error: unknown) => void, private readonly knobInput: KnobInput | null = MUSICAL_KNOB) {}
	input(value: unknown) {
		if (this.closed) return;
		const input = decodeInput(value);
		if (input.type === 'delivered') return;
		if (input.session !== this.session) throw new Error('Peripheral session changed');
		if (input.type === 'detached') throw new PeripheralRetry('I-PAC disconnected');
		if (input.type === 'ready') {
			if (this.ready) throw new Error('Duplicate peripheral attachment');
			this.switches = new Set(input.switches.map(value => value.controlId));
			this.ready = true; return;
		}
		if (!this.ready || input.sequence <= this.lastSequence) throw new Error('Peripheral input sequence is stale');
		this.lastSequence = input.sequence;
		if (input.type === 'button' && !this.switches.has(input.controlId)) throw new Error('Unconfigured physical switch');
		const inputId = input.type === 'button' ? PHYSICAL_SWITCH_IDS.indexOf(input.controlId) : this.knobInput;
		if (inputId === null || (input.type === 'motion' && input.deltaY === 0)) return;
		const control: PhysicalInputEvent = { sequence: input.sequence, input: inputId,
			value: input.type === 'button' ? Number(input.down) : input.deltaY };
		const previous = this.pending.at(-1);
		if (input.type === 'motion' && previous?.input === inputId && Math.sign(control.value) === Math.sign(previous.value)) {
			const distance = previous.value + control.value;
			if (Math.abs(distance) > 1_000_000) throw new Error('Peripheral motion backlog overflow');
			this.pending[this.pending.length - 1] = { ...control, value: distance };
		}
		else this.pending.push(control);
		if (this.pending.length > 16) throw new Error('Peripheral input queue overflow; reconnect after releasing the button');
		if (this.enabled && !this.pumping) this.idle = this.pump();
	}
	start() { if (!this.closed) { this.enabled = true; if (!this.pumping) this.idle = this.pump(); } }
	private async pump() {
		if (this.pumping || this.closed) return;
		this.pumping = true;
		try {
			while (!this.closed) {
				const control = this.pending.shift();
				if (!control) break;
				await this.send(control);
			}
		} catch (error) { this.close(); this.failed(error); }
		finally { this.pumping = false; }
	}
	close() { this.closed = true; this.pending = []; return this.idle; }
}

async function privateToken(file: string) {
	const info = await stat(file);
	if (!info.isFile() || info.size > 4096 || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid()))
		throw new Error('Gateway token must be a caller-owned regular file with mode 600');
	const token = (await readFile(file, 'utf8')).trim();
	if (token.length < 32 || /\s/.test(token)) throw new Error('Invalid gateway token');
	return token;
}

export class PeripheralRetry extends Error {}
export class PeripheralHelperUnavailable extends Error {}

export class PeripheralHttpError extends Error {
	constructor(readonly status: number | undefined) { super(`Peripheral gateway request failed (${status})`); }
}

export async function connection(config: PeripheralBridgeConfig, signal: AbortSignal) {
	const origin = new URL(config.origin);
	if (origin.origin !== config.origin || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) throw new Error('Gateway origin must be a plain HTTP(S) origin');
	if (origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Remote gateway requires HTTPS');
	const route = connectionOptions(origin, config.connectAddress);
	const token = await privateToken(config.tokenFile);
	const ca = config.caFile ? await readFile(config.caFile) : undefined;
	function open(path: string, body?: object, headers?: Record<string, string>): Promise<IncomingMessage> {
		return new Promise((resolve, reject) => {
			const payload = body ? JSON.stringify(body) : undefined;
			const request = (origin.protocol === 'https:' ? httpsRequest : httpRequest)(new URL(path, origin), {
				...route, method: payload ? 'POST' : 'GET', ca, signal,
				headers: { ...route.headers, authorization: `Bearer ${token}`, origin: config.origin, ...headers,
					...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) },
			}, response => {
				clearTimeout(timeout);
				if (response.statusCode !== 200) { response.resume(); reject(new PeripheralHttpError(response.statusCode)); }
				else resolve(response);
			});
			const timeout = setTimeout(() => request.destroy(new PeripheralRetry('Peripheral gateway timed out')), 3000);
			request.once('close', () => clearTimeout(timeout));
			request.once('error', reject);
			request.end(payload);
		});
	}
	async function json(path: string, body?: object): Promise<unknown> {
		const response = await open(path, body);
		const chunks: Buffer[] = []; let length = 0;
		const timeout = setTimeout(() => response.destroy(new PeripheralRetry('Peripheral gateway body timed out')), 3000);
		try {
			for await (const chunk of response) {
				const bytes = Buffer.from(chunk); length += bytes.length;
				if (length > 8 * 1024 * 1024) { response.destroy(); throw new Error('Peripheral gateway response is oversized'); }
				chunks.push(bytes);
			}
		} finally { clearTimeout(timeout); }
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	}
	return { open, json };
}

export interface PeripheralDevice {
	readonly session: number;
	snapshot(): HelperReady;
	subscribe(input: (value: HelperInput) => void, failed: (error: unknown) => void): () => void;
	write(line: string): void;
	bind(engineKey: string, revision: number): string;
	close(): Promise<void>;
}

export async function openPeripheralDevice(config: PeripheralBridgeConfig, signal: AbortSignal): Promise<PeripheralDevice> {
	signal.throwIfAborted();
	const session = randomBytes(6).readUIntBE(0, 6) + 1;
	const child = spawn(config.helperExecutable, peripheralHelperArgs(session, config.inputMap), { stdio: ['pipe', 'pipe', 'inherit'] });
	const listeners = new Set<{ input: (value: HelperInput) => void; failed: (error: unknown) => void }>();
	let initial: HelperReady | undefined, sequence = 0, failure: unknown, closing = false;
	let engineKey = '', incarnation = 0, fence = 0;
	let resolveReady!: (value: HelperReady) => void, rejectReady!: (error: unknown) => void;
	const ready = new Promise<HelperReady>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
	const fail = (error: unknown) => {
		if (closing || failure) return;
		failure = error; rejectReady(error);
		for (const listener of listeners) listener.failed(error);
	};
	const write = (line: string) => {
		if (!child.stdin.writable || child.stdin.writableLength > 32768) throw new Error('Peripheral output queue is blocked');
		child.stdin.write(`${line}\n`);
	};
	const timeout = setTimeout(() => fail(new PeripheralHelperUnavailable('Peripheral helper did not qualify within 3 seconds; inspect device access')), 3000);
	child.once('error', fail); child.stdin.on('error', fail);
	child.once('exit', (code, stopped) => fail(new (initial ? PeripheralRetry : PeripheralHelperUnavailable)(`Peripheral host exited (${stopped ?? code}); inspect its diagnostic and device access`)));
	const reading = (async () => {
		for await (const line of boundedLines(child.stdout, 8192)) {
			const input = decodeInput(JSON.parse(line));
			if (input.type !== 'delivered' && input.session !== session) throw new Error('Peripheral session changed');
			if (input.type === 'ready') {
				if (initial) throw new Error('Duplicate peripheral attachment');
				validateHelperReady(input, config.inputMap); initial = input; clearTimeout(timeout); resolveReady(input);
			} else if (input.type === 'detached') throw new PeripheralRetry('I-PAC disconnected');
			else if (input.type !== 'delivered') {
				if (!initial || input.sequence <= sequence) throw new Error('Peripheral input sequence is stale');
				sequence = input.sequence;
				if (input.type === 'motion' && !config.inputMap.axis) throw new Error('Unconfigured physical axis');
				if (input.type === 'button') {
					if (!initial.switches.some(value => value.controlId === input.controlId)) throw new Error('Unconfigured physical switch');
					initial = { ...initial, switches: initial.switches.map(value => value.controlId === input.controlId ? { ...value, state: input.down ? 'held' : 'released' } : value) };
				}
			}
			for (const listener of listeners) listener.input(input);
		}
		fail(new (initial ? PeripheralRetry : PeripheralHelperUnavailable)('Peripheral input stream ended'));
	})().catch(fail);
	let closed: Promise<void> | undefined;
	const close = () => closed ??= (async () => {
		closing = true; clearTimeout(timeout); signal.removeEventListener('abort', aborted);
		if (child.stdin.writable) child.stdin.end('clear\nquit\n');
		const terminate = setTimeout(() => child.kill('SIGTERM'), 1000);
		const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
		await new Promise<void>(resolve => { if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', () => resolve()); });
		clearTimeout(terminate); clearTimeout(kill); await reading;
	})();
	const aborted = () => { rejectReady(signal.reason); for (const listener of listeners) listener.failed(signal.reason); void close(); };
	signal.addEventListener('abort', aborted, { once: true });
	if (signal.aborted) aborted();
	try { await ready; signal.throwIfAborted(); }
	catch (error) { await close(); throw error; }
	return { session, snapshot() { if (failure) throw failure; if (!initial) throw new Error('Peripheral is not ready'); return initial; },
		subscribe(input, failed) { const listener = { input, failed }; listeners.add(listener); if (failure) failed(failure); return () => { listeners.delete(listener); }; }, write,
		bind(key, revision) {
			if (key !== engineKey) { engineKey = key; incarnation++; }
			if (++fence > Number.MAX_SAFE_INTEGER || incarnation > Number.MAX_SAFE_INTEGER) throw new Error('Peripheral light identity exhausted; restart its service');
			const tuple = `${incarnation} ${session} ${revision} ${fence}`; write(`bind ${tuple}`); return tuple;
		}, close };
}

export class PeripheralOwnershipUnconfirmed extends Error {
	constructor(readonly retired: () => Promise<boolean>, cause: unknown) {
		super('Native source revocation is unconfirmed. Physical LED feedback remains available; musical input waits for exact retirement or verified audio recovery.', { cause });
	}
}

async function nativeContext(config: PeripheralBridgeConfig, signal: AbortSignal) {
	signal.throwIfAborted();
	const abort = new AbortController();
	const link = await connection(config, abort.signal);
	const bootstrap = decodeDeskBootstrap(await link.json('/api/session'));
	signal.throwIfAborted();
	const audio = bootstrap.view.audio;
	if (audio.kind !== 'ready') throw new PeripheralRetry('Hardware audio is off; physical feedback remains independent');
	const target: NativeTarget = { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch };
	const bindingGeneration = audio.performance.state.inputRouting?.bindingGeneration;
	if (bindingGeneration === undefined) throw new Error('Native input routing is unavailable; update the engine before connecting');
	return { abort, link, bootstrap, target, bindingGeneration };
}
export async function runPeripheralBridge(config: PeripheralBridgeConfig, signal: AbortSignal, sharedDevice?: PeripheralDevice) {
	const context = await nativeContext(config, signal);
	try {
		const device = sharedDevice ?? await openPeripheralDevice(config, signal);
		try { await attachNativeSession(config, signal, device, context); }
		finally { if (!sharedDevice) await device.close(); }
	} finally { context.abort.abort(); }
}
async function attachNativeSession(config: PeripheralBridgeConfig, signal: AbortSignal, device: PeripheralDevice, context: Awaited<ReturnType<typeof nativeContext>>) {
	const { abort, link, bootstrap, target, bindingGeneration } = context;
	const combined = AbortSignal.any([signal, abort.signal]);
	const intentId = randomUUID();
	let receipt: InputLeaseReceipt | undefined;
	const initial = device.snapshot();
	const tuple = device.bind(`${bootstrap.view.serverEpoch}/${target.attempt}/${target.hostEpoch}`, config.bindingRevision);
	let commandSequence = 0, stopped = false, releaseRequired = false;
	let failure: unknown;
	let finishing = false;
	let finish: () => void = () => {};
	const done = new Promise<void>(resolve => { finish = resolve; });
	const fail = (error: unknown) => { if (signal.aborted) { finish(); return; } if (!stopped && !finishing) { finishing = true; failure = error; finish(); } };
	const send = async (event: PhysicalInputEvent) => {
		const result = decodeNativeOutcome(await link.json('/api/command', {
			sessionId: bootstrap.sessionId, sequence: ++commandSequence, target, command: 'inputEvent', args: { kind: 'physical', bindingGeneration, ...event },
		}));
		if (result.outcome !== 'applied') {
			if (result.outcome === 'unknown') throw new PeripheralRetry('Peripheral control outcome unknown; this input will not be replayed');
			if (event.input < PHYSICAL_SWITCH_IDS.length && event.value === 0) throw new PeripheralRetry('Native button release rejected; reconnect the physical source');
			process.stderr.write(`${JSON.stringify({ type: 'input-rejected', event, error: result.error })}\n`); return;
		}
		if (result.hostEpoch !== target.hostEpoch) throw new PeripheralRetry('Native engine changed');
	};
	const knobInput = !config.inputMap.axis ? null : config.jiggle ? MUSICAL_KNOB : OBSERVED_KNOB;
	const relay = new PeripheralRelay(device.session, send, fail, knobInput);
	relay.input(initial);
	const unsubscribe = device.subscribe(value => { try { if (value.type !== 'ready') relay.input(value); } catch (error) { fail(error); } }, fail);
	const exactRetirement = (status: InputIntentStatus): boolean => {
		if (status.kind !== 'retired') return false;
		const proof = status.proof;
		switch (proof.kind) {
			case 'rejected-before-admission': return !receipt && proof.target.attempt === target.attempt && proof.target.hostEpoch === target.hostEpoch && proof.kindOfProducer === 'physical' && proof.bindingGeneration === bindingGeneration;
			case 'old-engine-ended': return proof.target.attempt === target.attempt && proof.target.hostEpoch === target.hostEpoch && proof.serverEpoch === bootstrap.view.serverEpoch && proof.kindOfProducer === 'physical' && proof.bindingGeneration === bindingGeneration;
			case 'binding-generation-retired': return proof.target.attempt === target.attempt && proof.target.hostEpoch === target.hostEpoch
				&& proof.serverEpoch === bootstrap.view.serverEpoch && proof.kindOfProducer === 'physical' && proof.bindingGeneration === bindingGeneration
				&& proof.currentBindingGeneration > bindingGeneration && (!receipt || BigInt(proof.replacementRevision) > BigInt(receipt.admissionRevision));
			case 'exact-revoke-applied': return proof.receipt.target.attempt === target.attempt && proof.receipt.target.hostEpoch === target.hostEpoch && proof.receipt.kind === 'physical' && proof.receipt.bindingGeneration === bindingGeneration && BigInt(proof.revocationRevision) > BigInt(proof.receipt.admissionRevision) && (!receipt || proof.receipt.producer === receipt.producer && proof.receipt.session === receipt.session && proof.receipt.admissionRevision === receipt.admissionRevision);
		}
	};
	const readRetirement = async () => {
		const cleanup = await connection(config, AbortSignal.timeout(3000));
		return exactRetirement(decodeInputIntentStatus(await cleanup.json('/api/input-intent-status', { inputOwnerToken: bootstrap.inputOwnerToken, intentId })));
	};
	let revocation: Promise<void> | undefined;
	const revokeInput = () => revocation ??= (async () => {
		const cleanup = await connection(config, AbortSignal.timeout(3000));
		let revokeError: unknown;
		try {
			const result = decodeNativeOutcome(await cleanup.json('/api/command', { sessionId: bootstrap.sessionId, sequence: ++commandSequence, target, command: 'inputRevoke', args: { kind: 'physical' } }));
			if (result.outcome !== 'applied') throw new Error('Native source revocation was not acknowledged');
		} catch (error) { revokeError = error; }
		if (!await readRetirement()) throw revokeError ?? new Error('Native source retirement remains unconfirmed');
		releaseRequired = false;
	})();
	const light = (performance: NativePerformance) => {
		if (performance.state.inputRouting?.bindingGeneration !== bindingGeneration) throw new PeripheralRetry('Song input bindings changed; reconnect the physical source');
		if (!stopped) device.write(`light ${tuple} ${performance.lights.join(' ')}`);
	};
	combined.addEventListener('abort', finish, { once: true }); if (combined.aborted) finish();
	const stream = (async () => {
		if (stopped || finishing) return;
		if (config.jiggle !== null) {
			const configured = decodeNativeOutcome(await link.json('/api/command', { sessionId: bootstrap.sessionId, sequence: ++commandSequence, target, command: 'configureJiggle', args: config.jiggle }));
			if (configured.outcome !== 'applied' || configured.hostEpoch !== target.hostEpoch) throw new Error('Jiggle setup was not acknowledged by the current engine');
		}
		releaseRequired = true;
		const admission = decodeInputAttachOutcome(await link.json('/api/command', { sessionId: bootstrap.sessionId, sequence: ++commandSequence, target, command: 'inputAttach', args: { kind: 'physical', bindingGeneration, ...physicalReadyMasks(initial), intentId } }));
		if (admission.outcome !== 'applied' || admission.hostEpoch !== target.hostEpoch) throw new PeripheralRetry('Physical input admission was not acknowledged');
		const admitted = admission.receipt;
		if (admitted.target.attempt !== target.attempt || admitted.target.hostEpoch !== target.hostEpoch || admitted.kind !== 'physical' || admitted.bindingGeneration !== bindingGeneration || admitted.admissionRevision !== admission.revision || admission.state.inputRouting?.bindingGeneration !== bindingGeneration || !admission.state.inputRouting.producers.some(value => value.producer === admitted.producer && value.session === admitted.session && value.kind === 'physical')) throw new Error('Physical input admission receipt does not match this attachment');
		receipt = admitted; relay.start();
		const fresh = decodeView(await link.json('/api/status'));
		if (fresh.serverEpoch !== bootstrap.view.serverEpoch || fresh.audio.kind !== 'ready' || fresh.audio.attempt !== target.attempt || fresh.audio.performance.hostEpoch !== target.hostEpoch) throw new PeripheralRetry('Hardware audio changed during I-PAC attachment');
		light(fresh.audio.performance);
		const response = await link.open('/api/events', undefined, { 'x-session-id': bootstrap.sessionId });
		for await (const line of liveEventLines(response)) {
			if (!line.startsWith('data: ')) continue;
			if (line.length > 8 * 1024 * 1024) throw new Error('Peripheral publication is oversized');
			const event = decodeDeskPublication(JSON.parse(line.slice(6)));
			if (event.type === 'gap') throw new PeripheralRetry('Native publication gap');
			if (event.type === 'event') continue;
			if (event.type === 'desk') {
				if (event.view.serverEpoch !== bootstrap.view.serverEpoch) throw new PeripheralRetry('Gateway restarted');
				const state = event.view.audio;
				if (state.kind !== 'ready' || state.attempt !== target.attempt || state.performance.hostEpoch !== target.hostEpoch) throw new PeripheralRetry('Hardware audio session changed');
				light(state.performance);
			} else {
				if (event.serverEpoch !== bootstrap.view.serverEpoch || event.attempt !== target.attempt || event.performance.hostEpoch !== target.hostEpoch) throw new PeripheralRetry('Hardware audio session changed');
				light(event.performance);
			}
		}
		throw new PeripheralRetry('Peripheral publication stream ended');
	})().catch(fail);
	try { await done; }
	finally {
		stopped = true; unsubscribe(); combined.removeEventListener('abort', finish); const drained = relay.close();
		try { device.write(`clear ${tuple}`); } catch (error) { if (!signal.aborted) failure ??= error; }
		await drained;
		try { if (releaseRequired) await revokeInput(); }
		catch (error) { failure = new PeripheralOwnershipUnconfirmed(readRetirement, error); }
		abort.abort(); await stream;
	}
	if (failure) throw failure;
}

export async function* liveEventLines(response: Readable, idleMs = DESK_STREAM_IDLE_MS) {
	let timeout: ReturnType<typeof setTimeout>;
	const reset = () => {
		clearTimeout(timeout);
		timeout = setTimeout(() => response.destroy(new PeripheralRetry(`Gateway event stream silent; expected heartbeat every ${DESK_HEARTBEAT_MS} ms`)), idleMs);
	};
	reset();
	try {
		for await (const line of boundedLines(response, 8 * 1024 * 1024)) {
			if (line === ': show-tools-heartbeat' || line.startsWith('data: ')) reset();
			yield line;
		}
	} finally { clearTimeout(timeout!); }
}
