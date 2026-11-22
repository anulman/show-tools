import { snapshotSongVoices, mergeSongVoices } from '../../lib/voice-catalog/song-snapshot.js';
import type { CompiledSong } from '../../lib/performance/compiled-song.js';
import { applyCatalogCueRows } from '../../lib/voice-catalog/cue-mapping.js';
import type { SongMapping } from '../../lib/performance/compiled-song.js';
import type { SongSource } from '../../lib/performance/song-source.js';
import registry from '../../assets/video/characters.json';
import type { SongScript, PracticeState, LiveEffectDefinition, VoiceEffectConfiguration } from '../../lib/performance/model.js';
import { parseCatalogDocument, type CatalogDocument, type Voice, type SheetBinding } from '../../lib/voice-catalog/model.js';
import { discoverSheetVoices, discoverCueRows, loadedCommandRows, type SheetCueRow, type SheetVoiceRow } from '../../lib/voice-catalog/sheet-voices.js';
import { reconcileCatalog, resolveVoice, withVoice } from '../../lib/voice-catalog/session.js';
import { createCatalogClient, CatalogClientConflictError, type CatalogClient } from './catalog-client.js';
import { installVoiceLibrary } from './voice-library.js';
import { initialVoiceEffects, type createVoiceEffectsEditor } from './voice-effects.js';

