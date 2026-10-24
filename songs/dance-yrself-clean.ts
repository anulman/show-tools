import source from './dance-yrself-clean.chart.json';
import { parseChart } from '../lib/performance/chart.js';
import { compileChartControls, parseControlCue } from '../lib/performance/chart-controls.js';
import type { BarPlaybackCue, SongScript } from '../lib/performance/model.js';

const chart = parseChart(source);
const controls = compileChartControls(chart, [
  { id: 'R2', bar: 2, capture: { kind: 'bar', variantKey: 'cowbell-double' } },
  { id: 'R2', bar: 3, capture: { kind: 'bar', variantKey: 'cowbell-single' } },
]);
const cowbell = source.values.find(row => row[0] === 'AF - Cowbell');
const barPlayback: BarPlaybackCue[] = [];
for (const bar of chart.bars) {
  if (bar.bar < 5) continue;
  const phrase = parseControlCue(cowbell?.[bar.column - 1] || '');
  if (phrase.kind !== 'tap') continue;
  barPlayback.push({ bar: bar.bar, channelId: 'R2', variantKey: phrase.beats.length > 1 ? 'cowbell-double' : 'cowbell-single' });
  if (controls.bars[bar.bar - 1].R2.kind === 'tap') controls.bars[bar.bar - 1].R2 = { kind: 'none' };
}

export default {
  id: 'dance-yrself-clean',
  chart,
  program: {
    lengthBeats: 4, events: [],
    controls, barPlayback,
  },
  practice: { startBar: 1, endBar: 76 },
  description: 'Chart-driven capture and playback. Press a pad to perform its cue in the active column.',
} satisfies SongScript;
