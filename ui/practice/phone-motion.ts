interface MotionAxes { readonly x: number | null; readonly y: number | null; readonly z: number | null }
export interface MotionReading extends MotionAxes {
  readonly time: number;
  readonly gravity: boolean;
  readonly rotation?: MotionAxes;
}
type MotionSensor = 'shake' | 'gyroscope' | 'tambourine';
export interface MotionSurface {
  readonly secure: boolean;
  readonly available: boolean;
  permission?: () => Promise<unknown>;
  listen(listener: (reading: MotionReading) => void): () => void;
  hide(listener: () => void): () => void;
}
export interface ShakeSettings { readonly threshold?: number; readonly release?: number; readonly minimumIntervalMs?: number }
interface GyroscopeSettings extends ShakeSettings { readonly fullVelocity?: number }
export const DEFAULT_GYROSCOPE = {
  threshold: 150,
  release: 60,
  minimumIntervalMs: 100,
  fullVelocity: 550,
} as const;

function thresholdCrossing(threshold: number, release: number, minimumIntervalMs: number) {
  if (!Number.isFinite(threshold) || threshold <= 0 || !Number.isFinite(release) || release < 0 || release >= threshold
    || !Number.isFinite(minimumIntervalMs) || minimumIntervalMs < 0) throw new Error('Invalid shake settings');
  let armed = true;
  let lastHit = -Infinity;
  let lastReading = -Infinity;
  return (magnitude: number, time: number, reversed = false) => {
    if (!Number.isFinite(magnitude) || !Number.isFinite(time) || time < lastReading) return false;
    lastReading = time;
    if (magnitude <= release || reversed) armed = true;
    if (!armed || magnitude < threshold || time - lastHit < minimumIntervalMs) return false;
    armed = false;
    lastHit = time;
    return true;
  };
}

export function shakeDetector({ threshold = 8, release = 3, minimumIntervalMs = 100 }: ShakeSettings = {}) {
  const crosses = thresholdCrossing(threshold, release, minimumIntervalMs);
  let previous: { x: number; y: number; z: number } | undefined;
  return (reading: MotionReading): boolean => {
    const { x, y, z, time, gravity, rotation } = reading;
    if (!Number.isFinite(time)) return false;
    let magnitude = 0;
    const hasAcceleration = x !== null && y !== null && z !== null && [x, y, z].every(Number.isFinite);
    if (hasAcceleration) {
      magnitude = gravity
        ? previous ? Math.hypot(x - previous.x, y - previous.y, z - previous.z) : 0
        : Math.hypot(x, y, z);
      previous = gravity ? { x, y, z } : undefined;
    } else {
      previous = undefined;
    }
    if (rotation && rotation.x !== null && rotation.y !== null && rotation.z !== null && [rotation.x, rotation.y, rotation.z].every(Number.isFinite)) {
      const rotationMagnitude = Math.hypot(rotation.x, rotation.y, rotation.z);
      // Compare both sensors on the shake threshold and keep one latch per gesture.
      magnitude = Math.max(magnitude, rotationMagnitude * threshold / DEFAULT_GYROSCOPE.threshold);
    } else if (!hasAcceleration) return false;
    return crosses(magnitude, time);
  };
}

export function gyroscopeDetector({
  threshold = DEFAULT_GYROSCOPE.threshold, release = DEFAULT_GYROSCOPE.release,
  minimumIntervalMs = DEFAULT_GYROSCOPE.minimumIntervalMs, fullVelocity = DEFAULT_GYROSCOPE.fullVelocity,
}: GyroscopeSettings = {}) {
  if (!Number.isFinite(fullVelocity) || fullVelocity <= threshold) throw new Error('Invalid full-velocity rotation rate');
  const crosses = thresholdCrossing(threshold, release, minimumIntervalMs);
  return ({ x, y, z, time, gravity }: MotionReading): number => {
    if (gravity || x === null || y === null || z === null) return 0;
    const magnitude = Math.hypot(x, y, z);
    if (!crosses(magnitude, time)) return 0;
    const strength = Math.min(1, (magnitude - threshold) / (fullVelocity - threshold));
    return Math.round(28 + strength * (127 - 28));
  };
}

export type TambourineSlot = 0 | 1 | 2 | 3;

export const TAMBOURINE_DEFAULTS = {
  shake: 6, hardShake: 14, brake: 7, hardHitSpeed: 0.55, angularBrake: 1000,
  hardHitAngularSpeed: 400, minimumIntervalMs: 0, hitsEnabled: false,
};
export type TambourineTuning = Readonly<typeof TAMBOURINE_DEFAULTS>;

const TAMBOURINE = {
  release: 3, shakePeakWindowMs: 24, hitSpeed: 0.18, hitAngularSpeed: 150,
  brakeFraction: 0.4, maximumGapMs: 120, velocityDecaySeconds: 0.12,
  reversalWindowMs: 120, reversalCosine: -.5,
};

type MotionVector = readonly [number, number, number];
function finiteAxes(axes: MotionAxes | undefined): MotionVector | undefined {
  if (!axes) return;
  const { x, y, z } = axes;
  if (x === null || y === null || z === null || ![x, y, z].every(Number.isFinite)) return;
  return [x, y, z];
}

