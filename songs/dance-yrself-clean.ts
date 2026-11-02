import { musicXmlSourceView } from '../lib/performance/musicxml-source-view.js';
import { readMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { readBundledMusicXml } from './load-musicxml.js';
import type { SongScript } from '../lib/performance/model.js';

const document = await readMusicXmlSong(await readBundledMusicXml('dance-yrself-clean'));
const compiled = document.song;

export default {
  voiceMetadata: document.voices ?? undefined,
  id: compiled.id,
  chart: compiled.chart,
  program: { lengthBeats: compiled.chart.beatsPerBar, events: [] },
  compiled,
  source: musicXmlSourceView(document),
  practice: { startBar: 1, endBar: compiled.chart.bars.length },
  description: compiled.executable
    ? 'Chart compiled from MusicXML. Native capture, layers, variants, and effects.'
    : 'Chart inspection needs authoring decisions. Open Chart source & inspection below.',
} satisfies SongScript;
