import { Schema } from 'effect';
import { CONTROL_IDS, PHYSICAL_SWITCH_IDS, INPUT_PRODUCER_KINDS, INPUT_PRODUCER_LIMIT } from './model.js';
import type { PhysicalSwitchId } from './model.js';
export { PHYSICAL_SWITCH_IDS, INPUT_PRODUCER_KINDS, INPUT_PRODUCER_LIMIT, INPUT_LIGHT_ID_BASE,
  INPUT_PACKET_MAGIC, INPUT_BINDING_FIELDS, inputBindingRows, physicalControlLightId } from './model.js';
export type { PhysicalSwitchId } from './model.js';

export const PhysicalSwitchIdSchema = Schema.Literals(PHYSICAL_SWITCH_IDS);

const rows = Schema.NonEmptyArray(Schema.Literals(CONTROL_IDS)).check(Schema.isMaxLength(4),
  Schema.makeFilter(values => new Set(values).size === values.length || 'Duplicate cue row'));
export const InputTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('cue-rows'), rows }),
  Schema.Struct({ kind: Schema.Literal('tempo') }),
  Schema.Struct({ kind: Schema.Literal('panic') }),
]);
export const InputBindingSchema = Schema.Struct({ controlId: PhysicalSwitchIdSchema, target: InputTargetSchema });
export const InputBindingsSchema = Schema.Array(InputBindingSchema).check(Schema.isMaxLength(PHYSICAL_SWITCH_IDS.length),
  Schema.makeFilter(bindings => {
    const physical = new Set<PhysicalSwitchId>(), claimed = new Set<string>();
    for (const binding of bindings) {
      if (physical.has(binding.controlId)) return 'Duplicate physical control binding';
      physical.add(binding.controlId);
      if (binding.target.kind !== 'cue-rows') continue;
      for (const row of binding.target.rows) {
        if (claimed.has(row)) return 'Physical controls cannot share a cue row';
        claimed.add(row);
      }
    }
    return true;
  }));
export type InputBinding = typeof InputBindingSchema.Type;
export type InputBindings = typeof InputBindingsSchema.Type;
export const decodeInputBindings = Schema.decodeUnknownSync(InputBindingsSchema, { onExcessProperty: 'error' });

const identity = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const producer = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: INPUT_PRODUCER_LIMIT - 1 }));
const mask = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }));
export const InputProducerKindSchema = Schema.Literals(INPUT_PRODUCER_KINDS);
export const InputAttachSchema = Schema.Struct({ producer, session: identity, bindingGeneration: identity,
  kind: InputProducerKindSchema, releasedMask: mask, heldMask: mask }).check(Schema.makeFilter(value => {
  const allowed = value.kind === 'physical' ? 63 : 223;
  return !(value.releasedMask & value.heldMask) && !((value.releasedMask | value.heldMask) & ~allowed)
    || 'Initial input states overlap or include an axis';
}));
export const InputEventSchema = Schema.Struct({ producer, session: identity, bindingGeneration: identity,
  sequence: identity, input: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7 })),
  value: Schema.Number.check(Schema.isFinite()) });
export const InputRevokeSchema = Schema.Struct({ producer, session: identity });
export type InputAttach = typeof InputAttachSchema.Type;
export type InputEvent = typeof InputEventSchema.Type;
export type InputRevoke = typeof InputRevokeSchema.Type;
export const decodeInputAttach = Schema.decodeUnknownSync(InputAttachSchema, { onExcessProperty: 'error' });
export const decodeInputEvent = Schema.decodeUnknownSync(InputEventSchema, { onExcessProperty: 'error' });
export const decodeInputRevoke = Schema.decodeUnknownSync(InputRevokeSchema, { onExcessProperty: 'error' });

export const InputRoutingStateSchema = Schema.Struct({ bindingGeneration: identity,
  producers: Schema.Array(Schema.Struct({ producer, session: identity, kind: InputProducerKindSchema,
    releasedMask: mask, heldMask: mask, lastSequence: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })) }))
    .check(Schema.isMaxLength(INPUT_PRODUCER_LIMIT), Schema.makeFilter(values => new Set(values.map(value => value.producer)).size === values.length || 'Duplicate input producer')) });
export type InputRoutingState = typeof InputRoutingStateSchema.Type;
