import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { boundedLines } from './bridge.js';
import { decodeBrowserInput, decodeBrowserLease, validateBrowserLight } from './browser-protocol.js';
import { verifyBuild } from '../ui-host/snapshot.js';

type Lease = { id: string; response: ServerResponse; tuple: string; heartbeat: number };
export interface BrowserPeripheralTransport {
  session: number;
  input: AsyncIterable<unknown>;
  write(line: string): void;
  close(): Promise<void>;
}
async function body(request: IncomingMessage): Promise<unknown> {
  let text = '', bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 16384) throw new Error('Peripheral request exceeds 16 KiB');
    text += chunk.toString();
  }
  return JSON.parse(text);
}
export async function startBrowserPeripheralServer(options: { staticRoot: string; transport: BrowserPeripheralTransport }) {
  const root = await realpath(options.staticRoot);
  const token = randomBytes(32).toString('hex');
  let lease: Lease | undefined;
  let fence = 0, origin = '', stopped = false, ready = false;
  const clear = () => {
    const previous = lease;
    lease = undefined;
    try { options.transport.write('clear'); } catch {}
    previous?.response.end();
  };
  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    void (async () => {
      if (request.headers.host !== new URL(origin).host) { response.writeHead(403).end(); return; }
      const url = new URL(request.url ?? '/', origin);
      if (url.pathname.startsWith('/api/peripheral/')) {
        if (request.headers.origin !== origin || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return; }
        if (url.pathname === '/api/peripheral/events' && request.method === 'POST') {
          if (!ready) { response.writeHead(503).end(); return; }
          if (lease) { response.writeHead(409).end(); return; }
          const incarnation = randomBytes(6).readUIntBE(0, 6) + 1;
          const id = randomUUID(), tuple = `${incarnation} ${options.transport.session} 1 ${++fence}`;
          lease = { id, response, tuple, heartbeat: performance.now() };
          options.transport.write(`bind ${tuple}`);
          response.writeHead(200, { 'content-type': 'application/x-ndjson' });
          response.write(`${JSON.stringify({ type: 'connected', lease: id })}\n`);
          response.on('close', () => { if (lease?.id === id) clear(); });
          return;
        }
        if (url.pathname === '/api/peripheral/heartbeat' && request.method === 'POST') {
          const input = decodeBrowserLease(await body(request));
          if (!lease || input.lease !== lease.id) { response.writeHead(409).end(); return; }
          lease.heartbeat = performance.now(); response.writeHead(204).end(); return;
        }
        if (url.pathname === '/api/peripheral/light' && request.method === 'POST') {
          const light = validateBrowserLight(await body(request));
          if (!lease || light.lease !== lease.id) { response.writeHead(409).end(); return; }
          options.transport.write(`light ${lease.tuple} ${light.values.join(' ')}`);
          response.writeHead(204).end(); return;
        }
        if (url.pathname === '/api/peripheral/clear' && request.method === 'POST') {
          const input = decodeBrowserLease(await body(request));
          if (!lease || input.lease !== lease.id) { response.writeHead(409).end(); return; }
          clear(); response.writeHead(204).end(); return;
        }
        response.writeHead(404).end(); return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(['/', '/ui/practice/'].includes(url.pathname) ? '/ui/practice/index.html' : url.pathname);
      if (!pathname.startsWith('/ui/practice/') || pathname.includes('\\') || pathname.split('/').includes('..')) { response.writeHead(404).end(); return; }
      const path = await realpath(resolve(root, '.' + pathname));
      if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) { response.writeHead(404).end(); return; }
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
      response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(path));
    })().catch(() => { if (lease?.response === response) clear(); if (!response.headersSent) response.writeHead(400); response.end(); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback listener has no port');
  origin = `http://127.0.0.1:${address.port}`;
  const task = (async () => {
    try {
      for await (const value of options.transport.input) {
        const input = decodeBrowserInput(value);
        if ('session' in input && input.session !== options.transport.session) throw new Error('Peripheral session changed');
        if (input.type === 'ready') { if (ready) throw new Error('Duplicate helper ready'); ready = true; }
        else if (input.type === 'detached') throw new Error('I-PAC disconnected');
        else if (input.type !== 'delivered' && lease) {
          if (lease.response.writableLength > 32768) throw new Error('Peripheral input consumer stalled');
          lease.response.write(`${JSON.stringify(input)}\n`);
        }
      }
    } finally { ready = false; if (!stopped) clear(); }
  })();
  const watchdog = setInterval(() => { if (lease && performance.now() - lease.heartbeat > 2500) clear(); }, 250);
  const completed = task.then(() => { clearInterval(watchdog); if (!stopped) server.closeAllConnections(); server.close(); });
  completed.catch(() => { clearInterval(watchdog); server.closeAllConnections(); server.close(); });
  return { origin, completed, url: `${origin}/ui/practice/#peripheral=${token}`,
    async close() {
      if (stopped) return;
      stopped = true; clearInterval(watchdog); clear();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await options.transport.close();
      await task.catch(() => {});
    } };
}

export async function runBrowserPeripheralServer(options: { staticRoot: string; helperExecutable: string; sdkChannel: number; onReady?: (url: string) => void }, signal: AbortSignal) {
  await verifyBuild(options.staticRoot);
  if (!Number.isInteger(options.sdkChannel) || options.sdkChannel < 0 || options.sdkChannel > 95) throw new Error('Invalid SDK channel');
  const session = randomBytes(6).readUIntBE(0, 6) + 1;
  const child = spawn(options.helperExecutable, [String(session), String(options.sdkChannel), '--confirm-wiring'], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => child.kill('SIGTERM'));
  const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => { if (code === 0) resolve(); else reject(new Error(`Peripheral helper exited (${signal ?? code})`)); }); });
  void exited.catch(() => {});
  const transport: BrowserPeripheralTransport = { session,
    input: (async function* () { for await (const line of boundedLines(child.stdout, 8192)) yield JSON.parse(line); })(),
    write(line) {
      if (!child.stdin.writable || child.stdin.writableLength > 32768) { child.kill('SIGTERM'); throw new Error('Peripheral output stalled'); }
      child.stdin.write(line + '\n');
    },
    async close() {
      child.stdin.end('clear\nquit\n');
      const terminate = setTimeout(() => child.kill('SIGTERM'), 1000), kill = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(terminate); clearTimeout(kill); }
    } };
  let server: Awaited<ReturnType<typeof startBrowserPeripheralServer>> | undefined;
  try {
    server = await startBrowserPeripheralServer({ ...options, transport });
    if (options.onReady) options.onReady(server.url); else process.stdout.write(server.url + '\n');
    await Promise.race([exited, server.completed, new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); })]);
  } finally { if (server) await server.close(); else await transport.close(); }
}
