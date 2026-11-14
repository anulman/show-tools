import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SceneAuthoringError } from '../model.js';
import type { ChartFacts, IngestRequest, SceneOccurrence } from '../model.js';
import { SceneAuthoringStore } from '../store.js';

const songId = 'dance-yrself-clean';
const otherSong = 'i-can-change';
const scene: SceneOccurrence = { id:'scene-one',label:'Operator label',description:'Draft setting, not promoted',
  range:{ kind:'unresolved',text:'bars not provided yet' },stage:{ kind:'unbound' },sourceInputIds:[] };
function request(store: SceneAuthoringStore, operationId = 'operation-one', song = songId): IngestRequest {
  return { operationId,songId:song,base:store.read(song).stamp,
    input:{ kind:'new',value:{ id:operationId,operatorText:'  Original words.\r\n\n— 🎵  ',origin:'explicit operator message' } },scenes:[scene] };
}
async function fixture(run: (files: { directory:string; filename:string; store:SceneAuthoringStore }) => void | Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(),'scene-authoring-'));
  const filename = join(directory,'scene #?.sqlite');
  const store = SceneAuthoringStore.initialize(filename);
  try { await run({ directory,filename,store }); }
  finally { store.close(); await rm(directory,{ recursive:true,force:true }); }
}
function hasCode(code: string) {
  return (error: unknown) => error instanceof SceneAuthoringError && error.code === code;
}

test('new stores persist exact operator words and raw-only inputs across reopen', async () => {
  await fixture(async ({ filename,store }) => {
    const first = request(store);
    const input = { ...first,input:{ kind:'new',value:{ id:'raw-input',operatorText:'  Original words.\r\n\n— 🎵  \ud800',origin:'explicit operator message' } },scenes:[] };
    const saved = store.ingest(input);
    assert.equal(saved.kind,'saved'); assert.equal(saved.snapshot.stamp.revision,1);
    assert.equal(saved.snapshot.inputs[0]?.operatorText,input.input.kind === 'new' ? input.input.value.operatorText : '');
    assert.deepEqual(saved.snapshot.document.scenes,[]);
    assert.deepEqual(saved.snapshot.review,{ kind:'draft' }); assert.deepEqual(saved.snapshot.runtime,{ kind:'not-admitted' });
    const reopened = SceneAuthoringStore.open(filename);
    try { assert.deepEqual(reopened.read(songId),saved.snapshot); }
    finally { reopened.close(); }
  });
});

test('initialization is idempotent but never adopts another database or unsupported schema', async () => {
  await fixture(async ({ directory,filename,store }) => {
    store.ingest(request(store));
    const reopened = SceneAuthoringStore.initialize(filename);
    try { assert.deepEqual(reopened.read(songId),store.read(songId)); } finally { reopened.close(); }
    const unrelated = join(directory,'unrelated.sqlite');
    const database = new DatabaseSync(unrelated); database.exec('CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES (\'keep\')'); database.close();
    const before = await readFile(unrelated);
    assert.throws(() => SceneAuthoringStore.initialize(unrelated),hasCode('UNSUPPORTED_SCENE_STORE_SCHEMA'));
    assert.deepEqual(await readFile(unrelated),before);
    const corrupt = join(directory,'corrupt.sqlite'); await writeFile(corrupt,'do not overwrite');
    assert.throws(() => SceneAuthoringStore.open(corrupt),hasCode('INVALID_SCENE_STORE'));
    assert.equal(await readFile(corrupt,'utf8'),'do not overwrite');
    const missing = join(directory,'missing.sqlite'); assert.throws(() => SceneAuthoringStore.open(missing)); await assert.rejects(access(missing));
  });
});

