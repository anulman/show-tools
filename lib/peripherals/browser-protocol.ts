import { Schema } from 'effect';
import { decodeLightPublication } from '../performance/lights.js';
import { PF } from '../performance/light-abi.js';
import { PHYSICAL_SWITCH_IDS } from '../performance/model.js';
const safe = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const controlId = Schema.Literals(PHYSICAL_SWITCH_IDS);
export const HelperReadySchema = Schema.Struct({ type: Schema.Literal('ready'), version: Schema.Literal(2), session: safe,
  switches: Schema.Array(Schema.Struct({ controlId, state: Schema.Literals(['released', 'held', 'unknown']) }))
    .check(Schema.isMaxLength(PHYSICAL_SWITCH_IDS.length), Schema.makeFilter(values => new Set(values.map(value => value.controlId)).size === values.length || 'Duplicate physical switch state')) });
export const HelperInputSchema = Schema.Union([
  HelperReadySchema,
  Schema.Struct({ type: Schema.Literal('button'), session: safe, sequence: safe, controlId, down: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal('motion'), session: safe, sequence: safe, deltaY: Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER })) }),
  Schema.Struct({ type: Schema.Literal('detached'), session: safe }),
  Schema.Struct({ type: Schema.Literal('delivered'), publication: safe }),
]);
export type HelperReady = typeof HelperReadySchema.Type;
export type HelperInput = typeof HelperInputSchema.Type;
export const decodeBrowserInput = Schema.decodeUnknownSync(HelperInputSchema, { onExcessProperty: 'error' });
export function physicalReadyMasks(ready: HelperReady) {
  return ready.switches.reduce((masks, value) => {
    const bit = 1 << PHYSICAL_SWITCH_IDS.indexOf(value.controlId);
    if (value.state === 'released') masks.releasedMask |= bit;
    else if (value.state === 'held') masks.heldMask |= bit;
    return masks;
  }, { releasedMask: 0, heldMask: 0 });
}
export const decodeBrowserLight = Schema.decodeUnknownSync(Schema.Struct({ lease: Schema.NonEmptyString,
  values: Schema.Array(Schema.Number).check(Schema.isMinLength(PF.LIGHT_FIELDS), Schema.isMaxLength(PF.LIGHT_FIELDS)) }), { onExcessProperty: 'error' });
export const decodeBrowserLease = Schema.decodeUnknownSync(Schema.Struct({ lease: Schema.NonEmptyString }), { onExcessProperty: 'error' });
export function validateBrowserLight(value: unknown) {
  const request = decodeBrowserLight(value);
  decodeLightPublication(Float64Array.from(request.values));
  return request;
}
