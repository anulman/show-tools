import { canonicalCatalog, parseCatalogDocument, type CatalogDocument, type Voice } from './model.js';
import { reconcileCatalog, resolveVoice, withVoice } from './session.js';
import { sheetVoiceKey, bindingMatches, type SheetVoiceRow } from './sheet-voices.js';

export function snapshotSongVoices(document: CatalogDocument, rows: readonly SheetVoiceRow[], defaults: ReadonlyMap<number, Voice['effects']>): CatalogDocument {
  const missing = rows.filter(row => !document.bindings.some(binding => sheetVoiceKey(binding) === row.key));
  let index = 0;
  const reservedIds = new Set(document.voices.map(voice => voice.id));
  const complete = reconcileCatalog(document, rows, defaults, () => {
    const base = `song:${missing[index++].key}`;
    let id = base, suffix = 0;
    while (reservedIds.has(id)) id = `${base}:${++suffix}`;
    reservedIds.add(id);
    return id;
  });
  const bindings = complete.bindings.filter(binding => rows.some(row => bindingMatches(row, binding)));
  const ids = new Set(bindings.map(binding => binding.voiceId));
  return canonicalCatalog({ version: 2, revision: 0, bindings, voices: complete.voices.filter(voice => ids.has(voice.id)) });
}

export function mergeSongVoices(document: CatalogDocument, input: unknown, rows: readonly SheetVoiceRow[]): CatalogDocument {
  const incoming = parseCatalogDocument(input);
  if (incoming.bindings.some(binding => !rows.some(row => bindingMatches(row, binding)))) throw new Error('MusicXML voice metadata references another song or a changed source label.');
  let next = document;
  const identities = new Map<string, string>();
  const targetKeys = new Set(incoming.bindings.map(sheetVoiceKey));
  for (const binding of incoming.bindings) {
    const row = rows.find(row => bindingMatches(row, binding));
    const voice = row && resolveVoice(incoming, row);
    if (!voice) throw new Error('MusicXML voice metadata is missing a bound voice.');
    const base = `song:${sheetVoiceKey(binding)}`;
    let id = identities.get(voice.id) ?? base;
    let suffix = 0;
    while (next.voices.some(existing => existing.id === id) && (!next.bindings.some(existing => existing.voiceId === id && targetKeys.has(sheetVoiceKey(existing)))
      || next.bindings.some(existing => existing.voiceId === id && !targetKeys.has(sheetVoiceKey(existing))))) id = `${base}:${++suffix}`;
    identities.set(voice.id, id);
    next = withVoice(next, { ...voice, id }, { ...binding, voiceId: id });
  }
  return next;
}