test('open rejects weakened constraints and extra triggers, views or indexes without changing files', async () => {
  await fixture(async ({ directory,filename,store }) => {
    const metadata = store.read(songId).stamp;
    const source = new DatabaseSync(filename);
    const tables = source.prepare("SELECT name,sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all(); source.close();
    const weakened = join(directory,'weakened.sqlite');
    const weakDatabase = new DatabaseSync(weakened);
    weakDatabase.exec('PRAGMA application_id = 1396919877; PRAGMA user_version = 1;');
    for (const row of tables) {
      assert.ok(typeof row.sql === 'string');
      weakDatabase.exec(row.name === 'scene_songs' ? row.sql.replace('CHECK(revision >= 0)','') : row.sql);
    }
    weakDatabase.prepare('INSERT INTO scene_metadata VALUES (1,1,?,?)').run(metadata.databaseId,metadata.generationId); weakDatabase.close();
    const before = await readFile(weakened);
    assert.throws(() => SceneAuthoringStore.open(weakened),hasCode('UNSUPPORTED_SCENE_STORE_SCHEMA'));
    assert.deepEqual(await readFile(weakened),before);
    for (const [create,drop] of [
      ["CREATE TRIGGER extra_trigger AFTER INSERT ON scene_songs BEGIN SELECT 1; END",'DROP TRIGGER extra_trigger'],
      ['CREATE VIEW extra_view AS SELECT song_id FROM scene_songs','DROP VIEW extra_view'],
      ['CREATE INDEX extra_index ON scene_songs(revision)','DROP INDEX extra_index'],
    ]) {
      const database = new DatabaseSync(filename); database.exec(create); database.close();
      const bytes = await readFile(filename);
      assert.throws(() => SceneAuthoringStore.open(filename),hasCode('UNSUPPORTED_SCENE_STORE_SCHEMA'));
      assert.deepEqual(await readFile(filename),bytes);
      const cleanup = new DatabaseSync(filename); cleanup.exec(drop); cleanup.close();
    }
  });
});

test('compact receipt kinds and IDs must match their scopes and existing revisions', async () => {
  await fixture(async ({ filename,store }) => {
    store.ingest(request(store));
    const database = new DatabaseSync(filename);
    const original = database.prepare('SELECT * FROM scene_receipts').get(); assert.ok(original);
    const cases = [
      { scope:'song:'+songId,result:{ kind:'stage-write',revision:1 } },
      { scope:'stage:missing-stage',result:{ kind:'stage-write',revision:1 } },
      { scope:'song:'+otherSong,result:{ kind:'song-write',revision:1 } },
      { scope:'song:'+songId,result:{ kind:'song-write',revision:99 } },
    ];
    for (const value of cases) {
      database.prepare('UPDATE scene_receipts SET scope = ?, result_json = ?').run(value.scope,JSON.stringify(value.result));
      const before = await readFile(filename);
      assert.throws(() => SceneAuthoringStore.open(filename),hasCode('INVALID_SCENE_STORE'));
      assert.deepEqual(await readFile(filename),before);
    }
    database.prepare('UPDATE scene_receipts SET scope = ?, result_json = ?').run(original.scope,original.result_json);
    database.close();
    const reopened = SceneAuthoringStore.open(filename); reopened.close();
  });
});

test('paths cannot escape through NUL aliases and orphan journals are not adopted', async () => {
  await fixture(async ({ directory,filename }) => {
    assert.throws(() => SceneAuthoringStore.open('relative.sqlite'),hasCode('INVALID_DATABASE_PATH'));
    assert.throws(() => SceneAuthoringStore.open(filename+'\0suffix'),hasCode('INVALID_DATABASE_PATH'));
    const main = join(directory,'orphan.sqlite'); await writeFile(main+'-journal','keep this sidecar');
    assert.throws(() => SceneAuthoringStore.initialize(main),hasCode('EXISTING_DATABASE_SIDECARS'));
    await assert.rejects(access(main)); assert.equal(await readFile(main+'-journal','utf8'),'keep this sidecar');
  });
});

test('exact operation retries are idempotent before revision checks, but changed payloads conflict', async () => {
  await fixture(({ filename,store }) => {
    const first = request(store); const result = store.ingest(first);
    const later = store.ingest(request(store,'later-operation'));
    const retry = store.ingest(first);
    assert.equal(retry.kind,'unchanged'); assert.deepEqual(retry.snapshot,later.snapshot);
    assert.equal(retry.operationRevision,result.operationRevision); assert.equal(retry.operationRevision,1);
    const database = new DatabaseSync(filename);
    const receipts = database.prepare('SELECT result_json FROM scene_receipts ORDER BY operation_id').all();
    database.close();
    for (const row of receipts) {
      assert.ok(typeof row.result_json === 'string');
      assert.equal(row.result_json.includes('operatorText'),false);
      assert.deepEqual(Object.keys(JSON.parse(row.result_json)).sort(),['kind','revision']);
    }
    assert.equal(store.read(songId).stamp.revision,2);
    assert.throws(() => store.ingest({ ...first,scenes:[] }),hasCode('OPERATION_ID_CONFLICT'));
    assert.equal(store.read(songId).stamp.revision,2);
  });
});

test('separate song revisions do not conflict and stale same-song writers cannot overwrite', async () => {
  await fixture(({ filename,store }) => {
    const second = SceneAuthoringStore.open(filename);
    try {
      const firstSong = request(store);
      const secondSong = request(second,'other-song',otherSong);
      const stale = request(second,'stale');
      store.ingest(firstSong); second.ingest(secondSong);
      assert.equal(store.read(songId).stamp.revision,1); assert.equal(store.read(otherSong).stamp.revision,1);
      assert.throws(() => second.ingest(stale),hasCode('REVISION_CONFLICT'));
      assert.equal(second.read(songId).inputs.length,1);
    } finally { second.close(); }
  });
});

test('database identity and restore generation are checked before accepting an old receipt', async () => {
  await fixture(({ filename,store }) => {
    const original = request(store); store.ingest(original);
    const database = new DatabaseSync(filename); database.prepare('UPDATE scene_metadata SET generation_id = ?').run(randomUUID()); database.close();
    assert.throws(() => store.ingest(original),hasCode('STORE_IDENTITY_CONFLICT'));
    const current = store.read(songId);
    assert.notEqual(current.stamp.generationId,original.base.generationId);
    assert.equal(current.inputs.length,1);
  });
});

test('scene updates preserve earlier source links, old words and unmentioned scenes', async () => {
  await fixture(({ store }) => {
    const first = request(store); store.ingest({ ...first,scenes:[scene,{ ...scene,id:'another-scene' }] });
    const update = request(store,'correction');
    const changed = store.ingest({ ...update,scenes:[{ ...scene,range:{ kind:'known',startBar:200,endBar:400 },stage:{ kind:'reference',id:'missing-stage',revision:1 } }] });
    assert.equal(changed.snapshot.inputs.length,2);
    assert.deepEqual(changed.snapshot.document.scenes[0]?.sourceInputIds,['operation-one','correction']);
    assert.deepEqual(changed.snapshot.document.scenes[1]?.sourceInputIds,['operation-one']);
    assert.equal(changed.snapshot.document.scenes[0]?.range.kind,'known');
    const immutable = request(store,'replace-original');
    assert.throws(() => store.ingest({ ...immutable,input:{ kind:'new',value:{ id:'operation-one',operatorText:'changed original',origin:'different' } } }),hasCode('IMMUTABLE_OPERATOR_INPUT'));
    assert.equal(store.read(songId).inputs[0]?.id,'correction');
    const crossSong = request(store,'cross-song',otherSong);
    assert.throws(() => store.ingest({ ...crossSong,scenes:[{ ...scene,sourceInputIds:['operation-one'] }] }),hasCode('UNKNOWN_OPERATOR_INPUT'));
    assert.equal(store.read(otherSong).stamp.revision,0);
  });
});

test('malformed normalized data and failed writes preserve the prior coherent snapshot', async context => {
  await fixture(({ store }) => {
    store.ingest(request(store)); const before = store.read(songId);
    const reversed = request(store,'reversed');
    assert.throws(() => store.ingest({ ...reversed,scenes:[{ ...scene,range:{ kind:'known',startBar:9,endBar:2 } }] }));
    assert.deepEqual(store.read(songId),before);
    const failed = request(store,'failed-write');
    const originalPrepare = DatabaseSync.prototype.prepare;
    let scheduled = false;
    context.mock.method(DatabaseSync.prototype,'prepare',function(this:DatabaseSync,sql:string) {
      if (sql === 'INSERT INTO scene_inputs VALUES (?,?,?)' && !scheduled) {
        scheduled = true;
        // Schedule a real SQLite abort after the schema gate and first data write, inside this owned transaction.
        this.exec("CREATE TRIGGER reject_new_input BEFORE INSERT ON scene_inputs BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");
      }
      return originalPrepare.call(this,sql);
    });
    try { assert.throws(() => store.ingest(failed),/fixture storage failure/); }
    finally { context.mock.restoreAll(); }
    assert.equal(scheduled,true);
    assert.deepEqual(store.read(songId),before);
    assert.equal(store.ingest(request(store,'failed-write')).kind,'saved');
  });
});

test('binding a current chart preserves notes, checks identity and does not rebind during ingest', async () => {
  await fixture(({ store }) => {
    store.ingest(request(store)); const before = store.read(songId);
    const chart: ChartFacts = { songId,semanticSha256:'a'.repeat(64),xmlSha256:'b'.repeat(64),measureCount:218,meter:{ numerator:4,denominator:4 } };
    const bound = store.bindChart({ songId,base:before.stamp,chart });
    assert.deepEqual(bound.inputs,before.inputs); assert.equal(bound.stamp.revision,2);
    assert.deepEqual(store.bindChart({ songId,base:bound.stamp,chart }),bound);
    assert.throws(() => store.bindChart({ songId:otherSong,base:store.read(otherSong).stamp,chart }),hasCode('CHART_SONG_MISMATCH'));
    assert.deepEqual(store.ingest(request(store,'new-direction')).snapshot.document.chart,bound.document.chart);
  });
});

test('stages have independent immutable versions and scenes capture exact referenced versions', async () => {
  await fixture(({ store }) => {
    const base = store.read(songId).stamp;
    const definition = { id:'shared-stage',label:'Shared stage',description:'Art pending',art:{ kind:'unbound' } };
    const firstRequest = { operationId:'first-stage',base,definition };
    const first = store.saveStage(firstRequest);
    const second = store.saveStage({ operationId:'second-stage',base:{ ...base,revision:1 },definition:{ ...definition,label:'Revised stage' } });
    assert.equal(second.revision,2); assert.deepEqual(store.readStage('shared-stage',1),first);
    assert.deepEqual(store.saveStage(firstRequest),first);
    assert.deepEqual(store.readStage('shared-stage'),second);
    assert.throws(() => store.saveStage({ operationId:'stale-stage',base,definition }),hasCode('REVISION_CONFLICT'));
    assert.equal(store.saveStage({ operationId:'no-change',base:{ ...base,revision:2 },definition:second.definition }).revision,2);
    const input = request(store); const saved = store.ingest({ ...input,scenes:[{ ...scene,stage:{ kind:'reference',id:'shared-stage',revision:1 } }] });
    assert.deepEqual(saved.snapshot.stages,[first]); assert.equal(saved.snapshot.stamp.revision,1);
  });
});

test('consistent snapshots reopen in a fresh process and never clobber existing namespaces', async () => {
  await fixture(async ({ directory,store }) => {
    store.ingest(request(store)); const before = store.read(songId);
    const destination = join(directory,'backup #?');
    const copied = store.snapshot(destination);
    const backup = SceneAuthoringStore.open(copied.filename);
    try { assert.deepEqual(backup.read(songId),before); } finally { backup.close(); }
    const storeModule = new URL('../store.ts', import.meta.url).href;
    const child = spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',
      `import {SceneAuthoringStore} from '${storeModule}'; const s=SceneAuthoringStore.open(process.argv[1]); process.stdout.write(JSON.stringify(s.read('${songId}')));s.close();`,copied.filename],{ cwd:process.cwd(),encoding:'utf8' });
    assert.equal(child.status,0,child.stderr); assert.deepEqual(JSON.parse(child.stdout),before);
    assert.throws(() => store.snapshot(destination));
    const alias = join(directory,'alias'); await symlink(destination,alias); assert.throws(() => store.snapshot(alias));
    const contents = await readFile(copied.filename); store.ingest(request(store,'after-snapshot'));
    assert.deepEqual(await readFile(copied.filename),contents);
    const check = SceneAuthoringStore.open(copied.filename);
    try { assert.deepEqual(check.read(songId),before); } finally { check.close(); }
  });
});


