export interface MotionReading { readonly x: number | null; readonly y: number | null; readonly z: number | null; readonly time: number; readonly gravity: boolean }
type MotionSensor = 'acceleration' | 'gyroscope';
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
  return (magnitude: number, time: number) => {
    if (!Number.isFinite(magnitude) || !Number.isFinite(time) || time < lastReading) return false;
    lastReading = time;
    if (magnitude <= release) armed = true;
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
    const { x, y, z, time, gravity } = reading;
    if (x === null || y === null || z === null || ![x, y, z, time].every(Number.isFinite)) return false;
    const magnitude = gravity
      ? previous ? Math.hypot(x - previous.x, y - previous.y, z - previous.z) : 0
      : Math.hypot(x, y, z);
    previous = gravity ? { x, y, z } : undefined;
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

export function browserMotionSurface(sensor: MotionSensor = 'acceleration'): MotionSurface {
  const motion = globalThis.DeviceMotionEvent;
  const request = motion && 'requestPermission' in motion ? motion.requestPermission : undefined;
  return {
    secure: window.isSecureContext, available: typeof motion === 'function',
    ...(typeof request === 'function' ? { permission: async () => { const result: unknown = request.call(motion); return result; } } : {}),
    listen(listener) {
      const receive = (event: DeviceMotionEvent) => {
        if (sensor === 'gyroscope') {
          const rotation = event.rotationRate;
          if (rotation) listener({ x: rotation.alpha, y: rotation.beta, z: rotation.gamma, time: event.timeStamp, gravity: false });
          return;
        }
        const linear = event.acceleration;
        const usable = linear !== null && [linear.x, linear.y, linear.z].every(value => typeof value === 'number' && Number.isFinite(value));
        const acceleration = usable ? linear : event.accelerationIncludingGravity;
        if (acceleration) listener({ x: acceleration.x, y: acceleration.y, z: acceleration.z, time: event.timeStamp, gravity: !usable });
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
  sensor = 'acceleration', surface = browserMotionSurface(sensor), signal, current, hit, stopped = () => {}, settings,
}: {
  sensor?: MotionSensor; surface?: MotionSurface; signal: AbortSignal; current: () => boolean;
  hit: (velocity: number) => void; stopped?: () => void; settings?: GyroscopeSettings;
}): Promise<{ stop(): void }> {
  if (!surface.secure) throw new Error('Phone motion needs HTTPS or localhost');
  if (!surface.available) throw new Error('This browser does not provide motion input');
  signal.throwIfAborted();

  const detect = sensor === 'gyroscope' ? gyroscopeDetector(settings) : shakeDetector(settings);
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
      const velocity = detect(reading);
      if (velocity) hit(Number(velocity));
    });
    return { stop };
  } catch (error) {
    stop();
    throw error;
  }
}
