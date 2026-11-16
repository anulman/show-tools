import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { decodePeripheralInputMap, liveEventLines, PeripheralRetry } from '../bridge.js';
import { peripheralFingerprint, peripheralPresent, servePeripheral } from '../managed-runtime.js';
import { renderPeripheralUnit } from '../service-unit.js';
import { PersistentDesk } from '../../remote-performance/controller.js';
import { installedPackage, sessionProfile, until } from '../../remote-performance/tests/session-fixture.js';

const inputMap = decodePeripheralInputMap({
  sources: [{ kind: 'linux', id: 'synthetic', interfaceNumber: 2, eventTypes: [0, 1], keyCodes: [41], relativeAxes: [] }],
  switches: [{ controlId: 'blue', sourceId: 'synthetic', type: 1, code: 41 }], leds: [], confirmWiring: false,
});

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

test('absent device waits without opening a helper or requiring gateway audio', async () => {
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
		const running = servePeripheral({ version: 2, origin: `http://127.0.0.1:${address.port}`, tokenFile: join(directory, 'token'), helperExecutable: '/nonexistent-helper', inputMap, bindingRevision: 1, jiggle: { minimumTravel: 4, minimumReversal: 2 } }, abort.signal, { retryMs: 5, present: async () => { presenceChecks++; return false; }, report: () => {} });
		await until(() => presenceChecks >= 3 || undefined);
		abort.abort(); await running;
		assert.deepEqual(paths, []);
		assert.ok(presenceChecks >= 3);
		assert.equal(controller.snapshot().audio.kind, 'off');
	} finally { abort.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await controller.close(); await rm(directory, { recursive: true, force: true }); }
});

