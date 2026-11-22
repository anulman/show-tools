import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chartMetadata } from '../lib/performance/chart.js';
import { DESK_STREAM_IDLE_MS } from '../lib/remote-performance/event-liveness.js';
import { decodeDeskBootstrap, decodeDeskPublication, type DeskPublication, type DeskView } from '../lib/remote-performance/session-schema.js';
import { selectionFromEvent, type ChartSelection } from '../ui/practice/sheets-extension/selection.js';
import type { openChart } from './open-chart.js';

const MESSAGE_LIMIT = 8 * 1024 * 1024;
const TOKEN_LIMIT = 4096;

export async function configureDeskChartSource(env: NodeJS.ProcessEnv) {
  const origin = env.SHOW_TOOLS_DESK_ORIGIN;
  if (origin === undefined) return undefined;
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('SHOW_TOOLS_DESK_ORIGIN must be an exact HTTPS origin.');
  return { origin, token: await readDeskChartToken(env) };
}

export async function readDeskChartToken(env: NodeJS.ProcessEnv) {
  const path = env.SHOW_TOOLS_DESK_TOKEN_FILE ?? join(homedir(), '.config', 'show-tools', 'desk-token');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => {
    throw new Error('Cannot open the private desk token file. Set SHOW_TOOLS_DESK_TOKEN_FILE to its path.');
  });
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid?.() || metadata.size > TOKEN_LIMIT)
      throw new Error('The desk token file must be an owner-only regular file (chmod 600).');
    const bytes = Buffer.alloc(TOKEN_LIMIT + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const token = bytes.toString('utf8', 0, bytesRead).trim();
    if (bytesRead !== metadata.size || !/^[\x21-\x7e]{32,4096}$/.test(token)) throw new Error('Invalid desk token file.');
    return token;
  } finally { await file.close(); }
}

class DeskProtocolError extends Error {}

type FollowOptions = {
  origin: string;
  token: string;
  cdp: string;
  select: typeof openChart;
  signal: AbortSignal;
  log: (message: string) => void;
  request?: typeof fetch;
};

