import { PF as PFL } from './light-abi.js';

export type LightRow = { readonly id: number } & (
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly level: number }
  | { readonly kind: 'pulse'; readonly level: number; readonly periodBeats: number }
  | { readonly kind: 'blink'; readonly level: number; readonly periodBeats: number; readonly duty: number }
);
export type LightLaunch = { readonly kind: 'immediate' } | { readonly kind: 'grid'; readonly quantumBeats: number };
export interface LightReplacement {
  readonly generation: number;
  readonly revision: number;
  readonly launch: LightLaunch;
  readonly rows: readonly LightRow[];
}
export interface LightPublication {
  readonly version: 1;
  readonly generation: number;
  readonly run: number;
  readonly epoch: number;
  readonly timeline: number;
  readonly sequence: number;
  readonly frame: number;
  readonly sampleRate: number;
  readonly countBeat: number;
  readonly running: boolean;
  readonly pending: { readonly countBeat: number } | null;
  readonly originBeat: number;
  readonly samples: readonly { readonly id: number; readonly level: number }[];
}

function integer(value: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function unit(value: number) { return Number.isFinite(value) && value >= 0 && value <= 1; }
function positive(value: number) { return Number.isFinite(value) && value > 0; }

export function encodeLightReplacement(request: LightReplacement, target: Float64Array) {
  if (!integer(request.generation, 1) || !integer(request.revision, 1)
    || request.rows.length > PFL.LIGHT_CAPACITY || target.length < PFL.LIGHT_CAPACITY * PFL.LIGHT_ROW_FIELDS) {
    throw new Error('Invalid light replacement identity or capacity');
  }
  let launch: number;
  let quantumBeats: number;
  switch (request.launch.kind) {
    case 'immediate': launch = PFL.LIGHT_IMMEDIATE; quantumBeats = 0; break;
    case 'grid':
      if (!positive(request.launch.quantumBeats)) throw new Error('Light grid quantum must be finite and positive');
      launch = PFL.LIGHT_GRID; quantumBeats = request.launch.quantumBeats; break;
    default: {
      const exhaustive: never = request.launch;
      throw new Error(`Unknown light launch: ${exhaustive}`);
    }
  }
  const ids = new Set<number>();
  for (const row of request.rows) {
    if (!integer(row.id, 0, 0xffffffff) || ids.has(row.id)) throw new Error('Light IDs must be unique unsigned 32-bit integers');
    ids.add(row.id);
    switch (row.kind) {
      case 'off': break;
      case 'on':
        if (!unit(row.level)) throw new Error('Light level must be between zero and one');
        break;
      case 'pulse':
        if (!unit(row.level) || !positive(row.periodBeats)) throw new Error('Invalid light pulse level or period');
        break;
      case 'blink':
        if (!unit(row.level) || !positive(row.periodBeats) || !Number.isFinite(row.duty) || row.duty <= 0 || row.duty >= 1) {
          throw new Error('Invalid light blink level, period, or duty');
        }
        break;
      default: {
        const exhaustive: never = row;
        throw new Error(`Unknown light pattern: ${exhaustive}`);
      }
    }
  }
  target.fill(0);
  request.rows.forEach((row, index) => {
    const offset = index * PFL.LIGHT_ROW_FIELDS;
    target[offset + PFL.LIGHT_ID] = row.id;
    switch (row.kind) {
      case 'off': target[offset + PFL.LIGHT_PATTERN] = PFL.LIGHT_OFF; break;
      case 'on':
        target[offset + PFL.LIGHT_PATTERN] = PFL.LIGHT_ON;
        target[offset + PFL.LIGHT_PEAK] = row.level;
        break;
      case 'pulse':
        target[offset + PFL.LIGHT_PATTERN] = PFL.LIGHT_PULSE;
        target[offset + PFL.LIGHT_PEAK] = row.level;
        target[offset + PFL.LIGHT_PERIOD] = row.periodBeats;
        break;
      case 'blink':
        target[offset + PFL.LIGHT_PATTERN] = PFL.LIGHT_BLINK;
        target[offset + PFL.LIGHT_PEAK] = row.level;
        target[offset + PFL.LIGHT_PERIOD] = row.periodBeats;
        target[offset + PFL.LIGHT_DUTY] = row.duty;
        break;
      default: {
        const exhaustive: never = row;
        throw new Error(`Unknown light pattern: ${exhaustive}`);
      }
    }
  });
  return { launch, quantumBeats, count: request.rows.length };
}

export function decodeLightPublication(values: ArrayLike<number>): LightPublication {
  if (values.length !== PFL.LIGHT_FIELDS || values[PFL.LIGHT_FORMAT] !== PFL.LIGHT_VERSION) {
    throw new Error('Invalid native light publication format');
  }
  const generation = values[PFL.LIGHT_GENERATION], run = values[PFL.LIGHT_RUN], epoch = values[PFL.LIGHT_EPOCH];
  const timeline = values[PFL.LIGHT_TIMELINE], sequence = values[PFL.LIGHT_SEQUENCE], frame = values[PFL.LIGHT_FRAME];
  const sampleRate = values[PFL.LIGHT_RATE], countBeat = values[PFL.LIGHT_COUNT_BEAT], originBeat = values[PFL.LIGHT_ORIGIN_BEAT];
  const running = values[PFL.LIGHT_RUNNING], pending = values[PFL.LIGHT_PENDING], pendingBeat = values[PFL.LIGHT_PENDING_BEAT];
  const count = values[PFL.LIGHT_COUNT];
  if (!integer(generation, 1) || !integer(run, 0) || !integer(epoch, 1) || !integer(timeline, 0)
    || !integer(sequence, 1) || !integer(frame, 0) || !integer(sampleRate, 8000, 192000)
    || !Number.isFinite(countBeat) || !Number.isFinite(originBeat) || !Number.isFinite(pendingBeat)
    || (running !== 0 && running !== 1) || (pending !== 0 && pending !== 1)
    || !integer(count, 0, PFL.LIGHT_CAPACITY)) {
    throw new Error('Invalid native light publication metadata');
  }
  const ids = new Set<number>();
  const samples: { id: number; level: number }[] = [];
  for (let index = 0; index < PFL.LIGHT_CAPACITY; index++) {
    const offset = PFL.LIGHT_SAMPLES + index * PFL.LIGHT_SAMPLE_FIELDS;
    const id = values[offset + PFL.LIGHT_SAMPLE_ID], level = values[offset + PFL.LIGHT_SAMPLE_LEVEL];
    if (index >= count) {
      if (id !== 0 || level !== 0) throw new Error('Unused native light publication samples must be zero');
    } else {
      if (!integer(id, 0, 0xffffffff) || !unit(level) || ids.has(id)) throw new Error('Invalid native light publication sample');
      ids.add(id); samples.push({ id, level });
    }
  }
  if (sequence === Number.MAX_SAFE_INTEGER && (pending !== 0 || samples.some(sample => sample.level !== 0))) {
    throw new Error('Terminal native light publication must be off with no pending activation');
  }
  return { version: 1, generation, run, epoch, timeline, sequence, frame, sampleRate, countBeat,
    running: running === 1, pending: pending === 1 ? { countBeat: pendingBeat } : null, originBeat, samples };
}