type Drafts = ReturnType<typeof createVoiceEffectsEditor>;
export function installVoiceCatalog(root: HTMLElement, options: {
  drafts: Drafts;
  remote?: boolean;
  assetBase?: URL;
  signal?: AbortSignal;
  apply: (configurations: readonly VoiceEffectConfiguration[]) => Promise<void>;
  isBusy: () => boolean;
  onError: (error: unknown) => void;
  onBusyChange: () => void;
}) {
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([lifetime.signal, options.signal]) : lifetime.signal;
  let client: CatalogClient | undefined;
  let document: CatalogDocument = { version: 2, revision: 0, voices: [], bindings: [] };
  let rows: SheetVoiceRow[] = [];
  let cueRows: SheetCueRow[] = [];
  let commandRows = new Map<string, readonly number[]>();
  let availability: string | undefined = 'Opening local voice library…';
  let current: Pick<PracticeState, 'bar' | 'voiceEffects'> = { bar: null };
  let pendingSave = false;
  let effectMode: 'compiled' | 'dry' = 'compiled';
  let loadedDigest: string | undefined;
  let sourceProfiles: readonly number[] = [];
  function savedConfigurations(): readonly VoiceEffectConfiguration[] {
    return initialVoiceEffects(effectMode, sourceProfiles).map(configuration => {
      const row = rows.find(row => row.profile === configuration.profile);
      return { ...configuration, effects: (row ? resolveVoice(document, row)?.effects ?? configuration.effects : configuration.effects).map(effect => ({ ...effect })) };
    });
  }
  const ui = installVoiceLibrary(root, {
    characters: registry.characters.map(character => ({ ...character,
      publishedAvatarPath: 'publishedAvatarPath' in character ? new URL('./' + character.publishedAvatarPath, options.assetBase ?? window.document.baseURI).pathname : undefined,
    })),
    onSave: save,
    onExport: format => { void exportLibrary(format).catch(options.onError); },
    onImport: async file => {
      if (options.isBusy()) throw new Error('Stop practice before importing a library.');
      if (pendingSave) throw new Error('Wait for the current library save.');
      pendingSave = true; options.onBusyChange(); update(current);
      try {
        const imported = parseCatalogDocument(JSON.parse(await file.text()));
        await persist(imported);
        loadDrafts(); update(current);
      } finally { pendingSave = false; options.onBusyChange(); update(current); }
    },
    onDraftEffects: (id, effects) => {
      for (const row of rows) if (row.profile !== null && resolveVoice(document, row)?.id === id) options.drafts.setEffects(row.profile, effects);
    },
    getDraftEffects: id => {
      const row = rows.find(row => resolveVoice(document, row)?.id === id && row.profile !== null);
      return row ? options.drafts.configurations().find(item => item.profile === row.profile)?.effects ?? [] : document.voices.find(voice => voice.id === id)?.effects ?? [];
    },
  });
  const ready = options.remote ? Promise.resolve().then(() => { availability = 'Voice library is unavailable in remote mode.'; })
    : createCatalogClient({ assetBase: options.assetBase, signal }).then(async value => {
      client = value; document = await value.snapshot(); availability = undefined;
    }).catch(error => {
      client?.close(); client = undefined;
      if (!signal.aborted) availability = `Voice library unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }).finally(() => { if (!signal.aborted) update(current); });
  function update(state: Pick<PracticeState, 'bar' | 'voiceEffects'>) {
    current = state;
    ui.update({ document, rows, cueRows, commandRows, state, locked: options.isBusy() || pendingSave, availability });
  }
  async function persist(next: CatalogDocument) {
    if (!client) throw new Error(availability || 'Voice library unavailable.');
    try { document = await client.replace(next, document.revision); }
    catch (error) {
      if (error instanceof CatalogClientConflictError) { document = await client.snapshot(); loadDrafts(); update(current); }
      throw error;
    }
    update(current);
  }
  function loadDrafts() {
    for (const row of rows) {
      const voice = resolveVoice(document, row);
      if (row.profile !== null) options.drafts.setEffects(row.profile, voice?.effects ?? []);
    }
  }
  async function save(voice: Voice, binding: SheetBinding | undefined, expectedRevision: number): Promise<{ message: string }> {
    if (expectedRevision !== document.revision) throw new Error('The library changed. Close and reopen this voice before saving.');
    if (options.isBusy() || pendingSave) throw new Error('Stop practice before saving voice effects.');
    pendingSave = true; options.onBusyChange(); update(current);
    try {
      await persist(withVoice(document, voice, binding));
      const profiles = rows.flatMap(row => row.profile !== null && resolveVoice(document, row)?.id === voice.id ? [row.profile] : []);
      for (const profile of profiles) options.drafts.setEffects(profile, voice.effects);
      if (!profiles.length) return { message: 'Saved locally · no audio input assigned.' };
      try {
        const configurations = savedConfigurations();
        await options.apply(configurations); return { message: 'Saved locally · effects applied to audio.' }; }
      catch (error) { return { message: `Saved locally · audio preparation failed: ${error instanceof Error ? error.message : String(error)}` }; }
    } finally { pendingSave = false; options.onBusyChange(); update(current); }
  }
  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob); const link = window.document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportLibrary(format: 'json' | 'sqlite') {
    if (!client) throw new Error(availability || 'Voice library unavailable.');
    if (format === 'sqlite') {
      const bytes = await client.exportBytes();
      download(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.sqlite3' }), 'show-tools-voices.sqlite');
    } else {
      const latest = await client.snapshot();
      download(new Blob([JSON.stringify(latest, null, 2) + '\n'], { type: 'application/json' }), 'show-tools-voices.json');
    }
  }
  return {
    get busy() { return pendingSave; },
    update,
    savedConfigurations,
    async exportSongVoices(song: CompiledSong, source: SongSource) {
      await ready;
      const latest = loadedDigest === song.source.digest || !client ? document : await client.snapshot();
      const defaults = new Map(initialVoiceEffects('compiled', song.sourceProfiles?.map(source => source.profile)).map(item => [item.profile, item.effects]));
      return snapshotSongVoices(latest, discoverSheetVoices(song, source), defaults);
    },
    async load(song: SongScript) {
      await ready;
      signal.throwIfAborted();
      effectMode = song.compiled ? 'compiled' : 'dry';
      sourceProfiles = song.compiled?.sourceProfiles?.map(source => source.profile) ?? [];
      rows = song.compiled ? discoverSheetVoices(song.compiled, song.source) : [];
      cueRows = song.compiled ? discoverCueRows(song.compiled, song.source) : [];
      commandRows = new Map(rows.map(row => [row.key, song.compiled && row.partId ? loadedCommandRows(song.compiled, row.partId) : []]));
      loadedDigest = song.compiled?.source.digest;
      if (client) document = await client.snapshot();
      const defaults = new Map(initialVoiceEffects(song.compiled ? 'compiled' : 'dry', sourceProfiles).map(item => [item.profile, item.effects]));
      let next = reconcileCatalog(document, rows, defaults, () => crypto.randomUUID());
      if (song.voiceMetadata) next = mergeSongVoices(next, song.voiceMetadata, rows);
      if (client && next !== document) {
        try { await persist(next); }
        catch (error) {
          document = next;
          availability = 'Song assignments are active for this session. The local library save failed.';
          options.onError(error);
        }
      } else document = next;
      loadDrafts();
      update(current);
    },
    cueMapping(source: SongSource, mapping: SongMapping) { return applyCatalogCueRows(document, source, mapping); },
    voiceForProfile(profile: number) {
      const row = rows.find(row => row.profile === profile);
      return row ? resolveVoice(document, row) : undefined;
    },
    openProfile(profile: number) {
      const row = rows.find(row => row.profile === profile);
      const voice = row && resolveVoice(document, row);
      if (voice) ui.openVoice(voice.id);
      else options.onError(new Error(availability || 'This source row needs its saved mapping reviewed in Manage voices.'));
    },
    async saveDrafts() {
      if (!client) return; // Audio remains usable when local storage is unavailable; the notice stays visible.
      let next = document;
      for (const row of rows) {
        const voice = resolveVoice(document, row);
        if (voice && row.profile !== null) {
          const effects: readonly LiveEffectDefinition[] = options.drafts.configurations().find(item => item.profile === row.profile)?.effects ?? [];
          next = withVoice(next, { ...voice, effects });
        }
      }
      await persist(next);
    },
    dispose() { lifetime.abort(); client?.close(); ui.dispose(); },
  };
}
