import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import { compileSong } from '../performance/compiled-song.js';
import { columnName } from '../performance/columns.js';
import { parseSongSource } from '../performance/song-source.js';
import { parseCatalogDocument } from '../voice-catalog/model.js';
import { discoverSheetVoices } from '../voice-catalog/sheet-voices.js';
import { resolveVoice } from '../voice-catalog/session.js';
import { deriveMainVocalSections } from './main-vocal-sections.js';
import { parseStreetCell } from './street-rhythm.js';
import { prepareStreetScore, StreetScene, streetClipPlayback, type StreetActor, type StreetWindow } from './street-score.js';
import { prepareStreetPresence, type StreetPresenceAssets } from './street-presence.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface SourceDiagnostic { readonly cell: string; readonly text: string; readonly message: string }

export async function prepareStreetSong(input: { readonly catalog: unknown; readonly source: unknown; readonly mapping: unknown; readonly assets: unknown;
  readonly presence?: StreetPresenceAssets }) {
  const catalog = parseCatalogDocument(input.catalog), source = parseSongSource(input.source);
  const compiled = await compileSong(source, input.mapping);
  const diagnostics: SourceDiagnostic[] = compiled.diagnostics.map(item => ({ cell: item.source.a1, text: item.source.text, message: item.message }));
  const assets = Schema.decodeUnknownSync(StreetScene)(input.assets);
  const sections = deriveMainVocalSections({ compiled, source });
  for (const section of sections) if (section.eligibility.kind === 'unresolved') diagnostics.push({ cell: section.source.a1, text: section.source.text, message: section.eligibility.message });
  const resolved = discoverSheetVoices(compiled, source).map(row => {
    const voice = resolveVoice(catalog, row);
    if (!voice?.characterId) throw new Error(`No saved character for ${row.labelCell}`);
    const part = compiled.parts.find(part => part.id === row.partId);
    const role: StreetActor['role'] = part?.role.kind === 'default-live' ? 'main-vocals' : part?.role.kind === 'rotation-live' ? 'backup-vocals' : 'instrument';
    return { row, voice, role };
  });
  if (resolved.length !== assets.actors.length || new Set(resolved.map(item => item.voice.characterId)).size !== resolved.length) throw new Error('Saved cast and supplied Street assets must match exactly');
  const actors = assets.actors.map(actor => {
    const binding = resolved.find(item => item.voice.characterId === actor.characterId);
    if (!binding) throw new Error(`Street actor ${actor.characterId} is outside saved cast`);
    return { ...actor, role: binding.role };
  });
  const beats = compiled.chart.beatsPerBar;
  const durationCounts = compiled.chart.bars.length * beats;
  const cells: Array<{ actor: number; bar: number; cell: string; text: string; accents: readonly number[]; anchor: number | null }> = [];
  const windows = actors.map((actor, index) => {
    const binding = resolved.find(item => item.voice.characterId === actor.characterId);
    if (!binding) throw new Error('Missing saved binding');
    const cues = new Map(binding.row.cues.map(cue => [cue.bar, cue]));
    const rowNumber = binding.row.labelCell.match(/[0-9]+$/)?.[0];
    const states: StreetWindow[] = [], accents: number[] = [], downbeats: number[] = [];
    for (const bar of compiled.chart.bars) {
      const cue = cues.get(bar.bar), text = cue?.text ?? '', cell = cue?.cell ?? `${columnName(bar.column)}${rowNumber}`;
      const start = (bar.bar - 1) * beats, end = start + beats;
      try {
        const parsed = parseStreetCell(text, beats, actor.role === 'main-vocals');
        cells.push({ actor: index, bar: bar.bar, cell, text, accents: parsed.accents, anchor: parsed.anchor });
        const mainActive = sections.some(section => section.eligibility.kind === 'lyric' && section.startCount <= start && start < section.endCount);
        const splits = actor.role === 'backup-vocals' ? [...new Set([start, end, ...(compiled.rotation?.windows ?? []).flatMap(window => [(window.begin.bar - 1) * beats + window.begin.beat, (window.end.bar - 1) * beats + window.end.beat]).filter(at => start < at && at < end)])].sort((a, b) => a - b) : [start, end];
        for (let i = 0; i < splits.length - 1; i++) {
          const from = splits[i], to = splits[i + 1];
          const eligible = (compiled.rotation?.windows ?? []).some(window => (window.begin.bar - 1) * beats + window.begin.beat <= from && from < (window.end.bar - 1) * beats + window.end.beat);
          states.push({ start: from, end: to, active: actor.role === 'main-vocals' ? mainActive : parsed.active && (actor.role !== 'backup-vocals' || eligible), emphasis: parsed.emphasis, source: parsed.sampled ? 'sampled' : 'live', specialIndex: 0, ultraIndex: 0 });
        }
        const hits = parsed.accents.map(at => start + at);
        accents.push(...hits);
        if (parsed.anchor !== null) downbeats.push(start + parsed.anchor);
      } catch (error) { diagnostics.push({ cell, text, message: error instanceof Error ? error.message : String(error) }); }
    }
    return { actor: index, states, accents, downbeats };
  });
  if (diagnostics.length) return { kind: 'blocked', diagnostics } satisfies { kind: 'blocked'; diagnostics: SourceDiagnostic[] };
  const countedBeatUnit = compiled.meter.denominator;
  if (countedBeatUnit !== 4 && countedBeatUnit !== 8) throw new Error('Street score supports quarter-note or eighth-note counts');
  const prepared = prepareStreetScore({ scene: { ...assets, actors, durationCounts, countedBeatUnit, previewCountsPerSecond: compiled.chart.bpm / 60,
    provenance: { source: 'full-song chart-planned activity; backup eligibility intersected with nonblank arrangement; native manual performance unobserved', assetsDigest: assets.provenance.assetsDigest, scoreDigest: digest(windows) } }, windows });
  const presence = input.presence ? prepareStreetPresence({ scene: prepared.scene, windows,
    sections: compiled.chart.sections.map(section => ({ start: (section.startBar - 1) * beats, end: section.endBar * beats })), assets: input.presence }) : null;
  const scene = presence?.scene ?? prepared.scene;
  const receipt = { kind: 'private-chart-planned-street-song', durationCounts, bpm: compiled.chart.bpm, sourceDigest: compiled.source.digest, mappingDigest: compiled.mappingDigest,
    catalogSha256: digest(input.catalog), assetsSha256: digest(input.assets), mainVocalSections: sections, cells, windows, accentDecisions: prepared.accentDecisions.map(decision => ({ ...decision, cell: cells.find(cell => cell.actor === decision.actor && cell.bar === Math.floor(decision.at / beats) + 1)?.cell })),
    savedBindings: resolved.map(({ row, voice }) => ({ labelCell: row.labelCell, sourceLabel: row.sourceLabel, voiceId: voice.id, characterId: voice.characterId })),
    clipPlayback: actors.flatMap(actor => actor.clips.map(clip => ({ characterId: actor.characterId, clipId: clip.id, authoredCycleQuarters: clip.cycleQuarters, actionQuarters: clip.actionQuarters, ...streetClipPlayback(clip) }))),
    presence: presence && input.presence ? { policy: 'singer always present; backup first eligible cue through section end; overlapping poofs merge at opaque peak',
      poofCatalogSha256: input.presence.poofCatalogSha256, fitProfileSha256: input.presence.fitProfileSha256,
      ranges: presence.presenceRanges, transitions: presence.decisions, boundaryPolicy: 'half-open song duration; effect lead-ins and tails clip at song boundaries' } : null,
    nativeProgram: 'not-verified' };
  return { kind: 'ready', scene, receipt } satisfies { kind: 'ready'; scene: typeof scene; receipt: typeof receipt };
}
