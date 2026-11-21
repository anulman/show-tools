import test from 'node:test';
import assert from 'node:assert/strict';
import { TAMBOURINE_DEFAULTS, enablePhoneMotion, browserMotionSurface, gyroscopeDetector, shakeDetector, tambourineDetector, type MotionReading, type MotionSurface } from '../phone-motion.js';
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


test('browser shake ingress accepts a wrist flick without acceleration and gives one hit per gesture', async () => {
  const saved = ['window', 'document', 'DeviceMotionEvent'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] satisfies [string, PropertyDescriptor | undefined]);
  const window = Object.assign(new EventTarget(), { isSecureContext: true }), document = Object.assign(new EventTarget(), { hidden: false });
  class Motion extends Event {
    readonly rotationRate;
    readonly acceleration;
    constructor(angularSpeed: number, acceleration: number | null) {
      super('devicemotion');
      this.rotationRate = { alpha: angularSpeed, beta: 0, gamma: 0 };
      this.acceleration = { x: acceleration, y: 0, z: 0 };
    }
  }
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  Object.defineProperty(globalThis, 'DeviceMotionEvent', { value: Motion, configurable: true });
  try {
    let hits = 0;
    const connection = await enablePhoneMotion({ surface: browserMotionSurface(), signal: new AbortController().signal,
      current: () => true, hit: () => hits++, settings: { minimumIntervalMs: 0 } });
    window.dispatchEvent(new Motion(10, null));
    assert.equal(hits, 0);
    window.dispatchEvent(new Motion(400, null));
    assert.equal(hits, 1);
    window.dispatchEvent(new Motion(400, 14));
    window.dispatchEvent(new Motion(0, 14));
    assert.equal(hits, 1, 'sensors report the same excursion');
    window.dispatchEvent(new Motion(0, 0));
    window.dispatchEvent(new Motion(0, 14));
    assert.equal(hits, 2, 'a separate linear shake still works');
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

test('tambourine picks shake variants by acceleration and hit layers by speed before braking', () => {
  const detect = tambourineDetector();
  const read = (time: number, x: number | null, rotation?: number) => detect({
    x, y: 0, z: 0, time, gravity: false,
    ...(rotation === undefined ? {} : { rotation: { x: rotation, y: 0, z: 0 } }),
  });
  assert.equal(read(0, 0), undefined);
  assert.equal(read(20, 8), undefined);
  assert.equal(read(40, 0), 2, 'soft shake RR1');
  assert.equal(read(150, 8), undefined);
  assert.equal(read(170, 16), 3, 'a single hard shake RR2 can ramp through the soft layer');
  assert.equal(read(190, 16), undefined, 'one stroke cannot retrigger a sustained excursion');
  assert.equal(read(300, 0, 220), undefined, 'rotation alone is not a shake or hit');
  assert.equal(read(320, 8, 70), 0, 'a soft brake wins when the same frame also looks like a shake');
  assert.equal(read(340, 16, 50), undefined, 'brake does not also fire a second shake');
  assert.equal(read(460, null, 480), undefined);
  assert.equal(read(480, null, 100), 1, 'fast pre-brake speed chooses the hard hit');
  assert.equal(read(650, null, 500), undefined);
  assert.equal(read(850, null, 10), undefined, 'a stale rotation reading does not create a hit');
  assert.equal(read(890, NaN, NaN), undefined);
  assert.equal(read(880, 16, 500), undefined, 'out-of-order readings cannot trigger');
});

test('tambourine recognizes linear braking and ignores gravity-only tilt', () => {
  const detect = tambourineDetector();
  const read = (time: number, x: number, z: number, gravity: boolean) => detect({ x, y: 0, z, time, gravity });
  assert.equal(read(0, 0, 9.81, true), undefined);
  assert.equal(read(20, 9.81, 0, true), undefined);
  assert.equal(read(50, 0, 0, false), undefined);
  assert.equal(read(70, 12, 0, false), undefined);
  assert.equal(read(90, -12, 0, false), 0, 'linear reversal brakes movement accumulated in the previous frame');
  assert.equal(read(220, 0, 0, false), undefined);
  assert.equal(read(260, 16, 0, false), 3);
  assert.equal(read(300, -16, 0, false), 1, 'a faster linear stroke selects the hard hit');
});

test('the motion listener sends a tambourine hit even when the selected slot is zero', async () => {
  const { surface, read } = fixture();
  const slots: number[] = [];
  const connection = await enablePhoneMotion({ sensor: 'tambourine', surface, signal: new AbortController().signal,
    current: () => true, hit: slot => slots.push(slot) });
  read(0, 0);
  read(12, 20);
  read(-12, 40);
  assert.deepEqual(slots, [0]);
  connection.stop();
});


test('changing a motion threshold affects the existing listener without changing audio modes', async () => {
  const { surface, read } = fixture();
  const slots: number[] = [];
  let tuning = { ...TAMBOURINE_DEFAULTS };
  const connection = await enablePhoneMotion({ sensor: 'tambourine', surface, signal: new AbortController().signal,
    current: () => true, hit: slot => slots.push(slot), tambourineTuning: () => tuning });
  read(0, 0); read(10, 20); read(0, 40);
  assert.deepEqual(slots, [2], 'the unmodified acceleration selects the soft take');
  tuning = { ...tuning, hardShake: 9 };
  read(0, 150); read(10, 170); read(0, 190);
  assert.deepEqual(slots, [2, 3], 'the same acceleration selects the hard take after tuning');
  connection.stop();
});
