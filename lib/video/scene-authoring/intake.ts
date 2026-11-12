import { createHash } from 'node:crypto';
import { readMusicXmlSong } from '../../performance/musicxml-song.js';
import { parseChartFacts, SceneAuthoringError, type ChartFacts, type SceneOccurrence, type SongSnapshot, type StageSnapshot } from './model.js';

export type Diagnostic = {
  code: string;
  message: string;
  sceneIds: string[];
  bars: { startBar: number; endBar: number } | null;
};

export async function inspectSceneChart(musicxml: string): Promise<ChartFacts> {
  try {
    const { song, report } = await readMusicXmlSong(musicxml);
    return parseChartFacts({ songId: song.id, semanticSha256: song.source.digest,
      xmlSha256: createHash('sha256').update(musicxml).digest('hex'), measureCount: report.measureCount, meter: report.meter });
  } catch (error) {
    if (error instanceof SceneAuthoringError) throw error;
    throw new SceneAuthoringError('SCENE_AUTHORING_CHART_INVALID',
      `Cannot inspect canonical MusicXML: ${error instanceof Error ? error.message : String(error)}`, ['musicxml']);
  }
}

export function diagnoseSceneTimeline(snapshot: SongSnapshot, currentChart: ChartFacts | null): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const firstSuppressed: Diagnostic[] = [];
  const maximumDetails = 1000;
  const add = (code: string, message: string, sceneIds: string[] = [], bars: Diagnostic['bars'] = null): boolean => {
    if (diagnostics.length >= maximumDetails) {
      if (firstSuppressed.length === 0) firstSuppressed.push({ code,message,sceneIds,bars });
      return false;
    }
    diagnostics.push({ code,message,sceneIds,bars });
    return true;
  };
  const bound = snapshot.document.chart;
  let chart: ChartFacts | null = currentChart;
  if (!currentChart) add('UNKNOWN_SOURCE', 'Current canonical chart was not supplied; current bounds and revision are unknown.');
  else if (currentChart.songId !== snapshot.document.songId) {
    add('SOURCE_SONG_MISMATCH', `Current chart ${currentChart.songId} does not identify song ${snapshot.document.songId}.`);
    chart = null;
  }
  if (bound.kind === 'unbound') add('UNBOUND_SOURCE', 'Scene authoring has not been bound to a canonical chart revision.');
  else if (chart) {
    if (bound.semanticSha256 !== chart.semanticSha256) add('STALE_SEMANTIC_REVISION', 'The current chart has a different semantic revision; authored bars were not rebased.');
    if (bound.xmlSha256 !== chart.xmlSha256) add('CHANGED_XML_BYTES', 'The current MusicXML bytes differ from the bound source; source identity must be reviewed.');
    if (bound.measureCount !== chart.measureCount || bound.meter.numerator !== chart.meter.numerator || bound.meter.denominator !== chart.meter.denominator) {
      add('CHANGED_CHART_STRUCTURE', 'Current chart bounds or meter differ from the bound source.');
    }
  }

  const stageByVersion = new Map(snapshot.stages.map(stage => [`${stage.definition.id}:${stage.revision}`, stage]));
  for (const scene of snapshot.document.scenes) {
    if (scene.range.kind === 'unresolved') add('UNKNOWN_RANGE', `Scene ${scene.id} has an unresolved bar range: ${scene.range.text}`, [scene.id]);
    else if (chart && (scene.range.startBar > chart.measureCount || scene.range.endBar > chart.measureCount)) {
      add('OUT_OF_RANGE', `Scene ${scene.id} extends beyond the current chart's ${chart.measureCount} bars.`, [scene.id],
        { startBar: scene.range.startBar, endBar: scene.range.endBar });
    }
    if (scene.stage.kind === 'unbound') {
      add('UNKNOWN_STAGE', `Scene ${scene.id} has no reusable stage binding.`, [scene.id]);
      continue;
    }
    const stage = stageByVersion.get(`${scene.stage.id}:${scene.stage.revision}`);
    if (!stage) {
      add('MISSING_STAGE', `Scene ${scene.id} references unavailable stage ${scene.stage.id} revision ${scene.stage.revision}.`, [scene.id]);
      continue;
    }
    diagnoseStage(scene, stage, add);
  }

  const known = snapshot.document.scenes.flatMap(scene => scene.range.kind === 'known' ? [{ scene, startBar: scene.range.startBar, endBar: scene.range.endBar }] : []);
  known.sort((first, second) => first.startBar - second.startBar || first.endBar - second.endBar || first.scene.id.localeCompare(second.scene.id));
  let active: typeof known = [];
  overlaps: for (const current of known) {
    active = active.filter(previous => previous.endBar >= current.startBar);
    for (const previous of active) {
      const startBar = Math.max(previous.startBar,current.startBar);
      const endBar = Math.min(previous.endBar,current.endBar);
      if (!add('OVERLAPS', `Scenes ${previous.scene.id} and ${current.scene.id} overlap; no scene was trimmed or reordered.`,
        [previous.scene.id,current.scene.id], { startBar,endBar })) break overlaps;
    }
    active.push(current);
  }
  if (chart) {
    let next = 1;
    for (const range of known) {
      if (range.startBar > chart.measureCount) break;
      if (range.startBar > next) add('GAPS', 'No scene has a known range covering these bars.', [], { startBar:next,endBar:Math.min(range.startBar-1,chart.measureCount) });
      next = Math.max(next,Math.min(range.endBar,chart.measureCount)+1);
    }
    if (next <= chart.measureCount) add('GAPS', 'No scene has a known range covering these bars.', [], { startBar:next,endBar:chart.measureCount });
  }
  const omitted = firstSuppressed[0];
  if (omitted) diagnostics.push({ code:'DIAGNOSTICS_LIMIT',
    message:`The detailed report reached its ${maximumDetails}-issue limit; additional issues remain. Resolve the listed issues and inspect again. No authoring values were corrected. First omitted issue: ${omitted.code}: ${omitted.message}`,
    sceneIds:omitted.sceneIds,bars:omitted.bars });
  diagnostics.push({ code:'DRAFT_AUTHORING', message:'This first-milestone authoring record is a draft; no review proof has been supplied.',sceneIds:[],bars:null });
  diagnostics.push({ code:'RUNTIME_NOT_ADMITTED', message:'No renderer adapter, approved asset handoff or runtime admission proof is established by this authoring record.',sceneIds:[],bars:null });
  return diagnostics;
}