test('gateway authentication failure holds musical input while the one local helper remains active', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'peripheral-auth-'));
	const server = createServer((_, response) => { response.writeHead(401); response.end(); });
	const abort = new AbortController(); let running: Promise<void> | undefined;
	const helper = join(directory, 'helper'), log = join(directory, 'log');
	const states: string[] = [];
	try {
		await writeFile(join(directory, 'token'), 'a'.repeat(32), { mode: 0o600 });
		await writeFile(helper, `#!${process.execPath}
const fs=require('node:fs'),rl=require('node:readline');
fs.appendFileSync(${JSON.stringify(log)},'start\\n');
process.stdout.write(JSON.stringify({type:'ready',version:2,session:Number(process.argv[2]),switches:[{controlId:'blue',state:'released'}]})+'\\n');
rl.createInterface({input:process.stdin}).on('line',line=>{if(line==='quit')process.exit(0)});
process.on('exit',()=>fs.appendFileSync(${JSON.stringify(log)},'exit\\n'));
`);
		await chmod(helper, 0o700);
		server.listen(0, '127.0.0.1'); await once(server, 'listening');
		const address = server.address(); assert.ok(address && typeof address !== 'string');
		running = servePeripheral({ version: 2, origin: `http://127.0.0.1:${address.port}`, tokenFile: join(directory, 'token'), helperExecutable: helper, inputMap, bindingRevision: 1, jiggle: null }, abort.signal,
			{ present: async () => true, fingerprint: async () => 'same-device', retryMs: 5, report: state => states.push(JSON.stringify(state)) });
		await until(() => states.some(state => state.includes('401') && state.includes('physical-only')) || undefined);
		assert.equal(await readFile(log, 'utf8'), 'start\n');
		abort.abort(); await running;
		assert.equal(await readFile(log, 'utf8'), 'start\nexit\n');
	} finally { abort.abort(); await running?.catch(() => {}); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('persistent unit restarts abnormal exits with backoff, but holds normal configuration failures', () => {
	const unit = renderPeripheralUnit('/app/bin/show-tools-peripheral', '/home/user/config.json');
	assert.match(unit, /serve --config/); assert.match(unit, /Restart=on-abnormal/); assert.match(unit, /RestartSec=3s/); assert.match(unit, /KillMode=control-group/); assert.match(unit, /WantedBy=default.target/);
	assert.doesNotMatch(unit, /audio|sudo/);
	assert.throws(() => renderPeripheralUnit('/app\nother', '/config'), /absolute/);
});

for (const unknownCleanup of [false, true]) test(`qualification changes and USB loss reconnect; gateway cleanup ${unknownCleanup ? 'uncertainty blocks' : 'proof permits'} retry`, { timeout: 20000 }, async () => {
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
process.stdout.write(JSON.stringify({type:'ready',version:2,session,switches:[{controlId:'blue',state:'released'}]}) + '\\n');
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
	let audioCommands = 0, failCleanup = false;
	const server = createGateway(config, { ...controller, snapshot: () => controller.snapshot(), subscribe: listener => controller.subscribe(listener), command: (target, input) => {
		if (failCleanup && input && typeof input === 'object' && 'command' in input && input.command === 'inputRevoke') return Promise.resolve({ outcome: 'unknown' });
		return controller.command(target, input);
	}, close: () => controller.close(), setAudio: () => { audioCommands++; throw new Error('supervisor must not control audio'); } });
	const abort = new AbortController(); let running: Promise<void> | undefined;
	const reports: string[] = [];
	try {
		controller.setAudio('on');
		await until(() => { const audio = controller.snapshot().audio; if (audio.kind === 'fault') throw new Error(audio.error); return audio.kind === 'ready' ? true : undefined; });
		server.listen(0, '127.0.0.1'); await once(server, 'listening');
		const address = server.address(); assert.ok(address && typeof address !== 'string'); config.origin = `http://127.0.0.1:${address.port}`;
		let present = false;
		running = servePeripheral({ version: 2, origin: config.origin, tokenFile, helperExecutable: helper, inputMap, bindingRevision: 1, jiggle: null }, abort.signal, { present: async () => present, fingerprint: () => readFile(stageFile, 'utf8'), retryMs: 10, report: state => reports.push(JSON.stringify(state)) });
		const settled = running.then(() => ({ ok: true }), error => ({ ok: false, error }));
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
		const prepared = controller.snapshot().audio;
		assert.equal(prepared.kind, 'ready');
		if (prepared.kind !== 'ready') throw new Error('Missing native session');
		const started = await controller.command({ attempt: prepared.attempt, hostEpoch: prepared.performance.hostEpoch },
			{ command: 'start', args: { bpm: 120, countInBars: 0, startBar: 1, endBar: 4, loop: true } });
		assert.equal(started.outcome, 'applied');
		if (started.outcome !== 'applied') throw new Error('Missing native start acknowledgement');
		await writeFile(disconnect, 'yes');
		await waitRecords(history => new Set(history.filter(record => record.line?.startsWith('light ')).map(record => record.session)).size === 2);
		failCleanup = unknownCleanup;
		server.closeAllConnections();
		if (unknownCleanup) {
			await until(() => reports.some(report => report.includes('revocation is unconfirmed')) || undefined);
			await new Promise(resolve => setTimeout(resolve, 60));
			assert.equal(new Set((await records()).filter(record => record.line?.startsWith('light ')).map(record => record.session)).size, 2, 'uncertain musical cleanup never creates another input source');
		} else {
			await waitRecords(history => history.filter(record => record.line?.startsWith('bind ')).length >= 3);
			assert.equal(new Set((await records()).filter(record => record.line?.startsWith('light ')).map(record => record.session)).size, 2, 'gateway reconnect retains the same physical helper');
		}
		abort.abort(); await running;

		const history = await records(); const starts = history.filter(record => record.type === 'start');
		assert.equal(new Set(starts.map(record => record.session)).size, starts.length, 'every attempt has a fresh helper identity');
		for (let i = 1; i < starts.length; i++) assert.ok(history.findIndex(record => record.type === 'exit' && record.session === starts[i-1].session) < history.indexOf(starts[i]), 'old process exits before another child starts');
		assert.equal(history.filter(record => record.line === 'clear').length, history.filter(record => record.type === 'ready').length, 'only helper teardown uses the device-owner clear');
		assert.equal(history.at(-1)?.type, 'exit');
		assert.equal(audioCommands, 0);
		const final = controller.snapshot().audio;
		assert.equal(final.kind, 'ready');
		if (final.kind !== 'ready') throw new Error('Supervisor interrupted native audio');
		assert.equal(final.attempt, prepared.attempt);
		assert.equal(final.performance.state.runId, started.state.runId);
		assert.equal(final.performance.state.phase, 'playing');
	} finally {
		abort.abort(); await running?.catch(() => {}); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await controller.close(); await rm(directory, { recursive: true, force: true });
	}
});


test('read-only fingerprint notices late input/hidraw creation and permissions on the current USB parent', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'peripheral-metadata-'));
	const paths = { usb: join(directory, 'usb'), input: join(directory, 'input'), hidraw: join(directory, 'hidraw'), inputDevices: join(directory, 'input-devices'), hidrawDevices: join(directory, 'hidraw-devices') };
	try {
		for (const path of Object.values(paths)) await mkdir(path);
		const board = join(paths.usb, 'changing-usb-port'); await mkdir(board);
		await writeFile(join(board, 'idVendor'), 'd209'); await writeFile(join(board, 'idProduct'), '0410');
		const parentOnly = await peripheralFingerprint(paths);
		await mkdir(join(board, 'keyboard')); await symlink(join(board, 'keyboard'), join(paths.input, 'event87'));
		await writeFile(join(paths.inputDevices, 'event87'), '', { mode: 0o600 });
		const withInput = await peripheralFingerprint(paths); assert.notEqual(withInput, parentOnly);
		await mkdir(join(board, 'led')); await symlink(join(board, 'led'), join(paths.hidraw, 'hidraw23'));
		await writeFile(join(paths.hidrawDevices, 'hidraw23'), '', { mode: 0o600 });
		const withLed = await peripheralFingerprint(paths); assert.notEqual(withLed, withInput);
		await chmod(join(paths.hidrawDevices, 'hidraw23'), 0o660);
		const permissionReady = await peripheralFingerprint(paths); assert.notEqual(permissionReady, withLed);
		assert.equal(await peripheralFingerprint(paths), permissionReady, 'unchanged metadata is stable');
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('one helper survives audio-off and engine replacement without replaying offline presses', { timeout: 15000 }, async () => {
  const { createGateway } = await import('../../remote-performance/gateway.js');
  const directory = await mkdtemp(join(tmpdir(), 'physical-idle-'));
  const helper = join(directory, 'helper'), mode = join(directory, 'mode'), log = join(directory, 'log');
  const controller = new PersistentDesk(sessionProfile(directory), installedPackage().installed);
  const abort = new AbortController();
  const commands: { command: string; args: { sequence?: number; heldMask?: number; releasedMask?: number } }[] = [];
  const reports: string[] = [];
  const waitLog = async (text: string) => { for (let index = 0; index < 400; index++) { if ((await readFile(log, 'utf8').catch(() => '')).includes(text)) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error(`Helper did not observe ${text}`); };
  let audioCommands = 0, running: Promise<void> | undefined;
  const config = { host: '127.0.0.1', port: 0, origin: 'http://127.0.0.1', token: Buffer.from('c'.repeat(32)), staticRoot: directory };
  const server = createGateway(config, { snapshot: () => controller.snapshot(), subscribe: listener => controller.subscribe(listener),
    command: (target, input) => {
      if (input && typeof input === 'object' && 'command' in input && typeof input.command === 'string' && 'args' in input) {
        commands.push(JSON.parse(JSON.stringify(input)));
      }
      return controller.command(target, input);
    }, confirmedRetirement: target => controller.confirmedRetirement(target), close: () => controller.close(),
    setAudio: () => { audioCommands++; throw new Error('The peripheral service cannot enable audio'); } });
  try {
    await writeFile(join(directory, 'token'), 'c'.repeat(32), { mode: 0o600 });
    await writeFile(mode, 'released');
    await writeFile(helper, `#!${process.execPath}
const fs=require('node:fs'),rl=require('node:readline');
const session=Number(process.argv[2]);let sequence=0,prior='released';
fs.appendFileSync(${JSON.stringify(log)},'start\\n');
process.stdout.write(JSON.stringify({type:'ready',version:2,session,switches:[{controlId:'blue',state:'released'}]})+'\\n');
const timer=setInterval(()=>{const next=fs.readFileSync(${JSON.stringify(mode)},'utf8');if(next!==prior){prior=next;process.stdout.write(JSON.stringify({type:'button',session,sequence:++sequence,controlId:'blue',down:next==='held'})+'\\n');fs.appendFileSync(${JSON.stringify(log)},next+'\\n')}},5);
rl.createInterface({input:process.stdin}).on('line',line=>{if(line==='quit'){clearInterval(timer);process.exit(0)}});
process.on('exit',()=>fs.appendFileSync(${JSON.stringify(log)},'exit\\n'));
`);
    await chmod(helper, 0o700);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string'); config.origin = `http://127.0.0.1:${address.port}`;
    running = servePeripheral({ version: 2, origin: config.origin, tokenFile: join(directory, 'token'), helperExecutable: helper, inputMap, bindingRevision: 1, jiggle: null }, abort.signal,
      { present: async () => true, fingerprint: async () => 'one-board', retryMs: 10, report: state => reports.push(JSON.stringify(state)) });
    await until(() => reports.some(value => value.includes('physical-only')) || undefined);
    assert.equal(controller.snapshot().audio.kind, 'off');
    await writeFile(mode, 'held');
    await waitLog('held\n');
    assert.equal(commands.length, 0, 'offline physical input never reaches a native engine');
    controller.setAudio('on');
    await until(() => commands.some(value => value.command === 'inputAttach') || undefined);
    assert.equal(commands.find(value => value.command === 'inputAttach')?.args.heldMask, 1, 'native admission observes the current held barrier');
    await writeFile(mode, 'released'); await waitLog('released\n');
    await writeFile(mode, 'held');
    await until(() => commands.filter(value => value.command === 'inputEvent').length >= 2 || undefined);
    assert.deepEqual(commands.filter(value => value.command === 'inputEvent').map(value => value.args.sequence), [2, 3], 'the old offline press is never replayed');
    controller.setAudio('off');
    await until(() => controller.snapshot().audio.kind === 'off' || undefined);
    await writeFile(mode, 'released');
    for (let index = 0; index < 100; index++) { const text = await readFile(log, 'utf8'); if (text.split('released\n').length === 3) break; await new Promise(resolve => setTimeout(resolve, 5)); }
    controller.setAudio('on');
    await until(() => commands.filter(value => value.command === 'inputAttach').length === 2 || undefined);
    assert.equal(commands.filter(value => value.command === 'inputAttach')[1].args.releasedMask, 1);
    assert.equal((await readFile(log, 'utf8')).split('start\n').length, 2, 'audio replacement retains the original USB helper');
    assert.equal(audioCommands, 0);
    abort.abort(); await running;
  } finally {
    abort.abort(); await running?.catch(() => {}); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve())); await controller.close(); await rm(directory, { recursive: true, force: true });
  }
});
