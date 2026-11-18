import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { createSessionService, renderSessionUnit } from '../../remote-performance/session-service.js';
import { fileURLToPath } from 'node:url';
import { assembleInstallationMap, captureAxis, captureSwitch, profileSnapshot, saveCommissionedProfile } from '../commissioning.js';
import { commissioningService, runCommissioningCli } from '../commissioning-cli.js';
import { renderPeripheralUnit } from '../service-unit.js';
import { sessionProfile } from '../../remote-performance/tests/session-fixture.js';

function inactiveWeb() {
  return { state: async () => new Map([['ActiveState', 'inactive'], ['MainPID', '0'], ['TasksCurrent', '0']]),
    stop: async () => {}, start: async () => { throw Error('Previously inactive web must not start'); } };
}

test('dry run prints the six-switch plan without inspecting installation files or services', async () => {
  const output: string[] = [];
  const unused = async () => { throw new Error('dry run attempted an installation operation'); };
  await runCommissioningCli(['--dry-run', '--config', '/dev/null', '--session-profile', '/dev/null'], {
    command: unused,
    webService: { state: unused, start: unused, stop: unused },
    io: { question: unused, write: message => output.push(message) },
  });
  const plan = JSON.parse(output.join(''));
  assert.equal(plan.profilePath, '/dev/null');
  assert.deepEqual(plan.switches, ['blue', 'yellow', 'red', 'green', 'pedal', 'mushroom']);
  assert.deepEqual(plan.ledPrompts, ['blue', 'yellow', 'red', 'green']);
  assert.deepEqual(plan.inputOnly, ['pedal', 'mushroom']);
  assert.equal(plan.planOnly, true);
});

async function fixture(mode = 'complete') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-cli-')));
  const observer = join(directory, 'raw_keys.py');
  const publisher = join(directory, 'publish_marker.py');
  const actualPublisher = resolve(dirname(fileURLToPath(import.meta.url)), '../bench/publish_marker.py');
  await writeFile(publisher, `import argparse,importlib.util\np=argparse.ArgumentParser()\nfor n in ('directory','op','trial','nonce'):p.add_argument('--'+n,required=True)\na=p.parse_args()\ns=importlib.util.spec_from_file_location('reviewed_marker',${JSON.stringify(actualPublisher)})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.publish_marker(a.directory,a.op,a.trial,a.nonce)\n`, { mode: 0o600 });
  await writeFile(observer, `import argparse,json,os,pathlib,time\np=argparse.ArgumentParser()\nfor n in ('directory','trial','control-id'):p.add_argument('--'+n,required=True)\na=p.parse_args();d=pathlib.Path(a.directory);control=a.control_id;code=30 if control=='blue' else 31\n(d/'observer.pid').write_text(str(os.getpid()))\nf=os.open(d/'trial.ndjson',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\ndef record(v,public=False):\n os.write(f,(json.dumps(v)+'\\n').encode())\n if public:print(json.dumps(v),flush=True)\nrecord(dict(type='source',device='/dev/input/event23',canonical='/sys/synthetic/event23',eventClock='CLOCK_MONOTONIC',interfaceNumber=0,eventTypes=[0,1],keyCodes=[30,31],relativeAxes=[]))\nnonce='a'*32\nrecord(dict(type='ready',schemaVersion=2,trialId=a.trial,controlId=control,nonce=nonce),True)\nstart=time.monotonic()\nwhile not (d/'arm.json').exists():\n if time.monotonic()-start>3:raise RuntimeError('no arm')\n time.sleep(.005)\nassert json.loads((d/'arm.json').read_text())==dict(op='arm',trialId=a.trial,nonce=nonce)\nrecord(dict(type='armed',schemaVersion=2,trialId=a.trial,controlId=control,nonce=nonce),True)\nmode=${JSON.stringify(mode)}\nif mode=='wait':time.sleep(30)\npairs=3 if mode=='complete' else 2\nfor i in range(pairs):\n record(dict(type='key',device='/dev/input/event23',code=code,value=1));time.sleep(.005)\n record(dict(type='key',device='/dev/input/event23',code=code,value=0));time.sleep(.005)\nstart=time.monotonic()\nwhile mode=='complete' and not (d/'stop.json').exists():\n if time.monotonic()-start>3:raise RuntimeError('no stop')\n time.sleep(.005)\nterminal=dict(type='terminal',schemaVersion=2,trialId=a.trial,controlId=control,complete=mode=='complete',inputsClosed=True,requiresSuccessfulExit=True,error=None if mode=='complete' else 'synthetic incomplete capture',keySignatures=[dict(device='/dev/input/event23',code=code,presses=pairs,releases=pairs,repeats=0)])\nrecord(terminal);os.fsync(f);os.close(f);print(json.dumps(terminal),flush=True)\nraise SystemExit(0 if mode=='complete' else 1)\n`, { mode: 0o600 });
  return { directory, observer, publisher };
}

