import { Schema } from 'effect';
import { CONTROL_IDS } from './model.js';

export const PhysicalSwitchIdSchema = Schema.Literals(['blue', 'yellow', 'red', 'green', 'pedal', 'mushroom']);
export type PhysicalSwitchId = typeof PhysicalSwitchIdSchema.Type;
export const PHYSICAL_SWITCH_IDS = PhysicalSwitchIdSchema.literals;
export const INPUT_PRODUCER_LIMIT = 32;
export const INPUT_LIGHT_ID_BASE = 257;
export const INPUT_PACKET_MAGIC = 0x50464931;
export const INPUT_BINDING_FIELDS = 3;

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

export function inputBindingRows(bindings: InputBindings): readonly (readonly [number, number, number])[] {
  return bindings.map(binding => {
    const id = PHYSICAL_SWITCH_IDS.indexOf(binding.controlId);
    switch (binding.target.kind) {
      case 'cue-rows': return [id, 0, binding.target.rows.reduce((mask, row) => mask | 1 << CONTROL_IDS.indexOf(row), 0)];
      case 'tempo': return [id, 1, 0];
      case 'panic': return [id, 2, 0];
    }
  });
}
export function physicalControlLightId(id: PhysicalSwitchId): number {
  return INPUT_LIGHT_ID_BASE + PHYSICAL_SWITCH_IDS.indexOf(id);
}

const identity = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const producer = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: INPUT_PRODUCER_LIMIT - 1 }));
const mask = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }));
export const InputProducerKindSchema = Schema.Literals(['physical', 'keyboard', 'pointer']);
export const INPUT_PRODUCER_KINDS = InputProducerKindSchema.literals;
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
