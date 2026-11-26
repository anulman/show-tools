import { parentPort, workerData } from 'node:worker_threads';
import type { ChartPreparation, ChartPreparationResult } from './prepare-chart.js';
import { prepareSongBindings } from './song-bindings.js';

const request: ChartPreparation = workerData;
const result = await prepareSongBindings(request.entry, request.bindings, request.musicXml);
parentPort?.postMessage({
  song: result.installed.song, defaultVoiceEffects: result.installed.defaultVoiceEffects,
  packageDigest: result.packageDigest, chartVersion: result.chart.chartVersion,
} satisfies ChartPreparationResult);
