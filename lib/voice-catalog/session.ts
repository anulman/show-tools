import type { CatalogDocument, SheetBinding, Voice } from './model.js';
import { canonicalCatalog, parseCatalogDocument, parseVoice } from './model.js';
import type { SheetVoiceRow } from './sheet-voices.js';
import { bindingMatches, sheetVoiceKey } from './sheet-voices.js';

export function resolveVoice(document: CatalogDocument, row: SheetVoiceRow): Voice | undefined {
  const binding = document.bindings.find(item => bindingMatches(row, item));
  return binding ? document.voices.find(voice => voice.id === binding.voiceId) : undefined;
}

export function reconcileCatalog(document: CatalogDocument, rows: readonly SheetVoiceRow[],
    initialEffectsByProfile: ReadonlyMap<number, Voice['effects']>, idFactory: () => string): CatalogDocument {
  const bound = new Set(document.bindings.map(sheetVoiceKey));
  const ids = new Set(document.voices.map(voice => voice.id));
  const voices = [...document.voices], bindings = [...document.bindings];
  for (const row of rows) {
    if (bound.has(row.key)) continue;
    const id = idFactory();
    if (ids.has(id)) throw new Error('A new catalog voice requires a unique identity');
    const effects = row.profile === null ? [] : initialEffectsByProfile.get(row.profile) ?? [];
    voices.push(parseVoice({ id, name: row.name.trim() || row.labelCell, notes: '', characterId: null, avatarToken: 'neutral',
      effects: effects.map(effect => ({ ...effect })) }));
    bindings.push({ spreadsheetId: row.spreadsheetId, sheetId: row.sheetId, labelCell: row.labelCell,
      sourceLabel: row.sourceLabel, voiceId: id, cueRow: null });
    bound.add(row.key); ids.add(id);
  }
  return voices.length === document.voices.length ? document : parseCatalogDocument({ ...document, voices, bindings });
}

export function withVoice(document: CatalogDocument, input: Voice, binding?: SheetBinding): CatalogDocument {
  const voice = parseVoice(input);
  if (binding && binding.voiceId !== voice.id) throw new Error('The sheet binding must reference the saved voice');
  const exists = document.voices.some(item => item.id === voice.id);
  const voices = exists ? document.voices.map(item => item.id === voice.id ? voice : item) : [...document.voices, voice];
  const bindings = [...document.bindings];
  if (binding) {
    const index = bindings.findIndex(item => sheetVoiceKey(item) === sheetVoiceKey(binding));
    if (index < 0) bindings.push(binding);
    else bindings[index] = binding;
  }
  const updated = parseCatalogDocument({ ...document, voices, bindings });
  return JSON.stringify(canonicalCatalog(updated)) === JSON.stringify(canonicalCatalog(document)) ? document : updated;
}
