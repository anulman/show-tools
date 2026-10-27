import source from './dance-yrself-clean.source.json';
import mapping from './dance-yrself-clean.mapping.json';
import { compileSong } from '../lib/performance/compiled-song.js';
import type { SongScript } from '../lib/performance/model.js';

const compiled = await compileSong(source, mapping);

export default {
  id: compiled.id,
  chart: compiled.chart,
  program: { lengthBeats: compiled.chart.beatsPerBar, events: [] },
  compiled,
  practice: { startBar: mapping.startBar, endBar: mapping.endBar },
  description: compiled.executable
    ? 'Chart-compiled A section. Native capture, layers, variants, and effects.'
    : 'Chart inspection needs authoring decisions. Open Chart source & inspection below.',
} satisfies SongScript;
