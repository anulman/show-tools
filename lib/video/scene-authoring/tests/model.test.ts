import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { contentDigest, parseChartFacts, parseIngestRequest, parseOperatorInput, parseSceneDocument, parseSnapshot,
  parseSongId, parseStageDefinition, parseStageSnapshot, SceneAuthoringError,
  type BarRange, type SceneOccurrence, type SongSnapshot } from '../model.js';
import { diagnoseSceneTimeline, inspectSceneChart, prepareSceneIntake } from '../intake.js';

const stamp = { databaseId:'11111111-1111-4111-8111-111111111111', generationId:'22222222-2222-4222-8222-222222222222', revision:0 };
const operator = { id:'input-1', operatorText:'  Original words.\n\n\tKeep these exactly.  ', origin:'synthetic test input' };
const chart = parseChartFacts({ songId:'dance-yrself-clean', semanticSha256:'a'.repeat(64), xmlSha256:'b'.repeat(64),
  measureCount:10, meter:{ numerator:4, denominator:4 } });
function scene(id: string, range: BarRange): SceneOccurrence {
  return { id, label:id, description:'Explicit test normalization', range, stage:{ kind:'unbound' }, sourceInputIds:[operator.id] };
}
function snapshot(scenes: SceneOccurrence[] = []): SongSnapshot {
  return parseSnapshot({ stamp, document:{ songId:'dance-yrself-clean', chart:{ kind:'unbound' }, scenes },
    inputs:[operator], stages:[], review:{ kind:'draft' }, runtime:{ kind:'not-admitted' } });
}
function request() {
  return { operationId:'operation-1', songId:'dance-yrself-clean', base:stamp,
    input:{ kind:'new', value:operator }, scenes:[] };
}
const known = (startBar: number, endBar: number): BarRange => ({ kind:'known',startBar,endBar });
const codes = (value: SongSnapshot, current = chart) => diagnoseSceneTimeline(value,current).map(item=>item.code);

test('ingress preserves exact original text and accepts raw-only or unresolved drafts', () => {
  assert.equal(parseOperatorInput(operator).operatorText,operator.operatorText);
  assert.deepEqual(parseIngestRequest(request()).scenes,[]);
  const unresolved = scene('scene-1',{ kind:'unresolved',text:'Actual unresolved range wording' });
  assert.equal(parseSceneDocument(snapshot([unresolved]).document).scenes[0]?.range.kind,'unresolved');
  assert.equal(parseSceneDocument(snapshot([scene('out-of-bounds',known(300,400))]).document).scenes.length,1);
});

test('strict schemas reject inferred approval, unknown fields, reversed bars and invalid identities', () => {
  assert.throws(()=>parseIngestRequest({ ...request(),review:{ kind:'reviewed' } }),SceneAuthoringError);
  assert.throws(()=>parseIngestRequest({ ...request(),input:{ kind:'new',value:{ ...operator,runtimeReady:true } } }),SceneAuthoringError);
  assert.throws(()=>parseSnapshot({ ...snapshot(),runtime:{ kind:'admitted' } }),SceneAuthoringError);
  assert.throws(()=>parseSceneDocument({ ...snapshot().document,scenes:[scene('bad',known(5,2))] }),SceneAuthoringError);
  assert.throws(()=>parseSceneDocument({ ...snapshot().document,scenes:[scene('bad',known(0,2))] }),SceneAuthoringError);
  assert.throws(()=>parseSongId('invented-song'),SceneAuthoringError);
  assert.throws(()=>parseIngestRequest({ ...request(),base:{ ...stamp,databaseId:'not-a-uuid' } }),SceneAuthoringError);
  assert.throws(()=>parseSceneDocument({ ...snapshot().document,scenes:[scene('same',known(1,2)),scene('same',known(3,4))] }),SceneAuthoringError);
});

test('source references and immutable stage digests are checked without claiming art verification', () => {
  assert.throws(()=>parseSnapshot({ ...snapshot([scene('scene-1',known(1,2))]),inputs:[] }),/absent operator input/);
  const definition = parseStageDefinition({ id:'stage-1',label:'Unbound stage',description:'Pending Art',art:{ kind:'unbound' } });
  const stage = { definition,revision:1,digest:contentDigest(definition) };
  assert.deepEqual(parseStageSnapshot(stage),stage);
  assert.throws(()=>parseStageSnapshot({ ...stage,definition:{ ...definition,description:'Changed without new digest' } }),/content digest/);
  assert.throws(()=>parseStageSnapshot({ ...stage,revision:0 }),SceneAuthoringError);
});

