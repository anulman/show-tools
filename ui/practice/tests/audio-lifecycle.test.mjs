import { chartBarLabel, chartBarOrdinal } from '../../../lib/performance/chart-position.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceForVM } from '../../../scripts/source-for-vm.ts';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createVoiceEffectsEditor, initialVoiceEffects } from '../voice-effects.ts';
import { keyboardFocusBlocksShortcut } from '../keyboard-focus.ts';
import { audioMode, canChangeAudioMode, changeAudioMode } from '../audio-mode.ts';

function prepareUIContext(context) {
  for (const [key, value] of Object.entries({ chartBarLabel, chartBarOrdinal, URL, URLSearchParams, AbortController, preparationAbort: undefined, location: { href: 'https://example.test/', search: '' }, audioMode, canChangeAudioMode, changeAudioMode, crypto: webcrypto, createVoiceEffectsEditor, initialVoiceEffects, keyboardFocusBlocksShortcut, installVoiceCatalog: () => ({ savedConfigurations: () => initialVoiceEffects(), async saveDrafts() {}, update() {}, async load() {}, openProfile() {} }) })) if (!(key in context)) context[key] = value;
  vm.createContext(context);
}
import { loadSong } from '../../../songs/index.ts';
import { PracticeAudio } from '../audio.js';
import { NativePerformance } from '../../../lib/performance/wasm-performance.ts';
import { createPeripheralInput, peripheralCommandId } from '../peripheral-input.ts';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

