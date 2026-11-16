import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureSwitch, profileSnapshot } from '../commissioning.js';
import { commissioningService, runCommissioningCli } from '../commissioning-cli.js';
import { renderPeripheralUnit } from '../service-unit.js';
import { sessionProfile } from '../../remote-performance/tests/session-fixture.js';

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
      unitPath: unit, stagingRoot: f.directory, command, audioOff: async () => {},
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


for (const cancel of [false, true]) test(`the foreground TTY procedure ${cancel ? 'cancels and restores the service' : 'accepts real terminal answers'} without injected prompt IO`, { timeout: 20000 }, async () => {
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
  unitPath:${JSON.stringify(unit)},stagingRoot:${JSON.stringify(f.directory)},audioOff:async()=>{},
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
    assert.equal(await readFile(actionsFile, 'utf8'), 'stop\nstart\n');
    await assert.rejects(readFile(config + '.commissioning.lock'), /ENOENT/);
    if (cancel) assert.equal(await profileSnapshot(config), null);
    else { assert.match(result.transcript, /Saved 2 switch identities/); assert.equal(JSON.parse(await readFile(config, 'utf8')).inputMap.switches.length, 2); }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