test('a failed initializer preserves another writer’s committed input after publication', async context => {
  const directory=await mkdtemp(join(tmpdir(),'scene-init-publication-'));
  const filename=join(directory,'published.sqlite');
  const originalExec=DatabaseSync.prototype.exec;
  const operatorText='SYNTHETIC COMMITTED OPERATOR INPUT';
  let scheduled=false;
  let blocker:DatabaseSync|undefined;
  let committedText:string|undefined;
  context.mock.method(DatabaseSync.prototype,'exec',function(this:DatabaseSync,sql:string) {
    originalExec.call(this,sql);
    if (sql==='COMMIT' && !scheduled) {
      scheduled=true;
      const writer=SceneAuthoringStore.open(filename);
      try {
        const saved=writer.ingest({ operationId:'concurrent-save',songId,base:writer.read(songId).stamp,
          input:{kind:'new',value:{id:'concurrent-input',operatorText,origin:'owned SQLite interleaving'}},scenes:[] });
        committedText=saved.snapshot.inputs[0]?.operatorText;
      } finally { writer.close(); }
      blocker=new DatabaseSync(filename);
      blocker.exec('BEGIN EXCLUSIVE');
    }
  });
  try {
    let initializeError:unknown;
    try { SceneAuthoringStore.initialize(filename); } catch(error) { initializeError=error; }
    assert.ok(initializeError instanceof Error);
    assert.match(initializeError.message,/database is locked/);
    assert.equal(committedText,operatorText);
    await access(filename);
    blocker?.exec('ROLLBACK');blocker?.close();blocker=undefined;
    const reopened=SceneAuthoringStore.open(filename);
    try { assert.equal(reopened.read(songId).inputs[0]?.operatorText,operatorText); }
    finally { reopened.close(); }
    assert.ok('code' in initializeError && initializeError.code==='SCENE_INITIALIZATION_UNCERTAIN');
    assert.ok('filename' in initializeError && initializeError.filename===await realpath(filename));
  } finally {
    context.mock.restoreAll();
    try { blocker?.exec('ROLLBACK'); } finally { blocker?.close(); }
    await rm(directory,{recursive:true,force:true});
  }
});