for (const gate of ['resume']) for (const action of ['stop', 'panic']) {
  test(`${action} cancels a start waiting for ${gate}`, async () => {
    const waiting = deferred();
    const entered = deferred();
    const commands = [];
    const audio = Object.assign(Object.create(PracticeAudio.prototype), {
      latest: { phase: 'idle' }, chart: { bpm: 98 }, startGeneration: 0, runCounter: 0,
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
    else await audio.control({ id: 'mushroom' });
    waiting.resolve();
    await starting;
    assert.deepEqual(commands, [action === 'stop' ? 'practice.stop' : 'practice.control']);
  });
}

const uiSource = (await sourceForVM(new URL('../app.ts', import.meta.url)))
  .replace(/^import .*;\n/gm, '').replace(/import\(["']\.\/audio\.js["']\)/g, 'Promise.resolve({ PracticeAudio })').split('elements.start.addEventListener(')[0];

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
  const source = (await sourceForVM(new URL('../app.ts', import.meta.url))).replace(/^import .*;\n/gm, '').replace(/import\(["']\.\/audio\.js["']\)/g, 'Promise.resolve({ PracticeAudio })').split('elements.start.addEventListener(')[0];
  vm.runInContext(`${source}\nfunction render() {}\nchart = { bars: Array.from({ length: 218 }, (_, index) => ({ bar: index + 1 })) }; song = { chart, program: { lengthBeats: 4, events: [] } }; globalThis.recordDemo = toggleOutputRecording;`, context);
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
    subscribe() {}, onEvent() {}, outputStream: {},
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
    constructor(tag) { this.tag = tag; }
    append(...children) { this.children.push(...children); }
    get lastElementChild() { return this.children.at(-1); }
    get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    reportValidity() { return this.value !== ''; }
    querySelector() { return null; }
  }
  const roots = new Map(), applied = [];
  const editor = createVoiceEffectsEditor(profile => applied.push(profile));
  // Explicit non-default stacks exercise field validation for otherwise dry capture voices.
  for (const profile of [0, 1]) editor.setEffects(profile, [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
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
    descendants(roots.get(profile)).find(element => element.tag === 'button' && element.textContent === 'Apply settings').listeners.get('click')();
  } };
}

for (const [profile, label, stage, parameter] of [[0, 'Wet', 0, 'wet'], [0, 'Feedback', 0, 'feedback'], [5, 'Depth · ms', 1, 'depthMs']]) {
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
    startGeneration: 0, disposed: false,
    detachState() {}, detachTracker() {}, detachPeripheral() {},
    endpoint: { port: { removeEventListener() {} }, dispose() { released.push('endpoint'); }, request() { throw new Error('Must not wait for an acknowledgment'); } },
    recordDestination: { stream: { getTracks: () => [{ stop() { released.push('recording-track'); } }] }, disconnect() { released.push('recording-node'); } },
    tracker: { node: { disconnect(...targets) { assert.equal(targets.length, 0); released.push('all-output'); } }, async dispose() { released.push('microphone'); } },
    sampler: { async dispose() { released.push('sampler'); } },
    listeners: new Set(), eventListeners: new Set(), tunerListeners: new Set(),
  });
  await audio.dispose();
  assert(released.includes('all-output'));
  assert(released.includes('microphone'));
  assert.equal(audio.disposed, true);
});

test('Escape triggers Panic with an input focused while pad shortcuts still ignore editing', async () => {
  const source = await sourceForVM(new URL('../app.ts', import.meta.url));
  const keyboardSource = source.slice(source.indexOf('window.addEventListener("keydown"'), source.indexOf('window.addEventListener("keyup"'));
  let keydown;
  let panicCalls = 0;
  let padCalls = 0;
  class Element { closest() { return true; } }
  const context = { Element, Map, Set, heldKeys: new Set(), createPeripheralInput, peripheralCommandId, CONTROLS: [{ key: 'KeyQ', id: 'L1' }],
    document: { querySelector: () => null },
    window: { addEventListener(_type, listener) { keydown = listener; } },
    act: action => action(), flash() {}, panic: () => panicCalls++, triggerPad: () => padCalls++,
  };
  prepareUIContext(context);
  const adapterSource = source.slice(source.indexOf('let keyboardInput'), source.indexOf('const liveVoiceStates'));
  vm.runInContext(adapterSource + keyboardSource, context);
  const event = { target: new Element(), repeat: false, timeStamp: 0, preventDefault() {} };
  keydown({ ...event, code: 'KeyQ' });
  keydown({ ...event, code: 'Escape' });
  assert.equal(padCalls, 0);
  assert.equal(panicCalls, 1);
});

test('keyboard bridge accepts fresh DOM presses after focus loss and suppresses held/repeat events', async () => {
  const source = await sourceForVM(new URL('../app.ts', import.meta.url));
  const listeners = new Map();
  const commands = [];
  const releases = [];
  let panicCalls = 0;
  class Element {
    constructor(editing = false) { this.editing = editing; }
    closest() { return this.editing; }
  }
  const controls = [{ key: 'KeyQ', id: 'L1' }, { key: 'KeyW', id: 'R1' }, { key: 'KeyA', id: 'L2' }, { key: 'KeyS', id: 'R2' }];
  const context = { Element, Map, Set, heldKeys: new Set(), createPeripheralInput, peripheralCommandId, CONTROLS: controls,
    document: { querySelector: () => null, querySelectorAll: () => [] }, pads: new Map(), elements: { mushroom: { classList: { remove() {} } } },
    window: { addEventListener(type, listener) { listeners.set(type, listener); } },
    act: action => action(), flash() {}, panic: () => panicCalls++, triggerPad: (id, commandId) => commands.push({ id, commandId }), releasePad: (id, commandId) => releases.push({ id, commandId }),
  };
  prepareUIContext(context);
  const adapterSource = source.slice(source.indexOf('let keyboardInput'), source.indexOf('const liveVoiceStates'));
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
  assert.equal(new Set(commands.map(command => command.commandId)).size, 8);
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
  const source = await sourceForVM(new URL('../app.ts', import.meta.url));
  const keyboardSource = source.slice(source.indexOf('window.addEventListener("keydown"'), source.indexOf('window.addEventListener("keyup"'));
  const adapterSource = source.slice(source.indexOf('let keyboardInput'), source.indexOf('const liveVoiceStates'));
  let keydown;
  let starts = 0, panics = 0, pads = 0, prevented = 0;
  class Element {
    constructor(kind) { this.kind = kind; }
    closest(selector) { return selector.split(',').includes(this.kind) ? this : null; }
  }
  const context = { Element, Map, Set, heldKeys: new Set(), createPeripheralInput, peripheralCommandId, CONTROLS: [{ key: 'KeyQ', id: 'L1' }],
    document: { querySelector: () => null },
    window: { addEventListener(_type, callback) { keydown = callback; } },
    act: action => action(), flash() {}, isRunning: () => false, startPractice: () => starts++, stopPractice() {}, panic: () => panics++, triggerPad: () => pads++,
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

for (const id of ['i-can-change']) {
  test(`${id} starts with dry identity processing in every profile, including hidden live routes`, async () => {
    const song = await loadSong(id);
    assert.equal(song.compiled, undefined, 'this source has no compiled per-voice capture support');
    const h = startupHarness(undefined, { loadedSong: song, voiceConfigurations: initialVoiceEffects() });
    await h.controls.startPractice();
    assert.deepEqual(JSON.parse(JSON.stringify(h.audio.configuredEffects)), initialVoiceEffects('dry'));
    assert(h.audio.configuredEffects.every(configuration => configuration.effects.length === 0));
    assert.deepEqual(h.commands.slice(0, 2), ['effects', 'microphone']);
  });
}

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
  assert.equal(song.chart.bars[0].label, 'Pickup 0');
  assert.equal(song.chart.bars[9].label, '1');
  assert.equal(song.practice.endBar, 137);
});
