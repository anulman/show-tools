import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connection, PeripheralHelperUnavailable, PeripheralHttpError, PeripheralRetry, runPeripheralBridge, type PeripheralBridgeConfig } from './bridge.js';
import { DeskViewSchema } from '../remote-performance/session-schema.js';
import { Schema } from 'effect';

const decodeView = Schema.decodeUnknownSync(DeskViewSchema);

export async function peripheralPresent(directory = '/sys/bus/usb/devices'): Promise<boolean> {
	let count = 0;
	for (const entry of await readdir(directory)) {
		const attribute = async (name: string) => readFile(join(directory, entry, name), 'utf8').then(value => value.trim()).catch(error => {
			if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return '';
			throw error;
		});
		if (await attribute('idVendor') === 'd209' && await attribute('idProduct') === '0410') count++;
	}
	if (count > 1) throw new Error(`Require exactly one d209:0410 board; observed ${count}. Disconnect the extra board before restarting the peripheral service.`);
	return count === 1;
}

export async function peripheralFingerprint({ usb = '/sys/bus/usb/devices', input = '/sys/class/input', hidraw = '/sys/class/hidraw', inputDevices = '/dev/input', hidrawDevices = '/dev' } = {}) {
	const boards: string[] = [];
	for (const entry of await readdir(usb)) {
		const path = join(usb, entry);
		try {
			if ((await readFile(join(path, 'idVendor'), 'utf8')).trim() === 'd209'
				&& (await readFile(join(path, 'idProduct'), 'utf8')).trim() === '0410') boards.push(await realpath(path));
		} catch (error) { if (!(error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code)))) throw error; }
	}
	const result: string[] = [];
	for (const board of boards) {
		const info = await stat(board).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
		if (!info) continue;
		result.push(`${board}:${info.ino}:${info.ctimeMs}`);
		for (const [directory, devices] of [[input, inputDevices], [hidraw, hidrawDevices]] as const) {
			for (const entry of await readdir(directory)) {
				if (!entry.startsWith('event') && !entry.startsWith('hidraw')) continue;
				try {
					const target = await realpath(join(directory, entry));
					if (!target.startsWith(board + '/')) continue;
					const metadata = await stat(join(devices, entry));
					result.push(`${target}:${metadata.ino}:${metadata.mode}:${metadata.uid}:${metadata.gid}:${metadata.ctimeMs}`);
				} catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
			}
		}
	}
	return result.sort().join('\n');
}

function retryable(error: unknown): boolean {
	if (error instanceof PeripheralRetry) return true;
	if (error instanceof PeripheralHttpError) return error.status === 503;
	if (!(error instanceof Error)) return false;
	if ('code' in error && ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EAI_AGAIN'].includes(String(error.code))) return true;
	return false;
}

export type PeripheralServiceState =
	| { readonly kind: 'waiting'; readonly reason: 'audio' | 'device' }
	| { readonly kind: 'connecting' }
	| { readonly kind: 'blocked'; readonly error: string }
	| { readonly kind: 'retrying'; readonly error: string };

export async function servePeripheral(config: PeripheralBridgeConfig, signal: AbortSignal, {
	present = peripheralPresent,
	fingerprint = peripheralFingerprint,
	report = (state: PeripheralServiceState) => { process.stderr.write(`${JSON.stringify(state)}\n`); },
	retryMs = 1000,
}: { present?: () => Promise<boolean>; fingerprint?: () => Promise<string>; report?: (state: PeripheralServiceState) => void; retryMs?: number } = {}) {
	let previous = '';
	let blocked: { fingerprint: string; error: string } | undefined;
	const publish = (state: PeripheralServiceState) => {
		const encoded = JSON.stringify(state);
		if (encoded !== previous) { report(state); previous = encoded; }
	};
	try {
		while (!signal.aborted) {
			try {
				const link = await connection(config, signal);
				const view = decodeView(await link.json('/api/status'));
				if (view.audio.kind !== 'ready') publish({ kind: 'waiting', reason: 'audio' });
				else if (!await present()) publish({ kind: 'waiting', reason: 'device' });
				else {
					const before = await fingerprint();
					if (blocked?.fingerprint === before) {
						publish({ kind: 'blocked', error: blocked.error });
						await delay(retryMs, undefined, { signal });
						continue;
					}
					blocked = undefined;
					publish({ kind: 'connecting' });
					try { await runPeripheralBridge(config, signal); }
					catch (error) {
						if (!signal.aborted && error instanceof PeripheralHelperUnavailable) {
							blocked = { fingerprint: before, error: error.message + '; waiting for USB/interface/access metadata to change, or restart after correcting the helper' };
							publish({ kind: 'blocked', error: blocked.error });
						} else if (!signal.aborted && !retryable(error)) throw error;
						if (!signal.aborted && !blocked) publish({ kind: 'retrying', error: error instanceof Error ? error.message : String(error) });
					}
				}
			} catch (error) {
				if (signal.aborted) break;
				if (!retryable(error)) throw error;
				publish({ kind: 'retrying', error: error instanceof Error ? error.message : String(error) });
			}
			await delay(retryMs, undefined, { signal });
		}
	} catch (error) { if (!signal.aborted) throw error; }
}