export type TambourineTrace = {
  reading: MotionReading;
  magnitude?: number;
  comparedMs?: number;
  turnDegrees?: number;
  rearm?: 'release' | 'reversal';
  decision: 'stale-time' | 'missing-acceleration' | 'below-threshold' | 'latched-or-gap' | 'soft-pending' | 'shake' | 'hit' | 'hit-gap';
  slots: readonly TambourineSlot[];
};

export function tambourineDetector(
  hit: (slot: TambourineSlot) => void,
  tuning: TambourineTuning = TAMBOURINE_DEFAULTS,
  trace?: (entry: TambourineTrace) => void,
) {
  const shake = thresholdCrossing(tuning.shake, TAMBOURINE.release, tuning.minimumIntervalMs);
  let previous: { time: number; velocity: MotionVector; angularSpeed?: number } | undefined;
  const strongDirections: { time: number; axes: MotionVector }[] = [];
  let lastHit = -Infinity;
  let shakePeak: { time: number; magnitude: number } | undefined;
  return (reading: MotionReading) => {
    const { time, gravity, rotation } = reading;
    if (!Number.isFinite(time) || (previous && time <= previous.time)) {
      trace?.({ reading, decision: 'stale-time', slots: [] });
      return;
    }
    const acceleration = finiteAxes(reading);
    const angularAxes = finiteAxes(rotation);
    const angularSpeed = angularAxes && Math.hypot(...angularAxes);
    const elapsedMs = previous ? time - previous.time : Infinity;
    const elapsed = elapsedMs / 1000;
    const recent = elapsedMs <= TAMBOURINE.maximumGapMs ? previous : undefined;
    const [vx, vy, vz] = recent?.velocity ?? [0, 0, 0];
    const speed = Math.hypot(vx, vy, vz);
    const [ax, ay, az] = !gravity && acceleration ? acceleration : [0, 0, 0];
    const opposingAcceleration = speed > 0 ? -(vx * ax + vy * ay + vz * az) / speed : 0;
    const linearHit = speed >= TAMBOURINE.hitSpeed && opposingAcceleration >= tuning.brake
      && opposingAcceleration * elapsed >= speed * TAMBOURINE.brakeFraction;
    const precedingAngularSpeed = recent?.angularSpeed ?? 0;
    const angularDrop = precedingAngularSpeed - (angularSpeed ?? precedingAngularSpeed);
    const angularHit = precedingAngularSpeed >= TAMBOURINE.hitAngularSpeed
      && angularDrop >= Math.max(precedingAngularSpeed * TAMBOURINE.brakeFraction, tuning.angularBrake * elapsed);
    const braking = tuning.hitsEnabled && (linearHit || angularHit);
    const decay = Math.exp(-elapsed / TAMBOURINE.velocityDecaySeconds);
    const velocity: MotionVector = recent && acceleration && !gravity && !braking
      ? [decay * vx + elapsed * ax, decay * vy + elapsed * ay, decay * vz + elapsed * az] : [0, 0, 0];
    // Raw gravity changes direction as the phone turns. Its length is the usable shake signal.
    const magnitude = acceleration ? gravity ? Math.abs(Math.hypot(...acceleration) - 9.81) : Math.hypot(...acceleration) : undefined;
    const released = magnitude !== undefined && magnitude <= TAMBOURINE.release;
    if (gravity || !acceleration || released) strongDirections.length = 0;
    while (strongDirections[0] && time - strongDirections[0].time > TAMBOURINE.reversalWindowMs)
      strongDirections.shift();
    let cosine: number | undefined;
    let comparedMs: number | undefined;
    let reversed = false;
    if (!gravity && magnitude !== undefined && magnitude >= tuning.shake) {
      const axes: MotionVector = [ax / magnitude, ay / magnitude, az / magnitude];
      for (const direction of strongDirections) {
        const alignment = axes[0] * direction.axes[0] + axes[1] * direction.axes[1] + axes[2] * direction.axes[2];
        if (cosine === undefined || alignment < cosine) {
          cosine = alignment;
          comparedMs = time - direction.time;
        }
      }
      reversed = cosine !== undefined && cosine <= TAMBOURINE.reversalCosine;
      // A reversal starts a new stroke. Do not compare it to the stroke it just ended.
      if (reversed) strongDirections.length = 0;
      strongDirections.push({ time, axes });
    }
    previous = { time, velocity, angularSpeed };
    const shakeStarted = magnitude !== undefined && shake(magnitude, time, reversed);
    const slots: TambourineSlot[] | undefined = trace ? [] : undefined;
    const emit = (slot: TambourineSlot) => { slots?.push(slot); hit(slot); };
    const report = (decision: TambourineTrace['decision']) => trace?.({
      reading, magnitude,
      comparedMs,
      turnDegrees: cosine === undefined ? undefined : Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI,
      rearm: reversed ? 'reversal' : released ? 'release' : undefined,
      decision, slots: slots ?? [],
    });
    if (braking) {
      shakePeak = undefined;
      if (time - lastHit < tuning.minimumIntervalMs) { report('hit-gap'); return; }
      lastHit = time;
      emit((linearHit && speed >= tuning.hardHitSpeed)
        || (angularHit && precedingAngularSpeed >= tuning.hardHitAngularSpeed) ? 1 : 0);
      report('hit');
      return;
    }
    if (magnitude === undefined) { report('missing-acceleration'); return; }
    if (!recent) shakePeak = undefined;
    if (reversed && shakePeak) {
      shakePeak = undefined;
      emit(2);
    }
    if (magnitude >= tuning.hardShake && (shakeStarted || shakePeak)) {
      shakePeak = undefined;
      emit(3);
      report('shake');
      return;
    }
    if (shakePeak) {
      // A hard stroke can cross the soft threshold one reading before its peak.
      if (magnitude < shakePeak.magnitude * .8 || time - shakePeak.time >= TAMBOURINE.shakePeakWindowMs) {
        shakePeak = undefined;
        emit(2);
        report('shake');
        return;
      }
      shakePeak.magnitude = Math.max(shakePeak.magnitude, magnitude);
    } else if (shakeStarted) shakePeak = { time, magnitude };
    report(shakePeak ? 'soft-pending' : magnitude < tuning.shake ? 'below-threshold' : 'latched-or-gap');
  };
}

