import { Worker } from 'node:worker_threads';
import type { InputBindings } from '../performance/input-bindings.js';
import type { SongPreview } from './session-schema.js';
import type { InstalledSong } from './song-catalog.js';

export interface ChartPreparation {
  readonly entry: InstalledSong;
  readonly bindings: InputBindings;
  readonly musicXml: string;
}

export type ChartPreparationResult = SongPreview & { readonly chartVersion: string };

export async function prepareChart(request: ChartPreparation): Promise<ChartPreparationResult> {
  const entry = new URL(import.meta.url.endsWith('.mjs') ? './chart-worker.mjs' : './chart-worker.ts', import.meta.url);
  const worker = new Worker(entry, { workerData: request });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Chart validation timed out')), 15_000);
      worker.once('message', resolve);
      worker.once('messageerror', reject);
      worker.once('error', reject);
      worker.once('exit', () => reject(new Error('Chart validation exited without a result')));
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