test('content hashing is key-order invariant and preserves text and array ordering', () => {
  assert.equal(contentDigest({ b:{ y:2,x:1 },a:3 }),contentDigest({ a:3,b:{ x:1,y:2 } }));
  assert.notEqual(contentDigest({ text:' a ' }),contentDigest({ text:'a' }));
  assert.notEqual(contentDigest([1,2]),contentDigest([2,1]));
  assert.throws(()=>contentDigest({ impossible:undefined }));
});

test('current MusicXML parser supplies actual song, bounds, semantic and byte identities', async () => {
  const xml = await readFile(new URL('../../../../songs/dance-yrself-clean.musicxml',import.meta.url),'utf8');
  const actual = await inspectSceneChart(xml);
  assert.equal(actual.songId,'dance-yrself-clean');
  assert.equal(actual.measureCount,218);
  assert.deepEqual(actual.meter,{ numerator:4,denominator:4 });
  assert.equal(actual.xmlSha256,createHash('sha256').update(xml).digest('hex'));
  const whitespace = await inspectSceneChart(xml+'\n');
  assert.equal(whitespace.semanticSha256,actual.semanticSha256);
  assert.notEqual(whitespace.xmlSha256,actual.xmlSha256);
  await assert.rejects(inspectSceneChart('<broken'),error=>error instanceof SceneAuthoringError && error.code==='SCENE_AUTHORING_CHART_INVALID');
});

test('inclusive ranges diagnose exact overlaps, gaps and out-of-range bars without repairing drafts', () => {
  const value = snapshot([scene('first',known(1,3)),scene('second',known(3,4)),scene('third',known(7,12)),
    scene('unknown',{ kind:'unresolved',text:'Not supplied yet' })]);
  const before = JSON.stringify(value);
  const actual = diagnoseSceneTimeline(value,chart);
  assert.deepEqual(actual.filter(item=>item.code==='OVERLAPS').map(item=>({ ids:item.sceneIds,bars:item.bars })),
    [{ ids:['first','second'],bars:{ startBar:3,endBar:3 } }]);
  assert.deepEqual(actual.filter(item=>item.code==='GAPS').map(item=>item.bars),[{ startBar:5,endBar:6 }]);
  assert.deepEqual(actual.find(item=>item.code==='OUT_OF_RANGE')?.bars,{ startBar:7,endBar:12 });
  assert.ok(actual.some(item=>item.code==='UNKNOWN_RANGE' && item.sceneIds[0]==='unknown'));
  assert.equal(JSON.stringify(value),before);
});

test('unknown or foreign charts never become zero-length or guessed coverage', () => {
  const value = snapshot([scene('first',known(1,3))]);
  const unknown = diagnoseSceneTimeline(value,null);
  assert.ok(unknown.some(item=>item.code==='UNKNOWN_SOURCE'));
  assert.ok(!unknown.some(item=>item.code==='GAPS' || item.code==='OUT_OF_RANGE'));
  const foreign = diagnoseSceneTimeline(value,{ ...chart,songId:'drunk-girls',measureCount:1 });
  assert.ok(foreign.some(item=>item.code==='SOURCE_SONG_MISMATCH'));
  assert.ok(!foreign.some(item=>item.code==='GAPS' || item.code==='OUT_OF_RANGE'));
});

test('empty known coverage reports the entire current song and nested ranges remain overlapping', () => {
  assert.deepEqual(diagnoseSceneTimeline(snapshot(),chart).filter(item=>item.code==='GAPS').map(item=>item.bars),[{ startBar:1,endBar:10 }]);
  const value = snapshot([scene('outer',known(1,10)),scene('inner-a',known(2,4)),scene('inner-b',known(3,5))]);
  const actual = diagnoseSceneTimeline(value,chart);
  assert.equal(actual.filter(item=>item.code==='OVERLAPS').length,3);
  assert.ok(!actual.some(item=>item.code==='GAPS'));
});

