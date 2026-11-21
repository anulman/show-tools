import { gravityMotion, type DownstrokeAxis } from './tambourine-direction.js';
import type { MotionReading, TambourineSlot, TambourineTrace, TambourineTuning } from './phone-motion.js';

const DIRECTION_ACCELERATION = 2.5;
const DOWN_SPEED = .18;
const UP_SPEED = -.10;
const TURN_MS = 24;
const RETURN_PEAK_MS = 40;
const WRIST_BRAKE_WINDOW_MS = 65;
const WRIST_REVERSAL_SPEED = 120;
const WRIST_HIT_SPEED = 150;
const WRIST_DROP = .4;

type WristPeak = { time: number; axes: DownstrokeAxis; speed: number };
type ReturnMotion = {
  wrist?: WristPeak;
  reversed: boolean;
  impulses: { time: number; magnitude: number }[];
};
type Stroke =
  | { kind: 'ready' }
  | { kind: 'down'; magnitude: number; speed: number; turnAt?: number; recovery: ReturnMotion }
  | { kind: 'up'; recovery: ReturnMotion };

export function tambourineGrooveDetector(
  play: (slot: TambourineSlot) => void,
  tuning: TambourineTuning,
  trace?: (entry: TambourineTrace) => void,
) {
  const project = gravityMotion();
  const shakeSlot = (strength: number) => strength >= tuning.hardShake ? 3 : 2;
  let stroke: Stroke = { kind: 'ready' };
  let lastPlayed = -Infinity;

  return (reading: MotionReading) => {
    const motion = project(reading);
    if (motion.kind !== 'motion') {
      if (motion.kind === 'missing-gravity') stroke = { kind: 'ready' };
      trace?.({ reading, decision: motion.kind, slots: [] });
      return;
    }
    const { time } = reading;
    const { angular, angularSpeed, downAcceleration, magnitude, velocity, verticalAcceleration, gravityMagnitude } = motion;
    if (motion.reset || motion.settled) stroke = { kind: 'ready' };

    const report = (
      decision: TambourineTrace['decision'],
      gesture?: TambourineTrace['gesture'],
      slot?: TambourineSlot,
    ) => trace?.({ reading, magnitude, gravityMagnitude, verticalAcceleration, verticalVelocity: velocity,
      decision, gesture, slots: slot === undefined ? [] : [slot] });
    const emit = (slot: TambourineSlot, gesture: NonNullable<TambourineTrace['gesture']>) => {
      if (time - lastPlayed < tuning.minimumIntervalMs) { report('latched-or-gap', gesture); return; }
      lastPlayed = time;
      play(slot);
      report(gesture === 'hit' ? 'hit' : 'shake', gesture, slot);
    };

    if (!motion.initialized) { report('waiting-for-stillness'); return; }
    const startsDown = velocity >= DOWN_SPEED && downAcceleration >= DIRECTION_ACCELERATION && magnitude >= tuning.shake;
    const startDown = (): Stroke => ({
      kind: 'down', magnitude, speed: velocity,
      recovery: { reversed: false, impulses: [], wrist: angular ? { time, axes: angular, speed: angularSpeed } : undefined },
    });

    if (stroke.kind === 'ready') {
      if (startsDown) stroke = startDown();
      report(startsDown ? 'waiting-for-turn' : 'awaiting-downstroke');
      return;
    }

    if (stroke.kind === 'down' && stroke.turnAt === undefined && downAcceleration >= DIRECTION_ACCELERATION) {
      stroke.magnitude = Math.max(stroke.magnitude, magnitude);
      stroke.speed = Math.max(stroke.speed, velocity);
      const peak = stroke.recovery.wrist;
      if (angular && (!peak || angularSpeed >= peak.speed || time - peak.time > WRIST_BRAKE_WINDOW_MS))
        stroke.recovery.wrist = { time, axes: angular, speed: angularSpeed };
    }

    const { recovery } = stroke;
    if (downAcceleration <= -DIRECTION_ACCELERATION)
      recovery.impulses.push({ time, magnitude });
    while (recovery.impulses[0] && time - recovery.impulses[0].time > RETURN_PEAK_MS) recovery.impulses.shift();

    const wrist = recovery.wrist;
    if (angular && wrist && angularSpeed >= WRIST_REVERSAL_SPEED && wrist.speed >= WRIST_REVERSAL_SPEED) {
      const alignment = angular[0] * wrist.axes[0] + angular[1] * wrist.axes[1] + angular[2] * wrist.axes[2];
      if (alignment <= -.5 * angularSpeed * wrist.speed) recovery.reversed = true;
    }

    if (stroke.kind === 'down') {
      const angularBrake = angular && wrist && wrist.speed >= WRIST_HIT_SPEED && time - wrist.time <= WRIST_BRAKE_WINDOW_MS &&
        wrist.speed - angularSpeed >= Math.max(wrist.speed * WRIST_DROP, tuning.angularBrake * (time - wrist.time) / 1000);
      const verticalBrake = -downAcceleration;
      const reachedTurn = verticalBrake >= DIRECTION_ACCELERATION &&
        (verticalBrake >= tuning.brake || angularBrake || velocity <= stroke.speed - DOWN_SPEED || velocity <= 0);
      if (reachedTurn) stroke.turnAt ??= time;
      const hit = tuning.hitsEnabled && angularBrake && verticalBrake >= tuning.brake * 2;
      if (hit || (stroke.turnAt !== undefined && time - stroke.turnAt >= TURN_MS)) {
        const strength = stroke.magnitude;
        const hardHit = hit && (stroke.speed >= tuning.hardHitSpeed || wrist.speed >= tuning.hardHitAngularSpeed);
        stroke = { kind: 'up', recovery };
        if (hit) emit(hardHit ? 1 : 0, 'hit');
        else emit(shakeSlot(strength), 'downshake');
        return;
      }
      report('waiting-for-turn');
      return;
    }

    if (velocity <= UP_SPEED || (recovery.reversed && startsDown)) {
      const strength = Math.max(0, ...recovery.impulses.map(impulse => impulse.magnitude));
      stroke = startsDown ? startDown() : { kind: 'ready' };
      if (strength >= tuning.shake) emit(shakeSlot(strength), 'upshake');
      else report('return-stroke', 'upshake');
      return;
    }
    report('waiting-for-return');
  };
}
