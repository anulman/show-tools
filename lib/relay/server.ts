import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { parseControlMessage, parseProducer, validateEnvelope, type PerformanceEnvelope } from './controls.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const assetRoot = resolve(repoRoot, 'dist');
const mime: Readonly<Record<string, string>> = { '.html': 'text/html', '.js': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8' };

interface RelayOptions { token?: string; serveUI?: boolean; tls?: https.ServerOptions }
class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function createRelay({ token = randomBytes(24).toString('base64url'), serveUI = true, tls }: RelayOptions = {}) {
  const observers = new Set<ServerResponse>();
  const producers = new Set<ServerResponse>();
  const commandIds = new Map<string, string>();
  const retiredRuns = new Set<string>();
  let owner: { id: string; lastSeen: number } | null = null;
  let latest: PerformanceEnvelope | null = null;
  let leaseRevision = 0;
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const send = (res: ServerResponse, name: string, value: unknown) => {
    if (res.destroyed || res.writableLength > 262144) { res.destroy(); return; }
    res.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
  };
  const stream = (res: ServerResponse, clients: Set<ServerResponse>) => {
    if (observers.size + producers.size >= 64) { json(res, 503, { error: 'Listener limit reached' }); return false; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    clients.add(res);
    res.on('close', () => clients.delete(res));
    return true;
  };
  const body = async (req: IncomingMessage): Promise<unknown> => {
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) {
      if (!(chunk instanceof Uint8Array)) throw new RequestError('Expected a binary request body', 400);
      bytes += chunk.byteLength;
      if (bytes > 65536) throw new RequestError('Request is too large', 413);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw new RequestError('Expected JSON', 400); }
  };
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Producer-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const path = new URL(req.url || '/', 'http://relay.local').pathname;
      if (path === '/api/health' && req.method === 'GET') {
        json(res, 200, { v: 1, producerConnected: producers.size > 0, observers: observers.size, serveUI }); return;
      }
      if (path.startsWith('/api/')) {
        if (req.headers.authorization !== `Bearer ${token}`) { json(res, 401, { error: 'Relay token required' }); return; }
        const producerId = req.headers['x-producer-id'];
        if (path === '/api/producer' && req.method === 'POST') {
          const value = parseProducer(await body(req));
          if (owner && owner.id !== value.producerId && (producers.size || Date.now() - owner.lastSeen < 15000)) {
            json(res, 409, { error: 'Another audio producer owns this relay' }); return;
          }
          if (owner?.id !== value.producerId) {
            owner = { id: value.producerId, lastSeen: Date.now() };
            latest = null;
            retiredRuns.clear();
            commandIds.clear();
            leaseRevision++;
          }
          owner.lastSeen = Date.now();
          json(res, 200, { producerId: owner.id, leaseRevision }); return;
        }
        if (path === '/api/producer' && req.method === 'DELETE') {
          if (!owner || producerId !== owner.id) { json(res, 409, { error: 'Producer lease required' }); return; }
          for (const client of producers) client.end();
          producers.clear(); owner = null; latest = null;
          json(res, 200, { released: true }); return;
        }
        if (path === '/api/events' && req.method === 'GET') {
          if (stream(res, observers) && latest) send(res, 'performance', latest);
          return;
        }
        if (path === '/api/events' && req.method === 'POST') {
          if (!owner || producerId !== owner.id) { json(res, 409, { error: 'Producer lease required' }); return; }
          const publishingOwner = owner;
          const event = validateEnvelope(await body(req));
          if (owner !== publishingOwner) { json(res, 409, { error: 'Producer lease changed while reading the event' }); return; }
          owner.lastSeen = Date.now();
          if (retiredRuns.has(event.runId) || (latest?.runId === event.runId && event.seq <= latest.seq)) {
            json(res, 409, { error: 'Stale performance event' }); return;
          }
          if (latest && latest.runId !== event.runId) {
            retiredRuns.add(latest.runId);
            const oldest = retiredRuns.values().next().value;
            if (retiredRuns.size > 128 && oldest !== undefined) retiredRuns.delete(oldest);
          }
          latest = event;
          for (const client of observers) send(client, 'performance', event);
          json(res, 202, { accepted: true, runId: event.runId, seq: event.seq }); return;
        }
        if (path === '/api/controls' && req.method === 'GET') {
          if (!owner || producerId !== owner.id) { json(res, 409, { error: 'Producer lease required' }); return; }
          if (producers.size) { json(res, 409, { error: 'Producer control stream is already connected' }); return; }
          stream(res, producers); return;
        }
        if (path === '/api/controls' && req.method === 'POST') {
          const input = parseControlMessage(await body(req));
          const signature = JSON.stringify(input.control);
          if (commandIds.has(input.commandId)) {
            if (commandIds.get(input.commandId) !== signature) { json(res, 409, { error: 'Command ID was already used for another control' }); return; }
            json(res, 200, { accepted: true, duplicate: true }); return;
          }
          if (!producers.size) { json(res, 503, { error: 'No audio producer is listening' }); return; }
          commandIds.set(input.commandId, signature);
          const oldest = commandIds.keys().next().value;
          if (commandIds.size > 1024 && oldest !== undefined) commandIds.delete(oldest);
          for (const client of producers) send(client, 'control', input);
          json(res, 202, { accepted: true, applied: false, commandId: input.commandId }); return;
        }
        json(res, 404, { error: 'Unknown endpoint' }); return;
      }
      if (!serveUI || req.method !== 'GET') { json(res, 404, { error: 'Not found' }); return; }
      if (path === '/') { res.writeHead(302, { Location: '/ui/practice/' }); res.end(); return; }
      const decoded = decodeURIComponent(path);
      if (!decoded.startsWith('/ui/practice/') || decoded.split('/').some(part => part.startsWith('.'))) {
        json(res, 404, { error: 'Not found' }); return;
      }
      let target = resolve(assetRoot, `.${decoded}`);
      if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html');
      target = await realpath(target);
      if (!target.startsWith(assetRoot + sep)) { json(res, 404, { error: 'Not found' }); return; }
      const data = await readFile(target);
      res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      const status = missing ? 404 : error instanceof RequestError ? error.status : 400;
      const message = missing ? 'Not found' : error instanceof Error ? error.message : 'Request failed';
      if (!res.headersSent) json(res, status, { error: message });
      else res.destroy();
    }
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  server.requestTimeout = 15000;
  const heartbeat = setInterval(() => {
    for (const res of [...observers, ...producers]) {
      if (res.writableLength > 262144) res.destroy(); else res.write(': heartbeat\n\n');
    }
  }, 10000);
  heartbeat.unref();
  server.on('close', () => { clearInterval(heartbeat); for (const res of [...observers, ...producers]) res.destroy(); });
  return { server, token, close() {
    clearInterval(heartbeat);
    for (const res of [...observers, ...producers]) res.destroy();
    return new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
  } };
}

