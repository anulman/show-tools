import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sourceForVM } from '../../../scripts/source-for-vm.js';

async function fixture() {
  const source = await sourceForVM(new URL('../app.ts', import.meta.url));
  const commands: { value: number; commandId: string }[] = [];
  let wheel: ((event: object) => void) | undefined;
  class Element { constructor(readonly editing = false) {} closest() { return this.editing; } }
  const context = vm.createContext({ Element, Number, rotationSession: 'wheel-test', rotationSequence: 0,
    running: true, modalOpen: false, song: { compiled: { rotation: {} } },
    document: { activeElement: null, querySelector(selector: string) {
      assert.equal(selector, 'dialog[open]'); return context.modalOpen ? {} : null;
    } },
    audio: { control(control: { id: string; value: number }, options: { commandId: string }) {
      assert.equal(control.id, 'knob'); commands.push({ value: control.value, commandId: options.commandId });
    } },
    isRunning: () => context.running,
    act: (action: () => unknown) => action(),
    window: { addEventListener(type: string, handler: (event: object) => void, options: { passive: boolean }) {
      assert.equal(type, 'wheel'); assert.equal(options.passive, false); wheel = handler;
    } },
  });
  const rotate = source.slice(source.indexOf('async function rotate('), source.indexOf('function monitoringRelationship('));
  const start = source.indexOf('window.addEventListener("wheel"');
  assert(start >= 0, 'the desk installs a wheel proxy beyond the small rotation buttons');
  const handler = source.slice(start, source.indexOf('window.addEventListener("keydown"', start));
  vm.runInContext(rotate + handler, context);
  assert(wheel);
  return { context, commands, Element, wheel };
}

test('vertical scrolling forwards signed knob movement without choosing a musical deadline', async () => {
  const { wheel, commands, Element } = await fixture();
  let prevented = 0;
  const event = { deltaY: 12, deltaX: 0, deltaMode: 0, target: new Element(), preventDefault() { prevented++; } };
  wheel(event); wheel({ ...event, deltaY: -3 });
  wheel({ ...event, deltaMode: 1, deltaY: 2 }); wheel({ ...event, deltaMode: 2, deltaY: -1 });
  assert.deepEqual(commands.map(command => command.value), [12, -3, 2, -1]);
  assert.equal(new Set(commands.map(command => command.commandId)).size, 4);
  assert.equal(prevented, 4);
});

test('wheel proxy preserves editing, zoom gestures, horizontal scroll and stopped-page scrolling', async () => {
  const { wheel, commands, Element, context } = await fixture();
  const event = { deltaY: 12, deltaX: 0, target: new Element(), preventDefault() { assert.fail('native scrolling must remain available'); } };
  for (const patch of [{ deltaY: 0, deltaX: 20 }, { deltaY: NaN }, { deltaY: Infinity },
    { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { target: new Element(true) }]) {
    wheel({ ...event, ...patch });
  }
  context.document.activeElement = new Element(true); wheel(event);
  context.document.activeElement = null;
  context.running = false; wheel(event);
  context.running = true; context.song = undefined; wheel(event);
  assert.deepEqual(commands, []);
});


test('an open voice dialog keeps vertical scrolling native and never manipulates the knob', async () => {
  const { wheel, commands, Element, context } = await fixture();
  let prevented = 0;
  const event = { deltaY: 24, target: new Element(), preventDefault() { prevented++; } };
  context.modalOpen = true;
  wheel(event); wheel({ ...event, deltaY: -24 });
  assert.equal(commands.length, 0, 'scrolling the modal or its background cannot reach audio controls');
  assert.equal(prevented, 0, 'the modal retains native scroll behavior');
  context.modalOpen = false;
  wheel(event);
  assert.equal(commands.length, 1, 'the knob proxy resumes after closing the dialog');
  assert.equal(commands[0].value, 24);
  assert.equal(prevented, 1);
});
