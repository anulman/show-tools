import test from 'node:test';
import assert from 'node:assert/strict';
import { bindKeyboard } from '../index.js';

class Target extends EventTarget {
  send(type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
    this.dispatchEvent(event);
    return event;
  }
}

test('keyboard filters repeats, chords, editable paths, and held duplicates, then releases on keyup and blur', () => {
  const target = new Target();
  const triggered = [];
  const sequence = {
    snapshot: () => ({ state: 'running', buttons: [{ id: 'hit', key: 'KeyA', action: 'blue' },
      { id: 'off', key: 'KeyS', action: null }] }),
    trigger: id => triggered.push(id),
  };
  const detach = bindKeyboard(sequence, target);
  for (const properties of [
    { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    { composedPath: () => [{ tagName: 'INPUT' }] },
    { composedPath: () => [{ tagName: 'TEXTAREA' }] },
    { composedPath: () => [{ tagName: 'SELECT' }] },
    { composedPath: () => [{ tagName: 'SPAN' }, { isContentEditable: true }] },
  ]) target.send('keydown', { code: 'KeyA', ...properties });
  target.send('keydown', { code: 'KeyS' });
  target.send('keydown', { code: 'KeyQ' });
  assert.deepEqual(triggered, []);
  assert.equal(target.send('keydown', { code: 'KeyA' }).defaultPrevented, true);
  target.send('keydown', { code: 'KeyA' });
  assert.deepEqual(triggered, ['hit']);
  target.send('keyup', { code: 'KeyA' });
  target.send('keydown', { code: 'KeyA' });
  target.send('blur');
  target.send('keydown', { code: 'KeyA' });
  assert.deepEqual(triggered, ['hit', 'hit', 'hit']);
  detach();
  target.send('keyup', { code: 'KeyA' });
  target.send('keydown', { code: 'KeyA' });
  assert.equal(triggered.length, 3);
});

test('a document event target releases key latches when its window blurs', () => {
  const target = new Target();
  target.defaultView = new Target();
  let hits = 0;
  const detach = bindKeyboard({
    snapshot: () => ({ state: 'idle', buttons: [{ id: 'hit', key: 'KeyA', action: 'blue' }] }),
    trigger: () => hits++,
  }, target);
  target.send('keydown', { code: 'KeyA' });
  target.defaultView.send('blur');
  target.send('keydown', { code: 'KeyA' });
  assert.equal(hits, 2);
  detach();
});
