import { Schema } from 'effect';
import { decodeLightPublication } from '../performance/lights.js';
import { PF } from '../performance/light-abi.js';
const safe = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
export const decodeBrowserInput = Schema.decodeUnknownSync(Schema.Union([
  Schema.Struct({ type: Schema.Literal('ready'), version: Schema.Literal(1), session: safe, released: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal('button'), session: safe, sequence: safe, down: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal('motion'), session: safe, sequence: safe, deltaY: Schema.Int.check(Schema.isBetween({ minimum: -32768, maximum: 32767 })) }),
  Schema.Struct({ type: Schema.Literal('detached'), session: safe }),
  Schema.Struct({ type: Schema.Literal('delivered'), publication: safe }),
]), { onExcessProperty: 'error' });
export const decodeBrowserLight = Schema.decodeUnknownSync(Schema.Struct({ lease: Schema.NonEmptyString,
  values: Schema.Array(Schema.Number).check(Schema.isMinLength(PF.LIGHT_FIELDS), Schema.isMaxLength(PF.LIGHT_FIELDS)) }), { onExcessProperty: 'error' });
export const decodeBrowserLease = Schema.decodeUnknownSync(Schema.Struct({ lease: Schema.NonEmptyString }), { onExcessProperty: 'error' });
export function validateBrowserLight(value: unknown) {
  const request = decodeBrowserLight(value);
  decodeLightPublication(Float64Array.from(request.values));
  return request;
}
