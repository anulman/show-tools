import { Schema } from 'effect';
import type { SongScript } from '../lib/performance/model.js';
import type { MusicXmlSong } from '../lib/performance/musicxml-song.js';
import { musicXmlSourceView } from '../lib/performance/musicxml-source-view.js';
import { practiceAssetBase } from '../lib/remote-performance/desk-paths.js';

const NodeFiles = Schema.Struct({ readFile: Schema.declare((value): value is (url: URL, encoding: 'utf8') => Promise<string> => typeof value === 'function') });

export async function readBundledMusicXml(id: string, assetBase?: URL): Promise<string> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Invalid bundled song identity.');
  const directory = new URL('.', import.meta.url);
  if (directory.protocol === 'file:') {
    const source = new URL(`${id}.musicxml`, directory);
    const moduleName = 'node:fs/promises';
    const module: unknown = await import(moduleName);
    return Schema.decodeUnknownSync(NodeFiles)(module).readFile(source, 'utf8');
  }
  const response = await fetch(new URL(`./songs/${id}.musicxml`, assetBase ?? practiceAssetBase(document.baseURI)));
  if (!response.ok) throw new Error(`Cannot load ${id} MusicXML (${response.status}).`);
  return response.text();
}


export function musicXmlSongScript(document: MusicXmlSong, endBar = document.song.chart.bars.length): SongScript {
  const compiled = document.song;
  const timingOnly = !compiled.executable && !compiled.diagnostics.length && !compiled.cues.length
    && !compiled.takes.length && !compiled.voices.length && !compiled.parts.length
    && !compiled.selections.length && !compiled.playback.length && compiled.rotation === null && compiled.cueWindow === null
    && Object.values(compiled.chart.leadInCues).every(cue => !cue.trim())
    && compiled.chart.bars.every(bar => Object.values(bar.cues).every(cue => !cue.trim()));
  return {
    voiceMetadata: document.voices ?? undefined,
    id: compiled.id,
    chart: compiled.chart,
    program: { lengthBeats: compiled.chart.beatsPerBar, events: [] },
    ...(timingOnly ? {} : { compiled }),
    source: musicXmlSourceView(document),
    practice: { startBar: 1, endBar },
    description: compiled.executable
      ? 'Chart compiled from MusicXML. Native capture, layers, variants, and effects.'
      : timingOnly ? 'Timing-only chart. No authored performance instructions; sample slots start empty.'
        : 'Chart inspection needs authoring decisions. Open Chart source & inspection below.',
  };
}
