import defaultMapping from '../../songs/dance-yrself-clean.mapping.json';
import defaultSource from '../../songs/dance-yrself-clean.source.json';
import { compileSong, decodeCompiledSong, decodeSongMapping, inspectCompiledSong, canonicalSongJson } from '../../lib/performance/compiled-song.js';
import type { CompiledSong, SongMapping } from '../../lib/performance/compiled-song.js';
import { fetchSongSource, parseSongSource, canonicalSourceJson } from '../../lib/performance/song-source.js';
import type { SongSource } from '../../lib/performance/song-source.js';

type PanelOptions = { resolveMapping?: (source: SongSource, mapping: SongMapping) => SongMapping; isBusy: () => boolean; onLoad: (song: CompiledSong, source?: SongSource) => Promise<void> };
type Work = 'idle' | 'fetching' | 'reading' | 'compiling' | 'loading';

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
  details.append(element('summary', 'Chart source, compiler & inspection'));
  const introduction = element('p', 'Fetch a public worksheet or import frozen source, then inspect the exact program before loading it. Changes stay staged while practice runs.');
  introduction.className = 'effects-note';
  const url = element('input');
  url.type = 'url';
  url.value = `https://docs.google.com/spreadsheets/d/${defaultMapping.spreadsheetId}/edit#gid=${defaultMapping.sheetId}`;
  url.autocomplete = 'off';
  const refresh = button('Fetch latest & inspect');
  const sourceFile = element('input');
  sourceFile.type = 'file'; sourceFile.accept = '.json,application/json';
  const artifactFile = element('input');
  artifactFile.type = 'file'; artifactFile.accept = '.json,application/json';
  const files = element('div');
  files.className = 'effects-controls';
  files.append(label('IMPORT FROZEN SOURCE JSON', sourceFile), label('IMPORT COMPILED SONG JSON', artifactFile));
  const mapping = element('textarea');
  mapping.value = JSON.stringify(defaultMapping, null, 2);
  mapping.rows = 12;
  mapping.spellcheck = false;
  mapping.style.width = '100%';
  mapping.style.boxSizing = 'border-box';
  const compile = button('Compile & inspect');
  const load = button('Load staged song');
  const downloadSong = button('Download timing JSON');
  const downloadSource = button('Download source JSON');
  const actions = element('div');
  actions.className = 'effects-controls';
  actions.append(compile, load, downloadSong, downloadSource);
  const libraryNote = element('p'); libraryNote.className = 'effects-note';
  libraryNote.textContent = 'Song exports contain timing instructions. Export the voice library separately to keep effects and characters.';
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
    label('EXPLICIT CHART MAPPING JSON', mapping), actions, libraryNote, status, sourceStatus, report);
  root.replaceChildren(details);

  let source: SongSource | null = parseSongSource(defaultSource);
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
    downloadSong.disabled = !staged;
    downloadSource.disabled = !source;
    sourceStatus.textContent = source
      ? `Source ready. ${source.sheetName}, gid ${source.sheetId}, ${Object.keys(source.notes).length} cell notes.`
      : 'This artifact contains no source cells. Fetch or import frozen source to recompile or download its source.';
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
      ? `Public fetch failed. ${message} If the browser blocks this request, fetch through the CLI and import its frozen source JSON here.`
      : message;
  }

  function finish(value: number) {
    if (!current(value)) return;
    work = 'idle';
    fetchController = undefined;
    renderControls();
  }

  async function compileSource(nextSource: SongSource, mappingText: string, value: number) {
    const input = decodeSongMapping(JSON.parse(mappingText));
    const resolved = options.resolveMapping?.(nextSource, input) ?? input;
    const song = await compileSong(nextSource, resolved);
    if (!current(value)) return;
    source = nextSource;
    mapping.value = JSON.stringify(resolved, null, 2);
    setStaged(song);
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
        await compileSource(nextSource, mappingText, value);
      } catch (error) { failed(error, value, true); }
      finally { finish(value); }
    })();
  }, { signal: listeners.signal });

  compile.addEventListener('click', () => {
    if (!source) return;
    const nextSource = source;
    const mappingText = mapping.value;
    const value = begin('compiling');
    status.textContent = 'Compiling the frozen source…';
    void compileSource(nextSource, mappingText, value).catch(error => failed(error, value)).finally(() => finish(value));
  }, { signal: listeners.signal });

  sourceFile.addEventListener('change', () => {
    const file = sourceFile.files?.[0];
    if (!file) return;
    const mappingText = mapping.value;
    const value = begin('reading');
    status.textContent = `Reading frozen source ${file.name}…`;
    void (async () => {
      try { await compileSource(parseSongSource(JSON.parse(await file.text())), mappingText, value); }
      catch (error) { failed(error, value); }
      finally { sourceFile.value = ''; finish(value); }
    })();
  }, { signal: listeners.signal });

  artifactFile.addEventListener('change', () => {
    const file = artifactFile.files?.[0];
    if (!file) return;
    const value = begin('reading');
    status.textContent = `Reading compiled song ${file.name}…`;
    void (async () => {
      try {
        const song = decodeCompiledSong(JSON.parse(await file.text()));
        if (!current(value)) return;
        source = null;
        setStaged(song);
      } catch (error) { failed(error, value); }
      finally { artifactFile.value = ''; finish(value); }
    })();
  }, { signal: listeners.signal });

  mapping.addEventListener('input', () => {
    staged = null;
    report.textContent = '';
    status.textContent = 'Mapping changed. Compile and inspect it before loading.';
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
        await options.onLoad(song, source ?? undefined);
        if (current(value)) status.textContent = `Loaded ${song.title}. Start practice when ready.`;
      } catch (error) { failed(error, value); }
      finally { finish(value); }
    })();
  }, { signal: listeners.signal });

  function download(text: string, filename: string) {
    const address = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    downloads.add(address);
    const link = element('a');
    link.href = address; link.download = filename;
    root.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(address); downloads.delete(address); }, 0);
  }
  downloadSong.addEventListener('click', () => {
    if (staged) download(canonicalSongJson(staged), `${staged.id}.performance.json`);
  }, { signal: listeners.signal });
  downloadSource.addEventListener('click', () => {
    if (source) download(canonicalSourceJson(source), 'worksheet.source.json');
  }, { signal: listeners.signal });

  const initialGeneration = begin('compiling');
  status.textContent = 'Inspecting the bundled frozen DYC source…';
  void compileSource(source, mapping.value, initialGeneration).catch(error => failed(error, initialGeneration)).finally(() => finish(initialGeneration));

  return {
    show(input) {
      if (disposed) return;
      const song = decodeCompiledSong(input);
      fetchController?.abort();
      generation++;
      work = 'idle';
      source = null;
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
