import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import type { TunerCommand, TunerState } from '../../../lib/tuner/model.js';

class Node {
  children: Node[] = [];
  parent: Node | null = null;
  style = { left: '' };
  classList = { add() {} };
  textContent = '';
  value = '';
  hidden = false;
  disabled = false;
  append(...nodes: Node[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: Node[]) { this.children = []; this.append(...nodes); }
  setAttribute() {}
  addEventListener() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
}

const source = await sourceForVM(new URL('../app.ts', import.meta.url));
const wrapper = source.slice(source.indexOf('function sharedTuner('), source.indexOf('requiredElement("#open-tuner"'));
const unavailableStart = source.indexOf('if (!connected || status.kind !== "ready")');
assert.ok(unavailableStart >= 0);
const unavailable = source.slice(unavailableStart, source.indexOf('let session;', unavailableStart));
const panelSource = (await sourceForVM(new URL('../../tuner/panel.ts', import.meta.url))).replace('export function mountTuner', 'function mountTuner');

for (const reason of ['off', 'fault', 'disconnected']) {
  for (const pendingClose of [false, true]) {
    test(`tuner detaches and closes when remote audio is ${reason}${pendingClose ? ' during close' : ''}`, async () => {
      const state: TunerState = { revision: 1, root: 48, scale: 'major', step: 0,
        targets: [{ midi: 48, letter: 'C', accidental: 0, octave: 3 }], complete: false,
        listening: true, preview: { kind: 'silent' }, pitch: { kind: 'warming' } };
      let subscriptions = 0;
      let closeCommands = 0;
      const session = { tuner: {
        snapshot: () => state,
        subscribe(listener: (value: TunerState) => void) { subscriptions++; listener(state); return () => { subscriptions--; }; },
        command(command: TunerCommand) {
          assert.equal(command.kind, 'close');
          closeCommands++;
          return new Promise<TunerState>(() => {});
        },
      } };
      const root = new Node();
      const context = vm.createContext({ root, audio: session, tunerSession: session, tunerPort: null, tunerPanel: null,
        document: { createElement: () => new Node() }, isRunning: () => false, starting: false, outputCapture: 'idle',
        connected: reason !== 'disconnected', status: { kind: reason === 'fault' ? 'fault' : 'off' },
        transportGeneration: 0, releasePresses() {}, chartFollower: null, renderHardwareUnavailable() {} });
      vm.runInContext(`${panelSource}\n${wrapper}\n
        tunerPort = sharedTuner(audio);
        tunerPanel = mountTuner(root, { connect: async () => tunerPort });
        tunerPanel.setSession(tunerPort);
        function disconnect() { ${unavailable} }
      `, context);
      const closing = pendingClose ? vm.runInContext('tunerPanel.close()', context) : null;
      if (pendingClose) await new Promise(resolve => setImmediate(resolve));
      vm.runInContext('disconnect()', context);
      const closed = closing ?? vm.runInContext('tunerPanel.close()', context);
      const result = await Promise.race([Promise.resolve(closed).then(() => 'closed'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 100))]);
      assert.equal(result, 'closed');
      assert.equal(context.audio, undefined);
      assert.equal(root.children.length, 0);
      assert.equal(subscriptions, 0);
      assert.equal(closeCommands, pendingClose ? 1 : 0, 'unavailable sessions receive no new close command');
    });
  }
}
