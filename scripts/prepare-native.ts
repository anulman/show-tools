import { readFile } from 'node:fs/promises';
import { prepareHost } from '../lib/remote-performance/prepare.js';

const [socket, manifestPath, packetPath, effectsPath] = process.argv.slice(2);
if (!socket || !manifestPath || !packetPath || !effectsPath || process.argv.length !== 6) throw new Error('Usage: prepare SOCKET MANIFEST.json SONG.pfp EFFECTS.json');
const [manifest, packet, effects] = await Promise.all([readFile(manifestPath), readFile(packetPath), readFile(effectsPath, 'utf8')]);
await prepareHost(socket, manifest, packet, JSON.parse(effects));
