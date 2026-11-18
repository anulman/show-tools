import { musicXmlSourceView } from '../../lib/performance/musicxml-source-view.js';
import defaultMapping from '../../songs/dance-yrself-clean.mapping.json';
import { readBundledMusicXml } from '../../songs/load-musicxml.js';
import { readMusicXmlSong } from '../../lib/performance/musicxml-song.js';
import { importSheetMusicXml } from '../../lib/performance/sheet-musicxml.js';
import { decodeCompiledSong, decodeSongMapping, inspectCompiledSong } from '../../lib/performance/compiled-song.js';
import type { CompiledSong, SongMapping } from '../../lib/performance/compiled-song.js';
import { fetchSongSource, parseSongSource, canonicalSourceJson } from '../../lib/performance/song-source.js';
import type { CatalogDocument } from '../../lib/voice-catalog/model.js';
import type { SongSource } from '../../lib/performance/song-source.js';

type PanelOptions = { resolveMapping?: (source: SongSource, mapping: SongMapping) => SongMapping; exportMusicXml?: (xml: string) => Promise<string>; isBusy: () => boolean; onLoad: (song: CompiledSong, source: SongSource | undefined, voices: CatalogDocument | null) => Promise<void> };
type Work = 'idle' | 'fetching' | 'reading' | 'compiling' | 'loading' | 'exporting';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string): HTMLButtonElement {
  const node = element('button', text);
  node.type = 'button';
  node.className = 'secondary';
  return node;
}

function label(text: string, control: HTMLElement): HTMLLabelElement {
  const node = element('label');
  node.className = 'field';
  node.append(element('span', text), control);
  return node;
}

