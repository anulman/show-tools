export interface MotionReading { readonly x: number | null; readonly y: number | null; readonly z: number | null; readonly time: number; readonly gravity: boolean }
export interface MotionSurface {
  readonly secure: boolean;
  readonly available: boolean;
  permission?: () => Promise<unknown>;
  listen(listener: (reading: MotionReading) => void): () => void;
  hide(listener: () => void): () => void;
}
export interface ShakeSettings { readonly threshold?: number; readonly release?: number; readonly minimumIntervalMs?: number }
export function shakeDetector({ threshold = 8, release = 3, minimumIntervalMs = 100 }: ShakeSettings = {}) {
  if (!Number.isFinite(threshold) || threshold <= 0 || !Number.isFinite(release) || release < 0 || release >= threshold
    || !Number.isFinite(minimumIntervalMs) || minimumIntervalMs < 0) throw new Error('Invalid shake settings');
  let armed = true, last = -Infinity, previous: readonly number[] | undefined;
  return (reading: MotionReading): boolean => {
    const { x, y, z, time } = reading;
    if (x === null || y === null || z === null || ![x, y, z, time].every(Number.isFinite) || time < last) return false;
    const vector = [x, y, z];
    const magnitude = reading.gravity ? previous ? Math.hypot(x - previous[0], y - previous[1], z - previous[2]) : 0 : Math.hypot(x, y, z);
    previous = vector;
    if (magnitude <= release) armed = true;
    if (!armed || magnitude < threshold || time - last < minimumIntervalMs) return false;
    armed = false; last = time; return true;
  };
}
export function browserMotionSurface(): MotionSurface {
  const motion = globalThis.DeviceMotionEvent;
  const request = motion && 'requestPermission' in motion ? motion.requestPermission : undefined;
  return {
    secure: window.isSecureContext, available: typeof motion === 'function',
    ...(typeof request === 'function' ? { permission: async () => { const result: unknown = request.call(motion); return result; } } : {}),
    listen(listener) {
      const receive = (event: DeviceMotionEvent) => {
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
export async function enablePhoneMotion({ surface = browserMotionSurface(), signal, current, hit, stopped = () => {}, settings }: {
  surface?: MotionSurface; signal: AbortSignal; current: () => boolean; hit: () => void; stopped?: () => void; settings?: ShakeSettings;
}): Promise<{ stop(): void }> {
  if (!surface.secure) throw new Error('Phone motion needs HTTPS or localhost');
  if (!surface.available) throw new Error('This browser does not provide motion input');
  signal.throwIfAborted();
  if (surface.permission && await surface.permission() !== 'granted') throw new Error('Phone motion permission was not granted');
  signal.throwIfAborted();
  if (!current()) throw new Error('The song changed while motion permission was pending');
  const detect = shakeDetector(settings);
  let active = true, unlisten = () => {}, unhide = () => {};
  const stop = () => {
    if (!active) return;
    active = false; unlisten(); unhide(); signal.removeEventListener('abort', stop); stopped();
  };
  unlisten = surface.listen(reading => { if (!active) return; if (!current()) { stop(); return; } if (detect(reading)) hit(); });
  unhide = surface.hide(stop); signal.addEventListener('abort', stop, { once: true });
  return { stop };
}
