import source from './dance-yrself-clean.chart.json';
import { parseChart } from '../lib/performance/chart.js';
import { compileChartControls } from '../lib/performance/chart-controls.js';
import type { SongScript } from '../lib/performance/model.js';

const chart = parseChart(source);

export default {
  id: 'dance-yrself-clean',
  chart,
  program: {
    lengthBeats: 4, events: [],
    controls: compileChartControls(chart, [
      { id: 'R2', bar: 2, capture: { kind: 'sparse', beats: [3.5, 3.75], radiusBeats: 0.2 } },
      { id: 'R2', bar: 3, capture: { kind: 'sparse', beats: [3.5], radiusBeats: 0.2 } },
    ]),
  },
  practice: { startBar: 1, endBar: 76 },
  description: 'Chart-driven capture and playback. Press a pad to perform its cue in the active column.',
} satisfies SongScript;
