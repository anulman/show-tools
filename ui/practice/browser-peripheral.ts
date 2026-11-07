import { Schema } from 'effect';
import type { Control } from '../../lib/performance/model.js';
interface BrowserAudio {
  readonly disposed: boolean;
  control(control: Control): Promise<unknown>;
  endpoint: { port: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>; request(command: string, payload?: object): Promise<unknown> };
}
import { decodeBrowserInput } from '../../lib/peripherals/browser-protocol.js';

const connected = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.Literal('connected'), lease: Schema.NonEmptyString }), { onExcessProperty: 'error' });
const lightMessage = Schema.decodeUnknownSync(Schema.Struct({ lights: Schema.Array(Schema.Number) }));
const pairingKey = 'show-tools-local-peripheral';
let token: string | undefined;
export function peripheralPairing() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const value = fragment.get('peripheral');
  if (value !== null) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid local peripheral pairing');
    token = value;
    try { sessionStorage.setItem(pairingKey, value); } catch {}
    fragment.delete('peripheral');
    history.replaceState(null, '', location.pathname + location.search + (fragment.size ? '#' + fragment : ''));
  }
  if (token) return token;
  try { return sessionStorage.getItem(pairingKey) ?? undefined; } catch { return undefined; }
}
function status(message: string) {
  let element = document.getElementById('peripheral-status');
  if (!element) {
    element = document.createElement('p'); element.id = 'peripheral-status'; element.setAttribute('role', 'status');
    document.querySelector('main')?.prepend(element);
  }
  element.textContent = message;
}

export function connectBrowserPeripheral(audio: BrowserAudio, pairing = peripheralPairing()) {
  if (!pairing) return { stop() {}, ready: Promise.resolve() };
  const abort = new AbortController();
  let connectedReady: () => void = () => {};
  let failedReady: (error: unknown) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => { connectedReady = resolve; failedReady = reject; });
  void ready.catch(() => {});
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lease: string | undefined, stopped = false, active = false, sending = false;
  let pending: readonly number[] | undefined;
  let sequence = 0, session: number | undefined;
  let controls = Promise.resolve();
  const headers = { authorization: `Bearer ${pairing}`, 'content-type': 'application/json' };
  const post = async (path: string, body?: object) => {
    const response = await fetch('/api/peripheral/' + path, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined, signal: path === 'events' ? abort.signal : AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]), cache: 'no-store' });
    if (!response.ok) throw new Error(`Local peripheral connection failed (${response.status})`);
    return response;
  };
  const shutdown = (intentional: boolean) => {
    if (stopped) return;
    stopped = true; active = false; pending = undefined;
    clearInterval(heartbeat);
    failedReady(new Error('Local peripheral connection closed'));
    audio.endpoint.port.removeEventListener('message', light);
    window.removeEventListener('keydown', suppressTab, true);
    window.removeEventListener('pagehide', stop);
    abort.abort();
    if (lease) void fetch('/api/peripheral/clear', { method: 'POST', headers, body: JSON.stringify({ lease }), keepalive: true }).catch(() => {});
    const release = async () => {
      if (audio.disposed) return;
      try { await audio.endpoint.request('practice.peripheral-lights', { enabled: false }); }
      finally { if (!audio.disposed) await audio.control({ id: 'cueButton', value: 0 }); }
    };
    void controls.then(release, release).catch(error => { if (!intentional && !audio.disposed) globalThis.reportError?.(error); });
    status('Controller disconnected. Reconnect the local controller session to resume.');
  };
  const stop = () => shutdown(true);
  const fail = (error: unknown) => { if (!stopped) { shutdown(false); globalThis.reportError?.(error); } };
  async function pump() {
    if (sending || !active || !lease) return;
    sending = true;
    try {
      while (pending && active && !stopped) {
        const values = pending; pending = undefined;
        await post('light', { lease, values });
      }
    } catch (error) { fail(error); }
    finally { sending = false; }
  }
  function light(event: Event) {
    if (!(event instanceof MessageEvent)) return;
    if (!active || !event.data || typeof event.data !== 'object' || !('lights' in event.data)) return;
    try { pending = lightMessage(event.data).lights; void pump(); }
    catch (error) { fail(error); }
  }
  const cancelled = () => { if (audio.disposed && !stopped) stop(); return stopped || audio.disposed; };
  function suppressTab(event: KeyboardEvent) { if (active && event.code === 'Tab') event.preventDefault(); }
  async function receive(value: unknown) {
    if (!lease) {
      lease = connected(value).lease;
      controls = controls.then(async () => {
        if (cancelled()) return;
        await audio.control({ id: 'cueButton', value: 0 });
        if (cancelled()) return;
        await audio.endpoint.request('practice.jiggle', { minimumTravel: 4, minimumReversal: 2 });
        if (cancelled()) return;
        await audio.endpoint.request('practice.peripheral-lights', { enabled: true });
        if (cancelled()) return;
        active = true; connectedReady();
        heartbeat = setInterval(() => { void post('heartbeat', { lease }).catch(fail); }, 500);
        status('Controller connected. Button and spinner use this browser audio engine.');
      });
      await controls;
      return;
    }
    const input = decodeBrowserInput(value);
    if (input.type !== 'button' && input.type !== 'motion') throw new Error('Unexpected local peripheral input');
    session ??= input.session;
    if (input.session !== session || input.sequence <= sequence) throw new Error('Local peripheral input order changed');
    sequence = input.sequence;
    const control = input.type === 'button' ? { id: 'cueButton', value: input.down ? 1 : 0 } satisfies Control
      : { id: 'knob', value: input.deltaY } satisfies Control;
    controls = controls.then(async () => {
      if (cancelled()) return;
      try { await audio.control(control); }
      catch (error) {
        if (control.id === 'cueButton' && control.value === 0) throw error;
        if (!stopped) globalThis.reportError?.(error);
      }
    });
    await controls;
  }
  audio.endpoint.port.addEventListener('message', light);
  window.addEventListener('keydown', suppressTab, true);
  window.addEventListener('pagehide', stop);
  status('Connecting local controller…');
  void (async () => {
    const response = await post('events');
    if (!response.body) throw new Error('Local peripheral stream is unavailable');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    try {
      while (!stopped) {
        const next = await reader.read();
        if (next.done) throw new Error('Local peripheral stream ended');
        text += next.value;
        if (text.length > 32768) throw new Error('Local peripheral input stream overflow');
        let end: number;
        while ((end = text.indexOf('\n')) >= 0) { const line = text.slice(0, end); text = text.slice(end + 1); await receive(JSON.parse(line)); }
      }
    } finally { reader.releaseLock(); }
  })().catch(fail);
  return { stop, ready };
}
