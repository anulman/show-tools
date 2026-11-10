import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Readable } from 'node:stream';
import { Schema } from 'effect';
import { decodeDeskBootstrap, decodeDeskPublication, decodeNativeOutcome, DeskViewSchema, type NativePerformance, type NativeTarget } from '../remote-performance/session-schema.js';
import type { Control } from '../performance/model.js';
import { DESK_HEARTBEAT_MS, DESK_STREAM_IDLE_MS } from '../remote-performance/event-liveness.js';
import { ConnectAddressSchema, connectionOptions } from '../remote-performance/connection-options.js';

const integer = (minimum: number, maximum = Number.MAX_SAFE_INTEGER) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const path = Schema.NonEmptyString.check(Schema.isPattern(/^\//));
export const PeripheralBridgeConfigSchema = Schema.Struct({
	version: Schema.Literal(1), origin: Schema.NonEmptyString,
	connectAddress: Schema.optionalKey(ConnectAddressSchema),
	tokenFile: path, caFile: Schema.optionalKey(path), helperExecutable: path,
	sdkChannel: integer(0, 95), bindingRevision: integer(1),
	jiggle: Schema.Struct({ minimumTravel: integer(1, 32767), minimumReversal: integer(1, 32767) })
		.check(Schema.makeFilter(value => value.minimumReversal <= value.minimumTravel || 'Reversal threshold exceeds travel threshold')),
});
export type PeripheralBridgeConfig = typeof PeripheralBridgeConfigSchema.Type;
export const decodePeripheralBridgeConfig = Schema.decodeUnknownSync(PeripheralBridgeConfigSchema, { onExcessProperty: 'error' });
const helperInput = Schema.Union([
	Schema.Struct({ type: Schema.Literal('ready'), version: Schema.Literal(1), session: integer(1), released: Schema.Boolean }),
	Schema.Struct({ type: Schema.Literal('button'), session: integer(1), sequence: integer(1), down: Schema.Boolean }),
	Schema.Struct({ type: Schema.Literal('motion'), session: integer(1), sequence: integer(1), deltaY: Schema.Int.check(Schema.isBetween({ minimum: -32768, maximum: 32767 })) }),
	Schema.Struct({ type: Schema.Literal('detached'), session: integer(1) }),
	Schema.Struct({ type: Schema.Literal('delivered'), publication: integer(1) }),
]);
const decodeInput = Schema.decodeUnknownSync(helperInput, { onExcessProperty: 'error' });
type HelperInput = typeof helperInput.Type;
const decodeView = Schema.decodeUnknownSync(DeskViewSchema);

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

export class PeripheralRelay {
	private ready = false;
	private lastSequence = 0;
	private pending: Control[] = [];
	private pumping = false;
	private closed = false;
	private idle: Promise<void> = Promise.resolve();
	private enabled = false;
	constructor(private readonly session: number, private readonly send: (control: Control) => Promise<void>, private readonly failed: (error: unknown) => void) {}
	input(value: unknown) {
		if (this.closed) return;
		const input = decodeInput(value);
		if (input.type === 'delivered') return;
		if (input.session !== this.session) throw new Error('Peripheral session changed');
		if (input.type === 'detached') throw new PeripheralRetry('I-PAC disconnected');
		if (input.type === 'ready') {
			if (this.ready) throw new Error('Duplicate peripheral attachment');
			this.ready = true; return;
		}
		if (!this.ready || input.sequence <= this.lastSequence) throw new Error('Peripheral input sequence is stale');
		this.lastSequence = input.sequence;
		if (input.type === 'motion' && input.deltaY === 0) return;
		const control: Control = input.type === 'button' ? { id: 'cueButton', value: input.down ? 1 : 0 } : { id: 'knob', value: input.deltaY };
		const previous = this.pending.at(-1);
		if (control.id === 'knob' && previous?.id === 'knob' && Math.sign(control.value) === Math.sign(previous.value)) {
			const distance = previous.value + control.value;
			if (Math.abs(distance) > 1_000_000) throw new Error('Peripheral motion backlog overflow');
			this.pending[this.pending.length - 1] = { id: 'knob', value: distance };
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

export async function runPeripheralBridge(config: PeripheralBridgeConfig, signal: AbortSignal) {
	signal.throwIfAborted();
	const abort = new AbortController();
	const combined = AbortSignal.any([signal, abort.signal]);
	const link = await connection(config, combined);
	const bootstrap = decodeDeskBootstrap(await link.json('/api/session'));
	const audio = bootstrap.view.audio;
	if (audio.kind !== 'ready') throw new PeripheralRetry('Enable hardware audio in the desk before connecting the I-PAC');
	const target: NativeTarget = { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch };
	const session = randomBytes(6).readUIntBE(0, 6) + 1;
	const incarnation = randomBytes(6).readUIntBE(0, 6) + 1;
	const fence = 1;
	const tuple = `${incarnation} ${session} ${config.bindingRevision} ${fence}`;
	const child = spawn(config.helperExecutable, [String(session), String(config.sdkChannel), '--confirm-wiring'], { stdio: ['pipe', 'pipe', 'inherit'] });
	let commandSequence = 0, stopped = false, attached = false, configuredNative = false;
	let failure: unknown;
	let finishing = false;
	let finish: () => void = () => {};
	const done = new Promise<void>(resolve => { finish = resolve; });
	let ready: (attached: boolean) => void = () => {};
	const attachment = new Promise<boolean>(resolve => { ready = resolve; });
	const fail = (error: unknown) => { if (!stopped && !finishing) { finishing = true; failure = error; finish(); } };
	const write = (line: string) => {
		if (!child.stdin.writable || child.stdin.writableLength > 32768) throw new Error('Peripheral output queue is blocked');
		child.stdin.write(`${line}\n`);
	};
	const send = async (control: Control) => {
		const result = decodeNativeOutcome(await link.json('/api/command', {
			sessionId: bootstrap.sessionId, sequence: ++commandSequence, target, command: 'control', args: { control },
		}));
		if (result.outcome !== 'applied') {
			if (result.outcome === 'unknown') throw new PeripheralRetry('Peripheral control outcome unknown; this input will not be replayed');
			if (control.id === 'cueButton' && control.value === 0) throw new Error('Native button release rejected');
			process.stderr.write(`${JSON.stringify({ type: 'control-rejected', control, error: result.error })}\n`);
			return;
		}
		if (result.hostEpoch !== target.hostEpoch) throw new PeripheralRetry('Native engine changed');
	};
	const relay = new PeripheralRelay(session, send, fail);
	const light = (performance: NativePerformance) => {
		if (attached) write(`light ${tuple} ${performance.lights.join(' ')}`);
	};
	const startupTimeout = setTimeout(() => fail(new Error('Peripheral helper did not qualify within 3 seconds; inspect device access')), 3000);
	const helper = (async () => {
		for await (const line of boundedLines(child.stdout, 8192)) {
			const input: HelperInput = decodeInput(JSON.parse(line));
			relay.input(input);
			if (input.type === 'ready') { clearTimeout(startupTimeout); attached = true; write(`bind ${tuple}`); ready(true); }
		}
	})().catch(fail);
	child.once('error', fail);
	child.stdin.on('error', fail);
	child.once('exit', (code, signal) => fail(new (attached ? PeripheralRetry : PeripheralHelperUnavailable)(`Peripheral host exited (${signal ?? code}); inspect its diagnostic above and verify device access`)));
	combined.addEventListener('abort', finish, { once: true });
	if (combined.aborted) finish();
	const stream = (async () => {
		if (!await attachment || stopped) return;
		const configured = decodeNativeOutcome(await link.json('/api/command', {
			sessionId: bootstrap.sessionId, sequence: ++commandSequence, target, command: 'configureJiggle', args: config.jiggle,
		}));
		if (configured.outcome !== 'applied') throw new Error(`Jiggle setup ${configured.outcome}: ${configured.error ?? 'native acknowledgement unavailable'}`);
		if (configured.hostEpoch !== target.hostEpoch) throw new PeripheralRetry('Native engine changed during jiggle setup');
		configuredNative = true;
		await send({ id: 'cueButton', value: 0 });
		relay.start();
		const fresh = decodeView(await link.json('/api/status'));
		if (fresh.serverEpoch !== bootstrap.view.serverEpoch) throw new PeripheralRetry('Gateway restarted during I-PAC attachment');
		if (fresh.audio.kind !== 'ready' || fresh.audio.attempt !== target.attempt || fresh.audio.performance.hostEpoch !== target.hostEpoch)
			throw new PeripheralRetry('Hardware audio changed during I-PAC attachment');
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
				if (state.kind !== 'ready' || state.attempt !== target.attempt || state.performance.hostEpoch !== target.hostEpoch) throw new PeripheralRetry('Hardware audio session changed; reconnect the I-PAC');
				light(state.performance);
			} else {
				if (event.serverEpoch !== bootstrap.view.serverEpoch) throw new PeripheralRetry('Gateway restarted');
				if (event.attempt !== target.attempt || event.performance.hostEpoch !== target.hostEpoch) throw new PeripheralRetry('Hardware audio session changed');
				light(event.performance);
			}
		}
		throw new PeripheralRetry('Peripheral publication stream ended');
	})().catch(fail);
	try { await done; }
	finally {
		stopped = true; clearTimeout(startupTimeout); ready(false); const drained = relay.close();
		if (attached && child.stdin.writable) child.stdin.end('clear\nquit\n');
		else child.stdin.end();
		await drained;
		try {
			if (configuredNative) {
				const cleanup = await connection(config, AbortSignal.timeout(3000));
				const session = decodeDeskBootstrap(await cleanup.json('/api/session'));
				const result = decodeNativeOutcome(await cleanup.json('/api/command', {
					sessionId: session.sessionId, sequence: 1, target, command: 'control', args: { control: { id: 'cueButton', value: 0 } },
			}));
			if (result.outcome !== 'applied') throw new Error('Native release was not acknowledged');
			}
		} catch (error) { process.stderr.write(`I-PAC disconnected; native release unconfirmed: ${error instanceof Error ? error.message : String(error)}\n`); }
		abort.abort();
		const terminate = setTimeout(() => child.kill('SIGTERM'), 1000);
		const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
		await new Promise<void>(resolve => { if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', () => resolve()); });
		clearTimeout(terminate); clearTimeout(kill); await stream; await helper;
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