test('foreground reader auto-arms, prompts only after ARM and stops at three actual fixture pairs', async () => {
  const f = await fixture();
  const prompts: string[] = [];
  try {
    const result = await captureSwitch({ controlId: 'blue', observerPath: f.observer, publisherPath: f.publisher,
      stagingRoot: f.directory, onArmed: value => prompts.push(value), timeoutMs: 5000 });
    assert.deepEqual(prompts, ['blue']); assert.equal(result.code, 30);
    const marker = JSON.parse(await readFile(join(dirname(result.evidencePath), 'stop.json'), 'utf8'));
    assert.equal(marker.op, 'stop');
    const pid = Number(await readFile(join(dirname(result.evidencePath), 'observer.pid'), 'utf8'));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('incomplete foreground capture is rejected and does not become an installation map', async () => {
  const f = await fixture('incomplete');
  try { await assert.rejects(captureSwitch({ controlId: 'blue', observerPath: f.observer, publisherPath: f.publisher,
    stagingRoot: f.directory, onArmed: () => {}, timeoutMs: 5000 }), /did not complete/); }
  finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('cancelling foreground capture reaps its owned reader', async () => {
  const f = await fixture('wait');
  const abort = new AbortController();
  try {
    await assert.rejects(captureSwitch({ controlId: 'blue', observerPath: f.observer, publisherPath: f.publisher,
      stagingRoot: f.directory, signal: abort.signal, onArmed: () => abort.abort(), timeoutMs: 5000 }), /abort/i);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('the deterministic CLI captures two named controls, saves their exact map and restores only its managed unit', async () => {
  const f = await fixture();
  const config = join(f.directory, 'peripheral.json');
  const session = join(f.directory, 'session.json');
  const unit = join(f.directory, 'show-tools-peripheral.service');
  const runner = '/release/bin/show-tools-peripheral';
  const actions: string[][] = [];
  let active = true;
  const answers = ['blue,yellow', '', '', '1', '2', 'yes'];
  const output: string[] = [];
  const command = async (args: readonly string[]) => {
    actions.push([...args]);
    assert.equal(args[1], 'show-tools-peripheral.service');
    if (args[0] === 'stop') active = false;
    if (args[0] === 'start') active = true;
    return { code: 0, stdout: args[0] === 'show' ? `LoadState=loaded\nActiveState=${active ? 'active' : 'inactive'}\nSubState=${active ? 'running' : 'dead'}\nMainPID=${active ? '1234' : '0'}\nFragmentPath=${unit}\nDropInPaths=\nNeedDaemonReload=no\nTasksCurrent=${active ? '1' : '0'}\nKillMode=control-group\n` : '' };
  };
  await writeFile(session, JSON.stringify(sessionProfile(f.directory)), { mode: 0o600 });
  await writeFile(unit, renderPeripheralUnit(runner, config), { mode: 0o600 });
  try {
    await runCommissioningCli(['--config', config, '--session-profile', session, '--helper', '/release/native/peripheral/peripheral-host', '--bench-dir', f.directory, '--runner', runner], {
      unitPath: unit, stagingRoot: f.directory, command, webService: inactiveWeb(), checkListenerAbsent: async () => {}, audioOff: async () => {},
      io: { question: async () => { const answer = answers.shift(); if (answer === undefined) throw Error('unexpected question'); return answer; }, write: value => output.push(value) },
    });
    const saved = JSON.parse(await readFile(config, 'utf8'));
    assert.deepEqual(saved.inputMap.switches.map((value: { controlId: string; code: number }) => [value.controlId, value.code]), [['blue', 30], ['yellow', 31]]);
    assert.deepEqual(saved.inputMap.leds.map((value: { sdkChannel: number }) => value.sdkChannel), [0, 1]);
    assert.equal(saved.inputMap.axis, undefined);
    assert.equal(actions.filter(args => args[0] === 'stop').length, 1);
    assert.equal(actions.filter(args => args[0] === 'start').length, 1);
    assert(output.join('').includes('ARMED: press and fully release blue three times'));
    assert(output.join('').includes('Saved 2 switch identities'));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('a foreign unit is refused before any service-control command', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-foreign-')));
  const unit = join(directory, 'show-tools-peripheral.service');
  await writeFile(unit, 'foreign unit', { mode: 0o600 });
  let commands = 0;
  try {
    const service = commissioningService({ profilePath: join(directory, 'config'), runner: '/release/runner', unitPath: unit,
      command: async () => { commands++; return { code: 0, stdout: '' }; } });
    await assert.rejects(service.stop(), /differs/);
    assert.equal(commands, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


for (const cancel of [false, true]) test(`the foreground TTY procedure ${cancel ? 'cancels and leaves the service stopped' : 'accepts real terminal answers'} without injected prompt IO`, { timeout: 20000 }, async () => {
  const f = await fixture(cancel ? 'wait' : 'complete');
  const config = join(f.directory, 'peripheral.json');
  const session = join(f.directory, 'session.json');
  const unit = join(f.directory, 'show-tools-peripheral.service');
  const runner = '/release/bin/show-tools-peripheral';
  const entry = join(f.directory, 'terminal.mts');
  const harness = join(f.directory, 'terminal.py');
  const actionsFile = join(f.directory, 'service-actions');
  const module = resolve(dirname(fileURLToPath(import.meta.url)), '../commissioning-cli.ts');
  await writeFile(session, JSON.stringify(sessionProfile(f.directory)), { mode: 0o600 });
  await writeFile(unit, renderPeripheralUnit(runner, config), { mode: 0o600 });
  await writeFile(entry, `import { appendFileSync } from 'node:fs';
import { runCommissioningCli } from ${JSON.stringify(module)};
let active=true;
await runCommissioningCli(['--config',${JSON.stringify(config)},'--session-profile',${JSON.stringify(session)},'--helper','/release/native/peripheral/peripheral-host','--bench-dir',${JSON.stringify(f.directory)},'--runner',${JSON.stringify(runner)}], {
  unitPath:${JSON.stringify(unit)},stagingRoot:${JSON.stringify(f.directory)},webService:{state:async()=>new Map([['ActiveState','inactive'],['MainPID','0'],['TasksCurrent','0']]),stop:async()=>{},start:async()=>{throw Error('must not start web')}},checkListenerAbsent:async()=>{},audioOff:async()=>{},
  command:async args=>{if(args[0]!=='show')appendFileSync(${JSON.stringify(actionsFile)},args[0]+'\\n');if(args[0]==='stop')active=false;if(args[0]==='start')active=true;
    return {code:0,stdout:args[0]==='show'?'LoadState=loaded\\nActiveState='+ (active?'active':'inactive') +'\\nMainPID='+ (active?'1234':'0') +'\\nFragmentPath='+${JSON.stringify(unit)}+'\\nDropInPaths=\\nNeedDaemonReload=no\\nTasksCurrent='+(active?'1':'0')+'\\nKillMode=control-group\\n':''};}
});
`, { mode: 0o600 });
  await writeFile(harness, `import json,os,pty,select,subprocess,sys,time
master,slave=pty.openpty()
child=subprocess.Popen([sys.argv[1],'--import','tsx',sys.argv[2]],stdin=slave,stdout=slave,stderr=slave,close_fds=True)
os.close(slave)
steps=[(b'names separated by commas:',b'blue,yellow\\n'),(b'capture blue.',b'\\n'),(b'capture yellow.',b'\\n'),(b'LED output for blue',b'1\\n'),(b'LED output for yellow',b'2\\n'),(b'connections and polarity are checked',b'yes\\n')]
if ${cancel ? 'True' : 'False'}:steps=[(b'names separated by commas:',b'blue,yellow\\n'),(b'capture blue.',b'\\n'),(b'ARMED: press and fully release blue',b'\\x03')]
buffer=b'';cursor=0;index=0;deadline=time.monotonic()+12
try:
 while time.monotonic()<deadline:
  readable,_,_=select.select([master],[],[],.05)
  if readable:
   try:chunk=os.read(master,4096)
   except OSError:break
   if not chunk:break
   buffer+=chunk
   if len(buffer)>32768:raise RuntimeError('TTY output limit')
   if index<len(steps) and steps[index][0] in buffer[cursor:]:
    cursor=len(buffer);os.write(master,steps[index][1]);index+=1
  if child.poll() is not None:break
 code=child.wait(timeout=2)
 print(json.dumps(dict(code=code,answers=index,transcript=buffer.decode(errors='replace'))))
finally:
 if child.poll() is None:
  child.terminate()
  try:child.wait(timeout=2)
  except subprocess.TimeoutExpired:child.kill();child.wait()
 os.close(master)
`, { mode: 0o600 });
  try {
    const { stdout } = await promisify(execFile)('/usr/bin/python3', [harness, process.execPath, entry], { cwd: process.cwd(), maxBuffer: 65536, timeout: 18000 });
    const result = JSON.parse(stdout);
    assert.equal(result.code, cancel ? 1 : 0, result.transcript); assert.equal(result.answers, cancel ? 3 : 6, result.transcript);
    assert.match(result.transcript, /ARMED: press and fully release blue/);
    assert.equal(await readFile(actionsFile, 'utf8'), cancel ? 'stop\n' : 'stop\nstart\n');
    await assert.rejects(readFile(config + '.commissioning.lock'), /ENOENT/);
    if (cancel) assert.equal(await profileSnapshot(config), null);
    else { assert.match(result.transcript, /Saved 2 switch identities/); assert.equal(JSON.parse(await readFile(config, 'utf8')).inputMap.switches.length, 2); }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});


async function motionFixture(multiple = false) {
  const f = await fixture();
  const reader = join(f.directory, 'raw_motion.py');
  await writeFile(reader, `import argparse,json,os,pathlib,time
p=argparse.ArgumentParser()
for n in ('directory','trial','direction','capture-seconds'):p.add_argument('--'+n,required=True)
a=p.parse_args();d=pathlib.Path(a.directory)
f=os.open(d/'trial.ndjson',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
def record(v,public=False):
 os.write(f,(json.dumps(v)+'\\n').encode())
 if public:print(json.dumps(v),flush=True)
record(dict(type='source',device='/dev/input/event24',canonical='/sys/synthetic/event24',eventClock='CLOCK_MONOTONIC',interfaceNumber=2,eventTypes=[0,2],keyCodes=[],relativeAxes=[0,1]))
nonce='b'*32
context=dict(schemaVersion=1,trialId=a.trial,controlId='knob',operatorDirection=a.direction)
record(dict(type='ready',nonce=nonce,**context),True)
start=time.monotonic()
while not (d/'arm.json').exists():
 if time.monotonic()-start>3:raise RuntimeError('no arm')
 time.sleep(.005)
record(dict(type='armed',nonce=nonce,**context),True)
axes=[]
for code in (${multiple ? '[0,1]' : '[1]'}):
 for value in (5,-5,5,-5):record(dict(type='motion',device='/dev/input/event24',eventType=2,code=code,value=value))
 axes.append(dict(device='/dev/input/event24',interfaceNumber=2,eventType=2,code=code,samples=4,delta=0,positiveCounts=10,negativeCounts=10))
terminal=dict(type='terminal',complete=True,inputsClosed=True,requiresSuccessfulExit=True,error=None,observedAxes=axes,**context)
record(terminal);os.fsync(f);os.close(f);print(json.dumps(terminal),flush=True)
`, { mode: 0o600 });
  return { ...f, reader };
}

test('foreground motion capture accepts a unique observed axis without guessing its polarity', async () => {
  const f = await motionFixture(); const prompts: string[] = [];
  try {
    const axis = await captureAxis({ readerPath: f.reader, publisherPath: f.publisher, stagingRoot: f.directory,
      direction: 'counterclockwise', captureSeconds: 1, onArmed: direction => prompts.push(direction), timeoutMs: 5000 });
    assert.deepEqual(prompts, ['counterclockwise']); assert.equal(axis.code, 1);
    assert.equal(axis.observations[0].delta, 0); assert.equal(axis.observations[0].samples, 4);
    assert.equal(axis.direction, 'counterclockwise');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

for (const explicit of [false, true]) test(`multiple observed axes ${explicit ? 'require and preserve explicit choice' : 'are rejected without an explicit choice'}`, async () => {
  const f = await motionFixture(true);
  try {
    const operation = captureAxis({ readerPath: f.reader, publisherPath: f.publisher, stagingRoot: f.directory,
      direction: 'clockwise', captureSeconds: 1, onArmed: () => {}, timeoutMs: 5000,
      ...(explicit ? { chooseAxis: async axes => { assert.deepEqual(axes.map(value => value.code), [0, 1]); return 1; } } : {}) });
    if (explicit) assert.equal((await operation).code, 1);
    else await assert.rejects(operation, /Multiple relative axes/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('the installed dial CLI uses the motion reader and preserves the existing button map', async () => {
  const f = await motionFixture();
  const config = join(f.directory, 'peripheral.json'); const session = join(f.directory, 'session.json');
  const desk = sessionProfile(f.directory);
  await writeFile(session, JSON.stringify(desk), { mode: 0o600 });
  const source = { interfaceNumber: 0, eventTypes: [0, 1], keyCodes: [30, 31], relativeAxes: [] };
  const inputMap = assembleInstallationMap({ switches: [{ controlId: 'blue', source, type: 1, code: 30, evidencePath: '/tmp/synthetic' },
    { controlId: 'yellow', source, type: 1, code: 31, evidencePath: '/tmp/synthetic' }], leds: [], confirmWiring: false });
  await saveCommissionedProfile(config, null, { version: 2, origin: desk.origin, tokenFile: desk.tokenFile,
    helperExecutable: '/release/native/peripheral/peripheral-host', bindingRevision: 1, jiggle: null, inputMap });
  const output: string[] = [];
  try {
    await runCommissioningCli(['--dial', '--direction', 'counterclockwise', '--capture-seconds', '1', '--jiggle-travel', '4', '--jiggle-reversal', '2', '--config', config,
      '--session-profile', session, '--runner', '/release/bin/show-tools-peripheral', '--bench-dir', f.directory], {
      stagingRoot: f.directory, webService: inactiveWeb(), checkListenerAbsent: async () => {}, audioOff: async () => {}, service: { inspect: async () => ({ active: false }), stop: async () => {}, start: async () => {} },
      io: { question: async () => '', write: text => output.push(text) } });
    const saved = JSON.parse(await readFile(config, 'utf8'));
    assert.deepEqual(saved.inputMap.switches, inputMap.switches); assert.equal(saved.inputMap.axis.code, 1);
    assert.deepEqual(saved.jiggle, { minimumTravel: 4, minimumReversal: 2 }); assert.match(output.join(''), /4 nonzero samples, signed delta 0/);
    const exact = await readFile(config);
    for (const flags of [['--jiggle-travel', '4'], ['--jiggle-travel', '4', '--jiggle-reversal', '0'],
      ['--jiggle-travel', '1', '--jiggle-reversal', '2'], ['--jiggle-travel', '32768', '--jiggle-reversal', '2'],
      ['--disable-jiggle', '--jiggle-travel', '4', '--jiggle-reversal', '2']]) {
      let inspected = false;
      await assert.rejects(runCommissioningCli(['--dial', '--config', config, '--session-profile', session,
        '--runner', '/release/bin/show-tools-peripheral', '--bench-dir', f.directory, ...flags], {
        stagingRoot: f.directory, webService: inactiveWeb(), checkListenerAbsent: async () => {}, audioOff: async () => {},
        service: { inspect: async () => { inspected = true; return { active: false }; }, stop: async () => {}, start: async () => {} },
        io: { question: async () => '', write: () => {} } }), /jiggle/);
      assert.equal(inspected, false); assert.deepEqual(await readFile(config), exact);
    }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('service status reports the normal unconfigured state without inventing a map', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-empty-status-')));
  const config = join(directory, 'peripheral.json'); const output: string[] = [];
  try {
    await runCommissioningCli(['--status', '--config', config, '--runner', '/release/bin/show-tools-peripheral'], {
      service: { inspect: async () => ({ active: true }), stop: async () => { throw Error('must not stop'); }, start: async () => { throw Error('must not start'); } },
      io: { question: async () => { throw Error('must not ask'); }, write: value => output.push(value) } });
    assert.match(output.join(''), /active\. No input map is saved/); assert.equal(await profileSnapshot(config), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI dial cancellation during the final audio-off check cannot publish or restart', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'commission-cli-cancel-save-')));
  const path = join(directory, 'peripheral.json');
  const session = sessionProfile(directory);
  const source = { interfaceNumber: 0, eventTypes: [0, 1], keyCodes: [30, 31], relativeAxes: [] };
  const switches = (['blue', 'yellow'] as const).map((controlId, i) => ({ controlId, source, type: 1 as const, code: 30 + i, evidencePath: '/tmp/synthetic' }));
  const original = { version: 2 as const, origin: session.origin, tokenFile: session.tokenFile, helperExecutable: '/release/helper', bindingRevision: 1,
    jiggle: null, inputMap: assembleInstallationMap({ switches, leds: [], confirmWiring: false }) };
  await saveCommissionedProfile(path, null, original);
  const before = await readFile(path);
  const sessionPath = join(directory, 'session.json'); await writeFile(sessionPath, JSON.stringify(session));
  const controller = new AbortController(); let checks = 0, started = false;
  try {
    await assert.rejects(runCommissioningCli(['--dial', '--config', path, '--session-profile', sessionPath, '--runner', '/release/runner', '--helper', '/release/helper', '--bench-dir', directory], {
      stagingRoot: directory, signal: controller.signal, webService: inactiveWeb(), checkListenerAbsent: async () => {},
      service: { inspect: async () => ({ active: true }), stop: async () => {}, start: async () => { started = true; } },
      audioOff: async () => { if (++checks === 3) controller.abort(new Error('operator Ctrl-C before publication')); },
      io: { question: async () => '', write: () => {} },
      captureAxis: async () => ({ source: { interfaceNumber: 2, eventTypes: [0, 2], keyCodes: [], relativeAxes: [1] }, type: 2, code: 1, evidencePath: '/tmp/synthetic' }),
    }), /operator Ctrl-C before publication/);
    assert.deepEqual(await readFile(path), before); assert.equal(started, false); assert.equal(checks, 3);
    await assert.rejects(readFile(path + '.commissioning.lock'), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function dialMaintenanceFixture() {
  const f = await fixture();
  const config = join(f.directory, 'peripheral.json'), sessionPath = join(f.directory, 'session.json');
  const session = sessionProfile(f.directory);
  await writeFile(sessionPath, JSON.stringify(session));
  const source = { interfaceNumber: 0, eventTypes: [0, 1], keyCodes: [30, 31], relativeAxes: [] };
  const inputMap = assembleInstallationMap({ switches: [
    { controlId: 'blue', source, type: 1, code: 30, evidencePath: '/tmp/synthetic' },
    { controlId: 'yellow', source, type: 1, code: 31, evidencePath: '/tmp/synthetic' }], leds: [], confirmWiring: false });
  await saveCommissionedProfile(config, null, { version: 2, origin: session.origin, tokenFile: session.tokenFile,
    helperExecutable: '/release/helper', bindingRevision: 1, jiggle: null, inputMap });
  const args = ['--dial', '--config', config, '--session-profile', sessionPath, '--runner', '/release/runner', '--bench-dir', f.directory];
  const axis = { source: { interfaceNumber: 2, eventTypes: [0, 2], keyCodes: [], relativeAxes: [1] }, type: 2 as const, code: 1, evidencePath: '/tmp/synthetic' };
  return { ...f, config, sessionPath, session, args, axis };
}

function trackedWeb(initialActive: boolean) {
  let active = initialActive;
  const actions: string[] = [];
  const service = { state: async () => new Map([['ActiveState', active ? 'active' : 'inactive'], ['MainPID', active ? '4321' : '0'], ['TasksCurrent', active ? '1' : '0']]),
    stop: async () => { actions.push('web stop'); active = false; },
    start: async () => { actions.push('web start'); active = true; } };
  return { service, actions, activate: () => { active = true; }, active: () => active };
}

for (const initialActive of [false, true]) test(`explicit offline setup restores only a previously ${initialActive ? 'active' : 'inactive'} web service`, async () => {
  const f = await dialMaintenanceFixture(), web = trackedWeb(initialActive);
  const actions = web.actions;
  try {
    await runCommissioningCli([...f.args, '--stop-performance'], {
      stagingRoot: f.directory, webService: web.service, checkListenerAbsent: async () => { assert.equal(web.active(), false); },
      service: { inspect: async () => { actions.push('peripheral inspect'); assert.equal(web.active(), false); return { active: true }; },
        stop: async () => { actions.push('peripheral stop'); }, start: async () => { actions.push('peripheral start'); } },
      captureAxis: async () => { actions.push('capture and close reader'); assert.equal(web.active(), false); return f.axis; },
      io: { question: async () => '', write: () => {} },
    });
    assert(actions.indexOf('web stop') < actions.indexOf('peripheral stop'));
    assert(actions.indexOf('capture and close reader') < actions.indexOf('peripheral start'));
    assert.equal(web.active(), initialActive);
    if (initialActive) assert(actions.indexOf('peripheral start') < actions.indexOf('web start'));
    else assert(!actions.includes('web start'));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('active web setup needs explicit stop intent before touching the peripheral or profile', async () => {
  const f = await dialMaintenanceFixture(), web = trackedWeb(true);
  const before = await readFile(f.config);
  let touched = false;
  try {
    await assert.rejects(runCommissioningCli(f.args, {
      stagingRoot: f.directory, webService: web.service, checkListenerAbsent: async () => {},
      service: { inspect: async () => { touched = true; return { active: true }; }, stop: async () => { touched = true; }, start: async () => { touched = true; } },
      captureAxis: async () => { touched = true; return f.axis; }, io: { question: async () => '', write: () => {} },
    }), /--stop-performance/);
    assert.equal(touched, false); assert.deepEqual(web.actions, []); assert.deepEqual(await readFile(f.config), before);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

for (const cancel of [false, true]) test(`offline setup ${cancel ? 'cancellation' : 'unexpected web restart'} leaves services stopped and preserves the precommit profile`, async () => {
  const f = await dialMaintenanceFixture(), web = trackedWeb(true), controller = new AbortController();
  const before = await readFile(f.config); let peripheralStarted = false;
  try {
    await assert.rejects(runCommissioningCli([...f.args, '--stop-performance'], {
      stagingRoot: f.directory, signal: controller.signal, webService: web.service, checkListenerAbsent: async () => {},
      service: { inspect: async () => ({ active: true }), stop: async () => {}, start: async () => { peripheralStarted = true; } },
      captureAxis: async () => { if (cancel) controller.abort(new Error('operator cancelled offline setup')); else web.activate(); return f.axis; },
      io: { question: async () => '', write: () => {} },
    }), cancel ? /operator cancelled offline setup/ : /restarted during hardware setup/);
    assert.equal(web.active(), false); assert.equal(peripheralStarted, false); assert(!web.actions.includes('web start'));
    assert.deepEqual(await readFile(f.config), before); await assert.rejects(readFile(f.config + '.commissioning.lock'), /ENOENT/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('the verified web stop closes an actual listener before capture and restores it only afterwards', async () => {
  const f = await dialMaintenanceFixture();
  const server = createServer((_request, response) => { response.writeHead(503); response.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const session = { ...f.session, port: address.port, origin: `http://127.0.0.1:${address.port}` };
  const config = JSON.parse(await readFile(f.config, 'utf8')); config.origin = session.origin;
  await writeFile(f.config, JSON.stringify(config)); await writeFile(f.sessionPath, JSON.stringify(session));
  await writeFile(session.tokenFile, '0123456789abcdef0123456789abcdef', { mode: 0o600 });
  const unitDirectory = join(f.directory, 'systemd/user'); await mkdir(unitDirectory, { recursive: true });
  const unit = join(unitDirectory, session.serviceName); await writeFile(unit, renderSessionUnit(session, f.sessionPath), { mode: 0o600 });
  let active = true, captured = false;
  const webService = createSessionService(session, f.sessionPath, { configDirectory: f.directory,
    run: async (executable, args) => {
      assert.equal(executable, 'systemctl'); assert.equal(args[0], '--user');
      if (args[1] === 'stop') { await new Promise<void>(done => server.close(() => done())); active = false; }
      if (args[1] === 'start') { assert.equal(captured, true); server.listen(address.port, '127.0.0.1'); await once(server, 'listening'); active = true; }
      return { code: 0, stdout: args[1] === 'show' ? `LoadState=loaded\nActiveState=${active ? 'active' : 'inactive'}\nMainPID=${active ? '4321' : '0'}\nTasksCurrent=${active ? '1' : '0'}\nFragmentPath=${unit}\nDropInPaths=\n` : '' };
    } });
  try {
    await runCommissioningCli([...f.args, '--stop-performance'], {
      stagingRoot: f.directory, webService,
      service: { inspect: async () => ({ active: false }), stop: async () => {}, start: async () => {} },
      captureAxis: async () => {
        await assert.rejects(fetch(session.origin + '/api/audio', { method: 'POST', body: '{"goal":"on"}' }));
        captured = true; return f.axis;
      }, io: { question: async () => '', write: () => {} },
    });
    assert.equal(active, true); assert.equal((await fetch(session.origin)).status, 503);
  } finally { if (server.listening) await new Promise<void>(done => server.close(() => done())); await rm(f.directory, { recursive: true, force: true }); }
});

test('a listener outside the stopped named web service blocks setup before touching USB or saving', async () => {
  const f = await dialMaintenanceFixture();
  const server = createServer((_request, response) => { response.writeHead(503); response.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const session = { ...f.session, port: address.port, origin: `http://127.0.0.1:${address.port}` };
  const config = JSON.parse(await readFile(f.config, 'utf8')); config.origin = session.origin;
  await writeFile(f.config, JSON.stringify(config)); await writeFile(f.sessionPath, JSON.stringify(session));
  await writeFile(session.tokenFile, '0123456789abcdef0123456789abcdef', { mode: 0o600 });
  const before = await readFile(f.config); let touched = false;
  try {
    await assert.rejects(runCommissioningCli(f.args, { stagingRoot: f.directory, webService: inactiveWeb(),
      service: { inspect: async () => { touched = true; return { active: false }; }, stop: async () => { touched = true; }, start: async () => { touched = true; } },
      captureAxis: async () => { touched = true; return f.axis; }, io: { question: async () => '', write: () => {} } }), /failed \(503\)/);
    assert.equal(touched, false); assert.deepEqual(await readFile(f.config), before);
  } finally { await new Promise<void>(done => server.close(() => done())); await rm(f.directory, { recursive: true, force: true }); }
});

test('a competing setup cannot stop or restore web while the first reader owns the configuration lock', async () => {
  const f = await dialMaintenanceFixture(), web = trackedWeb(true);
  let releaseCapture: () => void = () => { throw Error('capture not started'); };
  let captureStarted: () => void = () => {};
  const started = new Promise<void>(resolve => { captureStarted = resolve; });
  const gate = new Promise<void>(resolve => { releaseCapture = resolve; });
  const options = { stagingRoot: f.directory, webService: web.service, checkListenerAbsent: async () => {},
    service: { inspect: async () => ({ active: false }), stop: async () => {}, start: async () => {} },
    captureAxis: async () => { captureStarted(); await gate; return f.axis; }, io: { question: async () => '', write: () => {} } };
  const first = runCommissioningCli([...f.args, '--stop-performance'], options);
  try {
    await started;
    await assert.rejects(runCommissioningCli([...f.args, '--stop-performance'], options), /already active or left a lock/);
    assert.deepEqual(web.actions, ['web stop']); assert.equal(web.active(), false);
    releaseCapture(); await first; assert.deepEqual(web.actions, ['web stop', 'web start']);
  } finally { releaseCapture(); await first.catch(() => {}); await rm(f.directory, { recursive: true, force: true }); }
});

test('offline setup refuses a foreign web unit before issuing stop or opening a reader', async () => {
  const f = await dialMaintenanceFixture();
  const directory = join(f.directory, 'systemd/user'); await mkdir(directory, { recursive: true });
  const unit = join(directory, f.session.serviceName); await writeFile(unit, 'foreign web unit', { mode: 0o600 });
  const commands: string[][] = [];
  const webService = createSessionService(f.session, f.sessionPath, { configDirectory: f.directory,
    run: async (_executable, args) => { commands.push([...args]); return { code: 0, stdout: `LoadState=loaded\nActiveState=inactive\nMainPID=0\nTasksCurrent=0\nFragmentPath=${unit}\nDropInPaths=\n` }; } });
  let touched = false;
  try {
    await assert.rejects(runCommissioningCli([...f.args, '--stop-performance'], { stagingRoot: f.directory, webService,
      checkListenerAbsent: async () => { touched = true; },
      service: { inspect: async () => { touched = true; return { active: false }; }, stop: async () => { touched = true; }, start: async () => { touched = true; } },
      io: { question: async () => '', write: () => {} } }), /Installed user unit differs/);
    assert.equal(touched, false); assert.equal(commands.length, 1); assert.equal(commands[0]?.[1], 'show');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

for (const stage of ['before-dispatch', 'after-dispatch', 'unconfirmed-stop']) test(`restore cancellation ${stage} preserves publication truth and confirms cleanup`, async () => {
  const f = await dialMaintenanceFixture(), controller = new AbortController();
  const before = await readFile(f.config);
  const unitDirectory = join(f.directory, 'systemd/user'); await mkdir(unitDirectory, { recursive: true });
  const unit = join(unitDirectory, f.session.serviceName);
  await writeFile(unit, renderSessionUnit(f.session, f.sessionPath), { mode: 0o600 });
  let active = true, captured = false, stops = 0, savedShows = 0;
  const actions: string[] = [], output: string[] = [];
  const webService = createSessionService(f.session, f.sessionPath, { configDirectory: f.directory,
    run: async (executable, args) => {
      assert.equal(executable, 'systemctl');
      const operation = args[1] ?? ''; actions.push(operation);
      if (operation === 'show' && captured && !before.equals(await readFile(f.config)) && ++savedShows === 2 && stage === 'before-dispatch')
        controller.abort(new Error('cancel inside restore verification'));
      if (operation === 'start') { active = true; controller.abort(new Error('cancel after start dispatch')); }
      if (operation === 'stop') {
        stops++;
        if (stops === 2 && stage === 'unconfirmed-stop') return { code: 1, stdout: '' };
        active = false;
      }
      return { code: 0, stdout: operation === 'show' ? `LoadState=loaded\nActiveState=${active ? 'active' : 'inactive'}\nMainPID=${active ? '4321' : '0'}\nTasksCurrent=${active ? '1' : '0'}\nFragmentPath=${unit}\nDropInPaths=\n` : '' };
    } });
  try {
    await assert.rejects(runCommissioningCli([...f.args, '--stop-performance'], {
      stagingRoot: f.directory, signal: controller.signal, webService, checkListenerAbsent: async () => {},
      service: { inspect: async () => ({ active: false }), stop: async () => {}, start: async () => {} },
      captureAxis: async () => { captured = true; return f.axis; },
      io: { question: async () => '', write: message => { output.push(message); } },
    }), stage === 'unconfirmed-stop' ? /Configuration saved\. Web restoration cancelled; stopping .* is unconfirmed/ : /Configuration saved\. Web restoration cancelled; .* is verified stopped/);
    assert(controller.signal.aborted);
    assert(!before.equals(await readFile(f.config)), 'the successfully published map remains saved');
    assert.equal(actions.includes('start'), stage !== 'before-dispatch');
    assert.equal(stops, 2);
    assert.equal(active, stage === 'unconfirmed-stop');
    assert(!output.some(message => message.includes('restarted. Audio is off')));
    await assert.rejects(readFile(f.config + '.commissioning.lock'), /ENOENT/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
