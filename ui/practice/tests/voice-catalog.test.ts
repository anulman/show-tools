import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import { loadSong } from '../../../songs/index.js';
import { parseCatalogDocument, type CatalogDocument, type Voice } from '../../../lib/voice-catalog/model.js';
import { discoverSheetVoices, discoverCueRows, loadedCommandRows } from '../../../lib/voice-catalog/sheet-voices.js';
import { reconcileCatalog, resolveVoice, withVoice } from '../../../lib/voice-catalog/session.js';
import { CatalogClientConflictError, type CatalogClient } from '../catalog-client.js';
import { createVoiceEffectsEditor } from '../voice-effects.js';
import { initialVoiceEffects } from '../../../lib/performance/vocal-effects.js';
import type { VoiceEffectConfiguration } from '../../../lib/performance/model.js';
import type { VoiceLibraryOptions, VoiceLibraryUpdate } from '../voice-library.js';
import type { installVoiceCatalog } from '../voice-catalog.js';

const controllerSource = (await sourceForVM(new URL('../voice-catalog.ts', import.meta.url)))
  .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export (?=function )/gm, '')
  .replace(/^export\s*\{[\s\S]*?\};?\s*$/m, '');
const song = await loadSong('dance-yrself-clean');
const slapback = [{ kind: 'slapback', delayMs: 140, feedback: .2, wet: .4 }] satisfies Voice['effects'];
const chorus = [{ kind: 'chorus', rateHz: 1, depthMs: 4, baseDelayMs: 22, wet: .3 }] satisfies Voice['effects'];
function deferred() {
  let finish = () => {};
  const promise = new Promise<void>(resolve => { finish = resolve; });
  return { promise, finish };
}

