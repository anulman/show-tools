import { readFile } from 'node:fs/promises';
import { createGateway } from './gateway.js';
import { NativeInstrument } from './instrument.js';

const values = process.argv.slice(2);
const options = new Map<string, string>();
for (let index = 0; index < values.length; index += 2) {
	const key = values[index], value = values[index + 1];
	if (!key.startsWith('--') || !value || options.has(key)) throw new Error('Expected unique --name value arguments');
	options.set(key, value);
}
const allowed = new Set(['--socket', '--host', '--port', '--origin', '--token-file', '--static-root', '--cert', '--key']);
for (const key of options.keys()) if (!allowed.has(key)) throw new Error(`Unknown option ${key}`);
function required(name: string) { const value = options.get(name); if (!value) throw new Error(`Missing ${name}`); return value; }
const host = required('--host');
const port = Number(required('--port'));
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const cert = options.get('--cert'), key = options.get('--key');
if (!!cert !== !!key) throw new Error('Supply both --cert and --key');
const tls = cert && key ? { cert: await readFile(cert), key: await readFile(key) } : undefined;
const token = Buffer.from((await readFile(required('--token-file'), 'utf8')).trim());
const instrument = new NativeInstrument(required('--socket'));
const server = createGateway({ host, port, origin: required('--origin'), token, staticRoot: required('--static-root'), tls }, instrument);
server.listen(port, host);
const stop = () => { instrument.close(); server.close(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
