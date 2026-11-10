import { servePeripheral } from './managed-runtime.js';
import { runBrowserPeripheralServer } from './browser-server.js';
import { readFile, stat } from 'node:fs/promises';
import { decodePeripheralBridgeConfig, runPeripheralBridge } from './bridge.js';

export const PERIPHERAL_HELP = `Usage: show-tools peripheral connect --config FILE
       show-tools peripheral serve --config FILE
       show-tools peripheral browser --helper FILE --static-root DIST

Connect the local I-PAC to an enabled hardware-audio session.
Run from the terminal granted Input Monitoring. Ctrl+C releases the button,
clears the owned LED and returns the input interfaces to the operating system.
Config names the gateway origin, private token file, optional TLS certificate,
native helper executable, SDK output channel and binding revision.
Serve waits for audio and USB readiness, and reconnects with fresh sessions.
This command starts no audio, Sheets helper or browser.
`;

export async function runPeripheralCli(args: readonly string[]) {
	if (args.length === 0 || args.includes('--help') || args.includes('-h')) { process.stdout.write(PERIPHERAL_HELP); return; }
	if (args[0] === 'browser') {
		if (args.length !== 5 || args[1] !== '--helper' || args[3] !== '--static-root') throw new Error('Usage: show-tools peripheral browser --helper FILE --static-root DIST');
		const abort = new AbortController();
		const stop = () => abort.abort();
		process.on('SIGINT', stop); process.on('SIGTERM', stop);
		try { await runBrowserPeripheralServer({ helperExecutable: args[2], staticRoot: args[4], sdkChannel: 0 }, abort.signal); }
		finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
		return;
	}
	if (args.length !== 3 || !['connect', 'serve'].includes(args[0]) || args[1] !== '--config') throw new Error(PERIPHERAL_HELP);
	const metadata = await stat(args[2]);
	if (!metadata.isFile() || metadata.size > 16384) throw new Error('Peripheral config must be a JSON file of at most 16 KiB');
	const config = decodePeripheralBridgeConfig(JSON.parse(await readFile(args[2], 'utf8')));
	const abort = new AbortController();
	const stop = () => abort.abort();
	process.on('SIGINT', stop); process.on('SIGTERM', stop);
	try { await (args[0] === 'serve' ? servePeripheral : runPeripheralBridge)(config, abort.signal); }
	finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
