import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { liveEventLines, PeripheralRetry } from '../bridge.js';
import { peripheralPresent, servePeripheral } from '../managed-runtime.js';
import { renderPeripheralUnit } from '../service-unit.js';
import { PersistentDesk } from '../../remote-performance/controller.js';
import { installedPackage, sessionProfile, until } from '../../remote-performance/tests/session-fixture.js';

test('identity presence follows fresh paths and holds on ambiguous devices', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'peripheral-presence-'));
	const board = async (name: string) => { await mkdir(join(directory, name)); await writeFile(join(directory, name, 'idVendor'), 'd209\n'); await writeFile(join(directory, name, 'idProduct'), '0410\n'); };
	try {
		assert.equal(await peripheralPresent(directory), false);
		await board('arbitrary-port-1'); assert.equal(await peripheralPresent(directory), true);
		await rm(join(directory, 'arbitrary-port-1'), { recursive: true });
		await board('new-port-after-reboot'); assert.equal(await peripheralPresent(directory), true);
		await board('second-board'); await assert.rejects(peripheralPresent(directory), /observed 2/);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('silent event stream fails even while socket remains open; comments keep it live', async () => {
	const stream = new PassThrough();
	const reading = (async () => { for await (const _ of liveEventLines(stream, 60)) {} })();
	const heartbeat = setInterval(() => stream.write(': show-tools-heartbeat\n\n'), 10);
	await new Promise(resolve => setTimeout(resolve, 100));
	assert.equal(stream.destroyed, false);
	clearInterval(heartbeat);
	await assert.rejects(reading, PeripheralRetry);
	assert.equal(stream.destroyed, true);
});

test('normal off/device waits use only status; cancellation leaves no child or audio command', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'peripheral-wait-'));
	const controller = new PersistentDesk(sessionProfile(directory), installedPackage().installed);
	const paths: string[] = [];
	const server = createServer((request, response) => { paths.push(request.url!); response.end(JSON.stringify(controller.snapshot())); });
	const abort = new AbortController();
	let presenceChecks = 0;
	try {
		await writeFile(join(directory, 'token'), 'a'.repeat(32), { mode: 0o600 });
		server.listen(0, '127.0.0.1'); await once(server, 'listening');
		const address = server.address(); assert.ok(address && typeof address !== 'string');
		const running = servePeripheral({ version: 1, origin: `http://127.0.0.1:${address.port}`, tokenFile: join(directory, 'token'), helperExecutable: '/nonexistent-helper', sdkChannel: 0, bindingRevision: 1, jiggle: { minimumTravel: 4, minimumReversal: 2 } }, abort.signal, { retryMs: 5, present: async () => { presenceChecks++; return false; }, report: () => {} });
		await until(() => paths.length >= 3 || undefined);
		abort.abort(); await running;
		assert.ok(paths.every(path => path === '/api/status'));
		assert.equal(presenceChecks, 0);
		assert.equal(controller.snapshot().audio.kind, 'off');
	} finally { abort.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await controller.close(); await rm(directory, { recursive: true, force: true }); }
});

test('auth faults hold instead of reconnecting or starting a helper', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'peripheral-auth-'));
	const server = createServer((_, response) => { response.writeHead(401); response.end(); });
	try {
		await writeFile(join(directory, 'token'), 'a'.repeat(32), { mode: 0o600 });
		server.listen(0, '127.0.0.1'); await once(server, 'listening');
		const address = server.address(); assert.ok(address && typeof address !== 'string');
		await assert.rejects(servePeripheral({ version: 1, origin: `http://127.0.0.1:${address.port}`, tokenFile: join(directory, 'token'), helperExecutable: '/nonexistent-helper', sdkChannel: 0, bindingRevision: 1, jiggle: { minimumTravel: 4, minimumReversal: 2 } }, new AbortController().signal), /401/);
	} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('persistent unit restarts abnormal exits with backoff, but holds normal configuration failures', () => {
	const unit = renderPeripheralUnit('/app/bin/show-tools-peripheral', '/home/user/config.json');
	assert.match(unit, /serve --config/); assert.match(unit, /Restart=on-abnormal/); assert.match(unit, /RestartSec=3s/); assert.match(unit, /KillMode=control-group/); assert.match(unit, /WantedBy=default.target/);
	assert.doesNotMatch(unit, /audio|sudo/);
	assert.throws(() => renderPeripheralUnit('/app\nother', '/config'), /absolute/);
});

