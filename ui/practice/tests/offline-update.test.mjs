import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sourceForVM } from '../../../scripts/source-for-vm.ts';

const origin = 'https://practice.test';
const scope = `${origin}/ui/practice/`;
const files = ['/ui/practice/index.html', '/ui/practice/app.js', '/ui/practice/wasm/manual-clock.wasm'];
const workerSource = (await sourceForVM(new URL('../sw.ts', import.meta.url))).replace(/^export .*;\n/gm, '');

function workerHarness() {
  const storage = new Map();
  let version = 'abi3';
  let failure;
  let unconsumed = false;
  let clients = [{ id: 'desk', url: scope }];
  const caches = {
    async open(key) {
      if (!storage.has(key)) storage.set(key, new Map());
      const entries = storage.get(key);
      return {
        async put(url, response) {
          entries.set(url, new Response(await response.text()));
          unconsumed = false;
        },
        async match(url) { return entries.get(url)?.clone(); },
      };
    },
    async keys() { return [...storage.keys()]; },
    async delete(key) { return storage.delete(key); },
  };
  function load(buildId, workerScope = scope) {
    const listeners = new Map();
    const lifecycle = [];
    const context = {
      URL, Set, caches,
      Request: class extends Request { constructor(path, options) { super(new URL(path, scope), options); } },
      self: {
        location: new URL('sw.js', workerScope), registration: { scope: workerScope },
        addEventListener(type, callback) { listeners.set(type, callback); },
        async skipWaiting() { lifecycle.push('skipWaiting'); },
        clients: { async claim() { lifecycle.push('claim'); }, async matchAll() { return clients; } },
      },
      async fetch(request) {
        assert.equal(request.cache, 'reload');
        assert.equal(unconsumed, false, 'consume the preceding response before starting the next fetch');
        const url = new URL(request.url);
        assert.equal(url.searchParams.get('__show_tools_build'), buildId);
        if (failure && url.pathname.endsWith(failure)) throw new Error('Deployment interrupted');
        unconsumed = true;
        return new Response(`${version}:${url.pathname}`);
      },
    };
    vm.createContext(context);
    vm.runInContext(workerSource.replace('__BUILD_CACHE_ID__', buildId).replace('"__BUILD_MODULE_FILES__"', JSON.stringify(files)), context);
    return {
      lifecycle,
      async dispatch(type, values = {}) {
        let completion;
        listeners.get(type)({ ...values, waitUntil(promise) { completion = promise; } });
        await completion;
      },
      async asset(path) {
        let response;
        listeners.get('fetch')({ request: new Request(new URL(path, scope)), respondWith(promise) { response = promise; } });
        return (await response).text();
      },
    };
  }
  return { storage, load, setVersion(value) { version = value; }, failAt(value) { failure = value; }, setClients(value) { clients = value; } };
}

test('an ABI4 deployment installs all files before replacing ABI3 and keeps JS and WASM immutable', async () => {
  const h = workerHarness();
  const old = h.load('v3');
  await old.dispatch('install');
  await old.dispatch('activate');
  h.setVersion('abi4');
  const next = h.load('v4');
  await next.dispatch('install');
  assert.deepEqual(next.lifecycle, [], 'installation waits for the idle activation request');
  assert.match(await old.asset('app.js'), /^abi3:/);
  assert.match(await old.asset('wasm/manual-clock.wasm'), /^abi3:/);
  await next.dispatch('message', { data: { type: 'activate-when-idle' }, source: { id: 'desk' } });
  assert.deepEqual(next.lifecycle, ['skipWaiting']);
  await next.dispatch('activate');
  assert.deepEqual([...h.storage.keys()], [`show-tools-practice-${scope}:v4`]);
  assert.deepEqual(next.lifecycle, ['skipWaiting', 'claim']);
  h.setVersion('abi5');
  assert.match(await next.asset('app.js?cache-bust=1'), /^abi4:/);
  assert.match(await next.asset('wasm/manual-clock.wasm'), /^abi4:/);
  assert.match(await next.asset('./'), /^abi4:/);
});

test('failed installation preserves the usable old build without activation', async () => {
  const h = workerHarness();
  const old = h.load('v3');
  await old.dispatch('install');
  h.setVersion('abi4');
  h.failAt('manual-clock.wasm');
  const next = h.load('v4');
  await assert.rejects(next.dispatch('install'), /Deployment interrupted/);
  assert.deepEqual(next.lifecycle, []);
  assert.equal(h.storage.has(`show-tools-practice-${scope}:v4`), false);
  assert.match(await old.asset('app.js'), /^abi3:/);
  assert.match(await old.asset('wasm/manual-clock.wasm'), /^abi3:/);
});

