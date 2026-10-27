import { Schema } from 'effect';
import { CONTROL_IDS } from '../../lib/performance/model.js';

const button = Schema.Union([Schema.Literals(CONTROL_IDS), Schema.Literal('mushroom')]);
export type PeripheralButtonId = typeof button.Type;
const finite = Schema.Number.check(Schema.isFinite());
const distance = finite.check(Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }));
const source = { sessionId: Schema.NonEmptyString, sourceTimeMs: finite };
const key = { ...source, kind: Schema.Literal('key'), code: Schema.NonEmptyString };
const observation = Schema.Union([
  Schema.Struct({ ...key, edge: Schema.Literal('press'), repeat: Schema.Boolean }),
  Schema.Struct({ ...key, edge: Schema.Literal('release'), repeat: Schema.Literal(false) }),
  Schema.Struct({ ...source, kind: Schema.Literal('rotation'), distance, units: Schema.NonEmptyString }),
]);
export type PeripheralObservation = typeof observation.Type;

interface Provenance {
  readonly producerId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly sourceTimeMs: number;
}
export type NormalizedPeripheralInput = Provenance & (
  | { readonly kind: 'button'; readonly buttonId: PeripheralButtonId; readonly edge: 'press' | 'release'; readonly rawCode: string }
  | { readonly kind: 'rotation'; readonly distance: number; readonly units: string }
);

export function peripheralCommandId(input: Pick<Provenance, 'producerId' | 'sessionId' | 'sequence'>): string {
  return JSON.stringify([input.producerId, input.sessionId, input.sequence]);
}

const decodeObservation = Schema.decodeUnknownSync(observation);
const decodeProducer = Schema.decodeUnknownSync(Schema.NonEmptyString);
const decodeMapping = Schema.decodeUnknownSync(Schema.ReadonlyMap(Schema.NonEmptyString, button));
const decodeConnection = Schema.decodeUnknownSync(Schema.Struct({
  sessionId: Schema.NonEmptyString, releasedCodes: Schema.Array(Schema.NonEmptyString),
}));
type KeyState = 'unknown' | 'released' | 'pressed';

export function createPeripheralInput(options: {
  readonly producerId: string;
  readonly mapping: ReadonlyMap<string, PeripheralButtonId>;
}) {
  const producerId = decodeProducer(options.producerId);
  const mapping = new Map(decodeMapping(options.mapping));
  const keys = new Map<string, KeyState>();
  const sessions = new Set<string>();
  let sessionId: string | null = null;
  let sequence = 0;
  function next(sessionId: string, sourceTimeMs: number): Provenance {
    if (!Number.isSafeInteger(sequence)) throw new Error('Peripheral sequence exhausted; connect a fresh session');
    return { producerId, sessionId, sequence: sequence++, sourceTimeMs };
  }

  return {
    connect(connection: { readonly sessionId: string; readonly releasedCodes: readonly string[] }): void {
      const next = decodeConnection(connection);
      if (sessions.has(next.sessionId)) throw new Error('A peripheral session ID cannot be reused');
      if (peripheralCommandId({ producerId, sessionId: next.sessionId, sequence: Number.MAX_SAFE_INTEGER }).length > 200)
        throw new Error('Producer/session IDs exceed the native command ID limit of 200 UTF-16 units');
      for (const code of next.releasedCodes) if (!mapping.has(code)) throw new Error(`Unknown released key code ${code}`);
      const released = new Set(next.releasedCodes);
      keys.clear();
      for (const code of mapping.keys()) keys.set(code, released.has(code) ? 'released' : 'unknown');
      sessionId = next.sessionId;
      sequence = 0;
      sessions.add(sessionId);
    },

    disconnect(): void {
      sessionId = null;
      keys.clear();
    },

    inject(value: unknown): NormalizedPeripheralInput | null {
      const input = decodeObservation(value);
      if (sessionId === null || input.sessionId !== sessionId) return null;
      if (input.kind === 'rotation') {
        const provenance = next(sessionId, input.sourceTimeMs);
        return input.distance === 0 ? null : { ...provenance, kind: 'rotation', distance: input.distance, units: input.units };
      }
      const buttonId = mapping.get(input.code);
      if (buttonId === undefined) return null;
      const provenance = next(sessionId, input.sourceTimeMs);
      const state = keys.get(input.code);
      if (input.edge === 'release') {
        keys.set(input.code, 'released');
        return state === 'pressed' ? { ...provenance, kind: 'button', buttonId, edge: 'release', rawCode: input.code } : null;
      }
      if (input.repeat) {
        if (state !== 'pressed') keys.set(input.code, 'unknown');
        return null;
      }
      if (state !== 'released') return null;
      keys.set(input.code, 'pressed');
      return { ...provenance, kind: 'button', buttonId, edge: 'press', rawCode: input.code };
    },
  };
}
export type PeripheralInput = ReturnType<typeof createPeripheralInput>;