test('semantic, byte and structure drift remain distinct from draft and runtime status', () => {
  const value = snapshot([scene('all',known(1,10))]);
  const bound: SongSnapshot = { ...value,document:{ ...value.document,chart:{ kind:'bound',...chart } } };
  const actual = diagnoseSceneTimeline(bound,{ ...chart,semanticSha256:'c'.repeat(64),xmlSha256:'d'.repeat(64),measureCount:11 });
  for (const code of ['STALE_SEMANTIC_REVISION','CHANGED_XML_BYTES','CHANGED_CHART_STRUCTURE','DRAFT_AUTHORING','RUNTIME_NOT_ADMITTED']) {
    assert.ok(actual.some(item=>item.code===code),code);
  }
});

test('stage-version and per-aspect fit unknowns remain explicit', () => {
  const value = snapshot([{ ...scene('all',known(1,10)),stage:{ kind:'reference',id:'stage-1',revision:1 } }]);
  assert.ok(codes(value).includes('MISSING_STAGE'));
  const definition = parseStageDefinition({ id:'stage-1',label:'Stage',description:'Only an authored reference',art:{ kind:'figma',
    fileKey:'actual-file-key',rootNodeId:'1:2',layers:[{ id:'sky',role:'world',source:{ kind:'unverified',nodeId:'1:3' } }],
    aspects:[{ aspect:'16:9',frameNodeId:'1:4',fit:{ kind:'pending' } }] } });
  const withStage: SongSnapshot = { ...value,stages:[{ definition,revision:1,digest:contentDigest(definition) }] };
  const actual = diagnoseSceneTimeline(withStage,chart);
  assert.ok(actual.some(item=>item.code==='UNVERIFIED_LAYER'));
  assert.ok(actual.some(item=>item.code==='PENDING_FIT' && item.message.includes('16:9')));
  assert.ok(actual.some(item=>item.code==='UNKNOWN_ASPECT' && item.message.includes('4:3')));
  assert.equal(prepareSceneIntake(withStage,chart).kind,'blocked');
});

test('complete ranges and claimed fit metadata cannot bypass first-milestone draft admission', () => {
  const value = snapshot([{ ...scene('all',known(1,10)),stage:{ kind:'reference',id:'stage-1',revision:1 } }]);
  const definition = parseStageDefinition({ id:'stage-1',label:'Stage',description:'Stored fit references',art:{ kind:'figma',
    fileKey:'actual-file-key',rootNodeId:'1:2',layers:[],aspects:[
      { aspect:'16:9',frameNodeId:'1:4',fit:{ kind:'verified',receiptSha256:'c'.repeat(64) } },
      { aspect:'4:3',frameNodeId:'1:5',fit:{ kind:'verified',receiptSha256:'d'.repeat(64) } },
    ] } });
  const complete: SongSnapshot = { ...value,document:{ ...value.document,chart:{ kind:'bound',...chart } },
    stages:[{ definition,revision:1,digest:contentDigest(definition) }] };
  assert.deepEqual(prepareSceneIntake(complete,chart).diagnostics.map(item=>item.code),['DRAFT_AUTHORING','RUNTIME_NOT_ADMITTED']);
});


test('large overlap reports are bounded and explicitly retain the first omitted source and draft gates', () => {
  const value = snapshot(Array.from({ length:100 },(_, index)=>scene(`overlap-${index}`,known(1,10))));
  const before = JSON.stringify(value);
  const actual = diagnoseSceneTimeline(value,chart);
  assert.equal(actual.length,1003);
  const limit = actual.filter(item=>item.code==='DIAGNOSTICS_LIMIT');
  assert.equal(limit.length,1);
  assert.equal(limit[0]?.sceneIds.length,2);
  assert.deepEqual(limit[0]?.bars,{ startBar:1,endBar:10 });
  assert.match(limit[0]?.message ?? '',/additional issues remain/);
  assert.deepEqual(actual.slice(-2).map(item=>item.code),['DRAFT_AUTHORING','RUNTIME_NOT_ADMITTED']);
  assert.equal(prepareSceneIntake(value,chart).kind,'blocked');
  assert.equal(JSON.stringify(value),before);
});
