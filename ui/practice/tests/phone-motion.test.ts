import { captureDownstrokeAxis, normalizeDownstrokeAxis } from '../tambourine-direction.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TAMBOURINE_DEFAULTS, enablePhoneMotion, browserMotionSurface, gyroscopeDetector, shakeDetector, tambourineDetector, type MotionReading, type MotionSurface, type TambourineSlot, type TambourineTrace, type TambourineTuning } from '../phone-motion.js';
function fixture(permission?: MotionSurface['permission']) {
  let receive: ((reading: MotionReading) => void) | undefined, hide: (() => void) | undefined;
  let removed = 0;
  const surface: MotionSurface = { secure: true, available: true, permission,
    listen(listener) { receive = listener; return () => { removed++; receive = undefined; }; }, hide(listener) { hide = listener; return () => { removed++; hide = undefined; }; } };
  return { surface, read(x: number, time: number, gravity = false, rotation?: MotionReading['rotation']) { receive?.({ x, y: 0, z: 0, time, gravity, rotation }); }, hide() { hide?.(); }, removed: () => removed };
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

function singleTambourineStroke(tuning?: TambourineTuning) {
  const slots: TambourineSlot[] = [];
  const detect = tambourineDetector(slot => slots.push(slot), tuning);
  return (reading: MotionReading) => {
    slots.length = 0;
    detect(reading);
    assert(slots.length <= 1);
    return slots[0];
  };
}

test('tambourine picks shake variants by acceleration and hit layers by speed before braking', () => {
  const detect = singleTambourineStroke({ ...TAMBOURINE_DEFAULTS, hitsEnabled: true, minimumIntervalMs: 85 });
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
  const detect = singleTambourineStroke({ ...TAMBOURINE_DEFAULTS, hitsEnabled: true, minimumIntervalMs: 85 });
  const read = (time: number, x: number, z: number, gravity: boolean) => detect({ x, y: 0, z, time, gravity });
  assert.equal(read(0, 0, 9.81, true), undefined);
  assert.equal(read(20, 9.81, 0, true), undefined);
  assert.equal(read(50, 0, 0, false), undefined);
  assert.equal(read(70, 12, 0, false), undefined);
  assert.equal(read(90, -12, 0, false), 0, 'linear reversal brakes movement accumulated in the previous frame');
  assert.equal(read(220, 0, 0, false), undefined);
  assert.equal(read(260, 40, 0, false), 3);
  assert.equal(read(300, -40, 0, false), 1, 'a faster linear stroke selects the hard hit');
});

test('the motion listener sends a tambourine hit even when the selected slot is zero', async () => {
  const { surface, read } = fixture();
  const tuning = { ...TAMBOURINE_DEFAULTS, hitsEnabled: true };
  const slots: number[] = [];
  const connection = await enablePhoneMotion({ sensor: 'tambourine', surface, signal: new AbortController().signal,
    current: () => true, hit: slot => slots.push(slot), tambourineTuning: () => tuning });
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


test('shake-only defaults allow rapidly rearmed strokes while ignoring braking hits', () => {
  const detect = singleTambourineStroke();
  const read = (time: number, x: number | null, rotation = 0) => detect({
    x, y: 0, z: 0, time, gravity: false, rotation: { x: rotation, y: 0, z: 0 },
  });
  assert.equal(read(0, 0, 480), undefined);
  assert.equal(read(16, null, 100), undefined, 'rotational braking alone is silent');
  assert.equal(read(32, 16, 480), 3);
  assert.equal(read(48, 16, 100), undefined, 'continuous acceleration does not retrigger');
  assert.equal(read(64, 3), undefined);
  assert.equal(read(80, 16), 3, 'another stroke can play 48 ms later');
  assert.equal(read(96, 0), undefined);
  assert.equal(read(112, 8, 480), undefined);
  assert.equal(read(128, 0, 100), 2, 'braking cannot consume a pending shake');
});


test('strong reversals rearm without a dip and adjacent motion in similar directions does not', () => {
  const slots: TambourineSlot[] = [];
  const detect = tambourineDetector(slot => slots.push(slot));
  const read = (time: number, x: number, y = 0, gravity = false) => detect({ x, y, z: 0, time, gravity });
  read(0, 16);
  read(16, 16, 3);
  read(32, 0, 16);
  assert.deepEqual(slots, [3], 'jitter and a sideways reading keep the latch set');
  read(48, 0, -16);
  read(64, 0, 16);
  assert.deepEqual(slots, [3, 3, 3], 'sustained above-threshold back-and-forth strokes all play');
  read(300, 0, -16);
  assert.deepEqual(slots, [3, 3, 3], 'opposite data after a sensor gap is not a reversal');
  read(316, 0, 30, true);
  read(332, 0, -30, true);
  assert.deepEqual(slots, [3, 3, 3], 'raw gravity direction does not create a reversal');
});

test('a reversal closes the soft stroke before playing the hard return stroke', () => {
  const slots: TambourineSlot[] = [];
  const detect = tambourineDetector(slot => slots.push(slot));
  detect({ x: 0, y: 0, z: 0, time: 0, gravity: false });
  detect({ x: 8, y: 0, z: 0, time: 16, gravity: false });
  assert.deepEqual(slots, []);
  detect({ x: -16, y: 0, z: 0, time: 32, gravity: false });
  assert.deepEqual(slots, [2, 3]);
});

test('a reversal rearms immediately and an explicitly configured gap still applies', () => {
  const slots: TambourineSlot[] = [];
  const detect = tambourineDetector(slot => slots.push(slot), { ...TAMBOURINE_DEFAULTS, minimumIntervalMs: 40 });
  for (const [time, x] of [[0, 16], [16, -16], [32, -16]]) detect({ x, y: 0, z: 0, time, gravity: false });
  assert.deepEqual(slots, [3]);
  detect({ x: -16, y: 0, z: 0, time: 48, gravity: false });
  assert.deepEqual(slots, [3, 3]);
});


test('a short reading between the release and onset thresholds preserves the reversal reference', () => {
  const trace: TambourineTrace[] = [];
  const slots: TambourineSlot[] = [];
  const detect = tambourineDetector(slot => slots.push(slot), TAMBOURINE_DEFAULTS, entry => trace.push(entry));
  for (const [time, x] of [[0, 16], [16, 4], [32, -16], [48, -4], [64, -16]])
    detect({ time, x, y: 0, z: 0, gravity: false });
  assert.deepEqual(slots, [3, 3]);
  assert.equal(trace[1].decision, 'below-threshold');
  assert.equal(trace[1].rearm, undefined);
  assert.equal(trace[2].rearm, 'reversal');
  assert.equal(trace[2].comparedMs, 32);
  assert.equal(trace[2].turnDegrees, 180);
  assert.deepEqual(trace[2].slots, [3]);
  assert.equal(trace[4].decision, 'latched-or-gap');
  detect({ time: 160, x: 4, y: 0, z: 0, gravity: false });
  detect({ time: 190, x: 16, y: 0, z: 0, gravity: false });
  assert.equal(trace.at(-1)?.comparedMs, undefined, 'a sequence of weak readings does not extend the strong reference');
  assert.deepEqual(slots, [3, 3]);
});

test('a wrist stroke can reverse across several above-threshold readings', () => {
  const slots: TambourineSlot[] = [];
  const tuning = { ...TAMBOURINE_DEFAULTS, shake: 4, hardShake: 5.5 };
  const detect = tambourineDetector(slot => slots.push(slot), tuning);

  for (const [time, x, y, z] of [
    [6804, 2.25, 7.15, 2.72],
    [6821, 3.93, 6.98, 2.04],
    [6836, 9.39, 3.49, -0.37],
    [6855, 14.18, 2.38, -0.79],
    [6873, 15.70, 3.06, -0.91],
    [6887, 15.30, 4.81, -2.37],
    [6903, 12.09, 8.83, -1.40],
    [6921, 9.64, 10.58, -1.25],
    [6937, 0.27, 12.64, -0.60],
  ]) detect({ time, x, y, z, gravity: false });
  assert.deepEqual(slots, [3], 'the outward stroke plays once as it arcs sideways');

  detect({ time: 6954, x: -21.07, y: 6.87, z: -2.57, gravity: false });
  assert.deepEqual(slots, [3, 3], 'the full reversal plays the return stroke');
  detect({ time: 6972, x: -31.79, y: 4.29, z: -6.17, gravity: false });
  detect({ time: 6988, x: -29.38, y: 0.41, z: -7.92, gravity: false });
  assert.deepEqual(slots, [3, 3], 'the return stroke plays once');
});

test('a continuous wrist brake hits once and a renewed stroke can hit immediately', () => {
  const slots: TambourineSlot[] = [];
  const detect = tambourineDetector(slot => slots.push(slot), { ...TAMBOURINE_DEFAULTS, hitsEnabled: true });
  const read = (time: number, x: number, y = 0, z = 0) =>
    detect({ time, x: 0, y: 0, z: 0, gravity: false, rotation: { x, y, z } });

  read(0, 102.86, -68.79, -437.26);
  read(16, 1.91, 41.71, -245.04);
  assert.deepEqual(slots, [1], 'the first qualifying drop fires the hard hit on that reading');
  read(33, -74.81, 55.62, 100.54);
  assert.deepEqual(slots, [1], 'a second steep drop in the same slowdown is silent');

  read(49, 155);
  read(65, 80);
  assert.deepEqual(slots, [1], 'a small rebound does not rearm the hit');
  read(81, 320);
  read(97, 110);
  assert.deepEqual(slots, [1, 0], 'a fresh stroke rearms without a time delay');
});

test('calibrated eighths play alternating accents and silence every return', async () => {
  const { surface, read } = fixture();
  const slots: number[] = [];
  const axis: readonly [number, number, number] = [0, -1, 0];
  const tuning = { ...TAMBOURINE_DEFAULTS, hitsEnabled: true };
  const active = await enablePhoneMotion({ sensor: 'tambourine', surface, signal: new AbortController().signal,
    current: () => true, hit: slot => slots.push(slot), tambourineTuning: () => tuning, tambourineDirection: () => axis });
  try {
    // The return and brake can both exceed the hard-shake threshold.
    for (let stroke = 0; stroke < 8; stroke++) {
      const time = 100 + stroke * 300;
      const before = slots.length;
      read(25, time - 16, false, { x: 65, y: 400, z: 70 });
      assert.equal(slots.length, before, 'upstroke stays silent');
      read(8, time, false, { x: 20, y: -110, z: 0 });
      read(stroke % 2 === 0 ? 20 : 10, time + 16, false, { x: 80, y: -330, z: -10 });
      read(9, time + 33, false, { x: 35, y: -280, z: 40 });
      read(24, time + 50, false, { x: 65, y: -95, z: 35 });
      assert.equal(slots.length, before + 1, 'one sample per downstroke, even across a hard brake');
    }
    assert.deepEqual(slots, [3, 2, 3, 2, 3, 2, 3, 2]);
  } finally { active.stop(); }
});

test('downstroke calibration waits for a still grip and captures the sign of one stroke', () => {
  const capture = captureDownstrokeAxis();
  const read = (time: number, y: number) => capture({
    x: 0, y: 0, z: 0, time, gravity: false, rotation: { x: 0, y, z: 0 },
  });
  assert.equal(read(0, 300).kind, 'listening');
  assert.equal(read(16, 0).kind, 'listening');
  assert.equal(read(96, 0).kind, 'listening');
  assert.equal(read(112, -120).kind, 'listening');
  assert.equal(read(128, -215).kind, 'listening');
  assert.equal(read(144, -180).kind, 'listening');
  assert.deepEqual(read(160, 0), { kind: 'calibrated', axis: [0, -1, 0] });
  assert.equal(normalizeDownstrokeAxis([0, 0, 0]), undefined);
  assert.equal(normalizeDownstrokeAxis([0, '1', 0]), undefined);
});

test('downstroke calibration rejects two conflicting directions in one capture', () => {
  const capture = captureDownstrokeAxis();
  const read = (time: number, x: number) => capture({
    x: 0, y: 0, z: 0, time, gravity: false, rotation: { x, y: 0, z: 0 },
  });
  for (const [time, x] of [[0, 0], [90, 0], [106, 200], [122, 300], [138, -300], [154, -200]]) {
    assert.equal(read(time, x).kind, 'listening');
  }
  assert.equal(read(170, 0).kind, 'retry');
});

test('gravity downstrokes play eighths in any grip and silence upward braking', async () => {
  let listener: (reading: MotionReading) => void = () => assert.fail('motion listener missing');
  const surface: MotionSurface = { secure: true, available: true,
    listen(receive) { listener = receive; return () => {}; }, hide() { return () => {}; } };
  const slots: number[] = [];
  const connection = await enablePhoneMotion({ sensor: 'tambourine', surface, signal: new AbortController().signal,
    current: () => true, hit: slot => slots.push(slot), tambourineDirection: () => 'gravity' });
  let frame = 0;
  const read = (down: number, forward = 0, turned = false) => {
    const motion = turned ? { x: -down, y: 0, z: forward } : { x: forward, y: 0, z: -down };
    listener({ ...motion, time: frame++ * 1000 / 60, gravity: false, rotation: { x: 0, y: 0, z: 0 },
      accelerationIncludingGravity: turned ? { ...motion, x: motion.x + 9.81 } : { ...motion, z: motion.z + 9.81 } });
  };
  try {
    for (let index = 0; index < 7; index++) read(0);
    // The strong downward acceleration only brakes the phone on its way up.
    for (const acceleration of [-8, -8, -8, 24, 0]) read(acceleration);
    assert.deepEqual(slots, []);
    for (const acceleration of [18, 18, -18, -18, 0]) read(0, acceleration);
    assert.deepEqual(slots, [], 'forward-only movement cannot fire');
    for (let stroke = 0; stroke < 8; stroke++) {
      const strong = stroke % 2 === 0;
      const turned = stroke >= 4;
      const before: number = slots.length;
      for (const acceleration of [6, 6, 6, -18, 0]) read(acceleration, acceleration > 0 ? strong ? 16 : 5 : 0, turned);
      assert.equal(slots.length, before + 1, 'the downstroke chooses one sample');
      for (const acceleration of [-5, -5, 10, 0]) read(acceleration, 0, turned);
      assert.equal(slots.length, before + 1, 'the return and its brake stay silent');
      for (let index = 0; index < 9; index++) read(0, 0, turned);
    }
    assert.deepEqual(slots, [3, 2, 3, 2, 3, 2, 3, 2]);
  } finally { connection.stop(); }
});
