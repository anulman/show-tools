import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { encodeInitialProfiles } from './commands.js';
import { HostConnection, HostUnavailable } from './host-connection.js';
import { decodeExternalSampleWav } from '../performance/external-assets.js';
import { PF } from '../performance/wasm-abi.js';
import { parseManifestProgram } from './observation.js';

export function validateInstalledPackage(manifest: Buffer, packet: Buffer, configurations: unknown) {
	if (manifest.length > 1024 * 1024) throw new Error('Package manifest exceeds the native host 1 MiB limit');
	const digest = createHash('sha256').update(manifest).digest();
	const metadata = parseManifestProgram(manifest, digest);
	const effects = encodeInitialProfiles(configurations);
	const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
	if (hash(packet) !== metadata.packetSha256 || hash(effects) !== metadata.profilesSha256) throw new Error('Package digest mismatch');
	if (!metadata.song.compiled || !packet.equals(Buffer.from(metadata.packet)) || packet.length < PF.COMPILED_HEADER_FIELDS * 8 || packet.readDoubleLE(0) !== PF.COMPILED_MAGIC || (packet.readDoubleLE(8) !== PF.COMPILED_LEGACY_VERSION && packet.readDoubleLE(8) !== PF.COMPILED_VERSION)
		|| packet.readDoubleLE(16) !== metadata.song.chart.beatsPerBar || packet.readDoubleLE(24) !== metadata.song.chart.bars.length
		|| packet.readDoubleLE(32) !== metadata.song.chart.bpm || packet.readDoubleLE(40) !== metadata.song.chart.annotatedThroughBar
		|| packet.readDoubleLE(64) !== metadata.takeCount) throw new Error('Package song identity mismatch');
	const header = Buffer.alloc(2 + 4 + 4);
	header.writeUInt16LE(9);
	header.writeUInt32LE(manifest.length, 2);
	header.writeUInt32LE(packet.length, 6);
	const operation = Buffer.concat([header, effects.subarray(2, 54), digest, manifest, packet, effects.subarray(54)]);
	if (operation.length + 32 > 8 * 1024 * 1024) throw new Error('Bundle exceeds host frame limit');
	const assets = (metadata.song.compiled.externalSamples ?? []).flatMap(sample => {
		if (!sample.asset) return [];
		const bytes = decodeExternalSampleWav(sample.asset);
		if (createHash('sha256').update(bytes).digest('hex') !== sample.asset.sha256) throw new Error('External WAV SHA-256 mismatch');
		const assetHeader = Buffer.alloc(10);
		assetHeader.writeUInt16LE(15);
		assetHeader.writeUInt32LE(sample.slot, 2);
		assetHeader.writeUInt32LE(bytes.length, 6);
		return [Buffer.concat([assetHeader, bytes])];
	});
	return { song: metadata.song, operation, assets, digest: digest.toString('hex') };
}

export async function prepareInstalledPackage(socket: string, installed: ReturnType<typeof validateInstalledPackage>, signal?: AbortSignal) {
	const deadline = new AbortController();
	let connection: HostConnection | undefined;
	let rejectCanceled!: (error: Error) => void;
	const canceled = new Promise<never>((_, reject) => { rejectCanceled = reject; });
	const cancel = (error: Error) => { deadline.abort(error); connection?.close(); rejectCanceled(error); };
	const abort = () => cancel(new Error('Preparation canceled'));
	const timer = setTimeout(() => cancel(new Error('Preparation timed out')), 5000);
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) abort();
	async function connectPreparedHost(): Promise<HostConnection> {
		for (;;) {
			deadline.signal.throwIfAborted();
			let resolveReady!: () => void;
			let rejectReady!: (error: Error) => void;
			const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
			const opened = new HostConnection(socket, frame => { if (frame.tag === 5) queueMicrotask(resolveReady); }, rejectReady);
			connection = opened;
			try {
				await Promise.race([ready, canceled]);
				deadline.signal.throwIfAborted();
				return opened;
			} catch (error) {
				opened.close();
				if (!(error instanceof HostUnavailable) || deadline.signal.aborted) throw error;
			}
			await delay(10, undefined, { signal: deadline.signal });
		}
	}
	try {
		connection = await Promise.race([connectPreparedHost(), canceled]);
		deadline.signal.throwIfAborted();
		for (const operation of [installed.operation, ...installed.assets]) {
			deadline.signal.throwIfAborted();
			const result = await Promise.race([connection.command(operation), canceled]);
			if (result.length !== 16 || result.readUInt32LE(0) !== 0) throw new Error(`Host rejected preparation (${result.length === 16 ? result.readInt32LE(4) : 'invalid result'})`);
		}
	} finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); connection?.close(); }
}

export async function prepareHost(socket: string, manifest: Buffer, packet: Buffer, configurations: unknown, signal?: AbortSignal) {
	return prepareInstalledPackage(socket, validateInstalledPackage(manifest, packet, configurations), signal);
}
