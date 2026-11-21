import type { MotionReading, TambourineSlot, TambourineTrace, TambourineTuning } from './phone-motion.js';

export type DownstrokeAxis = readonly [x: number, y: number, z: number];

const ONSET = 80;
const QUIET = 40;
const REST_MS = 80;
const CALIBRATION_MS = 100;
const PEAK_MS = 24;
const SENSOR_GAP_MS = 120;

export function normalizeDownstrokeAxis(input: unknown): DownstrokeAxis | undefined {
  if (!Array.isArray(input) || input.length !== 3) return;
  const [x, y, z]: unknown[] = input;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return;
  const length = Math.hypot(x, y, z);
  if (Number.isFinite(length) && length > 0) return [x / length, y / length, z / length];
}

function angularVelocity({ rotation }: MotionReading): DownstrokeAxis | undefined {
  if (!rotation) return;
  const { x, y, z } = rotation;
  if (x !== null && y !== null && z !== null && [x, y, z].every(Number.isFinite)) return [x, y, z];
}

type CalibrationResult = { kind: 'listening' } | { kind: 'retry' } | { kind: 'calibrated'; axis: DownstrokeAxis };

export function captureDownstrokeAxis() {
  let lastTime = -Infinity;
  let stillSince: number | undefined;
  let armed = false;
  let started: number | undefined;
  let x = 0, y = 0, z = 0, totalSpeed = 0, samples = 0;
  return (reading: MotionReading): CalibrationResult => {
    const rotation = angularVelocity(reading);
    if (!rotation || !Number.isFinite(reading.time) || reading.time <= lastTime) return { kind: 'listening' };
    const disconnected = reading.time - lastTime > SENSOR_GAP_MS;
    lastTime = reading.time;
    const speed = Math.hypot(...rotation);
    if (disconnected) {
      if (started !== undefined) return { kind: 'retry' };
      stillSince = undefined;
      armed = false;
    }
    if (started === undefined) {
      if (speed <= QUIET) {
        stillSince ??= reading.time;
        if (reading.time - stillSince >= REST_MS) armed = true;
      } else if (armed && speed >= ONSET) {
        started = reading.time;
      } else {
        stillSince = undefined;
      }
    }
    if (started === undefined) return { kind: 'listening' };
    if (speed >= ONSET) {
      x += rotation[0];
      y += rotation[1];
      z += rotation[2];
      totalSpeed += speed;
      samples++;
    }
    if (reading.time - started < CALIBRATION_MS && speed > QUIET) return { kind: 'listening' };
    const axis = normalizeDownstrokeAxis([x, y, z]);
    return axis && samples >= 3 && Math.hypot(x, y, z) >= totalSpeed * .8
      ? { kind: 'calibrated', axis } : { kind: 'retry' };
  };
}

export function downstrokeDetector(
  hit: (slot: TambourineSlot) => void,
  tuning: TambourineTuning,
  axis: DownstrokeAxis,
  trace?: (entry: TambourineTrace) => void,
) {
  let phase: 'waiting' | 'ready' | 'played' = 'waiting';
  let lastReading = -Infinity, lastHit = -Infinity;
  let stillSince: number | undefined;
  let softSince: number | undefined;

  return (reading: MotionReading) => {
    const { time, x, y, z } = reading;
    if (!Number.isFinite(time) || time <= lastReading) {
      trace?.({ reading, decision: 'stale-time', slots: [] });
      return;
    }
    if (time - lastReading > SENSOR_GAP_MS) {
      phase = 'waiting';
      softSince = stillSince = undefined;
    }
    lastReading = time;

    const rotation = angularVelocity(reading);
    const rawMagnitude = x !== null && y !== null && z !== null ? Math.hypot(x, y, z) : undefined;
    const magnitude = rawMagnitude !== undefined && Number.isFinite(rawMagnitude)
      ? reading.gravity ? Math.abs(rawMagnitude - 9.81) : rawMagnitude : undefined;
    const signedSpeed = rotation && (axis[0] * rotation[0] + axis[1] * rotation[1] + axis[2] * rotation[2]);
    const report = (decision: TambourineTrace['decision'], slot?: TambourineSlot) =>
      trace?.({ reading, magnitude, signedSpeed, decision, slots: slot === undefined ? [] : [slot] });
    const emit = (slot: TambourineSlot) => {
      phase = 'played';
      softSince = undefined;
      if (time - lastHit < tuning.minimumIntervalMs) { report('latched-or-gap'); return; }
      lastHit = time;
      hit(slot);
      report('shake', slot);
    };

    if (signedSpeed === undefined || !rotation) {
      phase = 'waiting';
      softSince = stillSince = undefined;
      report('missing-rotation');
      return;
    }
    if (signedSpeed <= -ONSET) {
      if (softSince !== undefined) emit(2);
      else report('return-stroke');
      phase = 'ready';
      stillSince = undefined;
      return;
    }

    if (magnitude !== undefined && magnitude <= 3 && Math.hypot(...rotation) <= QUIET) {
      stillSince ??= time;
      if (time - stillSince >= REST_MS) phase = 'ready';
    } else {
      stillSince = undefined;
    }
    if (phase === 'ready' && signedSpeed >= ONSET && magnitude !== undefined) {
      if (magnitude >= tuning.hardShake) { emit(3); return; }
      if (magnitude >= tuning.shake) softSince ??= time;
    }
    if (softSince !== undefined && time - softSince >= PEAK_MS) { emit(2); return; }
    report(softSince !== undefined ? 'soft-pending' : 'awaiting-downstroke');
  };
}