test('late interface/access changes qualify once per change; disconnect fully exits before a fresh session', { timeout: 20000 }, async () => {
	const { createGateway } = await import('../../remote-performance/gateway.js');
	const directory = await mkdtemp(join(tmpdir(), 'ps-'));
	const token = 'b'.repeat(32), tokenFile = join(directory, 'token'), helper = join(directory, 'helper'), log = join(directory, 'log'), stageFile = join(directory, 'stage'), disconnect = join(directory, 'disconnect');
	await writeFile(tokenFile, token, { mode: 0o600 });
	await writeFile(stageFile, '0');
	await writeFile(helper, `#!${process.execPath}
const fs = require('node:fs'), rl = require('node:readline');
const session = Number(process.argv[2]);
const record = value => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ session, ...value }) + '\\n');
record({type:'start'});
process.on('exit', () => record({type:'exit'}));
if (fs.readFileSync(${JSON.stringify(stageFile)}, 'utf8') !== '3') process.exit(1);
process.stdout.write(JSON.stringify({type:'ready',version:1,session,released:true}) + '\\n');
record({type:'ready'});
const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(disconnect)})) { fs.unlinkSync(${JSON.stringify(disconnect)}); process.stdout.write(JSON.stringify({type:'detached',session})+'\\n'); clearInterval(timer); } }, 5);
rl.createInterface({input:process.stdin}).on('line', line => { record({type:'command',line}); if (line === 'quit') process.exit(0); });
`);
	await chmod(helper, 0o700);
	const records = async (): Promise<{ session: number; type: string; line?: string }[]> => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
	const waitRecords = async (predicate: (history: Awaited<ReturnType<typeof records>>) => boolean) => {
		for (let i = 0; i < 400; i++) { const history = await records(); if (predicate(history)) return history; await new Promise(resolve => setTimeout(resolve, 10)); }
		throw new Error('helper history condition timed out: ' + await readFile(log, 'utf8'));
	};
	const controller = new PersistentDesk(sessionProfile(directory), installedPackage().installed);
	const config = { host: '127.0.0.1', port: 0, origin: 'http://127.0.0.1', token: Buffer.from(token), staticRoot: directory };
	let audioCommands = 0;
	const server = createGateway(config, { ...controller, snapshot: () => controller.snapshot(), subscribe: listener => controller.subscribe(listener), command: (target, input) => controller.command(target, input), close: () => controller.close(), setAudio: () => { audioCommands++; throw new Error('supervisor must not control audio'); } });
	const abort = new AbortController(); let running: Promise<void> | undefined;
	try {
		controller.setAudio('on');
		await until(() => { const audio = controller.snapshot().audio; if (audio.kind === 'fault') throw new Error(audio.error); return audio.kind === 'ready' ? true : undefined; });
		server.listen(0, '127.0.0.1'); await once(server, 'listening');
		const address = server.address(); assert.ok(address && typeof address !== 'string'); config.origin = `http://127.0.0.1:${address.port}`;
		let present = false;
		running = servePeripheral({ version: 1, origin: config.origin, tokenFile, helperExecutable: helper, sdkChannel: 0, bindingRevision: 1, jiggle: { minimumTravel: 4, minimumReversal: 2 } }, abort.signal, { present: async () => present, fingerprint: () => readFile(stageFile, 'utf8'), retryMs: 10, report: () => {} });
		await new Promise(resolve => setTimeout(resolve, 50)); assert.equal((await records()).length, 0, 'absent hardware never starts a child');
		present = true;
		for (let stage = 0; stage < 3; stage++) {
			if (stage) await writeFile(stageFile, String(stage));
			await waitRecords(history => history.filter(record => record.type === 'exit').length === stage + 1);
			await new Promise(resolve => setTimeout(resolve, 60));
			assert.equal((await records()).filter(record => record.type === 'start').length, stage + 1, 'unchanged qualification failure does not repeatedly spawn/write');
		}
		await writeFile(stageFile, '3');
		await waitRecords(history => history.some(record => record.line?.startsWith('light ')));
		await writeFile(disconnect, 'yes');
		await waitRecords(history => history.filter(record => record.type === 'ready').length === 2);
		server.closeAllConnections();
		await waitRecords(history => history.filter(record => record.type === 'ready').length === 3);
		abort.abort(); await running;
		const history = await records(); const starts = history.filter(record => record.type === 'start');
		assert.equal(new Set(starts.map(record => record.session)).size, starts.length, 'every attempt has a fresh helper identity');
		for (let i = 1; i < starts.length; i++) assert.ok(history.findIndex(record => record.type === 'exit' && record.session === starts[i-1].session) < history.indexOf(starts[i]), 'old process exits before another child starts');
		assert.equal(history.filter(record => record.line === 'clear').length, 3);
		assert.equal(history.at(-1)?.type, 'exit');
		assert.equal(audioCommands, 0);
		assert.equal(controller.snapshot().audio.kind, 'ready');
	} finally {
		abort.abort(); await running?.catch(() => {}); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await controller.close(); await rm(directory, { recursive: true, force: true });
	}
});
