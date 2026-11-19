import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { chartSettings, LOCAL_PRACTICE_ORIGINS } from './chart-settings.js';

export const ChartSelectionSchema = Schema.Struct({
  spreadsheetId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{20,}$/)),
  sheetId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  range: Schema.String.check(Schema.isPattern(/^([A-Z]{1,3}):\1$/)),
  activate: Schema.optionalKey(Schema.Boolean),
});
export type ChartSelection = typeof ChartSelectionSchema.Type;
export const parseChartSelection = Schema.decodeUnknownSync(ChartSelectionSchema);
const parseVersion = Schema.decodeUnknownSync(Schema.Struct({ webSocketDebuggerUrl: Schema.String }));
const parseReply = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.optionalKey(Schema.Int),
  result: Schema.optionalKey(Schema.Unknown), error: Schema.optionalKey(Schema.Struct({ message: Schema.String })) }));
const parseTargets = Schema.decodeUnknownSync(Schema.Struct({ targetInfos: Schema.Array(Schema.Struct({
  targetId: Schema.String, type: Schema.String, url: Schema.String,
})) }));
const parseTarget = Schema.decodeUnknownSync(Schema.Struct({ targetId: Schema.String }));
const parseSession = Schema.decodeUnknownSync(Schema.Struct({ sessionId: Schema.String }));
const parseEvaluation = Schema.decodeUnknownSync(Schema.Struct({ result: Schema.Struct({ value: Schema.optionalKey(Schema.Unknown) }),
  exceptionDetails: Schema.optionalKey(Schema.Unknown) }));
const parsePageState = Schema.decodeUnknownSync(Schema.Struct({ ready: Schema.Boolean, range: Schema.NullOr(Schema.String),
  activeSheetId: Schema.NullOr(Schema.Int), url: Schema.String }));
const parseViewport = Schema.decodeUnknownSync(Schema.NullOr(Schema.Struct({ scrollLeft: Schema.Number,
  left: Schema.Number, right: Schema.Number, selectedLeft: Schema.Number, selectedRight: Schema.Number })));

function viewportExpression(sheetId: number, scrollLeft?: number): string {
  return `(() => { const grid = document.getElementById('${sheetId}-grid-container');
    const scrollbar = grid?.querySelector('.native-scrollbar-x');
    if (!scrollbar) return null;
    ${scrollLeft === undefined ? '' : `scrollbar.scrollLeft = ${scrollLeft};`}
    const selected = Array.from(grid.querySelectorAll('.selection')).map(element => element.getBoundingClientRect()).find(rect => rect.width > 0 && rect.height > 0);
    if (!selected) return null;
    const viewport = scrollbar.getBoundingClientRect();
    return JSON.stringify({scrollLeft:scrollbar.scrollLeft,left:viewport.left,right:viewport.left+scrollbar.clientWidth,
      selectedLeft:selected.left,selectedRight:selected.right}); })()`;
}

export interface CDPConnection {
  request(method: string, params?: object, sessionId?: string): Promise<unknown>;
  close(): void;
}

class CDP implements CDPConnection {
  private serial = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();