test('a missing current-build asset never falls back to another build cache', async () => {
  const h = workerHarness();
  const old = h.load('v3');
  await old.dispatch('install');
  h.setVersion('abi4');
  const next = h.load('v4');
  await next.dispatch('install');
  h.storage.get(`show-tools-practice-${scope}:v4`).delete(`${scope}wasm/manual-clock.wasm`);
  await assert.rejects(next.asset('wasm/manual-clock.wasm'), /This build is unavailable offline/);
  assert.match(await next.asset('app.js'), /^abi4:/);
});

test('another practice window prevents forced activation until it closes', async () => {
  const h = workerHarness();
  const next = h.load('v4');
  await next.dispatch('install');
  h.setClients([{ id: 'desk', url: scope }, { id: 'old-desk', url: `${scope}?song=old` }, { id: 'other', url: `${origin}/elsewhere/` }]);
  await next.dispatch('message', { data: { type: 'activate-when-idle' }, source: { id: 'desk' } });
  assert.deepEqual(next.lifecycle, []);
  h.setClients([{ id: 'desk', url: scope }, { id: 'other', url: `${origin}/elsewhere/` }]);
  await next.dispatch('message', { data: { type: 'activate-when-idle' }, source: { id: 'other' } });
  assert.deepEqual(next.lifecycle, [], 'only the remaining practice client may request activation');
  await next.dispatch('message', { data: { type: 'activate-when-idle' }, source: { id: 'desk' } });
  assert.deepEqual(next.lifecycle, ['skipWaiting']);
});

const appSource = await sourceForVM(new URL('../desk.ts', import.meta.url));
const updateSource = appSource.slice(appSource.indexOf('function applyPendingPracticeUpdate()'), appSource.indexOf('return { dispose, selectSong'));
const tunerSyncSource = appSource.slice(appSource.indexOf('function syncTunerSession()'), appSource.indexOf('requiredElement("#open-tuner"'));
const renderSource = appSource.slice(appSource.indexOf('function songChanging()'), appSource.indexOf('function beginOutputRecording('));

async function updateHarness({ controlled = true, waiting = true } = {}) {
  let reloads = 0, updateChecks = 0;
  const messages = [];
  const events = new Map();
  const documentEvents = new Map();
  let editorOpen = false;
  const registrationEvents = new Map();
  const windowEvents = new Map();
  const worker = { postMessage(message) { messages.push(message.type); } };
  const registration = { waiting: waiting ? worker : null, active: {}, async update() { updateChecks++; }, addEventListener(type, callback) { registrationEvents.set(type, callback); } };
  const serviceWorker = { controller: controlled ? {} : null, ready: Promise.resolve(), async register(url, options) { assert.equal(url, './sw.js'); assert.equal(options.updateViaCache, 'none'); return registration; }, addEventListener(type, callback) { events.set(type, callback); } };
  const context = {
    URLSearchParams, mountSignal: new AbortController().signal, options: {}, remote: false, mode: 'browser', changingAudioMode: false,
    tunerPanel: undefined, tunerSession: undefined, audio: undefined, phoneMotionAbort: undefined,
    browserModeBusy: () => false, canChangeAudioMode: () => true, navigator: { serviceWorker },
    voiceCatalog: { busy: false }, sampleDownloads: { busy: false, render() {} },
    document: { querySelector() { return editorOpen ? {} : null; }, addEventListener(type, callback) { documentEvents.set(type, callback); } },
    window: { isSecureContext: true, addEventListener(type, callback) { windowEvents.set(type, callback); } },
    location: { search: '', reload() { reloads++; } },
    elements: { 'offline-status': { textContent: '' }, 'audio-mode-select': { disabled: false } },
    state: { phase: 'playing' }, chart: undefined, starting: false, switching: false, effectsApplying: false, preparing: null, outputCapture: 'idle',
    offlineUpdate: { kind: 'current' },
    isRunning() { return context.state.phase === 'playing' || context.state.phase === 'count-in'; },
    transport: { hasAttribute: () => false, toggleAttribute() {}, setAttribute() {} },
    songLoadingStatus: { textContent: '' }, explicitlySelected: undefined,
    beginOutputRecording() {}, finishOutputRecording() {},
  };
  vm.createContext(context);
  vm.runInContext(`${tunerSyncSource}\n${renderSource}\n${updateSource}`, context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, messages, registration, registrationEvents, windowEvents, worker,
    get reloads() { return reloads; },
    get updateChecks() { return updateChecks; },
    openEditor() { editorOpen = true; },
    closeEditor() { editorOpen = false; documentEvents.get('close')(); },
    render(next = {}) { context.render(next); },
    controllerChange() { serviceWorker.controller = {}; events.get('controllerchange')(); },
  };
}

