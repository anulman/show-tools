import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceForVM } from '../../../scripts/source-for-vm.ts';
import vm from 'node:vm';
import { PracticeAudio } from '../audio.js';

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
  .replace(/^import .*;\n/gm, '').split('elements.start.addEventListener(')[0];

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
      HTMLOutputElement: FakeElement, HTMLDetailsElement: FakeElement,
      document: { querySelector, querySelectorAll: () => [] },
      playableBars: chart => chart.bars.length - 1,
      PracticeAudio: { create: () => preparing.promise },
    };
    vm.createContext(context);
    vm.runInContext(`${uiSource}\nfunction render() {}\nchart = { bars: Array(218) }; song = { chart, program: { lengthBeats: 4, events: [] } };\nglobalThis.ui = { startPractice, stopPractice, panic };`, context);
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
    HTMLSelectElement: Element, HTMLOutputElement: Element, HTMLDetailsElement: Element,
    document: { querySelector: () => new Element(), querySelectorAll: () => [] },
    PracticeAudio: { create: () => preparing.promise },
  };
  vm.createContext(context);
  const source = (await sourceForVM(new URL('../app.ts', import.meta.url))).replace(/^import .*;\n/gm, '').split('elements.start.addEventListener(')[0];
  vm.runInContext(`${source}\nfunction render() {}\nchart = { bars: Array(218) }; song = { chart, program: { lengthBeats: 4, events: [] } }; globalThis.recordDemo = toggleOutputRecording;`, context);
  const first = context.recordDemo();
  const second = context.recordDemo();
  preparing.resolve({ subscribe() {}, onEvent() {}, outputStream: {} });
  await Promise.all([first, second]);
  assert.equal(recorders, 1);
});

function startupHarness(microphone = async () => {}, { autoPlay = true, convert = async () => new Blob(['mp3'], { type: 'audio/mpeg' }) } = {}) {
  const commands = [];
  class Element {
    constructor(selector) {
      this.value = ({ '#bpm': '98', '#start-section': '1', '#end-bar': '76', '#count-in': '1', '#effects-delay': '100', '#effects-feedback': '0', '#effects-wet': '0.25' })[selector] || '';
      this.checked = selector !== '#click';
      this.textContent = '';
    }
    setAttribute() {}
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
    async configureLiveEffects(effects) { commands.push('effects'); this.configuredEffects = effects; },
    async enableMicrophone() { commands.push('microphone'); await microphone(); },
    async disableMicrophone() { commands.push('microphone-off'); },
    async setClick(enabled) { commands.push(`click:${enabled}`); },
    async start() { commands.push('start'); context.controls.phase(autoPlay ? 'playing' : 'count-in'); },
    async stop() { commands.push('stop'); context.controls.phase('idle'); },
    async control() { commands.push('panic'); context.controls.phase('idle'); },
    async dispose() { this.disposed = true; commands.push('dispose'); },
  };
  let creations = 0;
  const elements = new Map();
  const revoked = [];
  const context = {
    Map, Set, Blob, URL: { createObjectURL(blob) { assert.equal(blob.type, 'audio/mpeg'); return 'blob:test'; }, revokeObjectURL(url) { revoked.push(url); } },
    recordingToMp3: convert,
    window: { isSecureContext: true, MediaRecorder: Recorder }, MediaRecorder: Recorder, CONTROLS: [],
    HTMLElement: Element, HTMLSpanElement: Element, HTMLHeadingElement: Element, HTMLAnchorElement: Element,
    HTMLDivElement: Element, HTMLButtonElement: Element, HTMLParagraphElement: Element, HTMLInputElement: Element,
    HTMLSelectElement: Element, HTMLOutputElement: Element, HTMLDetailsElement: Element,
    document: { querySelector: selector => { const element = new Element(selector); elements.set(selector, element); return element; }, querySelectorAll: () => [] },
    playableBars: () => 76, PracticeAudio: { create: async () => { creations++; return audio; } },
  };
  vm.createContext(context);
  vm.runInContext(`${uiSource}\nfunction render(next) { state = { ...state, ...next }; beginOutputRecording(state.phase); }\nchart = { bars: Array(76) }; song = { chart, program: {} }; globalThis.controls = { startPractice, stopPractice, panic, toggleOutputRecording, phase: phase => render({ phase }) };`, context);
  return { commands, controls: context.controls, audio, elements, revoked, get creations() { return creations; } };
}

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
    detachState() {}, detachTracker() {},
    endpoint: { port: { removeEventListener() {} }, dispose() { released.push('endpoint'); }, request() { throw new Error('Must not wait for an acknowledgment'); } },
    recordDestination: { stream: { getTracks: () => [{ stop() { released.push('recording-track'); } }] }, disconnect() { released.push('recording-node'); } },
    tracker: { node: { disconnect(...targets) { assert.equal(targets.length, 0); released.push('all-output'); } }, async dispose() { released.push('microphone'); } },
    sampler: { async dispose() { released.push('sampler'); } },
    listeners: new Set(), eventListeners: new Set(),
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
  const context = { Element, heldKeys: new Set(), CONTROLS: [{ key: 'KeyQ', id: 'L1' }],
    window: { addEventListener(_type, listener) { keydown = listener; } },
    act: action => action(), flash() {}, panic: () => panicCalls++, triggerPad: () => padCalls++,
  };
  vm.createContext(context);
  vm.runInContext(keyboardSource, context);
  const event = { target: new Element(), repeat: false, preventDefault() {} };
  keydown({ ...event, code: 'KeyQ' });
  keydown({ ...event, code: 'Escape' });
  assert.equal(padCalls, 0);
  assert.equal(panicCalls, 1);
});

for (const bypass of [false, true]) {
  test(`web effect configuration applies before microphone setup, bypass=${bypass}`, async () => {
    const h = startupHarness();
    h.elements.get('#effects-enabled').checked = !bypass;
    h.elements.get('#effects-delay').value = '125';
    h.elements.get('#effects-feedback').value = '0.3';
    h.elements.get('#effects-wet').value = '0.4';
    await h.controls.startPractice();
    assert.deepEqual(JSON.parse(JSON.stringify(h.audio.configuredEffects)), bypass ? [] : [{ kind: 'slapback', delayMs: 125, feedback: 0.3, wet: 0.4 }]);
    assert.deepEqual(h.commands.slice(0, 2), ['effects', 'microphone']);
  });
}

test('Stop cancels a start waiting for effects preparation', async () => {
  const h = startupHarness();
  const waiting = deferred();
  h.audio.configureLiveEffects = () => waiting.promise;
  const starting = h.controls.startPractice();
  await h.controls.stopPractice();
  waiting.resolve();
  await starting;
  assert(!h.commands.includes('microphone'));
  assert(!h.commands.includes('start'));
});
