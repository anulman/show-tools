import source from './i-can-change.chart.json';
import { parseChart } from '../lib/performance/chart.js';
import { compileChartControls } from '../lib/performance/chart-controls.js';
import type { SongScript } from '../lib/performance/model.js';

const chart = parseChart(source);

export default {
  id: 'i-can-change',
  chart,
  program: { lengthBeats: 4, events: [], controls: compileChartControls(chart) },
  practice: { startBar: 1, endBar: 16 },
  description: 'Chart-driven controls. This chart has no filled pad cues yet; sample slots start empty.',
} satisfies SongScript;