async function harness() {
  let stored: CatalogDocument = { version: 2, revision: 0, voices: [], bindings: [] };
  let libraryOptions: VoiceLibraryOptions | undefined;
  let latest: VoiceLibraryUpdate | undefined;
  let gate: Promise<void> | undefined;
  let applyError: Error | undefined;
  let writes = 0;
  const applied: (readonly VoiceEffectConfiguration[])[] = [];
  const errors: unknown[] = [];
  const busy: boolean[] = [];
  const downloads: Blob[] = [];
  const drafts = createVoiceEffectsEditor(() => {});
  const client: CatalogClient = {
    async snapshot() { return parseCatalogDocument(stored); },
    async replace(next, expected) {
      writes++;
      await gate;
      if (stored.revision !== expected) throw new CatalogClientConflictError('Library changed in another tab.');
      stored = parseCatalogDocument({ ...next, revision: stored.revision + 1 });
      return stored;
    },
    async exportBytes() { return new Uint8Array(); },
    close() {},
  };
  const context = vm.createContext({
    registry: { characters: [] }, parseCatalogDocument, discoverSheetVoices, discoverCueRows, loadedCommandRows, reconcileCatalog, resolveVoice, withVoice,
    CatalogClientConflictError, initialVoiceEffects, AbortController, AbortSignal, crypto: webcrypto, Blob, Error, URL: {
      createObjectURL(blob: Blob) { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {},
    }, setTimeout: () => 0,
    window: { document: { baseURI: 'http://localhost/', createElement: () => ({ href: '', download: '', click() {} }) } },
    createCatalogClient: async () => client,
    installVoiceLibrary(_root: HTMLElement, options: VoiceLibraryOptions) {
      libraryOptions = options;
      return { update(data: VoiceLibraryUpdate) { latest = data; }, openVoice() {}, dispose() {} };
    },
  });
  const install: typeof installVoiceCatalog = vm.runInContext(`${controllerSource}\ninstallVoiceCatalog`, context);
  // The controller only passes this root to the stubbed view; it never reads DOM properties.
  const root = Object.create(null);
  const controller = install(root, { drafts, isBusy: () => false, onError: error => errors.push(error),
    onBusyChange: () => { busy.push(controller.busy); },
    async apply(configurations) { applied.push(structuredClone(configurations)); if (applyError) throw applyError; },
  });
  await controller.load(song);
  assert(libraryOptions); assert(latest);
  const ui = libraryOptions;
  function data() { assert(latest); return latest; }
  function voice(cell: string) {
    const row = data().rows.find(row => row.labelCell === cell); assert(row);
    const found = resolveVoice(data().document, row); assert(found); return found;
  }
  return { controller, ui, drafts, data, voice, applied, errors, busy, downloads,
    stored: () => stored, writes: () => writes,
    externalSave(voice: Voice) { stored = parseCatalogDocument({ ...withVoice(stored, voice), revision: stored.revision + 1 }); },
    block(promise: Promise<void>) { gate = promise; },
    failApply(error: Error) { applyError = error; },
  };
}

test('saving a routed voice applies saved graphs and leaves another profile’s unsaved draft unapplied', async () => {
  const h = await harness();
  const other = h.voice('A9');
  h.ui.onDraftEffects?.(other.id, chorus);
  const selected = h.voice('A8');
  const result = await h.ui.onSave({ ...selected, effects: slapback }, undefined, h.data().document.revision);
  assert.match(result.message, /applied to audio/);
  assert.equal(h.applied.length, 1);
  assert.deepEqual(h.applied[0].find(item => item.profile === 4)?.effects, slapback);
  assert.deepEqual(h.applied[0].find(item => item.profile === 5)?.effects, other.effects);
  assert.deepEqual(h.drafts.configurations().find(item => item.profile === 5)?.effects, chorus);
});

test('saving instrument metadata without an audio profile persists without a native graph call', async () => {
  const h = await harness(); const bass = h.voice('A14');
  const result = await h.ui.onSave({ ...bass, notes: 'Video reference', characterId: 'A07', effects: chorus }, undefined, h.data().document.revision);
  assert.match(result.message, /no audio input assigned/);
  assert.equal(h.voice('A14').characterId, 'A07'); assert.equal(h.applied.length, 0);
});

test('CAS conflicts reload central drafts and reject a stale editor revision until reopened', async () => {
  const h = await harness(); const selected = h.voice('A8'); const revision = h.data().document.revision;
  h.ui.onDraftEffects?.(selected.id, chorus);
  h.externalSave({ ...selected, effects: slapback, notes: 'Other tab' });
  await assert.rejects(h.ui.onSave({ ...selected, notes: 'Stale' }, undefined, revision), CatalogClientConflictError);
  assert.equal(h.voice('A8').notes, 'Other tab');
  assert.deepEqual(h.drafts.configurations().find(item => item.profile === 4)?.effects, slapback);
  const writes = h.writes();
  await assert.rejects(h.ui.onSave(selected, undefined, revision), /Close and reopen/);
  assert.equal(h.writes(), writes); assert.equal(h.applied.length, 0);
  await h.ui.onSave({ ...h.voice('A8'), notes: 'Reopened' }, undefined, h.data().document.revision);
  assert.equal(h.voice('A8').notes, 'Reopened');
});

test('JSON export reads the latest store without advancing the controller revision or rebasing drafts', async () => {
  const h = await harness(); const selected = h.voice('A8'); const revision = h.data().document.revision;
  h.ui.onDraftEffects?.(selected.id, chorus);
  h.externalSave({ ...selected, effects: slapback, notes: 'External change' });
  h.ui.onExport('json');
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
  assert.equal(h.downloads.length, 1);
  const backup = parseCatalogDocument(JSON.parse(await h.downloads[0].text()));
  assert.equal(backup.revision, revision + 1);
  assert.equal(h.data().document.revision, revision); assert.equal(h.stored().revision, revision + 1);
  assert.deepEqual(h.drafts.configurations().find(item => item.profile === 4)?.effects, chorus);
  await assert.rejects(h.ui.onSave(selected, undefined, revision), CatalogClientConflictError);
  assert.equal(h.errors.length, 0);
});

test('native graph failure reports persisted content without claiming applied audio', async () => {
  const h = await harness(); const selected = h.voice('A8');
  h.failApply(new Error('Worklet unavailable'));
  const result = await h.ui.onSave({ ...selected, effects: slapback }, undefined, h.data().document.revision);
  assert.match(result.message, /Saved locally.*audio preparation failed: Worklet unavailable/);
  assert.doesNotMatch(result.message, /applied to audio/);
  assert.deepEqual(h.voice('A8').effects, slapback); assert.equal(h.applied.length, 1);
  assert.equal(h.controller.busy, false);
});

test('pending persistence locks the view, exposes busy and rejects concurrent saves', async () => {
  const h = await harness(); const selected = h.voice('A8'); const revision = h.data().document.revision;
  const waiting = deferred(); h.block(waiting.promise);
  const saving = h.ui.onSave({ ...selected, effects: slapback }, undefined, revision);
  assert.equal(h.controller.busy, true); assert.equal(h.data().locked, true);
  const writes = h.writes();
  await assert.rejects(h.ui.onSave(selected, undefined, revision), /Stop practice before saving/);
  assert.equal(h.writes(), writes); assert.equal(h.applied.length, 0);
  waiting.finish(); await saving;
  assert.equal(h.controller.busy, false); assert.equal(h.data().locked, false);
  assert.deepEqual(h.busy, [true, false]); assert.equal(h.applied.length, 1);
});

test('performance avatars resolve only saved voices at their exact native profile mapping', async () => {
  const h = await harness();
  const selected = h.voice('A13');
  assert.equal(h.controller.voiceForProfile(0)?.characterId, null);
  await h.ui.onSave({ ...selected, characterId: 'A07', avatarToken: 'blue' }, undefined, h.data().document.revision);
  assert.equal(h.controller.voiceForProfile(0)?.characterId, 'A07');
  assert.equal(h.controller.voiceForProfile(0)?.avatarToken, 'blue');
  assert.equal(h.controller.voiceForProfile(4)?.characterId, null, 'a pad avatar never leaks to live vocals');
  assert.equal(h.controller.voiceForProfile(999), undefined);
});

test('a cue-row connection persists separately from loaded command rows and native effect preparation', async () => {
  const h = await harness();
  const selected = h.voice('A10');
  const binding = h.data().document.bindings.find(binding => binding.voiceId === selected.id); assert(binding);
  const row = h.data().rows.find(row => row.labelCell === 'A10'); assert(row);
  assert.deepEqual(h.data().commandRows?.get(row.key), [18]);
  assert(h.data().cueRows?.some(cue => cue.labelCell === 'A19' && cue.sourceLabel === 'R2'));
  await h.ui.onSave(selected, { ...binding, cueRow: { labelCell: 'A19', sourceLabel: 'R2' } }, h.data().document.revision);
  assert.deepEqual(h.stored().bindings.find(binding => binding.voiceId === selected.id)?.cueRow, { labelCell: 'A19', sourceLabel: 'R2' });
  assert.deepEqual(h.data().commandRows?.get(row.key), [18], 'saving an authoring connection never pretends the loaded native instructions changed');
  assert.deepEqual(h.applied[0]?.find(configuration => configuration.profile === 2)?.effects, []);
});

test('passive audio preparation uses saved custom graphs while an editor draft remains unapplied', async () => {
  const h = await harness();
  const voice = h.voice('A8');
  await h.ui.onSave({ ...voice, effects: slapback }, undefined, h.data().document.revision);
  h.ui.onDraftEffects?.(voice.id, chorus);
  assert.deepEqual(structuredClone(h.controller.savedConfigurations().find(item => item.profile === 4)?.effects), slapback);
  assert.deepEqual(h.drafts.configurations().find(item => item.profile === 4)?.effects, chorus);
  const copy = h.controller.savedConfigurations();
  assert.notEqual(copy.find(item => item.profile === 4)?.effects, h.voice('A8').effects, 'the startup bundle cannot mutate the saved catalog');
});
