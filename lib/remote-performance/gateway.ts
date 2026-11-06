import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { extname, resolve, sep } from 'node:path';
import { isPriorityCommand } from './commands.js';

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

export type Outcome = { outcome: 'applied' | 'rejected'; error?: string; state?: unknown; revision?: string; hostEpoch?: string } | { outcome: 'unknown' };
type Session = { highWater: number; inFlight: number; attached: boolean; results: Map<number, { request: string; result: Promise<Outcome> }> };
const MAX_SESSIONS = 128;
const MAX_RESULTS = 256;
const MAX_BODY = 64 * 1024;
const MAX_CLIENTS = 128;
const MAX_EVENT_BUFFER = 4 * 1024 * 1024;
const commands = new Set(['start', 'stop', 'control', 'selectChannel', 'setChannel', 'setClick', 'configureVoiceProfile']);

function json(response: ServerResponse, status: number, value: unknown) {
	response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let length = 0;
	for await (const chunk of request) {
		const bytes = Buffer.from(chunk);
		length += bytes.length;
		if (length > MAX_BODY) throw new Error('Body too large');
		chunks.push(bytes);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const contentTypes: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
	'.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

export function createGateway(config: GatewayConfig, instrument: Instrument) {
	if (config.token.length < 32) throw new Error('Token must contain at least 32 bytes');
	const origin = new URL(config.origin);
	if (origin.origin !== config.origin) throw new Error('Origin must be an exact origin');
	if (!config.tls && !['127.0.0.1', '::1', 'localhost'].includes(config.host)) {
		throw new Error('TLS is required for non-loopback listeners');
	}
	if ((config.tls ? 'https:' : 'http:') !== origin.protocol) throw new Error('Origin protocol does not match listener');
	const sessions = new Map<string, Session>();
	const clients = new Set<ServerResponse>();
	const send = (client: ServerResponse, data: Buffer) => {
		if (client.destroyed || client.writableLength + data.length > MAX_EVENT_BUFFER) {
			clients.delete(client); client.destroy(); return;
		}
		client.write(data);
	};
	const unsubscribe = instrument.subscribe((observation) => {
		const data = Buffer.from(`data: ${JSON.stringify(observation)}\n\n`);
		for (const client of clients) send(client, data);
	});
	const authenticated = (request: IncomingMessage) => {
		const header = request.headers.authorization;
		if (!header?.startsWith('Bearer ')) return false;
		const supplied = Buffer.from(header.slice(7));
		return supplied.length === config.token.length && timingSafeEqual(supplied, config.token);
	};
	const handler = async (request: IncomingMessage, response: ServerResponse) => {
		let path: string;
		try {
			if (!request.url || request.url.length > 8192) throw new Error('Invalid request target');
			path = new URL(request.url, config.origin).pathname;
		} catch { return json(response, 400, { error: 'Invalid request target' }); }
		if (path.startsWith('/api/')) {
			if (!authenticated(request)) return json(response, 401, { error: 'Unauthorized' });
			if (request.headers.origin && request.headers.origin !== config.origin) return json(response, 403, { error: 'Invalid origin' });
			if (request.method === 'GET' && path === '/api/session') {
				const snapshot = instrument.snapshot();
				if (!snapshot) return json(response, 503, { error: 'Host unavailable' });
				if (sessions.size >= MAX_SESSIONS) return json(response, 503, { error: 'Session capacity reached' });
				const sessionId = randomBytes(32).toString('hex');
				const session: Session = { highWater: 0, inFlight: 0, attached: false, results: new Map() };
				sessions.set(sessionId, session);
				setTimeout(() => { if (!session.attached) sessions.delete(sessionId); }, 30_000).unref();
				return json(response, 200, { ...snapshot, sessionId });
			}
			if (request.method === 'GET' && path === '/api/events') {
				if (clients.size >= MAX_CLIENTS) return json(response, 503, { error: 'Observer capacity reached' });
				const sessionId = request.headers['x-session-id'];
				const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
				if (!session || session.attached) return json(response, 409, { error: 'Session expired or already attached' });
				session.attached = true;
				response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
				clients.add(response);
				request.on('close', () => { clients.delete(response); sessions.delete(sessionId as string); });
				response.on('error', () => { clients.delete(response); response.destroy(); });
				const snapshot = instrument.snapshot();
				if (snapshot) send(response, Buffer.from(`data: ${JSON.stringify(snapshot)}\n\n`));
				return;
			}
			if (request.method === 'POST' && path === '/api/command') {
				if (request.headers.origin !== config.origin) return json(response, 403, { error: 'Origin required' });
				let body: unknown;
				try { body = await readBody(request); } catch { return json(response, 400, { error: 'Invalid body' }); }
				if (!object(body) || typeof body.sessionId !== 'string' || !Number.isSafeInteger(body.sequence) || Number(body.sequence) < 1 || typeof body.command !== 'string' || !commands.has(body.command) || !object(body.args)) {
					return json(response, 400, { error: 'Invalid command' });
				}
				const session = sessions.get(body.sessionId);
				if (!session) return json(response, 409, { error: 'Session expired' });
				const sequence = Number(body.sequence);
				const requestKey = JSON.stringify([body.command, body.args]);
				const retained = session.results.get(sequence);
				if (retained) {
					if (retained.request !== requestKey) return json(response, 409, { error: 'Command identity reused' });
					return json(response, 200, await retained.result);
				}
				if (sequence <= session.highWater) return json(response, 409, { error: 'Command expired' });
				if (session.inFlight >= MAX_RESULTS + (isPriorityCommand(body) ? 1 : 0)) return json(response, 503, { error: 'Command capacity reached' });
				session.highWater = sequence;
				session.inFlight++;
				const result: Promise<Outcome> = instrument.command({ command: body.command, args: body.args }).catch(
					() => ({ outcome: 'unknown' } as const),
				).finally(() => { session.inFlight--; });
				session.results.set(sequence, { request: requestKey, result });
				if (session.results.size > MAX_RESULTS) session.results.delete(session.results.keys().next().value!);
				return json(response, 200, await result);
			}
			return json(response, 404, { error: 'Not found' });
		}
		if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed' });
		let relative: string;
		try { relative = decodeURIComponent(path); } catch { return json(response, 400, { error: 'Invalid path' }); }
		const root = resolve(config.staticRoot);
		const file = resolve(root, `.${relative.endsWith('/') ? `${relative}index.html` : relative}`);
		if (!file.startsWith(root + sep)) return json(response, 404, { error: 'Not found' });
		try {
			if (!(await stat(file)).isFile()) return json(response, 404, { error: 'Not found' });
			response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
			if (request.method === 'HEAD') return response.end();
			createReadStream(file).on('error', () => response.destroy()).pipe(response);
		} catch { json(response, 404, { error: 'Not found' }); }
	};
	const safeHandler = (request: IncomingMessage, response: ServerResponse) => {
		void handler(request, response).catch(() => {
			if (response.headersSent) response.destroy();
			else json(response, 500, { error: 'Internal server error' });
		});
	};
	const server = config.tls ? createHttpsServer(config.tls, safeHandler) : createServer(safeHandler);
	server.on('close', () => { unsubscribe(); for (const client of clients) client.destroy(); });
	return server;
}
