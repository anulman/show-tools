import { readFileSync } from 'node:fs';
import { summarizeCapture } from '../capture.js';

if (process.argv.length !== 3) {
  console.error('Usage: node --import tsx lib/peripherals/scripts/summarize.ts <probe.ndjson>');
  process.exitCode = 2;
} else {
  try { console.log(JSON.stringify(summarizeCapture(readFileSync(process.argv[2], 'utf8')), null, 2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
