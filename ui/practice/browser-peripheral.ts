import { Schema } from 'effect';
import { PHYSICAL_SWITCH_IDS, type PracticeState } from '../../lib/performance/model.js';
import { currentMusicalInputPolicy, musicalInputPolicyEvent } from './musical-input-policy.js';
import type { InputAttachArgs, InputEventArgs, InputRevokeArgs } from './musical-input-policy.js';
interface BrowserAudio {
  readonly disposed: boolean;
  snapshot(): Pick<PracticeState, 'inputRouting'>;
  inputAttach(args: InputAttachArgs): Promise<unknown>;
  inputEvent(args: InputEventArgs): Promise<unknown>;
  inputRevoke(args: InputRevokeArgs): Promise<unknown>;
  endpoint: { port: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>; request(command: string, payload?: object): Promise<unknown> };
}
import { decodeBrowserInput, HelperReadySchema, physicalReadyMasks } from '../../lib/peripherals/browser-protocol.js';

const connected = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.Literal('connected'), lease: Schema.NonEmptyString, ready: HelperReadySchema }), { onExcessProperty: 'error' });
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
  if (!pairing) return { stop: async () => {}, ready: Promise.resolve() };
  if (currentMusicalInputPolicy() !== 'native-controls') {
    status('Choose native controls to connect this controller.');
    return { stop: async () => {}, ready: Promise.resolve() };
  }
  const abort = new AbortController();
  let connectedReady: () => void = () => {};
  let failedReady: (error: unknown) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => { connectedReady = resolve; failedReady = reject; });
  void ready.catch(() => {});
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lease: string | undefined, stopped = false, active = false, sending = false;
  let pending: readonly number[] | undefined;
  let sequence = 0, session: number | undefined, bindingGeneration: number | undefined;
  let sourceAttached = false;
  let controls = Promise.resolve();
  const headers = { authorization: `Bearer ${pairing}`, 'content-type': 'application/json' };
  const post = async (path: string, body?: object) => {
    const response = await fetch('/api/peripheral/' + path, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined, signal: path === 'events' ? abort.signal : AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]), cache: 'no-store' });
    if (!response.ok) throw new Error(`Local peripheral connection failed (${response.status})`);
    return response;
  };
  let cleanup = Promise.resolve();
  const shutdown = (): Promise<void> => {
    if (stopped) return cleanup;
    stopped = true; active = false; pending = undefined;
    clearInterval(heartbeat);
    failedReady(new Error('Local peripheral connection closed'));
    audio.endpoint.port.removeEventListener('message', light);
    window.removeEventListener(musicalInputPolicyEvent, policyChanged);
    window.removeEventListener('pagehide', pagehide);
    const publisherCleanup = lease ? fetch('/api/peripheral/clear', { method: 'POST', headers, body: JSON.stringify({ lease }), keepalive: true })
      .then(response => { if (!response.ok) throw new Error(`Local peripheral publisher retirement unconfirmed (${response.status})`); }) : Promise.reject(new Error('Local peripheral publisher retirement unconfirmed: lease receipt unavailable'));
    const release = async () => {
      if (audio.disposed) return;
      const failures: unknown[] = [];
      try { await audio.endpoint.request('practice.peripheral-lights', { enabled: false }); }
      catch (error) { failures.push(error); }
      if (!audio.disposed && sourceAttached) {
        try { await audio.inputRevoke({ kind: 'physical' }); }
        catch (error) { failures.push(error); }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, 'Native peripheral cleanup unconfirmed');
    };
    cleanup = Promise.allSettled([publisherCleanup, controls, controls.then(release, release)]).then(results => {
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, 'Local peripheral cleanup unconfirmed');
    }).finally(() => abort.abort());
    void cleanup.catch(error => {
      status('Controller cleanup unconfirmed. Reconnect is blocked.');
      if (!audio.disposed) globalThis.reportError?.(error);
    });
    status('Controller disconnected. Reconnect the local controller session to resume.');
    return cleanup;
  };
  const stop = () => shutdown();
  const pagehide = () => { void stop(); };
  const fail = (error: unknown) => { if (!stopped) { shutdown(); globalThis.reportError?.(error); } };
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
  function policyChanged() { if (currentMusicalInputPolicy() !== 'native-controls') void stop(); }
  async function receive(value: unknown) {
    if (!lease) {
      const connection = connected(value);
      lease = connection.lease; session = connection.ready.session;
      controls = controls.then(async () => {
        if (cancelled()) return;
        bindingGeneration = audio.snapshot().inputRouting?.bindingGeneration;
        if (bindingGeneration === undefined) throw new Error('Native input routing is unavailable');
        await audio.inputAttach({ kind: 'physical', bindingGeneration, ...physicalReadyMasks(connection.ready) });
        sourceAttached = true;
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
    const physicalInput = input.type === 'button' ? PHYSICAL_SWITCH_IDS.indexOf(input.controlId) : 6;
    const physicalValue = input.type === 'button' ? Number(input.down) : input.deltaY;
    controls = controls.then(async () => {
      if (cancelled()) return;
      if (bindingGeneration === undefined) throw new Error('Physical source has not attached');
      try { await audio.inputEvent({ kind: 'physical', bindingGeneration, sequence: input.sequence, input: physicalInput, value: physicalValue }); }
      catch (error) {
        if (input.type === 'button' && !input.down) throw error;
        if (!stopped) globalThis.reportError?.(error);
      }
    });
    await controls;
  }
  audio.endpoint.port.addEventListener('message', light);
  window.addEventListener(musicalInputPolicyEvent, policyChanged);
  window.addEventListener('pagehide', pagehide);
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
