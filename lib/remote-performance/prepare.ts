import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { encodeInitialProfiles } from './commands.js';
import { HostConnection } from './host-connection.js';
import { compiledProgramBytes } from '../performance/compiled-native.js';
import { PF } from '../performance/wasm-abi.js';
import { parseManifest } from './observation.js';

export function validateInstalledPackage(manifest: Buffer, packet: Buffer, configurations: unknown) {
	const digest = createHash('sha256').update(manifest).digest();
	const metadata = parseManifest(manifest, digest);
	const effects = encodeInitialProfiles(configurations);
	const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
	if (hash(packet) !== metadata.packetSha256 || hash(effects) !== metadata.profilesSha256) throw new Error('Package digest mismatch');
	if (!metadata.song.compiled || !packet.equals(Buffer.from(compiledProgramBytes(metadata.song.compiled))) || packet.length < PF.COMPILED_HEADER_FIELDS * 8 || packet.readDoubleLE(0) !== PF.COMPILED_MAGIC || packet.readDoubleLE(8) !== PF.COMPILED_VERSION
		|| packet.readDoubleLE(16) !== metadata.song.chart.beatsPerBar || packet.readDoubleLE(24) !== metadata.song.chart.bars.length
		|| packet.readDoubleLE(32) !== metadata.song.chart.bpm || packet.readDoubleLE(40) !== metadata.song.chart.annotatedThroughBar
		|| packet.readDoubleLE(64) !== metadata.takeCount) throw new Error('Package song identity mismatch');
	const header = Buffer.alloc(2 + 4 + 4);
	header.writeUInt16LE(9);
	header.writeUInt32LE(manifest.length, 2);
	header.writeUInt32LE(packet.length, 6);
	const operation = Buffer.concat([header, effects.subarray(2, 54), digest, manifest, packet, effects.subarray(54)]);
	if (operation.length + 32 > 8 * 1024 * 1024) throw new Error('Bundle exceeds host frame limit');
	return { song: metadata.song, operation, digest: digest.toString('hex') };
}

export async function prepareInstalledPackage(socket: string, installed: ReturnType<typeof validateInstalledPackage>, signal?: AbortSignal) {
	let resolveReady!: () => void;
	let rejectReady!: (error: Error) => void;
	const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
	const connection = new HostConnection(socket, (frame) => { if (frame.tag === 5) queueMicrotask(resolveReady); }, () => rejectReady(new Error('Host disconnected before preparation')));
	let rejectCanceled!: (error: Error) => void;
	const canceled = new Promise<never>((_, reject) => { rejectCanceled = reject; });
	const abort = () => { connection.close(); rejectCanceled(new Error('Preparation canceled')); };
	const timer = setTimeout(() => { connection.close(); rejectCanceled(new Error('Preparation timed out')); }, 5000);
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) abort();
	try {
		await Promise.race([ready, canceled]);
		const result = await Promise.race([connection.command(installed.operation), canceled]);
		if (result.length !== 16 || result.readUInt32LE(0) !== 0) throw new Error(`Host rejected preparation (${result.length === 16 ? result.readInt32LE(4) : 'invalid result'})`);
	} finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); connection.close(); }
}

export async function prepareHost(socket: string, manifest: Buffer, packet: Buffer, configurations: unknown, signal?: AbortSignal) {
	return prepareInstalledPackage(socket, validateInstalledPackage(manifest, packet, configurations), signal);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	const [socket, manifestPath, packetPath, effectsPath] = process.argv.slice(2);
	if (!socket || !manifestPath || !packetPath || !effectsPath || process.argv.length !== 6) throw new Error('Usage: prepare SOCKET MANIFEST.json SONG.pfp EFFECTS.json');
	const [manifest, packet, effects] = await Promise.all([readFile(manifestPath), readFile(packetPath), readFile(effectsPath, 'utf8')]);
	await prepareHost(socket, manifest, packet, JSON.parse(effects));
}