export function browserMotionSurface(sensor: MotionSensor = 'shake'): MotionSurface {
  const motion = globalThis.DeviceMotionEvent;
  const request = motion && 'requestPermission' in motion ? motion.requestPermission : undefined;
  return {
    secure: window.isSecureContext, available: typeof motion === 'function',
    ...(typeof request === 'function' ? { permission: async () => { const result: unknown = request.call(motion); return result; } } : {}),
    listen(listener) {
      const receive = (event: DeviceMotionEvent) => {
        const rate = event.rotationRate;
        const rotation = rate ? { x: rate.alpha, y: rate.beta, z: rate.gamma } : undefined;
        if (sensor === 'gyroscope') {
          if (rotation) listener({ ...rotation, time: event.timeStamp, gravity: false });
          return;
        }
        const linear = event.acceleration;
        const usable = linear !== null && [linear.x, linear.y, linear.z].every(value => typeof value === 'number' && Number.isFinite(value));
        const acceleration = usable ? linear : event.accelerationIncludingGravity;
        if (acceleration || rotation) listener({ x: acceleration?.x ?? null, y: acceleration?.y ?? null, z: acceleration?.z ?? null,
          time: event.timeStamp, gravity: !usable, rotation });
      };
      window.addEventListener('devicemotion', receive);
      return () => window.removeEventListener('devicemotion', receive);
    },
    hide(listener) {
      const visibility = () => { if (document.hidden) listener(); };
      window.addEventListener('pagehide', listener); document.addEventListener('visibilitychange', visibility);
      return () => { window.removeEventListener('pagehide', listener); document.removeEventListener('visibilitychange', visibility); };
    },
  };
}

export async function enablePhoneMotion({
  sensor = 'shake', surface = browserMotionSurface(sensor), signal, current, hit, stopped = () => {}, settings, tambourineTuning, tambourineTrace,
}: {
  sensor?: MotionSensor; surface?: MotionSurface; signal: AbortSignal; current: () => boolean;
  hit: (velocity: number) => void; stopped?: () => void; settings?: GyroscopeSettings; tambourineTuning?: () => TambourineTuning;
  tambourineTrace?: (entry: TambourineTrace) => void;
}): Promise<{ stop(): void }> {
  if (!surface.secure) throw new Error('Phone motion needs HTTPS or localhost');
  if (!surface.available) throw new Error('This browser does not provide motion input');
  signal.throwIfAborted();

  let tuning = tambourineTuning?.();
  const detectMotion = sensor === 'tambourine' ? undefined
    : sensor === 'gyroscope' ? gyroscopeDetector(settings) : shakeDetector(settings);
  let detectTambourine = sensor === 'tambourine' ? tambourineDetector(hit, tuning, tambourineTrace) : undefined;
  let active = true, unlisten = () => {}, unhide = () => {};
  const stop = () => {
    if (!active) return;
    active = false;
    unlisten();
    unhide();
    signal.removeEventListener('abort', stop);
    stopped();
  };
  unhide = surface.hide(stop);
  signal.addEventListener('abort', stop, { once: true });
  try {
    if (surface.permission && await surface.permission() !== 'granted') throw new Error('Phone motion permission was not granted');
    signal.throwIfAborted();
    if (!active || !current()) throw new DOMException('Phone motion enable canceled', 'AbortError');
    unlisten = surface.listen(reading => {
      if (!active) return;
      if (!current()) { stop(); return; }
      if (detectTambourine) {
        const nextTuning = tambourineTuning?.();
        if (nextTuning !== tuning) {
          tuning = nextTuning;
          detectTambourine = tambourineDetector(hit, tuning, tambourineTrace);
        }
        detectTambourine(reading);
        return;
      }
      const value = detectMotion?.(reading);
      if (value) hit(Number(value));
    });
    return { stop };
  } catch (error) {
    stop();
    throw error;
  }
}