  static async connect(address: string, signal?: AbortSignal): Promise<CDP> {
    const endpoint = new URL(address);
    if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('CDP must use a local HTTP address');
    let response: Response;
    try { response = await fetch(new URL('/json/version', endpoint), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) }); }
    catch (cause) { throw new Error(`Chrome CDP is unavailable at ${endpoint.origin}. Start Chrome with remote debugging enabled.`, { cause }); }
    if (!response.ok) throw new Error(`Chrome CDP returned ${response.status}`);
    const version = parseVersion(await response.json());
    const websocket = new URL(version.webSocketDebuggerUrl);
    if (websocket.protocol !== 'ws:' || !['localhost', '127.0.0.1', '[::1]'].includes(websocket.hostname)) throw new Error('Chrome returned a non-local CDP socket');
    const socket = new WebSocket(websocket.href);
    await new Promise<void>((ready, reject) => {
      const abort = () => { clean(); socket.close(); reject(signal?.reason); };
      signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => { clean(); socket.close(); reject(new Error('Chrome CDP connection timed out')); }, 3000);
      const clean = () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); };
      socket.addEventListener('open', () => { clean(); ready(); }, { once: true });
      socket.addEventListener('error', () => { clean(); reject(new Error('Could not connect to Chrome CDP')); }, { once: true });
      if (signal?.aborted) { clean(); abort(); }
    });
    return new CDP(socket);
  }

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      try {
        const reply = parseReply(JSON.parse(event.data));
        if (reply.id === undefined) return;
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        clearTimeout(pending.timeout); this.pending.delete(reply.id);
        if (reply.error) pending.reject(new Error(reply.error.message)); else pending.resolve(reply.result);
      } catch (error) { this.rejectAll(error instanceof Error ? error : new Error('Invalid Chrome CDP message')); }
    });
    socket.addEventListener('close', () => this.rejectAll(new Error('Chrome CDP disconnected')));
    socket.addEventListener('error', () => this.rejectAll(new Error('Chrome CDP connection failed')));
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.pending.clear();
  }

  request(method: string, params: object = {}, sessionId?: string): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Chrome CDP connection is closed'));
    const id = ++this.serial;
    return new Promise((resolveReply, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`Chrome CDP timed out during ${method}`)); }, 5000);
      this.pending.set(id, { resolve: resolveReply, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close(): void { this.rejectAll(new Error('Chrome CDP connection closed')); this.socket.close(); }
}

const pageStateExpression = `(() => { const grid = Array.from(document.querySelectorAll('[id$="-grid-container"]')).find(element => /^\\d+-grid-container$/.test(element.id) && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0); return JSON.stringify({ready:!!document.querySelector('#t-name-box'),range:document.querySelector('#t-name-box')?.value??null,activeSheetId:grid ? Number.parseInt(grid.id,10) : null,url:location.href}); })()`;
const sameSpreadsheet = (url: string, id: string): boolean => {
  try { const address = new URL(url); return address.origin === 'https://docs.google.com' && address.pathname.startsWith(`/spreadsheets/d/${id}/`); }
  catch { return false; }
};
const columnOffsets = new Map<string, Map<number, number>>();
const releaseViewportExpression = `(() => { window.__showToolsReleaseViewport?.(); return true; })()`;
const sleep = (milliseconds: number) => new Promise<void>(done => setTimeout(done, milliseconds));

const parseBrowser = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.String }));

export async function inspectCDP(address: string, signal?: AbortSignal): Promise<string> {
  const connection = await CDP.connect(address, signal);
  const abort = () => connection.close();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const browser = parseBrowser(await connection.request('Browser.getVersion'));
    if (!/^(HeadlessChrome|Chrome|Chromium)\//.test(browser.product)) throw new Error(`Unsupported CDP browser: ${browser.product}`);
    parseTargets(await connection.request('Target.getTargets'));
    return browser.product;
  } finally { signal?.removeEventListener('abort', abort); connection.close(); }
}

export async function openSetList(address: string, url: string, signal?: AbortSignal,
  connect: (address: string) => Promise<CDPConnection> = address => CDP.connect(address, signal)): Promise<void> {
  const spreadsheet = new URL(url);
  const id = spreadsheet.pathname.split('/')[3];
  if (spreadsheet.origin !== 'https://docs.google.com' || spreadsheet.username || spreadsheet.password || !/^\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}\/edit\/?$/.test(spreadsheet.pathname)) throw new Error('Expected a Google Sheets spreadsheet edit URL');
  const connection = await connect(address);
  const abort = () => connection.close();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const targets = parseTargets(await connection.request('Target.getTargets'));
    const matching = targets.targetInfos.find(target => target.type === 'page' && sameSpreadsheet(target.url, id));
    const targetId = matching?.targetId || parseTarget(await connection.request('Target.createTarget', { url })).targetId;
    const gid = new URLSearchParams(spreadsheet.hash.slice(1)).get('gid') ?? spreadsheet.searchParams.get('gid');
    if (matching && gid !== null) {
      const session = parseSession(await connection.request('Target.attachToTarget', { targetId, flatten: true }));
      try { await connection.request('Page.navigate', { url }, session.sessionId); }
      finally { if (!signal?.aborted) await connection.request('Target.detachFromTarget', { sessionId: session.sessionId }).catch(() => {}); }
    }
    await connection.request('Target.activateTarget', { targetId });
  } finally { signal?.removeEventListener('abort', abort); connection.close(); }
}