async function readBootstrap(response: Response, signal: AbortSignal) {
  if (!response.body) throw new DeskProtocolError('The EliteDesk returned no session.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body.values()) {
    signal.throwIfAborted();
    bytes += chunk.length;
    if (bytes > MESSAGE_LIMIT) throw new DeskProtocolError('The EliteDesk session exceeds the size limit.');
    chunks.push(chunk);
  }
  try { return decodeDeskBootstrap(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new DeskProtocolError('The EliteDesk returned an invalid session.'); }
}

export async function followDeskCharts({ origin, token, cdp, select, signal, log, request = fetch }: FollowOptions) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) throw new DeskProtocolError('The hardware desk origin must be an exact HTTPS origin.');
  let active: AbortController | undefined;
  let pending: ChartSelection | undefined;
  let draining: Promise<void> | undefined;
  let selectedKey = '';
  let inFlightKey = '';
  let generation = 0;
  const stop = () => {
    generation++;
    active?.abort();
    pending = undefined;
    selectedKey = '';
    inFlightKey = '';
  };
  const key = (selection: ChartSelection) => JSON.stringify([selection.runId, selection.spreadsheetId, selection.sheetId, selection.range]);
  async function drain() {
    while (pending && !signal.aborted) {
      const selection = pending;
      pending = undefined;
      const current = generation;
      const controller = new AbortController();
      active = controller;
      inFlightKey = key(selection);
      const selectionSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(18_000)]);
      try {
        await select(cdp, { spreadsheetId: selection.spreadsheetId, sheetId: selection.sheetId,
          range: selection.range, activate: false }, undefined, selectionSignal);
        if (current === generation && !signal.aborted) {
          selectedKey = key(selection);
          log(`Following ${selection.range}`);
        }
      } catch (error) {
        if (current === generation && !signal.aborted)
          log(`Sheets    ${error instanceof Error ? error.message : 'Could not select the current column'}`);
      } finally {
        active = undefined;
        inFlightKey = '';
      }
    }
    draining = undefined;
  }
  function receive(event: Parameters<typeof selectionFromEvent>[0]) {
    const selection = selectionFromEvent(event);
    if (!selection) return;
    const next = key(selection);
    if (next === inFlightKey || (!inFlightKey && next === selectedKey)) {
      pending = undefined;
      return;
    }
    pending = selection;
    draining ??= drain();
  }
  async function get(path: string, abort: AbortSignal, sessionId?: string) {
    const response = await request(new URL(path, url), { redirect: 'error', cache: 'no-store', signal: abort,
      headers: { Authorization: `Bearer ${token}`, Origin: origin, ...(sessionId ? { 'X-Session-Id': sessionId } : {}) } });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new DeskProtocolError('The EliteDesk rejected the token or origin.');
      if (response.status !== 409 && response.status < 500) throw new DeskProtocolError(`The EliteDesk did not provide the event API (HTTP ${response.status}).`);
      throw new Error(`The EliteDesk returned HTTP ${response.status}.`);
    }
    return response;
  }
  function followSnapshot(view: DeskView, chart: ReturnType<typeof chartMetadata>) {
    const state = view.audio.kind === 'ready' ? view.audio.performance.state : undefined;
    if (state && (state.phase === 'playing' || state.phase === 'count-in')) {
      receive({ v: 1, seq: state.seq, runId: state.runId, state: { ...state, chart: state.chart ?? chart } });
    } else stop();
  }
  try {
    while (!signal.aborted) {
      const connection = new AbortController();
      const connected = AbortSignal.any([connection.signal, signal]);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const cancelRead = () => { void reader?.cancel().catch(() => {}); };
      const expectData = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => connection.abort(new Error('The EliteDesk event stream went silent.')), DESK_STREAM_IDLE_MS);
      };
      try {
        const admission = AbortSignal.any([connected, AbortSignal.timeout(DESK_STREAM_IDLE_MS)]);
        const bootstrap = await readBootstrap(await get('/api/session', admission), admission);
        let view = bootstrap.view;
        let chart = chartMetadata(view.song.chart);
        expectData();
        const stream = await get('/api/events', connected, bootstrap.sessionId);
        if (!stream.body || !stream.headers.get('content-type')?.startsWith('text/event-stream')) {
          await stream.body?.cancel();
          throw new DeskProtocolError('The EliteDesk did not provide an event stream.');
        }
        reader = stream.body.getReader();
        // Some Node versions leave a pending SSE read open after fetch is aborted.
        connected.addEventListener('abort', cancelRead, { once: true });
        log(`Desk      following ${origin}`);
        const decoder = new TextDecoder();
        let buffer = '';
        while (!connected.aborted) {
          const { done, value } = await reader.read();
          if (done || connected.aborted) break;
          expectData();
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const message = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (message.length > MESSAGE_LIMIT) throw new DeskProtocolError('An EliteDesk event exceeds the size limit.');
            if (!message.startsWith('data: ')) continue;
            let publication: DeskPublication;
            try { publication = decodeDeskPublication(JSON.parse(message.slice(6))); }
            catch { throw new DeskProtocolError('The EliteDesk sent an invalid event.'); }
            if (publication.type === 'gap') throw new Error('The EliteDesk reported dropped events.');
            if (publication.type === 'desk') {
              if (publication.view.serverEpoch !== view.serverEpoch) throw new Error('The EliteDesk server restarted.');
              if (publication.view.song.id !== view.song.id || publication.view.song.compiled?.source.digest !== view.song.compiled?.source.digest)
                chart = chartMetadata(publication.view.song.chart);
              view = publication.view;
              followSnapshot(view, chart);
            } else if (publication.type === 'native' && publication.serverEpoch === view.serverEpoch && view.audio.kind === 'ready'
              && publication.attempt === view.audio.attempt && publication.performance.hostEpoch === view.audio.performance.hostEpoch) {
              const { phase } = publication.performance.state;
              if (phase === 'idle' || phase === 'ended') stop();
            } else if (publication.type === 'event' && view.audio.kind === 'ready' && publication.attempt === view.audio.attempt) {
              const { event } = publication;
              if (event.state.phase === 'idle' || event.state.phase === 'ended') stop();
              else if (event.type === 'beat' || event.type === 'state') {
                receive({ ...event, state: { ...event.state, chart: event.state.chart ?? chart } });
              }
            }
          }
          if (buffer.length > MESSAGE_LIMIT) throw new DeskProtocolError('An EliteDesk event exceeds the size limit.');
        }
        if (!signal.aborted) throw new Error('The EliteDesk event stream closed.');
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof DeskProtocolError) throw error;
        const cause = connection.signal.aborted ? connection.signal.reason : error;
        log(`Desk      ${cause instanceof Error ? cause.message : 'Connection interrupted'} Reconnecting…`);
      } finally {
        clearTimeout(timeout);
        connected.removeEventListener('abort', cancelRead);
        connection.abort();
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
        stop();
      }
      await delay(1000, undefined, { signal }).catch(() => {});
    }
  } finally { stop(); await draining; }
}
