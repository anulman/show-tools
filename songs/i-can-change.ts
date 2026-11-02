import { readMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { readBundledMusicXml } from './load-musicxml.js';
import { compileChartControls } from '../lib/performance/chart-controls.js';
import type { SongScript } from '../lib/performance/model.js';

const { song: { chart } } = await readMusicXmlSong(await readBundledMusicXml('i-can-change'));

export default {
  id: 'i-can-change',
  chart,
  program: { lengthBeats: 4, events: [], controls: compileChartControls(chart) },
  practice: { startBar: 1, endBar: 16 },
  description: 'Chart-driven controls. This chart has no filled pad cues yet; sample slots start empty.',
} satisfies SongScript;
