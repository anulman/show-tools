import { readFile, mkdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Schema } from 'effect';
import { SceneAuthoringStore, SceneInitializationError } from '../lib/video/scene-authoring/store.js';
import { SceneAuthoringError, parseStamp } from '../lib/video/scene-authoring/model.js';
import { diagnoseSceneTimeline, inspectSceneChart, prepareSceneIntake } from '../lib/video/scene-authoring/intake.js';
import { publishPreparedArtifact } from '../lib/video/prepared-artifact.js';
import { isCliEntrypoint } from './cli-entry.js';
import { chiefHandoff, commandFailureExitCode, formatCommandFailure, productFailure } from './lib/command-diagnostics.js';

export const SCENE_AUTHORING_HELP = `Usage: show-tools scenes COMMAND --database ABSOLUTE_SQLITE_PATH [OPTIONS]

Commands:
  init        Create a new scene store, or validate an existing scene store
  ingest      Save an operator chunk and explicit scene edits from --input JSON
  read        Read a song's current scenes and original inputs (--song ID)
  bind-chart  Pin actual MusicXML facts (--song ID --input BASE_STAMP_JSON --musicxml FILE)
  stage-put   Save a reusable stage version from --input JSON
  stage-read  Read --stage ID, optionally --revision NUMBER
  inspect     Report draft unknowns, gaps and overlaps (--song ID [--musicxml FILE])
  export      Write a derived draft JSON (--song ID --output FILE [--musicxml FILE])
  intake      Check renderer intake; draft-only milestone fails closed
  snapshot    Make a consistent local SQLite copy in --output NEW_DIRECTORY

Every operation names the database explicitly. JSON is transport or derived output,
not the authoring authority. Ingest never marks a draft reviewed or runtime-ready.
No audio, browser, Sheets, database service or renderer is started.
--json formats failures as the shared command diagnostic; successes are always JSON.
`;
const allowed: Readonly<Record<string, readonly string[]>> = {
  init:[], ingest:['input'], read:['song'], 'bind-chart':['song','input','musicxml'],
  'stage-put':['input'], 'stage-read':['stage','revision'], inspect:['song','musicxml'],
  export:['song','musicxml','output'], intake:['song','musicxml'], snapshot:['output'],
};
async function readUtf8(filename:string):Promise<string> {
  const bytes=await readFile(filename);
  try { return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
  catch { throw new SceneAuthoringError('INVALID_UTF8_INPUT','Authoring input must be valid UTF-8; no replacement characters were substituted.',[filename]); }
}
const readJson = async (filename: string): Promise<unknown> => {
  try {
    if ((await stat(filename)).size>16*1024*1024) throw new SceneAuthoringError('INPUT_TOO_LARGE','Scene transport must not exceed 16 MiB.',[filename]);
    const text=await readUtf8(filename);
    if (Buffer.byteLength(text,'utf8')>16*1024*1024) throw new SceneAuthoringError('INPUT_TOO_LARGE','Scene transport must not exceed 16 MiB.',[filename]);
    return JSON.parse(text);
  }
  catch (error) {
    if (error instanceof SyntaxError) throw new SceneAuthoringError('INVALID_JSON', 'Input is not valid JSON.', [filename]);
    throw error;
  }
};
const BindingInput = Schema.Struct({ base:Schema.Unknown });

export async function runSceneAuthoringCli(args: readonly string[], write: (text: string) => void = text => process.stdout.write(text),
  writeError: (text: string) => void = text => process.stderr.write(text)): Promise<number> {
  if (args.length===0 || args.includes('--help') || args.includes('-h')) { write(SCENE_AUTHORING_HELP); return 0; }
  const json=args.includes('--json');
  try {
    let parsed;
    try { parsed=parseArgs({ args:[...args], allowPositionals:true, tokens:true, options:{
      database:{ type:'string' }, input:{ type:'string' }, song:{ type:'string' }, musicxml:{ type:'string' },
      stage:{ type:'string' }, revision:{ type:'string' }, output:{ type:'string' }, json:{ type:'boolean' },
    } }); }
    catch { throw new SceneAuthoringError('SCENE_USAGE','Invalid scene command options. Run show-tools scenes --help.',[]); }
    const optionNames=parsed.tokens.flatMap(token=>token.kind==='option'?[token.name]:[]);
    if (new Set(optionNames).size!==optionNames.length) throw new SceneAuthoringError('SCENE_USAGE','Duplicate scene command options are not accepted.',[]);
    const { values,positionals }=parsed;
    const command=positionals[0];
    if (positionals.length!==1 || !Object.hasOwn(allowed,command)) throw new SceneAuthoringError('SCENE_USAGE','Expected one supported scene command.',[]);
    for (const key of Object.keys(values)) if (!['database','json',...allowed[command]].includes(key)) {
      throw new SceneAuthoringError('SCENE_USAGE',`Option --${key} is not valid for ${command}.`,[]);
    }
    const required=(name:keyof typeof values):string=>{
      const value=values[name];
      if (typeof value!=='string' || value.length===0) throw new SceneAuthoringError('SCENE_USAGE',`Expected --${name}.`,[]);
      return value;
    };
    const database=required('database');
    if (!isAbsolute(database)) throw new SceneAuthoringError('DATABASE_PATH','The scene database path must be absolute.',[database]);
    if (command==='init') await mkdir(dirname(database),{recursive:true,mode:0o700});
    const store=command==='init' ? SceneAuthoringStore.initialize(database) : SceneAuthoringStore.open(database);
    try {
      let result:unknown;
      switch (command) {
        case 'init': result={kind:'initialized',database:await realpath(database),runtime:{kind:'not-admitted'}}; break;
        case 'ingest': result=store.ingest(await readJson(required('input'))); break;
        case 'read': result=store.read(required('song')); break;
        case 'bind-chart': {
          const inputPath=required('input');
          let binding;
          try { binding=Schema.decodeUnknownSync(BindingInput,{onExcessProperty:'error'})(await readJson(inputPath)); }
          catch (error) {
            if (error instanceof SceneAuthoringError) throw error;
            throw new SceneAuthoringError('INVALID_BINDING','Chart binding input must contain only the observed base stamp.',[inputPath]);
          }
          const chart=await inspectSceneChart(await readUtf8(required('musicxml')));
          result=store.bindChart({songId:required('song'),base:parseStamp(binding.base),chart}); break;
        }
        case 'stage-put': result=store.saveStage(await readJson(required('input'))); break;
        case 'stage-read': {
          const revision=values.revision===undefined ? undefined : Number(values.revision);
          if (revision!==undefined && (!Number.isSafeInteger(revision)||revision<=0)) throw new SceneAuthoringError('INVALID_REVISION','Stage revision must be a positive integer.',[]);
          result=store.readStage(required('stage'),revision); break;
        }
        case 'inspect': case 'export': case 'intake': {
          const snapshot=store.read(required('song'));
          const chart=values.musicxml ? await inspectSceneChart(await readUtf8(values.musicxml)) : null;
          const diagnostics=diagnoseSceneTimeline(snapshot,chart);
          if (command==='intake') {
            const intake=prepareSceneIntake(snapshot,chart);
            if (intake.kind==='blocked') throw new SceneAuthoringError('SCENE_INTAKE_BLOCKED',intake.diagnostics.map(item=>`${item.code}: ${item.message}`).join('\n'),[required('song')]);
            result=intake;
          } else {
            result={kind:'scene-authoring-draft',snapshot,diagnostics,runtime:{kind:'not-admitted'}};
            if (command==='export') {
              const output=required('output'),physicalDatabase=await realpath(database),target=resolve(output);
              const physicalParent=await realpath(dirname(target));
              const canonicalTarget=resolve(physicalParent,basename(target));
              const compare=(path:string)=>process.platform==='darwin'?path.toLowerCase():path;
              if (['','-wal','-shm','-journal'].some(suffix=>compare(canonicalTarget)===compare(physicalDatabase+suffix))) {
                throw new SceneAuthoringError('OUTPUT_ALIASES_DATABASE','Derived output cannot replace the database or its journal namespace.',[output,database]);
              }
              try { await publishPreparedArtifact({output,inputs:[database,...(values.musicxml?[values.musicxml]:[])],artifact:result}); }
              catch (error) {
                if (error instanceof Error && (error.message.startsWith('Prepared output aliases an input:') || error.message==='Prepared output must be a regular file')) {
                  throw new SceneAuthoringError('INVALID_EXPORT_OUTPUT',error.message,[output]);
                }
                throw error;
              }
              result={kind:'exported-draft',output:target,stamp:snapshot.stamp,diagnostics,runtime:{kind:'not-admitted'}};
            }
          }
          break;
        }
        case 'snapshot': result=store.snapshot(required('output')); break;
      }
      write(JSON.stringify(result,null,2)+'\n'); return 0;
    } finally { store.close(); }
  } catch (error) {
    const failure=error instanceof SceneInitializationError
      ? chiefHandoff({code:error.code,message:'Initialization did not complete. The database path was retained because it may contain committed input.',locations:[error.filename],
        nextSteps:['Have Chief inspect the retained database read-only and verify committed records before retrying an existing-store open. Do not delete or recreate it based on this failed acknowledgment.']})
      : error instanceof SceneAuthoringError
      ? productFailure({code:error.code,message:error.message,locations:error.locations,nextSteps:error.code==='SCENE_AUTHORING_CHART_INVALID'
          ? ['Preserve the intended MusicXML file. Confirm its profile matches the current reader and coordinate an explicit reviewed migration if required. Do not substitute another checkout or relabel the profile.']
          : ['Read the current song or stage revision and correct the supplied authoring input. Preserve unknown facts as draft data.']})
      : chiefHandoff({code:'SCENE_COMMAND_FAILED',message:'The scene authoring command could not complete because of a tooling or filesystem failure.',locations:[],nextSteps:['Give Chief the command and database path to diagnose the harness. Do not overwrite the database or bypass product validation.']});
    (json?write:writeError)(formatCommandFailure(failure,json?'json':'human')); return commandFailureExitCode(failure);
  }
}
if (await isCliEntrypoint(import.meta.url)) process.exitCode=await runSceneAuthoringCli(process.argv.slice(2));