test('snapshots reject the live database and all sidecar aliases before reserving a destination', async()=>{
  await fixture(async({directory,filename,store})=>{
    store.ingest(request(store));
    const before=store.read(songId);
    const parentAlias=join(directory,'parent-alias');await symlink(directory,parentAlias,'dir');
    const hardAlias=join(directory,'hard-alias.sqlite');await link(filename,hardAlias);
    for (const suffix of ['-shm','-wal','-journal']) for (const base of [filename,join(parentAlias,basename(filename)),hardAlias]) {
      const target=base+suffix;
      assert.throws(()=>store.snapshot(target),hasCode('SNAPSHOT_DATABASE_NAMESPACE'));
      await assert.rejects(access(target),{code:'ENOENT'});
    }
    assert.throws(()=>store.snapshot(filename),hasCode('SNAPSHOT_DATABASE_NAMESPACE'));
    assert.deepEqual(store.read(songId),before);
  });
});

test('open handles reject external schema drift under the write lock before any mutation', async()=>{
  for (const action of ['ingest','bind-chart','stage-put'] as const) await fixture(({filename,store})=>{
    store.ingest(request(store));const before=store.read(songId);
    const later=request(store,'later-operation');
    const outside=new DatabaseSync(filename);
    const event=action==='stage-put'?'AFTER INSERT ON scene_stages':'AFTER UPDATE ON scene_songs';
    outside.exec(`CREATE TRIGGER external_rewrite ${event} BEGIN UPDATE scene_inputs SET input_json=json_set(input_json,'$.operatorText','MODIFIED BY TRIGGER'); END`);
    try {
      assert.throws(()=>{
        if(action==='ingest')store.ingest(later);
        else if(action==='bind-chart')store.bindChart({songId,base:before.stamp,chart:{songId,semanticSha256:'a'.repeat(64),xmlSha256:'b'.repeat(64),measureCount:218,meter:{numerator:4,denominator:4}}});
        else store.saveStage({operationId:'stage-under-drift',base:{...before.stamp,revision:0},definition:{id:'drift-stage',label:'Stage',description:'Synthetic',art:{kind:'unbound'}}});
      },hasCode('UNSUPPORTED_SCENE_STORE_SCHEMA'));
    } finally { outside.exec('DROP TRIGGER external_rewrite');outside.close(); }
    assert.deepEqual(store.read(songId),before);
    assert.equal(store.readStage('drift-stage'),null);
  });
});