for (const busy of ['playing', 'count-in', 'starting', 'preparing', 'switching', 'effectsApplying', 'starting-export', 'waiting-export', 'recording-export', 'stopping-export']) {
  test(`update activation and reload wait through ${busy} and run once idle`, async () => {
    const h = await updateHarness();
    h.context.state.phase = busy === 'playing' || busy === 'count-in' ? busy : 'idle';
    if (busy === 'starting' || busy === 'switching' || busy === 'effectsApplying') h.context[busy] = true;
    if (busy === 'preparing') h.context.preparing = Promise.resolve();
    if (busy.endsWith('-export')) h.context.outputCapture = busy.slice(0, -7);
    h.render();
    assert.deepEqual(h.messages, []);
    assert.equal(h.reloads, 0);
    h.context.starting = false;
    h.context.switching = false;
    h.context.effectsApplying = false;
    h.context.preparing = null;
    h.context.outputCapture = 'idle';
    h.render({ phase: 'idle' });
    assert.deepEqual(h.messages, ['activate-when-idle']);
    assert.equal(h.reloads, 0, 'the page waits for the new controller');
    h.controllerChange();
    h.render();
    assert.equal(h.reloads, 1);
  });
}

test('first installation does not reload an uncontrolled practice page', async () => {
  const h = await updateHarness({ controlled: false, waiting: false });
  h.context.state.phase = 'idle';
  h.controllerChange();
  h.render();
  assert.equal(h.reloads, 0);
});

test('a controller change during MP3 export waits for the export completion render', async () => {
  const h = await updateHarness({ waiting: false });
  h.context.state.phase = 'idle';
  h.context.outputCapture = 'stopping';
  h.controllerChange();
  assert.equal(h.reloads, 0);
  h.context.outputCapture = 'idle';
  h.render();
  assert.equal(h.reloads, 1);
});

test('a newly installed waiting worker and a focus retry use the same idle gate', async () => {
  const h = await updateHarness({ waiting: false });
  const installingEvents = new Map();
  h.registration.installing = { addEventListener(type, callback) { installingEvents.set(type, callback); } };
  h.registrationEvents.get('updatefound')();
  h.registration.waiting = h.worker;
  installingEvents.get('statechange')();
  assert.deepEqual(h.messages, []);
  h.context.state.phase = 'idle';
  h.windowEvents.get('focus')();
  assert.deepEqual(h.messages, ['activate-when-idle']);
  assert.equal(h.updateChecks, 1);
});

test('restoring connectivity checks for a Browser update', async () => {
  const h = await updateHarness({ waiting: false });
  h.windowEvents.get('online')();
  assert.equal(h.updateChecks, 1);
  assert.equal(h.reloads, 0);
});

for (const operation of ['save', 'import']) {
  test(`a controller change during library ${operation} waits for durable completion`, async () => {
    const h = await updateHarness({ waiting: false });
    h.context.state.phase = 'idle';
    h.context.voiceCatalog.busy = true;
    h.controllerChange();
    h.render();
    assert.equal(h.reloads, 0, 'an in-flight library transaction prevents reload');
    h.context.voiceCatalog.busy = false;
    h.render(); // onBusyChange renders when save/import settles.
    assert.equal(h.reloads, 1);
    h.render();
    assert.equal(h.reloads, 1, 'settling triggers only one reload');
  });
}

test('a waiting worker cannot activate while a voice editor is open, then resumes on close', async () => {
  const h = await updateHarness();
  h.openEditor();
  h.render({ phase: 'idle' });
  assert.deepEqual(h.messages, [], 'unsaved metadata stays on the page');
  h.closeEditor();
  assert.deepEqual(h.messages, ['activate-when-idle']);
  h.controllerChange();
  assert.equal(h.reloads, 1);
});

test('a new controller waits for editor dismissal even after its save completes', async () => {
  const h = await updateHarness({ waiting: false });
  h.context.state.phase = 'idle';
  h.openEditor();
  h.context.voiceCatalog.busy = true;
  h.controllerChange();
  h.context.voiceCatalog.busy = false;
  h.render();
  assert.equal(h.reloads, 0, 'successful save does not interrupt the still-open editor');
  h.closeEditor();
  assert.equal(h.reloads, 1, 'closing retries the pending update without another audio frame');
});

test('activating a pinned release preserves another registration scope', async () => {
  const h = workerHarness();
  const old = h.load('old', `${origin}/__build/old/ui/practice/`);
  await old.dispatch('install');
  const next = h.load('new', `${origin}/__build/new/ui/practice/`);
  await next.dispatch('install');
  await next.dispatch('activate');
  assert.equal(h.storage.size, 2);
});

test('a controller change waits for a voice sample download to finish', async () => {
  const h = await updateHarness({ waiting: false });
  h.context.state.phase = 'idle'; h.context.sampleDownloads.busy = true;
  h.controllerChange(); h.render(); assert.equal(h.reloads, 0);
  h.context.sampleDownloads.busy = false; h.render(); assert.equal(h.reloads, 1);
});
