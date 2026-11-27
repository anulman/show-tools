import { chartBarLabel, chartBarOrdinal } from '../../../lib/performance/chart-position.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceForVM } from '../../../scripts/source-for-vm.ts';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { PF } from '../../../lib/performance/wasm-abi.ts';
import { webcrypto } from 'node:crypto';
import { createVoiceEffectsEditor } from '../voice-effects.ts';
import { chorus, initialVoiceEffects, slapback } from '../../../lib/performance/vocal-effects.ts';
import { keyboardFocusBlocksShortcut } from '../keyboard-focus.ts';
import { audioMode, canChangeAudioMode, changeAudioMode } from '../audio-mode.ts';

function prepareUIContext(context) {
  for (const [key, value] of Object.entries({ postPerformanceEvent() {}, dismissOnBackdrop() {}, createMusicalInputProducer, createMusicalInputPolicy, SONGS, CONTROL_IDS: ['L1', 'L2', 'R1', 'R2'], chartBarLabel, chartBarOrdinal, URL, URLSearchParams, AbortController, mountSignal: new AbortController().signal, options: {}, remote: false, preparationAbort: undefined, location: { href: 'https://example.test/', search: '' }, audioMode, canChangeAudioMode, changeAudioMode, crypto: webcrypto, createVoiceEffectsEditor, initialVoiceEffects, keyboardFocusBlocksShortcut, installVoiceCatalog: () => ({ savedConfigurations: () => initialVoiceEffects(), async saveDrafts() {}, update() {}, async load() {}, openProfile() {} }) })) if (!(key in context)) context[key] = value;
  context.createInputBindingPanel ??= () => ({ element: {}, update() {} });
  context.createSampleDownloads ??= () => ({ render() {}, busy: false });
  if (context.HTMLElement) context.HTMLElement.prototype.after ??= () => {};
  vm.createContext(context);
}
import { SONGS, loadSong, loadSongPreview } from '../../../songs/index.ts';
import { PracticeAudio } from '../audio.js';
import { BeatTracker } from '../runtime/beat-tracker.js';
import { NativePerformance } from '../../../lib/performance/wasm-performance.ts';
import { createMusicalInputProducer } from '../peripheral-input.ts';
import { createMusicalInputPolicy } from '../musical-input-policy.ts';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

for (const gate of ['resume']) for (const action of ['stop', 'panic', 'physical-panic']) {
  test(`${action} cancels a start waiting for ${gate}`, async () => {
    const waiting = deferred();
    const entered = deferred();
    const commands = [];
    const audio = Object.assign(Object.create(PracticeAudio.prototype), {
      latest: { phase: 'idle', inputRouting: { bindingGeneration: 1, panicMask: 1 } }, chart: { bpm: 98 }, startGeneration: 0, runCounter: 0,
      sessionId: 'test', disposed: false, listeners: new Set(),
      tracker: {
        async resume() { if (gate === 'resume') { entered.resolve(); await waiting.promise; } },
        async setManualBpm() { if (gate === 'tempo') { entered.resolve(); await waiting.promise; } },
      },
      endpoint: { async request(command) { commands.push(command); } },
    });
    const starting = audio.start();
    await entered.promise;
    if (action === 'stop') await audio.stop();
    else if (action === 'panic') await audio.control({ id: 'mushroom' });
    else await audio.inputEvent({ kind: 'physical', bindingGeneration: 1, sequence: 1, input: 0, value: 1 });
    waiting.resolve();
    await starting;
    assert.deepEqual(commands, [action === 'stop' ? 'practice.stop' : action === 'panic' ? 'practice.control' : 'practice.input-event']);
  });
}

test('identified preflight mushroom presses preserve browser monitoring until engine classifies Panic', async () => {
  for (const [kind, input] of [['physical', 5], ['keyboard', 4], ['pointer', 4]]) {
    const requested = [];
    const audio = Object.assign(Object.create(PracticeAudio.prototype), {
      latest: { preflightStage: 1, inputRouting: { bindingGeneration: 1, panicMask: 48 } },
      startGeneration: 2, microphoneGeneration: 3,
      request(command, args) { requested.push({ command, args }); },
      clearMonitoring() { assert.fail('Setup press cannot clear microphone monitoring'); },
    });
    const args = { kind, bindingGeneration: 1, sequence: 1, input, value: 1 };
    await audio.inputEvent(args);
    assert.deepEqual(requested, [{ command: 'practice.input-event', args }]);
    assert.equal(audio.startGeneration, 2);
    assert.equal(audio.microphoneGeneration, 3);
  }
});

