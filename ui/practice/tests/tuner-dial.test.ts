import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import type { TunerState } from '../../../lib/tuner/model.js';
import { tunerFixture } from '../../../lib/remote-performance/tests/tuner-fixture.js';

const source = (await sourceForVM(new URL('../../tuner/dial.ts', import.meta.url)))
  .replace(/^import .*;\n/gm, '').replace('export function createTunerDial', 'function createTunerDial');

class Node {
  className = '';
  hidden = false;
  clientWidth = 672;
  dataset: Record<string, string> = {};
  style = { width: '', height: '' };
  children: Node[] = [];
  textContent = '';
  removed = false;
  append(...nodes: Node[]) { this.children.push(...nodes); }
  setAttribute() {}
  getContext() { return {}; }
  remove() { this.removed = true; }
}

function fixture() {
  let load: () => void = () => {};
  let fail: (cause: Error) => void = () => {};
  const decoded = new Promise<void>((resolve, reject) => { load = resolve; fail = reject; });
  const frames = new Map<number, (time: number) => void>();
  let sequence = 0;
  const paints: { state: TunerState | null; aspect: string; timeSeconds: number }[] = [];
  let resize: () => void = () => {};
  let disconnected = false;
  let imageSource = '';
  const context = vm.createContext({
    ballManifest: { file: 'disco-ball.png', width: 70, height: 70, scale: 1 },
    document: { createElement: () => new Node(), baseURI: 'http://fixture.test/releases/build/ui/practice/' }, URL,
    Image: class {
      naturalWidth = 70;
      naturalHeight = 70;
      set src(value: string) { imageSource = value; }
      decode() { return decoded; }
      removeAttribute() { imageSource = ''; }
    },
    ResizeObserver: class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    requestAnimationFrame(callback: (time: number) => void) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
    paintTunerScene(input: { state: TunerState | null; aspect: string; timeSeconds: number }) {
      paints.push(input);
      return { hitIndex: null, notches: [] };
    },
  });
  const dial: unknown = vm.runInContext(`${source}\ncreateTunerDial()`, context);
  assert(dial && typeof dial === 'object' && 'element' in dial && 'update' in dial && 'dispose' in dial);
  assert(dial.element instanceof Node && typeof dial.update === 'function' && typeof dial.dispose === 'function');
  const element = dial.element;
  const update = dial.update;
  const dispose = dial.dispose;
  return { element, frames, paints, load, fail,
    update: (state: TunerState | null) => update(state), dispose: () => dispose(),
    resize(width: number) { element.clientWidth = width; resize(); },
    flush(time = 2000) { for (const [id, callback] of [...frames]) { frames.delete(id); callback(time); } },
    get disconnected() { return disconnected; }, get imageSource() { return imageSource; },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('dial waits for the image and paints at integer sizes in both aspects', async () => {
  const dial = fixture();
  assert.equal(dial.frames.size, 0);
  assert.equal(dial.imageSource, 'http://fixture.test/releases/build/ui/practice/assets/tuner/disco-ball.png');
  dial.load(); await tick(); dial.flush();
  assert.equal(dial.paints.length, 1);
  assert.equal(dial.paints[0]?.aspect, '16:9');
  assert.equal(dial.paints[0]?.timeSeconds, 2);
  assert.equal(dial.element.children[0]?.style.width, '640px');
  assert.equal(dial.element.children[0]?.style.height, '360px');
  dial.resize(500); dial.flush();
  assert.equal(dial.paints.at(-1)?.aspect, '4:3');
  assert.equal(dial.element.children[0]?.style.width, '480px');
  assert.equal(dial.frames.size, 0, 'idle scenes have no perpetual animation loop');
  dial.dispose();
});

test('telemetry updates coalesce into one frame and a lost session clears the state', async () => {
  const dial = fixture();
  dial.load(); await tick();
  const initial = tunerFixture();
  const latest = { ...initial, revision: 1 };
  dial.update(initial); dial.update(latest);
  assert.equal(dial.frames.size, 1);
  dial.flush();
  assert.equal(dial.paints.length, 1);
  assert.equal(dial.paints[0]?.state, latest);
  dial.update(null); dial.flush();
  assert.equal(dial.paints.at(-1)?.state, null);
  dial.dispose();
});

test('disposing cancels the pending frame, resize observation and image ownership', async () => {
  const dial = fixture();
  dial.load(); await tick();
  assert.equal(dial.frames.size, 1);
  dial.dispose(); dial.dispose();
  assert.equal(dial.frames.size, 0);
  assert.equal(dial.disconnected, true);
  assert.equal(dial.imageSource, '');
  assert.equal(dial.element.removed, true);
  dial.resize(500); dial.update(null); dial.flush();
  assert.equal(dial.paints.length, 0);
});

test('late image completion cannot revive a disposed dial', async () => {
  const dial = fixture();
  dial.dispose(); dial.load(); await tick();
  assert.equal(dial.frames.size, 0);
  assert.equal(dial.paints.length, 0);
});

test('an image failure is visible and schedules no invented scene', async () => {
  const dial = fixture();
  dial.fail(new Error('Fixture load failure')); await tick();
  assert.equal(dial.element.dataset.ready, 'false');
  assert.equal(dial.element.children[0]?.hidden, true);
  assert.equal(dial.element.children[1]?.hidden, false);
  assert.equal(dial.element.children[1]?.textContent, 'Scale dial unavailable.');
  assert.equal(dial.frames.size, 0);
  dial.dispose();
});