function diagnoseStage(scene: SceneOccurrence, stage: StageSnapshot,
  add: (code: string, message: string, sceneIds?: string[], bars?: Diagnostic['bars']) => void): void {
  const art = stage.definition.art;
  if (art.kind === 'unbound') {
    add('UNKNOWN_STAGE_ART', `Stage ${stage.definition.id} has no Figma source binding.`, [scene.id]);
    return;
  }
  for (const layer of art.layers) if (layer.source.kind === 'unverified') {
    add('UNVERIFIED_LAYER', `Stage ${stage.definition.id} layer ${layer.id} has no verified source pin or registration.`, [scene.id]);
  }
  for (const aspect of ['16:9','4:3']) {
    const reference = art.aspects.find(reference => reference.aspect === aspect);
    if (!reference) add('UNKNOWN_ASPECT', `Stage ${stage.definition.id} has no ${aspect} scene reference.`, [scene.id]);
    else if (reference.fit.kind === 'pending') add('PENDING_FIT', `Stage ${stage.definition.id} ${aspect} fit has not been verified.`, [scene.id]);
  }
}

export function prepareSceneIntake(snapshot: SongSnapshot, currentChart: ChartFacts | null): { kind: 'blocked'; diagnostics: Diagnostic[] } {
  return { kind:'blocked', diagnostics:diagnoseSceneTimeline(snapshot,currentChart) };
}
