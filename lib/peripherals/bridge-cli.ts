import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runCommissioningCli, COMMISSIONING_HELP } from './commissioning-cli.js';
import { servePeripheral } from './managed-runtime.js';
import { runBrowserPeripheralServer } from './browser-server.js';
import { readFile, stat } from 'node:fs/promises';
import { decodePeripheralBridgeConfig, decodePeripheralInputMap, runPeripheralBridge } from './bridge.js';

export const PERIPHERAL_HELP = `Usage: show-tools peripheral connect --config FILE
       show-tools peripheral serve --config FILE
       show-tools peripheral setup [OPTIONS]
       show-tools peripheral browser --helper FILE --static-root DIST --input-map FILE

Connect the local I-PAC to the configured desk; held LED feedback works with audio off.
Run from the terminal granted Input Monitoring. Ctrl+C releases the button,
clears the owned LED and returns the input interfaces to the operating system.
Config names the gateway origin, private token file, optional TLS certificate,
native helper executable, explicit installation input map and binding revision.
Serve waits for a missing configuration without opening USB, then reconnects with fresh sessions.
This command starts no audio, Sheets helper or browser.
`;

export async function runPeripheralCli(args: readonly string[]) {
	if (args[0] === 'setup') {
		const release = resolve(dirname(fileURLToPath(import.meta.url)), '..');
		await runCommissioningCli(args.slice(1), { helperExecutable: join(release, 'native/peripheral/peripheral-host'),
			benchDirectory: join(release, 'bench'), serviceRunner: join(release, 'bin/show-tools-peripheral') });
		return;
	}
	if (args.length === 0 || args.includes('--help') || args.includes('-h')) { process.stdout.write(PERIPHERAL_HELP + COMMISSIONING_HELP); return; }
	if (args[0] === 'browser') {
		if (args.length !== 7 || args[1] !== '--helper' || args[3] !== '--static-root' || args[5] !== '--input-map') throw new Error('Usage: show-tools peripheral browser --helper FILE --static-root DIST --input-map FILE');
		const metadata = await stat(args[6]);
		if (!metadata.isFile() || metadata.size > 16384) throw new Error('Input map must be a JSON file of at most 16 KiB');
		const inputMap = decodePeripheralInputMap(JSON.parse(await readFile(args[6], 'utf8')));
		const abort = new AbortController();
		const stop = () => abort.abort();
		process.on('SIGINT', stop); process.on('SIGTERM', stop);
		try { await runBrowserPeripheralServer({ helperExecutable: args[2], staticRoot: args[4], inputMap }, abort.signal); }
		finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
		return;
	}
	if (args.length !== 3 || !['connect', 'serve'].includes(args[0]) || args[1] !== '--config') throw new Error(PERIPHERAL_HELP);
	const abort = new AbortController();
	const stop = () => abort.abort();
	process.on('SIGINT', stop); process.on('SIGTERM', stop);
	try {
		let waiting = false;
		while (!abort.signal.aborted) {
			let metadata;
			try { metadata = await stat(args[2]); }
			catch (error) {
				if (!(args[0] === 'serve' && error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
				if (!waiting) { process.stdout.write(`Waiting for peripheral configuration at ${args[2]}. Run peripheral setup in a foreground terminal. USB is unopened.\n`); waiting = true; }
				try { await delay(500, undefined, { signal: abort.signal }); }
				catch (cancelled) { if (!abort.signal.aborted) throw cancelled; }
				continue;
			}
			if (!metadata.isFile() || metadata.size > 16384) throw new Error('Peripheral config must be a JSON file of at most 16 KiB');
			const config = decodePeripheralBridgeConfig(JSON.parse(await readFile(args[2], 'utf8')));
			await (args[0] === 'serve' ? servePeripheral : runPeripheralBridge)(config, abort.signal);
			return;
		}
	} finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
