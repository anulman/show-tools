import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,readFile,writeFile,rm,symlink,link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runSceneAuthoringCli } from '../scene-authoring.js';
import { SceneAuthoringStore } from '../../lib/video/scene-authoring/store.js';
import { parseSnapshot } from '../../lib/video/scene-authoring/model.js';
import { inspectSceneChart } from '../../lib/video/scene-authoring/intake.js';

const execute=promisify(execFile);
const song='dance-yrself-clean';
const chartPath=fileURLToPath(new URL('../../songs/dance-yrself-clean.musicxml',import.meta.url));
async function run(args:string[]) {
  let stdout='',stderr='';
  const code=await runSceneAuthoringCli(args,text=>{stdout+=text;},text=>{stderr+=text;});
  return {code,stdout,stderr};
}
async function fixture(action:(directory:string,database:string)=>Promise<void>) {
  const directory=await mkdtemp(join(tmpdir(),'scene-command-'));
  try { await action(directory,join(directory,'scenes.sqlite')); }
  finally { await rm(directory,{recursive:true,force:true}); }
}
function snapshot(database:string) {
  const store=SceneAuthoringStore.open(database);
  try { return store.read(song); } finally { store.close(); }
}

test('CLI saves exact raw words without inventing scenes, and retries without duplication', async()=>fixture(async(directory,database)=>{
  assert.equal((await run(['init','--database',database])).code,0);
  const base=snapshot(database).stamp;
  const operatorText='  Exact original words\r\nλ, tapir & gator.\n';
  const request={operationId:'request-1',songId:song,base,input:{kind:'new',value:{id:'message-1',operatorText,origin:'test conversation'}},scenes:[]};
  const input=join(directory,'chunk.json');await writeFile(input,JSON.stringify(request));
  assert.equal((await run(['ingest','--database',database,'--input',input])).code,0);
  assert.equal((await run(['ingest','--database',database,'--input',input])).code,0);
  const read=await run(['read','--database',database,'--song',song]);
  const actual=parseSnapshot(JSON.parse(read.stdout));
  assert.equal(actual.inputs[0]?.operatorText,operatorText);assert.deepEqual(actual.document.scenes,[]);assert.equal(actual.stamp.revision,1);
  await writeFile(input,JSON.stringify({...request,input:{...request.input,value:{...request.input.value,operatorText:'different'}}}));
  const rejected=await run(['ingest','--database',database,'--input',input,'--json']);
  assert.equal(rejected.code,2);assert.match(rejected.stdout,/"status":"blocked"/);assert.equal(snapshot(database).inputs[0]?.operatorText,operatorText);
}));

test('CLI binds actual MusicXML and reports source-bound gaps without guessing a script', async()=>fixture(async(directory,database)=>{
  const store=SceneAuthoringStore.initialize(database);store.close();
  const input=join(directory,'base.json');await writeFile(input,JSON.stringify({base:snapshot(database).stamp}));
  const bind=await run(['bind-chart','--database',database,'--song',song,'--input',input,'--musicxml',chartPath]);
  assert.equal(bind.code,0,bind.stderr);
  const chart=await inspectSceneChart(await readFile(chartPath,'utf8'));
  assert.deepEqual(snapshot(database).document.chart,{kind:'bound',...chart});
  const inspected=await run(['inspect','--database',database,'--song',song,'--musicxml',chartPath]);
  assert.equal(inspected.code,0);assert.match(inspected.stdout,/GAPS/);assert.match(inspected.stdout,/not-admitted/);
  const output=join(directory,'draft.json');
  assert.equal((await run(['export','--database',database,'--song',song,'--musicxml',chartPath,'--output',output])).code,0);
  assert.deepEqual(parseSnapshot(JSON.parse(await readFile(output,'utf8')).snapshot).document.scenes,[]);
  const intake=await run(['intake','--database',database,'--song',song,'--musicxml',chartPath,'--json']);
  assert.equal(intake.code,2);assert.match(intake.stdout,/SCENE_INTAKE_BLOCKED/);
}));

test('CLI refuses database, journal and source aliases while preserving the authority', async()=>fixture(async(directory,database)=>{
  SceneAuthoringStore.initialize(database).close();
  const before=await readFile(database);
  const alias=join(directory,'db-alias.json');await link(database,alias);
  for (const output of [database,database+'-wal',database+'-journal',alias]) {
    const result=await run(['export','--database',database,'--song',song,'--output',output,'--json']);
    assert.equal(result.code,2,result.stdout);assert.match(result.stdout,/blocked/);
    assert.deepEqual(await readFile(database),before);
  }
  const source=join(directory,'source.musicxml');await writeFile(source,await readFile(chartPath));
  const result=await run(['export','--database',database,'--song',song,'--musicxml',source,'--output',source,'--json']);
  assert.equal(result.code,2);assert.deepEqual(await readFile(source),await readFile(chartPath));
}));

test('CLI rejects ambiguous paths and input flags before database creation', async()=>fixture(async(directory,database)=>{
  for (const args of [['init','--database','relative.sqlite'],['init','--database',database,'--database',database],['init','--database',database,'--input','not-used.json']]) {
    const result=await run([...args,'--json']);assert.equal(result.code,2,result.stdout);assert.match(result.stdout,/SCENE_USAGE|DATABASE_PATH/);
  }
  await assert.rejects(readFile(database),{code:'ENOENT'});
  const missing=await run(['read','--database',database,'--song',song,'--json']);
  assert.ok(missing.code!==0);await assert.rejects(readFile(database),{code:'ENOENT'});
}));

test('physical and checkout-alias CLI help execute, while API import stays inert', async()=>fixture(async(directory)=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const alias=join(directory,'checkout');await symlink(root,alias,'dir');
  for (const entry of [join(root,'scripts/scene-authoring.ts'),join(alias,'scripts/scene-authoring.ts')]) {
    const result=await execute(process.execPath,['--import','tsx',entry,'--help'],{cwd:root});assert.match(result.stdout,/Usage: show-tools scenes/);
  }
  const imported=await execute(process.execPath,['--import','tsx','--input-type=module','-e',"await import('./scripts/scene-authoring.ts')"],{cwd:root});assert.equal(imported.stdout,'');
  const routed=await execute(process.execPath,['--import','tsx','scripts/show-tools.ts','scenes','--help'],{cwd:root});assert.match(routed.stdout,/Usage: show-tools scenes/);
}));

test('invalid UTF-8 transport is rejected instead of changing original words', async()=>fixture(async(directory,database)=>{
  SceneAuthoringStore.initialize(database).close();
  const before=snapshot(database);const input=join(directory,'invalid.json');
  await writeFile(input,Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]));
  const result=await run(['ingest','--database',database,'--input',input,'--json']);
  assert.equal(result.code,2);assert.match(result.stdout,/INVALID_UTF8_INPUT/);assert.deepEqual(snapshot(database),before);
}));