export async function openChart(address: string, input: unknown, connect: ((address: string) => Promise<CDPConnection>) | undefined = undefined, signal?: AbortSignal): Promise<{ ok: true; selectedRange: string; url: string }> {
  const selection = parseChartSelection(input);
  const connection = await (connect ? connect(address) : CDP.connect(address, signal));
  const abort = () => connection.close();
  signal?.addEventListener('abort', abort, { once: true });
  let sessionId: string | undefined;
  try {
    signal?.throwIfAborted();
    const targets = parseTargets(await connection.request('Target.getTargets'));
    const matching = targets.targetInfos.find(target => target.type === 'page' && sameSpreadsheet(target.url, selection.spreadsheetId));
    const base = `https://docs.google.com/spreadsheets/d/${selection.spreadsheetId}/edit`;
    const sheetURL = `${base}?gid=${selection.sheetId}#gid=${selection.sheetId}`;
    const targetId = matching?.targetId || parseTarget(await connection.request('Target.createTarget', { url: sheetURL, background: selection.activate === false })).targetId;
    sessionId = parseSession(await connection.request('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    const evaluate = async (expression: string): Promise<unknown> => {
      const result = parseEvaluation(await connection.request('Runtime.evaluate', { expression, returnByValue: true }, sessionId));
      if (result.exceptionDetails) throw new Error('The song chart could not run the selection command');
      return result.result.value;
    };
    const state = async () => {
      const value = await evaluate(pageStateExpression);
      if (typeof value !== 'string') throw new Error('The chart did not return its selection state');
      return parsePageState(JSON.parse(value));
    };
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const current = await state();
      if (current.ready) { ready = true; break; }
      await sleep(125);
    }
    if (!ready) throw new Error('Google Sheets did not become ready. Sign in or finish loading the chart in the Chrome window, then try again.');
    if ((await state()).activeSheetId !== selection.sheetId) {
      await connection.request('Page.navigate', { url: sheetURL }, sessionId);
      let correctSheet = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        try {
          const current = await state();
          if (current.ready && current.activeSheetId === selection.sheetId) { correctSheet = true; break; }
        } catch (error) {
          if (!(error instanceof Error) || !/context|navigat/i.test(error.message)) throw error;
        }
        await sleep(125);
      }
      if (!correctSheet) throw new Error('Google Sheets did not open the requested song sheet');
    }
    const selectRange = async (range: string) => {
      const focus = `(() => { const box = document.querySelector('#t-name-box'); if (!box) return false;
        const grid = document.getElementById('${selection.sheetId}-grid-container');
        const scrollbar = grid?.querySelector('.native-scrollbar-x');
        if (!scrollbar || !grid.clientWidth || !grid.clientHeight || !scrollbar.clientWidth) return false;
        window.__showToolsReleaseViewport?.();
        const vertical = grid.querySelector('.native-scrollbar-y');
        const left = scrollbar.scrollLeft;
        const top = vertical?.scrollTop;
        const preserve = () => {
          if (scrollbar.scrollLeft !== left) scrollbar.scrollLeft = left;
          if (vertical && vertical.scrollTop !== top) vertical.scrollTop = top;
        };
        const timeout = setTimeout(() => window.__showToolsReleaseViewport?.(), 5000);
        window.__showToolsReleaseViewport = () => { clearTimeout(timeout); scrollbar.removeEventListener('scroll', preserve); vertical?.removeEventListener('scroll', preserve); delete window.__showToolsReleaseViewport; };
        scrollbar.addEventListener('scroll', preserve);
        vertical?.addEventListener('scroll', preserve);
        box.focus({preventScroll:true});
        box.select();
        return document.activeElement === box; })()`;
      for (let selectionAttempt = 0; selectionAttempt < 2; selectionAttempt++) {
        let focused = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          signal?.throwIfAborted();
          if (await evaluate(focus) === true) { focused = true; break; }
          await sleep(125);
        }
        if (!focused) throw new Error('Google Sheets Name box or column viewport did not become ready');
        await connection.request('Input.insertText', { text: range }, sessionId);
        await connection.request('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
        await connection.request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
        for (let attempt = 0; attempt < 12; attempt++) {
          const current = await state();
          if (current.range === range && current.activeSheetId === selection.sheetId) return;
          await sleep(100);
        }
      }
      throw new Error(`Google Sheets did not confirm ${range}`);
    };
    const viewport = async (scrollLeft?: number) => {
      const value = await evaluate(viewportExpression(selection.sheetId, scrollLeft));
      return parseViewport(typeof value === 'string' ? JSON.parse(value) : value);
    };
    const waitForViewport = async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        signal?.throwIfAborted();
        const visible = await viewport();
        if (visible) return visible;
        await sleep(125);
      }
      throw new Error('Google Sheets did not render the selected column');
    };
    const letters = selection.range.split(':')[0];
    const column = Array.from(letters).reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0);
    await selectRange(selection.range);
    // Sheets resets horizontal scroll even for a visible Name box selection.
    // Preserve it through that event, then move once to the intended context.
    await sleep(50);
    const measured = await waitForViewport();
    const cacheKey = `${address}/${targetId}/${selection.sheetId}`;
    let offsets = columnOffsets.get(cacheKey);
    if (!offsets) {
      offsets = new Map();
      const oldestKey = columnOffsets.keys().next().value;
      if (columnOffsets.size >= 32 && oldestKey !== undefined) columnOffsets.delete(oldestKey);
      columnOffsets.set(cacheKey, offsets);
    }
    const absoluteLeft = measured.scrollLeft + measured.selectedLeft - measured.left;
    const previous = offsets.get(column);
    if (previous !== undefined && Math.abs(previous - absoluteLeft) > 2) offsets.clear();
    offsets.set(column, absoluteLeft);
    const width = measured.selectedRight - measured.selectedLeft;
    const contextScroll = column <= 3 ? 0 : Math.max(0, offsets.get(column - 2) ?? absoluteLeft - 2 * width);
    await evaluate(releaseViewportExpression);
    await viewport(contextScroll);
    await sleep(50);
    let visible = await waitForViewport();
    const overflow = visible.selectedRight > visible.right ? visible.selectedRight - visible.right
      : visible.selectedLeft < visible.left ? visible.selectedLeft - visible.left : 0;
    if (overflow) {
      await viewport(Math.max(0, visible.scrollLeft + overflow));
      await sleep(50);
      visible = await waitForViewport();
    }
    if (column > 1 && (visible.selectedRight <= visible.left || visible.selectedLeft >= visible.right)) throw new Error('Google Sheets did not keep the active column visible');
    const final = await state();
    if (final.range !== selection.range || final.activeSheetId !== selection.sheetId) throw new Error('Google Sheets changed selection while positioning the chart');
    if (selection.activate !== false) await connection.request('Target.activateTarget', { targetId });
    return { ok: true, selectedRange: selection.range, url: final.url };
  } finally {
    signal?.removeEventListener('abort', abort);
    if (sessionId && !signal?.aborted) {
      await connection.request('Runtime.evaluate', { expression: releaseViewportExpression, returnByValue: true }, sessionId).catch(() => {});
      await connection.request('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
    connection.close();
  }
}

export function createChartHelper({ cdp = 'http://127.0.0.1:9222', origins = LOCAL_PRACTICE_ORIGINS, select = openChart }:
  { cdp?: string; origins?: readonly string[]; select?: typeof openChart } = {}) {
  let queue = Promise.resolve();
  const server = http.createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const json = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    const origin = request.headers.origin;
    if (origin && !origins.includes(origin)) { json(403, { error: 'This practice origin is not allowed by the chart helper' }); return; }
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method === 'GET' && request.url === '/health') { json(200, { ok: true }); return; }
    if (request.method !== 'POST' || request.url !== '/open') { json(404, { error: 'Not found' }); return; }
    try {
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        if (!(chunk instanceof Uint8Array)) throw new Error('Expected JSON bytes');
        bytes += chunk.byteLength;
        if (bytes > 4096) throw new Error('Chart request is too large');
        chunks.push(chunk);
      }
      const selection = parseChartSelection(JSON.parse(Buffer.concat(chunks).toString()));
      const previous = queue;
      let finish: () => void = () => {};
      queue = new Promise<void>(resolveQueue => { finish = resolveQueue; });
      const controller = new AbortController();
      const abort = () => { if (!response.writableEnded) controller.abort(); };
      response.on('close', abort);
      try {
        await previous;
        controller.signal.throwIfAborted();
        json(200, await select(cdp, selection, undefined, controller.signal));
      }
      finally { response.removeListener('close', abort); finish(); }
    } catch (error) { json(400, { error: error instanceof Error ? error.message : 'Could not select the song chart' }); }
  });
  server.requestTimeout = 20000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const settings = chartSettings();
  const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] || fallback : fallback;
  const cdp = option('--cdp', settings.cdp);
  if (args.includes('--once')) {
    const result = await openChart(cdp, { spreadsheetId: option('--spreadsheet', ''), sheetId: Number(option('--sheet', '101')), range: option('--range', 'C:C') });
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    const origins = [...LOCAL_PRACTICE_ORIGINS, settings.practiceOrigin, ...args.filter((value, index) => args[index - 1] === '--origin')];
    const server = createChartHelper({ cdp, origins });
    const port = Number(option('--port', '9223'));
    server.listen(port, '127.0.0.1', () => process.stdout.write(`Local chart helper ready at http://127.0.0.1:${port}. Practice audio does not use this helper.\n`));
  }
}
