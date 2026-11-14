import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import { NativePerformance } from '../../../lib/performance/wasm-performance.js';
import { PF } from '../../../lib/performance/wasm-abi.js';
import type { TunerPort, TunerState, TuningBankOptions } from '../../../lib/tuner/model.js';
import type { TunerCaptureBank } from '../panel.js';

const source = (await sourceForVM(new URL('../panel.ts', import.meta.url)))
  .replace(/^import .*;\n/gm, '').replace('export function mountTuner', 'function mountTuner');
class Node {
  className = ''; textContent = ''; value = ''; type = ''; hidden = false; disabled = false;
  dataset: Record<string, string> = {};
  children: Node[] = [];
  classList = { add() {} };
  listeners = new Map<string, () => void>();
  append(...nodes: Node[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Node[]) { this.children = nodes; }
  setAttribute() {}
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  remove() {}
  click() { if (!this.disabled && !this.hidden) this.listeners.get('click')?.(); }
}
function fixture(banks: readonly TunerCaptureBank[], port: TunerPort) {
  const root = new Node();
  const context = vm.createContext({ document: { createElement: () => new Node() },
    createTunerDial: () => ({ element: new Node(), update() {}, dispose() {} }) });
  const mount: unknown = vm.runInContext(`${source}\nmountTuner`, context);
  assert.equal(typeof mount, 'function');
  if (typeof mount !== 'function') throw new Error('Missing panel factory');
  const panel: unknown = mount(root, { banks, connect: async () => port });
  assert(panel && typeof panel === 'object' && 'setSession' in panel && typeof panel.setSession === 'function'
    && 'dispose' in panel && typeof panel.dispose === 'function');
  panel.setSession(port);
  const dispose = panel.dispose;
  const all = (node: Node): Node[] => [node, ...node.children.flatMap(all)];
  const byText = (text: string) => {
    const node = all(root).find(candidate => candidate.textContent === text);
    assert(node, `Missing ${text}`); return node;
  };
  return { root, byText, all: () => all(root), dispose: () => dispose() };
}
const slots = [0, 1, 2, 3, 4, 5, 6, 7];
const bank: TunerCaptureBank = { id: 'fixture-pad', label: 'Fixture Pad', capture: { profile: 0, slots } };
const state: TunerState = { revision: 0, root: 48, scale: 'major', step: 0, complete: false, listening: false,
  preview: { kind: 'silent' }, pitch: { kind: 'off' }, targets: slots.map((_, index) => ({ midi: 48 + index, letter: 'C', accidental: 0, octave: 3 })) };
const tick = () => new Promise(resolve => setImmediate(resolve));
function portFixture(prepare = true) {
  let current = state;
  const calls: string[] = [];
  const listeners = new Set<(state: TunerState) => void>();
  const port: TunerPort = { snapshot: () => current, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    async command(command) {
      calls.push(command.kind);
      current = { ...current, revision: current.revision + 1,
        ...(command.kind === 'listen' ? { listening: command.enabled } : {}), ...(command.kind === 'confirm' ? { step: current.step + 1 } : {}) };
      for (const listener of listeners) listener(current);
      return current;
    }, ...(prepare ? { async prepareBank(options: TuningBankOptions) { calls.push(`prepare:${options.slots.join(',')}`); return { count: slots.length, step: 0, clipFrames: 2000, filledFrames: 0, stableFrames: 0, ready: false, capturedFrames: [], midi: [] }; } } : {}) };
  return { port, calls };
}

test('recording a declared source order uses setup then Listen, and Confirm retains its existing command', async () => {
  const input = portFixture(); const panel = fixture([bank], input.port);
  try {
    panel.byText('Record selected scale').click(); await tick();
    assert.deepEqual(input.calls, ['configure', 'prepare:0,1,2,3,4,5,6,7', 'listen']);
    panel.byText('Confirm').click(); await tick();
    assert.equal(input.calls.at(-1), 'confirm');
  } finally { panel.dispose(); }
});

test('missing source order, unsupported host, and unmatched scale cannot start bank capture', () => {
  const input = portFixture(); const noOrder = fixture([], input.port);
  assert.equal(noOrder.byText('Record selected scale').hidden, true);
  assert(noOrder.byText('This song has no source-note capture order.')); noOrder.dispose();
  const unsupported = fixture([bank], portFixture(false).port);
  assert.equal(unsupported.byText('Record selected scale').disabled, true);
  assert(unsupported.byText('Note-bank capture is unavailable in this audio session.')); unsupported.dispose();
  const mismatch = fixture([{ ...bank, capture: { ...bank.capture, slots: [0] } }], input.port);
  assert.equal(mismatch.byText('Record selected scale').disabled, true); mismatch.dispose();
  assert.deepEqual(input.calls, []);
});

test('late bank preparation cannot enable listening on a replacement session', async () => {
  let finish: () => void = () => {};
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const input = portFixture();
  const port = { ...input.port, async prepareBank() { await waiting; return { count: 8, step: 0, clipFrames: 2000, filledFrames: 0, stableFrames: 0, ready: false, capturedFrames: [], midi: [] }; } };
  const panel = fixture([bank], port);
  panel.byText('Record selected scale').click(); await tick(); panel.dispose(); finish(); await tick();
  assert.deepEqual(input.calls, ['configure']);
});

test('real panel Record and Confirm prepare and lock a sung source in the shared native engine', async () => {
  const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
  const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write: () => 0, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(String(code)); } } });
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  const native = new NativePerformance({ api: instance.exports, sampleRate: 8000, mode: PF.PRACTICE, clickGain: 0,
    compiledProgram: [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 2, 120, 2, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3] });
  native.prepareLiveEffects([]); native.setMicrophone(true);
  const port: TunerPort = { snapshot: () => native.tunerState(), subscribe: () => () => {},
    prepareBank: async options => native.prepareTuningBank(options), command: async command => native.tunerCommand(command) };
  const panel = fixture([bank], port);
  try {
    panel.byText('Record selected scale').click(); await tick();
    assert.equal(native.tunerState().listening, true);
    for (let frame = 0; frame < 10000; frame += 250) {
      const input = Float32Array.from({ length: 250 }, (_, index) => .2 * Math.sin(2 * Math.PI * 130.81278265 * (frame + index) / 8000));
      native.process(input, [new Float32Array(250), new Float32Array(250)], 250);
    }
    assert.equal(native.tuningBankState().ready, true);
    panel.byText('Confirm').click(); await tick();
    assert.equal(native.tunerState().step, 1); assert.equal(native.tuningBankState().capturedFrames[0], 2000);
  } finally { panel.dispose(); native.dispose(); }
});
