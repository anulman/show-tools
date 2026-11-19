import test from 'node:test';
import assert from 'node:assert/strict';
import { enablePhoneMotion, browserMotionSurface, gyroscopeDetector, shakeDetector, type MotionReading, type MotionSurface } from '../phone-motion.js';
function fixture(permission?: MotionSurface['permission']) {
  let receive: ((reading: MotionReading) => void) | undefined, hide: (() => void) | undefined;
  let removed = 0;
  const surface: MotionSurface = { secure: true, available: true, permission,
    listen(listener) { receive = listener; return () => { removed++; receive = undefined; }; }, hide(listener) { hide = listener; return () => { removed++; hide = undefined; }; } };
  return { surface, read(x: number, time: number) { receive?.({ x, y: 0, z: 0, time, gravity: false }); }, hide() { hide?.(); }, removed: () => removed };
}
test('motion permission gates listeners, delivers manual hits and cleans up on hide or song replacement', async () => {
  const env = fixture(async () => 'granted'), abort = new AbortController(); let hits = 0, current = true;
  const connection = await enablePhoneMotion({ surface: env.surface, signal: abort.signal, current: () => current, hit: () => hits++ });
  env.read(12, 100); env.read(15, 200); assert.equal(hits, 1, 'one excursion is one manual hit');
  env.read(0, 250); env.read(12, 350); assert.equal(hits, 2);
  current = false; env.read(0, 500); env.read(12, 650); assert.equal(hits, 2); assert.equal(env.removed(), 2);
  connection.stop(); assert.equal(env.removed(), 2);
  const second = fixture(); await enablePhoneMotion({ surface: second.surface, signal: new AbortController().signal, current: () => true, hit: () => hits++ });
  second.hide(); second.read(12, 800); assert.equal(hits, 2); assert.equal(second.removed(), 2);
});
test('denial, missing sensors and stale permission never attach input or acquire audio', async () => {
  let resolve: (value: unknown) => void = () => {};
  const waiting = new Promise<unknown>(done => { resolve = done; }), env = fixture(() => waiting), abort = new AbortController();
  const pending = enablePhoneMotion({ surface: env.surface, signal: abort.signal, current: () => true, hit: () => assert.fail('No stale input') });
  abort.abort(); resolve('granted'); await assert.rejects(pending); assert.equal(env.removed(), 1);
  await assert.rejects(enablePhoneMotion({ surface: { ...env.surface, permission: async () => 'denied' }, signal: new AbortController().signal, current: () => true, hit() {} }), /permission/);
  await assert.rejects(enablePhoneMotion({ surface: { ...env.surface, available: false }, signal: new AbortController().signal, current: () => true, hit() {} }), /motion input/);
});
test('detector handles gravity-only devices, silence and invalid samples without scheduling hits', () => {
  const detect = shakeDetector();
  assert.equal(detect({ x: 0, y: 0, z: 9.8, time: 0, gravity: true }), false);
  assert.equal(detect({ x: 0, y: 0, z: 9.8, time: 100, gravity: true }), false);
  assert.equal(detect({ x: 12, y: 0, z: 9.8, time: 200, gravity: true }), true);
  assert.equal(detect({ x: null, y: 0, z: 0, time: 300, gravity: true }), false);
  assert.equal(detect({ x: NaN, y: 0, z: 0, time: 400, gravity: true }), false);
});


test('browser ingress uses finite gravity data when linear acceleration axes are null', async () => {
  const saved = ['window', 'document', 'DeviceMotionEvent'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] satisfies [string, PropertyDescriptor | undefined]);
  const window = Object.assign(new EventTarget(), { isSecureContext: true }), document = Object.assign(new EventTarget(), { hidden: false });
  class Motion extends Event {
    acceleration = { x: null, y: null, z: null };
    accelerationIncludingGravity: { x: number; y: number; z: number };
    constructor(x: number) { super('devicemotion'); this.accelerationIncludingGravity = { x, y: 0, z: 9.8 }; }
  }
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  Object.defineProperty(globalThis, 'DeviceMotionEvent', { value: Motion, configurable: true });
  try {
    let hits = 0;
    const connection = await enablePhoneMotion({ surface: browserMotionSurface(), signal: new AbortController().signal,
      current: () => true, hit: () => hits++, settings: { minimumIntervalMs: 0 } });
    window.dispatchEvent(new Motion(0)); window.dispatchEvent(new Motion(12)); assert.equal(hits, 1);
    connection.stop();
  } finally { for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } }
});


test('gyro threshold, release, cooldown and MIDI velocity follow angular speed', () => {
  const detect = gyroscopeDetector();
  const read = (x: number | null, time: number, gravity = false) => detect({ x, y: 0, z: 0, time, gravity });
  assert.equal(read(149, 0), 0);
  assert.equal(read(150, 20), 28);
  assert.equal(read(500, 140), 0, 'a sustained excursion cannot double-trigger');
  assert.equal(read(60, 150), 0, 'returning to the release threshold re-arms');
  assert.equal(read(-350, 170), 78);
  assert.equal(read(0, 190), 0);
  assert.equal(read(550, 200), 0, 'accepted hits stay at least 100 ms apart');
  assert.equal(read(null, 290), 0);
  assert.equal(read(1000, 290, true), 0);
  assert.equal(read(-1000, 290), 127);
  assert.equal(read(0, 280), 0, 'out-of-order readings cannot re-arm');
  assert.equal(read(200, 500), 0);
});

test('hide while permission is pending prevents late motion attachment', async () => {
  let resolve: (value: unknown) => void = () => {};
  const env = fixture(() => new Promise(done => { resolve = done; }));
  const pending = enablePhoneMotion({ surface: env.surface, signal: new AbortController().signal, current: () => true, hit: () => assert.fail('No stale input') });
  env.hide();
  resolve('granted');
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(env.removed(), 1);
});