const deskSource = await sourceForVM(new URL('../desk.ts', import.meta.url));
const uiSource = deskSource.slice(deskSource.indexOf('function requiredElement('), deskSource.indexOf('export async function mountDesk('))
  + 'const mode = "browser"; const remote = false; const defaultMode = mode; const deskURL = new URL(location.href);\n'
  + deskSource.slice(deskSource.indexOf('const elements ='), deskSource.indexOf('elements.start.addEventListener('))
    .replace(/import\(["']\.\/audio\.js["']\)/g, 'Promise.resolve({ PracticeAudio })');

for (const action of ['stopPractice', 'panic']) {
  test(`UI ${action} cancels initial audio preparation before launch`, async () => {
    const preparing = deferred();
    const commands = [];
    class FakeElement {
      constructor(selector) {
        this.id = selector.slice(1);
        this.value = ({ '#bpm': '98', '#start-section': '1', '#end-bar': '76', '#count-in': '1', '#effects-delay': '100', '#effects-feedback': '0', '#effects-wet': '0.25' })[selector] || '';
        this.checked = true;
        this.textContent = '';
      }
      addEventListener() {}
    }
    const elements = new Map();
    const querySelector = selector => {
      if (!elements.has(selector)) elements.set(selector, new FakeElement(selector));
      return elements.get(selector);
    };
    const context = { Map, Set, window: { isSecureContext: true }, CONTROLS: [],
      HTMLElement: FakeElement, HTMLSpanElement: FakeElement, HTMLHeadingElement: FakeElement,
      HTMLAnchorElement: FakeElement, HTMLDivElement: FakeElement, HTMLButtonElement: FakeElement,
      HTMLParagraphElement: FakeElement, HTMLInputElement: FakeElement, HTMLSelectElement: FakeElement,
      HTMLOutputElement: FakeElement, HTMLDetailsElement: FakeElement, HTMLDialogElement: FakeElement,
      document: { querySelector, querySelectorAll: () => [] },
      playableBars: chart => chart.bars.length - 1,
      PracticeAudio: { create: () => preparing.promise },
    };
    prepareUIContext(context);
    vm.runInContext(`${uiSource}\nfunction render() {}\nchart = { bars: Array.from({ length: 218 }, (_, index) => ({ bar: index + 1 })) }; song = { chart, program: { lengthBeats: 4, events: [] } };\nglobalThis.ui = { startPractice, stopPractice, panic };`, context);
    const starting = context.ui.startPractice();
    await context.ui[action]();
    preparing.resolve({ subscribe() {}, onEvent() {}, async setClick() { commands.push('click'); }, async start() { commands.push('start'); } });
    await starting;
    assert.deepEqual(commands, []);
  });
}

test('repeated Record demo taps during audio preparation create one recorder', async () => {
  const preparing = deferred();
  let recorders = 0;
  class Element {
    value = '';
    checked = true;
    textContent = '';
    setAttribute() {}
    addEventListener() {}
  }
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive';
    constructor() { recorders++; }
    addEventListener() {}
    start() { this.state = 'recording'; }
  }
  const context = { Map, Set, window: { isSecureContext: true, MediaRecorder: Recorder }, MediaRecorder: Recorder, CONTROLS: [],
    HTMLElement: Element, HTMLSpanElement: Element, HTMLHeadingElement: Element, HTMLAnchorElement: Element,
    HTMLDivElement: Element, HTMLButtonElement: Element, HTMLParagraphElement: Element, HTMLInputElement: Element,
    HTMLSelectElement: Element, HTMLOutputElement: Element, HTMLDetailsElement: Element, HTMLDialogElement: Element,
    document: { querySelector: () => new Element(), querySelectorAll: () => [] },
    PracticeAudio: { create: () => preparing.promise },
  };
  prepareUIContext(context);
  vm.runInContext(`${uiSource}\nfunction render() {}\nchart = { bars: Array.from({ length: 218 }, (_, index) => ({ bar: index + 1 })) }; song = { chart, program: { lengthBeats: 4, events: [] } }; globalThis.recordDemo = toggleOutputRecording;`, context);
  const first = context.recordDemo();
  const second = context.recordDemo();
  preparing.resolve({ subscribe() {}, onEvent() {}, outputStream: {} });
  await Promise.all([first, second]);
  assert.equal(recorders, 1);
});

function startupHarness(microphone = async () => {}, { autoPlay = true, convert = async () => new Blob(['mp3'], { type: 'audio/mpeg' }), voiceConfigurations = initialVoiceEffects(), compiled = true, loadedSong, catalogSave = async () => {}, savedConfigurations = initialVoiceEffects() } = {}) {
  const commands = [];
  class Element {
    constructor(selector) {
      this.value = ({ '#bpm': '98', '#start-section': '1', '#end-bar': '76', '#count-in': '1', '#effects-delay': '100', '#effects-feedback': '0', '#effects-wet': '0.25' })[selector] || '';
      this.checked = selector !== '#click';
      this.textContent = '';
    }
    setAttribute() {}
    addEventListener() {}
  }
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive';
    listeners = new Map();
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    start() { this.state = 'recording'; commands.push('record-start'); }
    stop() { this.state = 'inactive'; commands.push('record-stop'); this.listeners.get('stop')?.(); }
  }
  const audio = {
    subscribe() {}, onEvent(listener) { this.eventListener = listener; }, outputStream: {},
    async configureVoiceEffects(effects) { commands.push('effects'); this.configuredEffects = effects; },
    async enableMicrophone() { commands.push('microphone'); await microphone(); },
    async disableMicrophone() { commands.push('microphone-off'); },
    async setClick(enabled) { commands.push(`click:${enabled}`); },
    async start() { commands.push('start'); context.controls.phase(autoPlay ? 'playing' : 'count-in'); },
    async stop() { commands.push('stop'); context.controls.phase('idle'); },
    async control() { commands.push('panic'); context.controls.phase('idle'); },
    async dispose() { this.disposed = true; commands.push('dispose'); },
  };
  let creations = 0;
  const creationOptions = [];
  const elements = new Map();
  const revoked = [];
  const context = {
    Map, Set, Blob, URL: class extends URL { static createObjectURL(blob) { assert.equal(blob.type, 'audio/mpeg'); return 'blob:test'; } static revokeObjectURL(url) { revoked.push(url); } },
    recordingToMp3: convert, loadedSong,
    installVoiceCatalog: () => ({ savedConfigurations: () => savedConfigurations, saveDrafts: catalogSave, update() {}, async load() {}, openProfile() {} }),
    createVoiceEffectsEditor: () => ({ configurations: () => typeof voiceConfigurations === 'function' ? voiceConfigurations() : voiceConfigurations }),
    window: { isSecureContext: true, MediaRecorder: Recorder }, MediaRecorder: Recorder, CONTROLS: [],
    HTMLElement: Element, HTMLSpanElement: Element, HTMLHeadingElement: Element, HTMLAnchorElement: Element,
    HTMLDivElement: Element, HTMLButtonElement: Element, HTMLParagraphElement: Element, HTMLInputElement: Element,
    HTMLSelectElement: Element, HTMLOutputElement: Element, HTMLDetailsElement: Element, HTMLDialogElement: Element,
    document: { querySelector: selector => { const element = new Element(selector); elements.set(selector, element); return element; }, querySelectorAll: () => [] },
    playableBars: () => 76, PracticeAudio: { create: async options => { creations++; creationOptions.push(options); return audio; } },
  };
  prepareUIContext(context);
  vm.runInContext(`${uiSource}\nfunction render(next) { state = { ...state, ...next }; beginOutputRecording(state.phase); }\nchart = loadedSong?.chart || { bars: Array.from({ length: 76 }, (_, index) => ({ bar: index + 1 })) }; song = loadedSong || { chart, program: {}, compiled: ${compiled ? '{ executable: true }' : 'undefined'} }; globalThis.controls = { ensureAudio, applyVoiceEffects, startPractice, stopPractice, panic, toggleOutputRecording, phase: phase => render({ phase }) };`, context);
  return { commands, controls: context.controls, audio, elements, revoked, creationOptions, get creations() { return creations; } };
}

function voiceEditorHarness() {
  class Element {
    children = []; listeners = new Map(); attributes = {}; dataset = {}; value = '';
    style = { setProperty() {} }; validationMessage = '';
    replaceChildren(...children) { this.children = [...children]; }
    setCustomValidity(message) { this.validationMessage = message; }
    constructor(tag) { this.tag = tag; }
    append(...children) { this.children.push(...children); }
    get lastElementChild() { return this.children.at(-1); }
    get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    reportValidity() { return this.value !== '' && !this.validationMessage; }
    querySelector() { return null; }
    contains(element) { return this.children.includes(element); }
  }
  const roots = new Map(), applied = [];
  const editor = createVoiceEffectsEditor(profile => applied.push(profile));
  // Explicit non-default stacks exercise field validation for otherwise dry capture voices.
  for (const profile of [0, 1]) editor.setEffects(profile, [slapback()]);
  editor.setEffects(5, [slapback(), chorus()]);
  const original = globalThis.document;
  try {
    globalThis.document = { createElement: tag => new Element(tag) };
    for (const profile of [0, 1, 5]) {
      const root = new Element('div'); roots.set(profile, root);
      editor.mount({ id: `voice-${profile}`, name: `Voice ${profile}`, profile }, root);
    }
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
  const native = editor.configurations().map(configuration => ({ ...configuration, prepared: true, revision: 1, activity: 'standby', rotationEligible: false, rotationRemainingBeats: 0 }));
  editor.render(native, false);
  function descendants(element) { return [element, ...element.children.flatMap(descendants)]; }
  function field(profile, label, value) {
    const input = descendants(roots.get(profile)).find(element => element.attributes['aria-label']?.endsWith(label));
    assert(input, `missing numeric field ${label}`);
    input.value = value; input.listeners.get('input')();
  }
  return { editor, native, applied, field, apply(profile) {
    descendants(roots.get(profile)).find(element => element.tag === 'button' && element.textContent === 'Apply changes').listeners.get('click')();
  } };
}

for (const [profile, label, stage, parameter] of [[0, 'Wet', 0, 'wet'], [0, 'Feedback', 0, 'feedback'], [5, 'Depth', 1, 'depthMs']]) {
  test(`blank required ${label} remains invalid instead of becoming zero`, () => {
    const h = voiceEditorHarness(); h.field(profile, label, '');
    assert(Number.isNaN(h.editor.configurations()[profile].effects[stage][parameter]));
    h.apply(profile); assert.deepEqual(h.applied, [], 'Apply rejects the empty required field');
  });
}

test('Start rejects blank voice settings before microphone setup and preserves the applied bundle', async () => {
  const editor = voiceEditorHarness(); editor.field(0, 'Wet', '');
  const h = startupHarness(undefined, { voiceConfigurations: () => editor.editor.configurations() });
  const previous = editor.native.map(({ profile, effects }) => ({ profile, effects })); h.audio.configuredEffects = previous;
  h.audio.configureVoiceEffects = async configurations => {
    h.commands.push('effects');
    NativePerformance.prototype.prepareVoiceEffects.call({}, configurations);
    h.audio.configuredEffects = configurations;
  };
  await assert.rejects(h.controls.startPractice(), /Invalid voice effect/);
  assert.deepEqual(h.commands, ['effects']);
  assert.equal(h.audio.configuredEffects, previous);
  assert.deepEqual(editor.editor.configurations(1)[0].effects, previous[0].effects, 'another voice Apply uses this voice’s applied stack');
  editor.apply(1); assert.deepEqual(editor.applied, [1], 'an unrelated invalid draft does not block the selected voice');
});

test('MP3 preparation blocks replacement takes until the download is ready', async () => {
  const conversion = deferred();
  const { commands, controls, elements } = startupHarness(undefined, { convert: () => conversion.promise });
  await controls.startPractice();
  await controls.stopPractice();
  assert.equal(elements.get('#recording-hint').textContent, 'Preparing MP3…');
  await controls.startPractice();
  await controls.toggleOutputRecording();
  assert.equal(commands.filter(command => command === 'record-start').length, 1);
  conversion.resolve(new Blob(['mp3'], { type: 'audio/mpeg' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(elements.get('#download-demo').download, /^practice-.*\.mp3$/);
  assert.equal(elements.get('#download-demo').hidden, false);
  await controls.startPractice();
  assert.equal(commands.filter(command => command === 'record-start').length, 2);
});

test('failed MP3 preparation retains the previous download and permits another take', async () => {
  let conversions = 0;
  const { controls, commands, elements, revoked } = startupHarness(undefined, { convert: async () => {
    if (++conversions > 1) throw new Error('Encoding failed');
    return new Blob(['mp3'], { type: 'audio/mpeg' });
  } });
  await controls.startPractice();
  await controls.stopPractice();
  const previous = elements.get('#download-demo').download;
  await controls.startPractice();
  await controls.stopPractice();
  assert.equal(elements.get('#download-demo').hidden, false);
  assert.equal(elements.get('#download-demo').download, previous);
  assert.deepEqual(revoked, []);
  await controls.startPractice();
  assert.equal(commands.filter(command => command === 'record-start').length, 3);
});

test('Start opens the microphone and records by default on every run, with song click off', async () => {
  const { commands, controls } = startupHarness();
  await controls.startPractice();
  assert.deepEqual(commands, ['effects', 'microphone', 'click:false', 'start', 'record-start']);
  await controls.stopPractice();
  assert.deepEqual(commands.slice(-3), ['record-stop', 'stop', 'microphone-off']);
  await controls.startPractice();
  assert.deepEqual(commands.slice(-5), ['effects', 'microphone', 'click:false', 'start', 'record-start']);
  await controls.panic();
  assert.deepEqual(commands.slice(-3), ['record-stop', 'panic', 'microphone-off']);
});

test('a physical Panic event from real WASM cleans up the UI without another musical command', async () => {
  const module = await WebAssembly.compile(await readFile(new URL('../wasm/manual-clock.wasm', import.meta.url)));
  let memory;
  const instance = new WebAssembly.Instance(module, {
    env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: {
      fd_write(_fd, _vectors, _count, written) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; },
      fd_close: () => 0, fd_seek: () => 0, proc_exit(code) { throw new Error(`WASM exited ${code}`); },
    },
  });
  memory = instance.exports.memory;
  instance.exports._initialize?.();
  const native = new NativePerformance({ api: instance.exports, sampleRate: 8000, mode: PF.PRACTICE, clickGain: 0,
    compiledProgram: [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
      PF.INPUT_MAGIC, 1, 0, PF.INPUT_PANIC, 0] });
  try {
    const h = startupHarness(); await h.controls.startPractice();
    const bindingGeneration = native.inputRouting().bindingGeneration;
    native.inputAttach({ producer: 0, session: 1, bindingGeneration, kind: 'physical', releasedMask: 1, heldMask: 0 });
    native.inputEvent({ producer: 0, session: 1, bindingGeneration, sequence: 1, input: 0, value: 1 });
    const event = native.events().find(value => value.type === 'control' && value.control?.id === 'mushroom' && value.applied);
    assert(event, 'the engine publishes the accepted physical Panic as a normal control event');
    h.audio.eventListener(event);
    await Promise.resolve();
    assert.deepEqual(h.commands.slice(-2), ['record-stop', 'microphone-off']);
    assert(!h.commands.includes('panic'), 'readback cleanup never submits a second Panic');
  } finally { native.dispose(); }
});

test('demo recording excludes count-in and starts once at the first playing state', async () => {
  const { commands, controls } = startupHarness(undefined, { autoPlay: false });
  await controls.startPractice();
  controls.phase('count-in');
  assert(!commands.includes('record-start'));
  controls.phase('playing');
  controls.phase('playing');
  assert.equal(commands.filter(command => command === 'record-start').length, 1);
  await controls.stopPractice();
  assert(commands.includes('record-stop'));
});

test('stopping during count-in cancels the pending take without starting a recorder', async () => {
  const { commands, controls } = startupHarness(undefined, { autoPlay: false });
  await controls.startPractice();
  await controls.stopPractice();
  controls.phase('playing');
  assert(!commands.includes('record-start'));
  assert(!commands.includes('record-stop'));
});

test('recording toggled on during playback begins immediately', async () => {
  const { commands, controls } = startupHarness();
  await controls.startPractice();
  await controls.toggleOutputRecording();
  await controls.toggleOutputRecording();
  assert.equal(commands.filter(command => command === 'record-start').length, 2);
});

test('cancelling a waiting take cannot resume recording at the downbeat', async () => {
  const { commands, controls } = startupHarness(undefined, { autoPlay: false });
  await controls.startPractice();
  await controls.toggleOutputRecording();
  controls.phase('playing');
  assert(!commands.includes('record-start'));
});

test('Stop while microphone access is pending cannot start a recorder or transport later', async () => {
  const entered = deferred();
  const waiting = deferred();
  const { commands, controls } = startupHarness(async () => { entered.resolve(); await waiting.promise; });
  const starting = controls.startPractice();
  await entered.promise;
  await controls.stopPractice();
  waiting.resolve();
  await starting;
  assert(!commands.includes('start'));
  assert(!commands.includes('record-start'));
  assert.equal(commands.at(-1), 'microphone-off');
});

for (const [action, method] of [['stopPractice', 'stop'], ['panic', 'control']]) {
  test(`${action} finishes recording and releases the microphone even when the backend fails`, async () => {
    const harness = startupHarness();
    await harness.controls.startPractice();
    const failure = new Error('Audio worklet failed');
    harness.audio[method] = async () => { throw failure; };
    await assert.rejects(harness.controls[action](), error => error === failure);
    assert.deepEqual(harness.commands.slice(-3), ['record-stop', 'microphone-off', 'dispose']);
    await harness.controls.startPractice();
    assert.equal(harness.creations, 2, 'a failed session is replaced on the next Start');
  });

  test(`${action} stops local recording and microphone acquisition before backend acknowledgment`, async () => {
    const harness = startupHarness();
    await harness.controls.startPractice();
    const waiting = deferred();
    harness.audio[method] = () => waiting.promise;
    const stopping = harness.controls[action]();
    assert.deepEqual(harness.commands.slice(-2), ['record-stop', 'microphone-off']);
    waiting.resolve();
    await stopping;
  });
}

test('microphone tracks release before a failed worklet notification settles', async () => {
  const waiting = deferred();
  let released = false;
  const audio = Object.assign(Object.create(PracticeAudio.prototype), {
    tracker: { async stopListening() { released = true; } },
    request() { return waiting.promise; },
  });
  const disabling = audio.disableMicrophone();
  assert.equal(released, true);
  const failure = new Error('Microphone worklet unavailable');
  waiting.resolve(Promise.reject(failure));
  await assert.rejects(disabling, error => error === failure);
});

test('disposing failed audio disconnects every output without waiting for a worklet reply', async () => {
  const released = [];
  const audio = Object.assign(Object.create(PracticeAudio.prototype), {
    startGeneration: 0, disposed: false, peripheralTransition: Promise.resolve(),
    detachState() {}, detachTracker() {}, detachPeripheral() {},
    endpoint: { port: { removeEventListener() {} }, dispose() { released.push('endpoint'); }, request() { throw new Error('Must not wait for an acknowledgment'); } },
    recordDestination: { stream: { getTracks: () => [{ stop() { released.push('recording-track'); } }] }, disconnect() { released.push('recording-node'); } },
    tracker: { node: { disconnect(...targets) { assert.equal(targets.length, 0); released.push('all-output'); } }, async stopListening() { released.push('microphone'); }, async dispose() { released.push('tracker'); } },
    sampler: { async dispose() { released.push('sampler'); } },
    listeners: new Set(), eventListeners: new Set(), tunerListeners: new Set(),
  });
  await audio.dispose();
  assert(released.includes('all-output'));
  assert(released.includes('microphone'));
  assert.equal(audio.disposed, true);
});

for (const stage of ['transition', 'detach']) for (const acknowledgement of ['delayed', 'hung', 'rejected']) {
  test(`local disposal silences audio during ${acknowledgement} peripheral ${stage}`, async () => {
    const calls = [];
    const waiting = acknowledgement === 'hung' ? { promise: new Promise(() => {}) } : deferred();
    const failure = new Error('Peripheral cleanup unconfirmed');
    const audio = Object.assign(Object.create(PracticeAudio.prototype), {
      startGeneration: 0, microphoneGeneration: 0, disposed: false,
      peripheralTransition: stage === 'transition' ? waiting.promise : Promise.resolve(),
      detachPeripheral() { calls.push('peripheral-stop'); return stage === 'detach' ? waiting.promise : Promise.resolve(); },
      detachState() {}, detachTracker() {}, monitoring: { kind: 'unconfirmed' },
      liveMonitor: { gain: { value: 1 }, disconnect() { calls.push('monitor'); } },
      endpoint: { port: { removeEventListener() {} }, dispose() { calls.push('endpoint'); } },
      recordDestination: { stream: { getTracks: () => [{ stop() { calls.push('recording-track'); } }] }, disconnect() { calls.push('recording-node'); } },
      tracker: { node: { disconnect() { calls.push('all-output'); } }, async stopListening() { calls.push('microphone'); }, async dispose() { calls.push('tracker'); } },
      sampler: { async dispose() { calls.push('sampler'); } },
      listeners: new Set(), eventListeners: new Set(), tunerListeners: new Set(),
    });
    let settled = false;
    const result = audio.dispose().then(() => { settled = true; }, error => { settled = true; throw error; });
    void result.catch(() => {});
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(audio.liveMonitor.gain.value, 0, 'a physical acknowledgement cannot keep live monitoring audible');
      assert.equal(audio.disposed, true);
      for (const resource of ['recording-track', 'all-output', 'recording-node', 'monitor', 'sampler', 'microphone'])
        assert(calls.includes(resource), `${resource} must be released before the peripheral acknowledges`);
      assert.equal(settled, false, 'source cleanup uncertainty is retained after local silence');
    } finally {
      if (waiting.resolve) {
        waiting.resolve(acknowledgement === 'rejected' ? Promise.reject(failure) : undefined);
        if (acknowledgement === 'rejected') await assert.rejects(result, error => error === failure);
        else await result;
        assert(calls.includes('endpoint'));
        assert(calls.includes('tracker'));
      }
    }
  });
}

test('the desk mushroom sends an identified tap during preflight and ordinary Panic afterward', async () => {
  const source = await sourceForVM(new URL('../desk.ts', import.meta.url));
  const presses = [];
  let stage = 3;
  const context = vm.createContext({
    audio: { snapshot: () => ({ preflightStage: stage }) },
    keyboardProducer: { async event(input, value) { presses.push(['keyboard', input, value]); } },
    pointerProducer: { async event(input, value) { presses.push(['pointer', input, value]); } },
    panic() { presses.push(['panic']); },
  });
  const mushroom = source.slice(source.indexOf('async function pressMushroom('), source.indexOf('function receivePerformanceEvent('));
  vm.runInContext(mushroom, context);
  await context.pressMushroom('keyboard');
  await context.pressMushroom('pointer');
  stage = 0;
  await context.pressMushroom('pointer');
  assert.deepEqual(presses, [
    ['keyboard', 4, 1], ['keyboard', 4, 0], ['pointer', 4, 1], ['pointer', 4, 0], ['panic'],
  ]);
});

test('Escape triggers Panic with an input focused while pad shortcuts still ignore editing', async () => {
  const source = await sourceForVM(new URL('../desk.ts', import.meta.url));
  const keyboardSource = source.slice(source.indexOf('window.addEventListener("keydown"'), source.indexOf('window.addEventListener("keyup"'));
  let keydown;
  let panicCalls = 0;
  let padCalls = 0;
  class Element { closest() { return true; } }
  const context = { Element, Map, Set, acceptsRouteInput: () => true, heldKeys: new Set(), inputPolicy: { allowsDomInput: () => true }, pointerHeld: new Set(), keyboardProducer: { async reset() {}, async event() {} }, keyboardEpoch: 0, audio: {}, CONTROLS: [{ key: 'KeyQ', id: 'L1' }],
    document: { querySelector: () => null },
    window: { addEventListener(_type, listener) { keydown = listener; } },
    act: action => action(), flash() {}, pressMushroom: () => panicCalls++, triggerPad: () => padCalls++,
  };
  prepareUIContext(context);
  const adapterSource = '';
  vm.runInContext(adapterSource + keyboardSource, context);
  const event = { target: new Element(), repeat: false, timeStamp: 0, preventDefault() {} };
  keydown({ ...event, code: 'KeyQ' });
  keydown({ ...event, code: 'Escape' });
  assert.equal(padCalls, 0);
  assert.equal(panicCalls, 1);
});

for (const policy of ['unselected', 'native-controls', 'inactive-song-preview']) {
  test(`${policy} guards every musical DOM path before Escape, transport, pads and wheel`, async () => {
    const source = await sourceForVM(new URL('../desk.ts', import.meta.url));
    const handlers = source.slice(source.indexOf('window.addEventListener("wheel"'), source.indexOf('function postPerformanceEvent'));
    const listeners = new Map();
    let commands = 0;
    class Element { closest() { return null; } }
    const context = vm.createContext({ Element, mountSignal: new AbortController().signal,
      acceptsRouteInput: () => policy !== 'inactive-song-preview',
      inputPolicy: { allowsDomInput: () => policy === 'inactive-song-preview' },
      window: { addEventListener: (type, listener) => listeners.set(type, listener) },
      panic() { commands++; }, triggerPad() { commands++; }, releasePad() { commands++; },
      rotate() { commands++; }, startPractice() { commands++; }, stopPractice() { commands++; } });
    vm.runInContext(handlers, context);
    for (const code of ['Escape', 'Space', 'KeyQ', 'KeyW', 'KeyA', 'KeyS']) {
      const event = { code, target: new Element(), preventDefault() {}, repeat: false };
      listeners.get('keydown')(event); listeners.get('keyup')(event);
    }
    listeners.get('wheel')({ deltaY: 3, target: new Element(), preventDefault() {} });
    assert.equal(commands, 0);
  });
}

test('keyboard forwards fresh observations after focus loss while native admission owns release barriers', async () => {
  const source = await sourceForVM(new URL('../desk.ts', import.meta.url));
  const listeners = new Map();
  const commands = [];
  const releases = [];
  let panicCalls = 0;
  class Element {
    constructor(editing = false) { this.editing = editing; }
    closest() { return this.editing; }
  }
  const controls = [{ key: 'KeyQ', id: 'L1' }, { key: 'KeyW', id: 'R1' }, { key: 'KeyA', id: 'L2' }, { key: 'KeyS', id: 'R2' }];
  const context = { Element, Map, Set, acceptsRouteInput: () => true, heldKeys: new Set(), inputPolicy: { allowsDomInput: () => true }, pointerHeld: new Set(), keyboardProducer: { async reset() {}, async event() {} }, keyboardEpoch: 0, audio: {}, CONTROLS: controls,
    document: { querySelector: () => null, querySelectorAll: () => [] }, pads: new Map(), elements: { mushroom: { classList: { remove() {} } } },
    window: { addEventListener(type, listener) { listeners.set(type, listener); } },
    act: action => action(), flash() {}, pressMushroom: () => panicCalls++, triggerPad: (id, commandId) => commands.push({ id, commandId }), releasePad: (id, commandId) => releases.push({ id, commandId }),
  };
  prepareUIContext(context);
  const adapterSource = '';
  const releaseSource = source.slice(source.indexOf('function releasePresses'), source.indexOf('const pendingPadPresses'));
  const handlers = source.slice(source.indexOf('window.addEventListener("keydown"'), source.indexOf('function postPerformanceEvent'));
  vm.runInContext(adapterSource + releaseSource + handlers, context);
  const event = { target: new Element(), code: 'KeyQ', repeat: false, timeStamp: 123, preventDefault() {} };
  for (const control of controls) {
    const key = { ...event, code: control.key };
    const before = commands.length;
    listeners.get('keydown')(key);
    listeners.get('keydown')(key);
    listeners.get('keydown')({ ...key, repeat: true });
    assert.equal(commands.length, before + 1);
    listeners.get('keyup')(key);
    vm.runInContext('releasePresses()', context);
    listeners.get('keydown')({ ...key, repeat: true });
    assert.equal(commands.length, before + 1, 'a held repeat after refocus does not perform');
    listeners.get('keydown')(key);
    assert.equal(commands.length, before + 2, `fresh ${control.key} performs on the first press after refocus`);
    assert.equal(commands.at(-1).id, control.id);
    listeners.get('keyup')(key);
  }
  vm.runInContext('releasePresses()', context);
  const escape = { ...event, code: 'Escape', target: new Element(true) };
  listeners.get('keydown')(escape);
  assert.equal(panicCalls, 1, 'the first Escape after reconnect panics even with a field focused');
  listeners.get('keydown')({ ...escape, repeat: true });
  assert.equal(panicCalls, 1);
  listeners.get('keyup')(escape);
  vm.runInContext('releasePresses()', context);
  listeners.get('keydown')(escape);
  assert.equal(panicCalls, 2, 'Escape also works when it is the first input after focus loss');
  assert.equal(commands.length, 8);
  assert.equal(releases.length, 8, "every accepted key-up forwards a pad release");
  assert.deepEqual(releases.map(control => control.id), commands.map(control => control.id));
  assert(commands.every(command => command.commandId === 'keyboard'));
  assert(releases.every(command => command.commandId === 'keyboard'));
});

for (const bypass of [false, true]) {
  test(`per-voice effect configuration applies before microphone setup, bypass=${bypass}`, async () => {
    const configurations = initialVoiceEffects();
    configurations[1] = { profile: 1, effects: bypass ? [] : [{ kind: 'slapback', delayMs: 125, feedback: .3, wet: .4 }] };
    const h = startupHarness(undefined, { voiceConfigurations: configurations });
    await h.controls.startPractice();
    assert.deepEqual(JSON.parse(JSON.stringify(h.audio.configuredEffects)), configurations);
    assert.deepEqual(h.commands.slice(0, 2), ['effects', 'microphone']);
    assert.deepEqual(h.audio.configuredEffects[0].effects, [], 'tuning one voice leaves another capture voice dry');
    assert.deepEqual(h.audio.configuredEffects[4].effects, initialVoiceEffects()[4].effects, 'tuning a capture voice preserves the live vocal stack');
  });
}

test('applying a stopped voice configuration does not open the microphone or start recording', async () => {
  const h = startupHarness();
  await h.controls.applyVoiceEffects(1);
  assert.deepEqual(h.commands, ['effects']);
});

test('Stop cancels a start waiting for effects preparation', async () => {
  const h = startupHarness();
  const waiting = deferred();
  h.audio.configureVoiceEffects = () => waiting.promise;
  const starting = h.controls.startPractice();
  await h.controls.stopPractice();
  waiting.resolve();
  await starting;
  assert(!h.commands.includes('microphone'));
  assert(!h.commands.includes('start'));
});

test('Space on an effect disclosure, action button or link never toggles transport', async () => {
  const source = await sourceForVM(new URL('../desk.ts', import.meta.url));
  const keyboardSource = source.slice(source.indexOf('window.addEventListener("keydown"'), source.indexOf('window.addEventListener("keyup"'));
  const adapterSource = '';
  let keydown;
  let starts = 0, panics = 0, pads = 0, prevented = 0;
  class Element {
    constructor(kind) { this.kind = kind; }
    closest(selector) { return selector.split(',').includes(this.kind) ? this : null; }
  }
  const context = { Element, Map, Set, acceptsRouteInput: () => true, heldKeys: new Set(), inputPolicy: { allowsDomInput: () => true }, pointerHeld: new Set(), keyboardProducer: { async reset() {}, async event() {} }, keyboardEpoch: 0, audio: {}, CONTROLS: [{ key: 'KeyQ', id: 'L1' }],
    document: { querySelector: () => null },
    window: { addEventListener(_type, callback) { keydown = callback; } },
    act: action => action(), flash() {}, isRunning: () => false, startPractice: () => starts++, stopPractice() {}, pressMushroom: () => panics++, triggerPad: () => pads++,
  };
  prepareUIContext(context); vm.runInContext(adapterSource + keyboardSource, context);
  const event = { code: 'Space', repeat: false, timeStamp: 0, preventDefault() { prevented++; } };
  for (const kind of ['summary', 'button', 'a', 'input', 'select']) keydown({ ...event, target: new Element(kind) });
  assert.equal(starts, 0);
  assert.equal(prevented, 0, 'native Space behavior remains available to the focused element');
  keydown({ ...event, target: new Element('body') });
  assert.equal(starts, 1);
  keydown({ ...event, code: 'KeyQ', target: new Element('button') });
  assert.equal(pads, 1, 'pad keys remain available outside value editors');
  keydown({ ...event, code: 'Escape', target: new Element('input') });
  assert.equal(panics, 1);
});

test('timing-only sessions start with dry identity processing in every profile', async () => {
  const h = startupHarness(undefined, { compiled: false, voiceConfigurations: initialVoiceEffects() });
  await h.controls.startPractice();
  assert.deepEqual(JSON.parse(JSON.stringify(h.audio.configuredEffects)), initialVoiceEffects('dry'));
  assert(h.audio.configuredEffects.every(configuration => configuration.effects.length === 0));
  assert.deepEqual(h.commands.slice(0, 2), ['effects', 'microphone']);
});

test('an unfinished chart cannot prepare audio or start transport', async () => {
  const { song } = await loadSongPreview('you-wanted-a-hit');
  const h = startupHarness(undefined, { loadedSong: song, catalogSave: async () => assert.fail('Unexpected draft save') });
  await assert.rejects(h.controls.ensureAudio(), /Audio is unavailable/);
  await assert.rejects(h.controls.startPractice(), /Audio is unavailable/);
  assert.deepEqual(h.creationOptions, []);
  assert.deepEqual(h.commands, []);
});

for (const action of ['startPractice', 'applyVoiceEffects']) {
  test(`${action} persists voice drafts before configuring audio`, async () => {
    const operations = [];
    const h = startupHarness(undefined, { catalogSave: async () => { operations.push('saved'); } });
    const configure = h.audio.configureVoiceEffects;
    h.audio.configureVoiceEffects = async effects => { operations.push('configured'); await configure.call(h.audio, effects); };
    await h.controls[action](1);
    assert.deepEqual(operations, ['saved', 'configured']);
  });

  test(`${action} blocks audio configuration when saving voice drafts fails`, async () => {
    const failure = new Error('Local voice library could not be saved');
    const h = startupHarness(undefined, { catalogSave: async () => { throw failure; } });
    await assert.rejects(h.controls[action](1), error => error === failure);
    assert.deepEqual(h.commands, [], 'failed persistence never prepares effects, microphone or transport');
  });
}

test('passive preparation passes saved graphs while Start passes its explicitly selected draft bundle', async () => {
  const saved = initialVoiceEffects();
  const draft = saved.map(configuration => configuration.profile === 0 ? { ...configuration, effects: [] } : configuration);
  const passive = startupHarness(undefined, { savedConfigurations: saved, voiceConfigurations: draft });
  await passive.controls.ensureAudio();
  assert.equal(passive.creationOptions[0].initialVoiceEffects, saved);
  const start = startupHarness(undefined, { savedConfigurations: saved, voiceConfigurations: draft });
  await start.controls.startPractice();
  assert.equal(start.creationOptions[0].initialVoiceEffects, draft);
});

test('Drunk Girls loads the complete executable pickup and numbered timeline', async () => {
  const song = await loadSong('drunk-girls');
  assert.equal(song.compiled?.executable, true);
  assert.equal(song.chart.bars.length, 137);
  assert.equal(song.chart.bars[0].label, 'Pickup');
  assert.equal(song.chart.bars[9].label, '1');
  assert.equal(song.practice.endBar, 137);
});

for (const cleanup of ['normal', 'delayed', 'rejected', 'hung', 'clear-rejected', 'clear-lost', 'clear-hung', 'lights-rejected']) test(`actual physical source disposal ${cleanup}`, async () => {
  const saved = new Map(['window', 'document', 'location', 'history', 'sessionStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new Map([['show-tools-musical-input-policy', 'native-controls']]);
  const status = { textContent: '', setAttribute() {} };
  const events = new EventTarget();
  const token = 'a'.repeat(64);
  let nativeCommands;
  let nativeRouting;
  let destroyNative = () => {};
  if (cleanup === 'normal') {
    const module = await WebAssembly.compile(await readFile(new URL('../wasm/manual-clock.wasm', import.meta.url)));
    const sources = await Promise.all(['../runtime/beat-worklet.js', '../runtime/performance-worklet.js', '../practice-worklet.ts']
      .map(async path => (await sourceForVM(new URL(path, import.meta.url))).replace(/^import .*;\n/gm, '').replace(/export class /g, 'class ')));
    const context = vm.createContext({ NativePerformance, CONTROL_IDS: ['L1', 'L2', 'R1', 'R2'], WebAssembly, module, sampleRate: 8000, currentFrame: 0,
      Float32Array, Float64Array, DataView, AudioWorkletProcessor: class { port = { postMessage() {} }; }, registerProcessor() {} });
    vm.runInContext(sources.join('\n') + `
      globalThis.processor = new PracticeProcessor({ processorOptions: { module, clickGain: 0, practice: { barCount: 4, endBar: 4,
        program: { lengthBeats: 4, events: [], controls: { leadIn: Object.fromEntries(CONTROL_IDS.map(id => [id, { kind: 'none' }])),
          bars: Array.from({ length: 4 }, () => Object.fromEntries(CONTROL_IDS.map(id => [id, { kind: 'none' }]))) } } } } });
      const messages = []; let request = 0;
      processor.receive({ type: 'performance-connect', port: { start() {}, close() {}, postMessage: value => messages.push(value) } });
      globalThis.command = (command, payload) => {
        processor.command({ id: ++request, command, payload });
        return messages.at(-1);
      };
    `, context);
    nativeCommands = context.command;
    nativeRouting = () => context.processor.native.inputRouting();
    destroyNative = () => context.processor.native.dispose();
  }
  const calls = [];
  const waiting = (cleanup === 'hung' || cleanup === 'clear-hung') ? { promise: new Promise(() => {}) } : deferred();
  let closed = false;
  let eventsSignal;
  const values = {
    window: events, document: { getElementById: () => status },
    location: { hash: `#peripheral=${token}`, pathname: '/', search: '' }, history: { replaceState() {} },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => {
      if (String(url).endsWith('/events')) {
        eventsSignal = options.signal;
        return new Response(new ReadableStream({ start(controller) {
        options.signal.addEventListener('abort', () => controller.close(), { once: true });
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'connected', lease: 'helper-lease', ready: { type: 'ready', version: 2, session: 1, switches: [{ controlId: 'blue', state: 'released' }] } }) + '\n'));
      } }));
      }
      calls.push(String(url));
      if (String(url).endsWith('/clear')) {
        assert.equal(eventsSignal.aborted, false, 'exact publisher retirement is requested before aborting its stream');
        assert.deepEqual(JSON.parse(options.body), { lease: 'helper-lease' });
        if (cleanup === 'clear-rejected') return new Response(null, { status: 409 });
        if (cleanup === 'clear-lost') throw new Error('Publisher acknowledgement lost');
        if (cleanup === 'clear-hung') await waiting.promise;
      }
      return Response.json({});
    },
  };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  createMusicalInputPolicy().select('native-controls');
  const audio = Object.assign(Object.create(PracticeAudio.prototype), {
    startGeneration: 0, microphoneGeneration: 0, disposed: false, peripheralTransition: Promise.resolve(),
    detachPeripheral() {}, fail(error) { throw error; },
    latest: { inputRouting: nativeRouting ? nativeRouting() : { bindingGeneration: 1, sessionHighWatermark: 0, panicMask: 0, producers: [] } },
    detachState() {}, detachTracker() {},
    liveMonitor: { gain: { value: 1 }, disconnect() { calls.push('monitor'); } },
    endpoint: { port: new EventTarget(), async request(command, payload) {
      if (closed) throw new Error('Endpoint already destroyed');
      calls.push([command, payload]);
      if (nativeCommands) assert.equal(nativeCommands(command, payload).ok, true, command);
      if (command === 'practice.peripheral-lights' && payload.enabled === false && cleanup === 'lights-rejected') throw new Error('Light disable unconfirmed');
      if (command === 'practice.input-revoke' && ['delayed', 'rejected', 'hung'].includes(cleanup)) {
        await waiting.promise;
        if (cleanup === 'rejected') throw new Error('Physical revoke unconfirmed');
      }
    }, dispose() { closed = true; calls.push('endpoint'); } },
    recordDestination: { stream: { getTracks: () => [{ stop() { calls.push('recording-track'); } }] }, disconnect() { calls.push('recording-node'); } },
    tracker: { node: { disconnect() { calls.push('all-output'); } }, async stopListening() { calls.push('microphone'); }, async dispose() { calls.push('microphone', 'tracker'); } },
    sampler: { async dispose() { calls.push('sampler'); } },
    listeners: new Set(), eventListeners: new Set(), tunerListeners: new Set(),
  });
  try {
    audio.attachPeripheral(); await audio.peripheralReady;
    assert(calls.some(call => Array.isArray(call) && call[0] === 'practice.input-attach'));
    if (nativeRouting) assert.equal(nativeRouting().producers.find(producer => producer.kind === 'physical')?.kind, 'physical');
    let settled = false;
    const disposed = audio.dispose().finally(() => { settled = true; }); void disposed.catch(() => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(audio.liveMonitor.gain.value, 0);
    assert(calls.includes('microphone'));
    await assert.rejects(audio.inputEvent({ kind: 'physical', bindingGeneration: 1, sequence: 1, input: 0, value: 1 }), /disposed/);
    assert(calls.some(call => Array.isArray(call) && call[0] === 'practice.peripheral-lights' && call[1].enabled === false), 'physical light disable must actually execute');
    assert(calls.some(call => Array.isArray(call) && call[0] === 'practice.input-revoke'), 'exact physical revoke must actually execute');
    if (['clear-rejected', 'clear-lost', 'lights-rejected'].includes(cleanup)) {
      await assert.rejects(disposed, /retirement unconfirmed|acknowledgement lost|Light disable unconfirmed/);
      assert.equal(closed, true);
    } else if (cleanup === 'normal') {
      await disposed; assert.equal(closed, true);
      assert.equal(nativeRouting().producers.length, 0, 'real worklet physical lease was revoked before engine destruction');
    }
    else {
      assert.equal(closed, false, 'control endpoint survives until physical cleanup settles');
      assert.equal(settled, false, 'physical cleanup uncertainty stays pending');
      if (waiting.resolve) {
        waiting.resolve();
        if (cleanup === 'rejected') await assert.rejects(disposed, /Physical revoke unconfirmed/);
        else await disposed;
        assert.equal(closed, true);
      }
    }
  } finally {
    waiting.resolve?.(); destroyNative();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

for (const failure of ['context-close', 'microphone-notification', 'track-stop']) test(`actual tracker disposal retains ${failure} failure`, async () => {
  const calls = [];
  const problem = new Error(`${failure} failed`);
  const waiting = deferred();
  const tracker = new BeatTracker({ state: 'running', removeEventListener() {}, async close() {
    calls.push('context-close'); if (failure === 'context-close') throw problem;
  } }, true);
  tracker.lifecycle = 'running';
  tracker.node = { disconnect() { calls.push('all-output'); }, port: { postMessage() { calls.push('engine-dispose'); } } };
  tracker.source = { kind: 'microphone', node: { disconnect() { calls.push('microphone-node'); } }, stream: { getTracks: () => [
    { stop() { calls.push('first-track'); if (failure === 'track-stop') throw problem; } },
    { stop() { calls.push('second-track'); } },
  ] } };
  tracker.command = async () => { if (failure === 'microphone-notification') throw problem; };
  const audio = Object.assign(Object.create(PracticeAudio.prototype), {
    startGeneration: 0, microphoneGeneration: 0, disposed: false, peripheralTransition: Promise.resolve(),
    detachPeripheral: () => waiting.promise, detachState() {}, detachTracker() {},
    liveMonitor: { gain: { value: 1 }, disconnect() { calls.push('monitor'); } },
    endpoint: { port: new EventTarget(), dispose() { calls.push('endpoint'); } },
    recordDestination: { stream: { getTracks: () => [{ stop() { calls.push('recording-track'); } }] }, disconnect() { calls.push('recording-node'); } },
    tracker, sampler: { async dispose() { calls.push('sampler'); } },
    listeners: new Set(), eventListeners: new Set(), tunerListeners: new Set(),
  });
  let settled = false;
  const disposed = audio.dispose().finally(() => { settled = true; }); void disposed.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audio.liveMonitor.gain.value, 0);
  assert(calls.includes('recording-track')); assert(calls.includes('all-output')); assert(calls.includes('monitor'));
  assert(calls.includes('first-track'));
  assert.equal(calls.includes('second-track'), failure !== 'track-stop', 'a throwing track.stop leaves remaining capture retirement unconfirmed');
  if (failure !== 'context-close') assert.equal(audio.error, problem.message, 'microphone cleanup failure remains visible while peripheral cleanup hangs');
  assert.equal(settled, false);
  waiting.resolve();
  await assert.rejects(disposed, error => error === problem || error instanceof AggregateError && error.errors.includes(problem));
  assert(calls.includes('endpoint'));
  assert.equal(calls.includes('context-close'), failure !== 'track-stop');
});

test('only pointerup emits a musical release and cancellation retires pointer input', async () => {
  const source = await sourceForVM(new URL('../desk.ts', import.meta.url));
  const controls = [{ id: 'L1', key: 'KeyQ' }, { id: 'R2', key: 'KeyS' }];
  const commands = [];
  const windowEvents = new Map(), documentEvents = new Map();
  class Element {
    dataset = {};
    style = { setProperty() {} };
    classList = { add() {}, remove() {} };
    listeners = new Map();
    append() {}
    setAttribute() {}
    setPointerCapture() {}
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    observe(name, pointerId) { this.listeners.get(name)({ pointerId, button: 0, isPrimary: true, preventDefault() {} }); }
  }
  const audio = {
    inputScope: 'fixture',
    snapshot: () => ({ inputRouting: { bindingGeneration: 1 } }),
    async selectChannel() {},
    async inputAttach({ kind }) { commands.push(['attach', kind]); },
    async inputEvent({ input, value }) { commands.push(['edge', input, value]); },
    async inputRevoke({ kind }) { commands.push(['revoke', kind]); },
  };
  const panels = new Map();
  const context = {
    HTMLElement: Element, HTMLSpanElement: Element,
    CONTROLS: controls, CONTROL_IDS: ['L1', 'L2', 'R1', 'R2'], pads: panels, heldKeys: new Set(), pointerHeld: new Map(),
    pointerEpoch: 0, keyboardEpoch: 0, transportGeneration: 0, remote: false, voiceCatalog: { busy: false }, audio,
    window: { addEventListener: (name, listener) => windowEvents.set(name, listener) },
    document: { hidden: false, createElement: () => new Element(), addEventListener: (name, listener) => documentEvents.set(name, listener) },
    elements: { pads: new Element() }, arcadeColorForRow: () => '', controlName: id => id,
    inputPolicy: { allowsDomInput: () => true }, requiredElement: () => new Element(), flash() {},
    ensureAudio: async () => audio, phoneMotionAbort: undefined,
    act: action => action(),
    pointerProducer: createMusicalInputProducer({ kind: 'pointer', endpoint: async () => audio, releasedMask: 223 }),
    keyboardProducer: createMusicalInputProducer({ kind: 'keyboard', endpoint: async () => audio, releasedMask: 0 }),
  };
  prepareUIContext(context);
  vm.runInContext(
    source.slice(source.indexOf('function releasePresses('), source.indexOf('function scheduleAuditionEffect(')) +
    source.slice(source.indexOf('function makePads('), source.indexOf('function mountVoiceRows(')) +
    source.slice(source.indexOf('window.addEventListener("blur"'), source.indexOf('window.addEventListener("beforeunload"')) + 'makePads();',
    context,
  );
  const left = panels.get('L1').button, right = panels.get('R2').button;
  const drain = () => new Promise(resolve => setImmediate(resolve));

  right.observe('pointerdown', 1);
  await drain();
  right.observe('pointerup', 1);
  right.observe('lostpointercapture', 1);
  await drain();
  assert.deepEqual(commands.splice(0), [['attach', 'pointer'], ['edge', 3, 1], ['edge', 3, 0]]);

  right.observe('pointerdown', 2);
  left.observe('pointerdown', 3);
  await drain();
  right.observe('lostpointercapture', 1);
  assert.deepEqual(commands.splice(0), [['edge', 3, 1], ['edge', 0, 1]], 'an old capture event cannot retire current holds');
  right.observe('pointercancel', 2);
  right.observe('lostpointercapture', 2);
  left.observe('pointerup', 3);
  await drain();
  assert.deepEqual(commands.splice(0), [['revoke', 'pointer']], 'canceling one pointer retires the shared source without releasing either pad');

  const preparing = deferred();
  context.ensureAudio = () => preparing.promise;
  right.observe('pointerdown', 4);
  right.observe('lostpointercapture', 4);
  preparing.resolve(audio);
  await drain();
  assert.deepEqual(commands.splice(0), [], 'an already canceled press cannot attach after audio preparation');

  right.observe('pointerdown', 5);
  await drain();
  context.document.hidden = true;
  documentEvents.get('visibilitychange')();
  windowEvents.get('blur')();
  right.observe('pointerup', 5);
  await drain();
  assert.deepEqual(commands.splice(0), [['attach', 'pointer'], ['edge', 3, 1], ['revoke', 'pointer']]);

  context.document.hidden = false;
  right.observe('pointerdown', 6);
  await drain();
  right.observe('pointerup', 6);
  await drain();
  context.document.hidden = true;
  documentEvents.get('visibilitychange')();
  await drain();
  assert.deepEqual(commands, [['attach', 'pointer'], ['edge', 3, 1], ['edge', 3, 0], ['revoke', 'pointer']],
    'hiding the page retires the source even after its real release started recording');
});