export function installChartPanel(root: HTMLElement, options: PanelOptions): { show: (song: CompiledSong) => void; dispose: () => void } {
  const details = element('details');
  details.className = 'chart-compiler';
  details.append(element('summary', 'MusicXML song & inspection'));
  const introduction = element('p', 'Import a MusicXML song or fetch a public worksheet into MusicXML, then inspect the exact program before loading it. Changes stay staged while practice runs.');
  introduction.className = 'effects-note';
  const url = element('input');
  url.type = 'url';
  url.value = `https://docs.google.com/spreadsheets/d/${defaultMapping.spreadsheetId}/edit#gid=${defaultMapping.sheetId}`;
  url.autocomplete = 'off';
  const refresh = button('Fetch latest & inspect');
  const sourceFile = element('input');
  sourceFile.type = 'file'; sourceFile.accept = '.json,application/json';
  const artifactFile = element('input');
  artifactFile.type = 'file'; artifactFile.accept = '.musicxml,.xml,application/vnd.recordare.musicxml+xml,application/xml,text/xml';
  const files = element('div');
  files.className = 'effects-controls';
  files.append(label('IMPORT SHEETS SNAPSHOT JSON', sourceFile), label('IMPORT MUSICXML SONG', artifactFile));
  const mapping = element('textarea');
  mapping.value = JSON.stringify(defaultMapping, null, 2);
  mapping.rows = 12;
  mapping.spellcheck = false;
  mapping.style.width = '100%';
  mapping.style.boxSizing = 'border-box';
  const compile = button('Reimport worksheet snapshot');
  const load = button('Load staged song');
  const downloadSong = button('Download MusicXML');
  const downloadSource = button('Download worksheet archive');
  const actions = element('div');
  actions.className = 'effects-controls';
  actions.append(compile, load, downloadSong, downloadSource);
  const libraryNote = element('p'); libraryNote.className = 'effects-note';
  libraryNote.textContent = 'MusicXML song exports include the current song’s saved effects and character assignments. The voice library backup preserves the complete library.';
  const status = element('p');
  status.className = 'effects-note';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const sourceStatus = element('p');
  sourceStatus.className = 'effects-note';
  const report = element('pre');
  report.tabIndex = 0;
  report.setAttribute('aria-label', 'Compiled song inspection report');
  report.style.whiteSpace = 'pre-wrap';
  report.style.overflowWrap = 'anywhere';
  details.append(introduction, label('PUBLIC WORKSHEET URL', url), refresh, files,
    label('SHEETS IMPORT CONFIGURATION JSON', mapping), actions, libraryNote, status, sourceStatus, report);
  root.replaceChildren(details);

  let source: SongSource | null = null;
  let musicXml: string | null = null;
  let stagedSource: SongSource | null = null;
  let stagedVoices: CatalogDocument | null = null;
  let staged: CompiledSong | null = null;
  let work: Work = 'idle';
  let generation = 0;
  let disposed = false;
  let fetchController: AbortController | undefined;
  const listeners = new AbortController();
  const downloads = new Set<string>();

  function renderControls() {
    const working = work !== 'idle';
    url.disabled = working;
    mapping.disabled = working;
    sourceFile.disabled = working;
    artifactFile.disabled = working;
    compile.disabled = working || !source;
    load.disabled = working || !staged?.executable;
    refresh.disabled = working && work !== 'fetching';
    downloadSong.disabled = working || !musicXml;
    downloadSource.disabled = !source;
    sourceStatus.textContent = source
      ? `Worksheet archive available. ${source.sheetName}, gid ${source.sheetId}, ${Object.keys(source.notes).length} cell notes.`
      : 'This MusicXML has no archived worksheet. Import and playback use its canonical song data.';
  }

  function setStaged(song: CompiledSong) {
    staged = song;
    report.textContent = inspectCompiledSong(song);
    const errors = song.diagnostics.filter(item => item.severity === 'error').length;
    status.textContent = song.executable
      ? `Staged ${song.title}. Inspect the report, then load while practice is stopped.`
      : `Staged draft. ${errors} unresolved ${errors === 1 ? 'error blocks' : 'errors block'} audio loading. See the source-located report.`;
    renderControls();
  }

  function begin(next: Exclude<Work, 'idle'>): number {
    fetchController?.abort();
    fetchController = undefined;
    work = next;
    const current = ++generation;
    renderControls();
    return current;
  }

  function current(value: number): boolean { return !disposed && value === generation; }

  function failed(error: unknown, value: number, publicFetch = false) {
    if (!current(value)) return;
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = publicFetch
      ? `Public fetch failed. ${message} If the browser blocks this request, fetch through the CLI and import its MusicXML file here.`
      : message;
  }

  function finish(value: number) {
    if (!current(value)) return;
    work = 'idle';
    fetchController = undefined;
    renderControls();
  }

  async function importSource(nextSource: SongSource, mappingText: string, value: number) {
    const input = decodeSongMapping(JSON.parse(mappingText));
    const resolved = options.resolveMapping?.(nextSource, input) ?? input;
    const converted = await importSheetMusicXml({ source: nextSource, mapping: resolved });
    const document = await readMusicXmlSong(converted.xml);
    if (!current(value)) return;
    source = nextSource;
    musicXml = converted.xml;
    stagedSource = musicXmlSourceView(document);
    stagedVoices = document.voices;
    mapping.value = JSON.stringify(resolved, null, 2);
    setStaged(document.song);
  }

  refresh.addEventListener('click', () => {
    const worksheetUrl = url.value.trim();
    const mappingText = mapping.value;
    const value = begin('fetching');
    const controller = new AbortController();
    fetchController = controller;
    status.textContent = 'Fetching current worksheet values and cell notes…';
    void (async () => {
      try {
        const frozenMapping = decodeSongMapping(JSON.parse(mappingText));
        const nextSource = await fetchSongSource(worksheetUrl, { signal: controller.signal, sheetName: frozenMapping.sheetName });
        await importSource(nextSource, mappingText, value);
      } catch (error) { failed(error, value, true); }
      finally { finish(value); }
    })();
  }, { signal: listeners.signal });

  compile.addEventListener('click', () => {
    if (!source) return;
    const nextSource = source;
    const mappingText = mapping.value;
    const value = begin('compiling');
    status.textContent = 'Importing the worksheet snapshot into MusicXML…';
    void importSource(nextSource, mappingText, value).catch(error => failed(error, value)).finally(() => finish(value));
  }, { signal: listeners.signal });

  sourceFile.addEventListener('change', () => {
    const file = sourceFile.files?.[0];
    if (!file) return;
    const mappingText = mapping.value;
    const value = begin('reading');
    status.textContent = `Reading worksheet snapshot ${file.name}…`;
    void (async () => {
      try { await importSource(parseSongSource(JSON.parse(await file.text())), mappingText, value); }
      catch (error) { failed(error, value); }
      finally { sourceFile.value = ''; finish(value); }
    })();
  }, { signal: listeners.signal });

  artifactFile.addEventListener('change', () => {
    const file = artifactFile.files?.[0];
    if (!file) return;
    const value = begin('reading');
    status.textContent = `Reading MusicXML song ${file.name}…`;
    void (async () => {
      try {
        const text = await file.text();
        const document = await readMusicXmlSong(text);
        if (!current(value)) return;
        source = document.source;
        musicXml = text;
        stagedSource = musicXmlSourceView(document);
        stagedVoices = document.voices;
        setStaged(document.song);
      } catch (error) { failed(error, value); }
      finally { artifactFile.value = ''; finish(value); }
    })();
  }, { signal: listeners.signal });

  mapping.addEventListener('input', () => {
    staged = null;
    musicXml = null;
    report.textContent = '';
    status.textContent = 'Sheets import configuration changed. Reimport and inspect the worksheet snapshot before loading.';
    renderControls();
  }, { signal: listeners.signal });

  load.addEventListener('click', () => {
    if (!staged?.executable || work !== 'idle') return;
    if (options.isBusy()) { status.textContent = 'Stop practice and finish the recording export before loading a staged song.'; return; }
    const song = staged;
    const value = begin('loading');
    status.textContent = `Loading ${song.title}…`;
    void (async () => {
      try {
        if (options.isBusy()) throw new Error('Practice became busy. The staged song was not loaded.');
        await options.onLoad(song, stagedSource ?? undefined, stagedVoices);
        if (current(value)) status.textContent = `Loaded ${song.title}. Start when ready.`;
      } catch (error) { failed(error, value); }
      finally { finish(value); }
    })();
  }, { signal: listeners.signal });

  function download(text: string, filename: string, type: string) {
    const address = URL.createObjectURL(new Blob([text], { type }));
    downloads.add(address);
    const link = element('a');
    link.href = address; link.download = filename;
    root.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(address); downloads.delete(address); }, 0);
  }
  downloadSong.addEventListener('click', () => {
    if (!staged || !musicXml || work !== 'idle') return;
    const text = musicXml, filename = `${staged.id}.musicxml`;
    const value = begin('exporting');
    status.textContent = 'Preparing the MusicXML song and saved voice assignments…';
    void (async () => {
      const exported = options.exportMusicXml ? await options.exportMusicXml(text) : text;
      if (!current(value)) return;
      download(exported, filename, 'application/vnd.recordare.musicxml+xml;charset=utf-8');
      status.textContent = 'MusicXML song prepared for download.';
    })().catch(error => failed(error, value)).finally(() => finish(value));
  }, { signal: listeners.signal });
  downloadSource.addEventListener('click', () => {
    if (source) download(canonicalSourceJson(source), 'worksheet.source.json', 'application/json;charset=utf-8');
  }, { signal: listeners.signal });

  const initialGeneration = begin('reading');
  status.textContent = 'Inspecting the bundled DYC MusicXML…';
  void (async () => {
    const text = await readBundledMusicXml('dance-yrself-clean');
    const document = await readMusicXmlSong(text);
    if (!current(initialGeneration)) return;
    source = document.source;
    musicXml = text;
    stagedSource = musicXmlSourceView(document);
    stagedVoices = document.voices;
    setStaged(document.song);
  })().catch(error => failed(error, initialGeneration)).finally(() => finish(initialGeneration));

  return {
    show(input) {
      if (disposed) return;
      const song = decodeCompiledSong(input);
      fetchController?.abort();
      generation++;
      work = 'idle';
      source = null;
      musicXml = null;
      stagedSource = null;
      stagedVoices = null;
      setStaged(song);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      fetchController?.abort();
      listeners.abort();
      for (const address of downloads) URL.revokeObjectURL(address);
      downloads.clear();
      details.remove();
    },
  };
}
