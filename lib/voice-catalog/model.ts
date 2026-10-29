import { Schema } from 'effect';

const nonnegativeInteger = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const bounded = (minimum: number, maximum: number) => Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum, maximum }));
export const LiveEffectDefinitionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('slapback'), delayMs: bounded(40, 250), feedback: bounded(0, .7), wet: bounded(0, 1) }),
  Schema.Struct({ kind: Schema.Literal('chorus'), rateHz: bounded(.05, 5), depthMs: bounded(0, 9), baseDelayMs: bounded(10, 40), wet: bounded(0, 1) }),
]);
export const VoiceSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  notes: Schema.String.check(Schema.isMaxLength(4000)),
  characterId: Schema.NullOr(Schema.NonEmptyString),
  avatarToken: Schema.Literals(['neutral', 'olive', 'amber', 'blue', 'plum']),
  effects: Schema.Array(LiveEffectDefinitionSchema).check(Schema.isMaxLength(64)),
});
const bindingFields = {
  spreadsheetId: Schema.NonEmptyString,
  sheetId: nonnegativeInteger,
  labelCell: Schema.String.check(Schema.isPattern(/^[A-Z]+[1-9][0-9]*$/)),
  sourceLabel: Schema.NonEmptyString,
  voiceId: Schema.NonEmptyString,
};
export const CueRowSchema = Schema.Struct({ labelCell: bindingFields.labelCell, sourceLabel: Schema.NonEmptyString });
export const SheetBindingSchema = Schema.Struct({ ...bindingFields, cueRow: Schema.NullOr(CueRowSchema) });
export const CatalogDocumentSchema = Schema.Struct({
  version: Schema.Literal(2),
  revision: nonnegativeInteger,
  voices: Schema.Array(VoiceSchema).check(Schema.isMaxLength(256)),
  bindings: Schema.Array(SheetBindingSchema).check(Schema.isMaxLength(512)),
}).check(Schema.makeFilter(document => {
  const ids = new Set(document.voices.map(voice => voice.id));
  if (ids.size !== document.voices.length) return 'Voice IDs must be unique';
  const keys = new Set<string>();
  for (const binding of document.bindings) {
    if (!ids.has(binding.voiceId)) return `Binding references unknown voice: ${binding.voiceId}`;
    const key = JSON.stringify([binding.spreadsheetId, binding.sheetId, binding.labelCell]);
    if (keys.has(key)) return 'Qualified sheet bindings must be unique';
    keys.add(key);
  }
  return true;
}));
export type CatalogDocument = typeof CatalogDocumentSchema.Type;
export type Voice = typeof VoiceSchema.Type;
export type SheetBinding = typeof SheetBindingSchema.Type;
const legacySchema = Schema.Struct({ version: Schema.Literal(1), revision: nonnegativeInteger,
  voices: Schema.Array(VoiceSchema), bindings: Schema.Array(Schema.Struct(bindingFields)),
});
const decodeCatalog = Schema.decodeUnknownSync(Schema.Union([CatalogDocumentSchema, legacySchema]));
export function parseCatalogDocument(input: unknown): CatalogDocument {
  const document = decodeCatalog(input);
  return document.version === 2 ? document : Schema.decodeUnknownSync(CatalogDocumentSchema)({ ...document, version: 2,
    bindings: document.bindings.map(binding => ({ ...binding, cueRow: null })),
  });
}
export const parseVoice = Schema.decodeUnknownSync(VoiceSchema);
export const parseSheetBinding = Schema.decodeUnknownSync(SheetBindingSchema);

export function canonicalCatalog(document: CatalogDocument): CatalogDocument {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return {
    ...document,
    voices: [...document.voices].sort((a, b) => compare(a.id, b.id)),
    bindings: [...document.bindings].sort((a, b) => compare(a.spreadsheetId, b.spreadsheetId) || a.sheetId - b.sheetId || compare(a.labelCell, b.labelCell)),
  };
}

export type CueRow = typeof CueRowSchema.Type;
