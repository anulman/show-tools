import { mkdir, readFile } from 'node:fs/promises';
import { createUiBroker } from './broker.js';
import { decode, ConfigSchema } from './model.js';

const config = decode(ConfigSchema, JSON.parse(await readFile(process.argv[2], 'utf8')));
await mkdir(config.controlDirectory, { recursive: true, mode: 0o700 });
const broker = await createUiBroker(config, { version: 1, nonce: process.argv[3], pid: process.pid });
let stopping = false;
const stop = () => { if (!stopping) { stopping = true; void broker.dispose(); } };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