class StartupError extends Schema.TaggedError<StartupError>()('RelayStartupError', { cause: Schema.Defect() }) {}

const runRelay = Effect.fn('Relay.run')(function*(options: RelayOptions & { host: string; port: number }) {
  const relay = yield* Effect.acquireRelease(Effect.sync(() => createRelay(options)), relay =>
    Effect.promise(() => relay.close().catch(() => {})));
  yield* Effect.tryPromise({
    try: () => new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error) => rejectListen(error);
      relay.server.once('error', onError);
      relay.server.listen(options.port, options.host, () => { relay.server.off('error', onError); resolveListen(); });
    }),
    catch: cause => new StartupError({ cause }),
  });
  yield* Effect.sync(() => {
    process.stdout.write(`Practice desk ${options.tls ? 'https' : 'http'}://${options.host}:${options.port}/ui/practice/\n`);
    process.stdout.write(`Relay token ${relay.token}\n`);
    if (!['localhost', '127.0.0.1', '::1'].includes(options.host) && !options.tls) {
      process.stdout.write('Phone audio needs HTTPS. Supply --cert and --key using a certificate trusted by the phone.\n');
    }
  });
  yield* Effect.callback<void>(resume => {
    const stop = () => resume(Effect.void);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return Effect.sync(() => { process.off('SIGINT', stop); process.off('SIGTERM', stop); });
  });
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name: string, fallback?: string): string | undefined => {
    const index = args.indexOf(name);
    if (index === -1) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  };
  const host = option('--host', '127.0.0.1') || '127.0.0.1';
  const port = Schema.decodeUnknownSync(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })))(Number(option('--port', '8082')));
  const cert = option('--cert');
  const key = option('--key');
  if (Boolean(cert) !== Boolean(key)) throw new Error('--cert and --key must be supplied together');
  const tls = cert && key ? { cert: await readFile(cert), key: await readFile(key) } : undefined;
  await Effect.runPromise(runRelay({ token: process.env.SHOW_TOOLS_TOKEN, serveUI: !args.includes('--no-ui'), host, port, tls }).pipe(Effect.scoped));
}
