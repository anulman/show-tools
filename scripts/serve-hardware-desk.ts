import { readFile } from 'node:fs/promises';
import { serveProfile } from '../lib/remote-performance/server.js';
import { decodeSessionProfile } from '../lib/remote-performance/session-profile.js';

if (process.argv.length !== 4 || process.argv[2] !== '--profile') throw new Error('Usage: server --profile FILE');
const app = await serveProfile(decodeSessionProfile(JSON.parse(await readFile(process.argv[3], 'utf8'))));
const stop = () => { void app.close().catch(() => { process.exitCode = 1; }); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
