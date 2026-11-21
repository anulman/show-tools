import { gravityMotion, type DownstrokeAxis } from './tambourine-direction.js';
import type { MotionReading, TambourineSlot, TambourineTrace, TambourineTuning } from './phone-motion.js';

const DIRECTION_ACCELERATION = 2.5;
const DOWN_SPEED = .18;
const UP_SPEED = -.10;
const TURN_MS = 24;
const RETURN_PEAK_MS = 40;
const WRIST_BRAKE_WINDOW_MS = 65;
const WRIST_REVERSAL_SPEED = 120;
const PAIRED_WRIST_SPEED = 60;
const PAIRED_VELOCITY_DROP = .12;
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
  | { kind: 'up'; recovery: ReturnMotion; paired?: { speedAtHit: number; reversedFrames: number; rested: boolean } };

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
    if (motion.reset) stroke = { kind: 'ready' };
    if (motion.settled) {
      if (stroke.kind === 'up' && stroke.paired) stroke.paired.rested = true;
      else stroke = { kind: 'ready' };
    }

    const report = (
      decision: TambourineTrace['decision'],
      gesture?: TambourineTrace['gesture'],
      slot?: TambourineSlot,
    ) => trace?.({ reading, magnitude, gravityMagnitude, verticalAcceleration, verticalVelocity: velocity,
      decision, gesture, slots: slot === undefined ? [] : [slot] });
    const emit = (slot: TambourineSlot, gesture: NonNullable<TambourineTrace['gesture']>, pairedReturn = false) => {
      if (!pairedReturn && time - lastPlayed < tuning.minimumIntervalMs) {
        report('latched-or-gap', gesture);
        return false;
      }
      if (!pairedReturn) lastPlayed = time;
      play(slot);
      report(gesture === 'hit' ? 'hit' : 'shake', gesture, slot);
      return true;
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
    const reversedNow = angular && wrist && wrist.speed >= WRIST_REVERSAL_SPEED
      && angular[0] * wrist.axes[0] + angular[1] * wrist.axes[1] + angular[2] * wrist.axes[2]
        <= -.5 * angularSpeed * wrist.speed;
    if (reversedNow && angularSpeed >= WRIST_REVERSAL_SPEED) recovery.reversed = true;

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
        if (hit && emit(hardHit ? 1 : 0, 'hit')) {
          recovery.impulses.length = 0;
          stroke = { kind: 'up', recovery, paired: { speedAtHit: velocity, reversedFrames: 0, rested: false } };
        } else {
          stroke = { kind: 'up', recovery };
          if (!hit) emit(shakeSlot(strength), 'downshake');
        }
        return;
      }
      report('waiting-for-turn');
      return;
    }

    const paired = stroke.paired;
    if (paired) {
      paired.reversedFrames = reversedNow && angularSpeed >= PAIRED_WRIST_SPEED ? paired.reversedFrames + 1 : 0;
    }
    const pairedWristReturn = paired && paired.reversedFrames >= 2 && paired.speedAtHit - velocity >= PAIRED_VELOCITY_DROP;
    if (velocity <= UP_SPEED || pairedWristReturn || (recovery.reversed && startsDown)) {
      const strength = Math.max(0, ...recovery.impulses.map(impulse => impulse.magnitude));
      stroke = startsDown ? startDown() : { kind: 'ready' };
      if (paired || strength >= tuning.shake) emit(shakeSlot(strength), 'upshake', !!paired);
      else report('return-stroke', 'upshake');
      return;
    }
    if (paired?.rested && startsDown) {
      stroke = startDown();
      report('waiting-for-turn');
      return;
    }
    report('waiting-for-return');
  };
}
