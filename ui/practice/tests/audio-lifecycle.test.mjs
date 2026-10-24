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

for (const gate of ['resume', 'tempo']) for (const action of ['stop', 'panic']) {
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
        this.value = ({ '#bpm': '98', '#start-section': '1', '#end-bar': '76', '#count-in': '1' })[selector] || '';
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

function startupHarness(microphone = async () => {}) {
  const commands = [];
  class Element {
    constructor(selector) {
      this.value = ({ '#bpm': '98', '#start-section': '1', '#end-bar': '76', '#count-in': '1' })[selector] || '';
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
    async enableMicrophone() { commands.push('microphone'); await microphone(); },
    async disableMicrophone() { commands.push('microphone-off'); },
    async setClick(enabled) { commands.push(`click:${enabled}`); },
    async start() { commands.push('start'); },
    async stop() { commands.push('stop'); },
    async control() { commands.push('panic'); },
  };
  const context = {
    Map, Set, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    window: { isSecureContext: true, MediaRecorder: Recorder }, MediaRecorder: Recorder, CONTROLS: [],
    HTMLElement: Element, HTMLSpanElement: Element, HTMLHeadingElement: Element, HTMLAnchorElement: Element,
    HTMLDivElement: Element, HTMLButtonElement: Element, HTMLParagraphElement: Element, HTMLInputElement: Element,
    HTMLSelectElement: Element, HTMLOutputElement: Element, HTMLDetailsElement: Element,
    document: { querySelector: selector => new Element(selector), querySelectorAll: () => [] },
    playableBars: () => 76, PracticeAudio: { create: async () => audio },
  };
  vm.createContext(context);
  vm.runInContext(`${uiSource}\nfunction render() {}\nchart = { bars: Array(76) }; song = { chart, program: {} }; globalThis.controls = { startPractice, stopPractice, panic, toggleOutputRecording };`, context);
  return { commands, controls: context.controls };
}

test('Start opens the microphone and records by default on every run, with song click off', async () => {
  const { commands, controls } = startupHarness();
  await controls.startPractice();
  assert.deepEqual(commands, ['microphone', 'record-start', 'click:false', 'start']);
  await controls.stopPractice();
  assert.deepEqual(commands.slice(-3), ['stop', 'record-stop', 'microphone-off']);
  await controls.startPractice();
  assert.deepEqual(commands.slice(-4), ['microphone', 'record-start', 'click:false', 'start']);
  await controls.panic();
  assert.deepEqual(commands.slice(-3), ['panic', 'record-stop', 'microphone-off']);
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
