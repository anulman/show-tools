import { Schema } from 'effect';
import type { Chart, ChartBar, ChartSection } from './model.js';
import { parseSheetCues, type SheetCue } from './sheet-cues.js';
import { columnName } from './columns.js';
import { SongSourceSchema } from './song-source.js';

const list = <S extends Schema.Constraint>(schema: S) => Schema.mutable(Schema.Array(schema));
const Finite = Schema.Number.check(Schema.isFinite());
const validInactivityBeats = (value: number) => value > 0 && value <= 1 && Number.isInteger(value * 960);
const ButtonSchema = Schema.Literals(['L1', 'L2', 'R1', 'R2']);
const CueKindSchema = Schema.Literals(['arm', 'commit', 'commit-arm', 'stop', 'play']);
export const ExecutionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('now') }),
  Schema.Struct({ kind: Schema.Literal('next-bar') }),
  Schema.Struct({ kind: Schema.Literal('beat'), beat: Finite, barOffset: Schema.optionalKey(Schema.Literals([0, 1])) }),
]);
const PointSchema = Schema.Struct({ bar: Schema.Int, beat: Finite });
const SourceRefSchema = Schema.Struct({ sheetId: Schema.Int, a1: Schema.String, text: Schema.String, note: Schema.String });
const PartRoleSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('pad'), buttonId: ButtonSchema }),
  Schema.Struct({ kind: Schema.Literal('default-live') }),
  Schema.Struct({ kind: Schema.Literal('rotation-live') }),
]);
const PartSchema = Schema.Struct({ id: Schema.String, name: Schema.String, source: SourceRefSchema, role: PartRoleSchema, profile: Schema.Int });
const RotationWindowSchema = Schema.Struct({ begin: PointSchema, end: PointSchema, source: SourceRefSchema, endSource: SourceRefSchema, sources: list(SourceRefSchema) });
export const RotationSchema = Schema.Struct({ voiceId: Schema.String, inactivityBeats: Finite, windows: list(RotationWindowSchema) });
const ActionFields = {
  kind: CueKindSchema, cueBeat: Schema.NullOr(Finite), execution: ExecutionSchema,
  captureTail: Schema.Literals(['none', 'silence-to-bar-end']), tempoBeatHint: Schema.Literals([0, 1]),
};
const AuthoredCueSchema = Schema.Struct({
  bar: Schema.Int, buttonId: ButtonSchema, voiceId: Schema.String, source: SourceRefSchema,
  actions: list(Schema.Struct({ group: Schema.optionalKey(Schema.Int), operation: Schema.Literals(['cr', 'cx', 'r', 'c', 'x', 'p', 'g', 'h']), pressBeat: Schema.NullOr(Finite), sourceName: Schema.NullOr(Schema.String),
    execution: Schema.Union([Schema.Struct({ kind: Schema.Literal('now') }), Schema.Struct({ kind: Schema.Literal('next-bar') }),
      Schema.Struct({ kind: Schema.Literal('beat'), beat: Finite, barOffset: Schema.Literals([0, 1]) })]) })),
});
const CueWindowSchema = Schema.Struct({ earlyMs: Finite, lateMs: Finite, ties: Schema.Literal('reject') });
const OverrideSchema = Schema.Struct({
  a1: Schema.String, notation: Schema.String, ...ActionFields,
});
export const SongMappingSchema = Schema.Struct({
  mappingVersion: Schema.Literal(6), notationVersion: Schema.Literals(['dyc-v1', 'terse-v2']), songId: Schema.String,
  spreadsheetId: Schema.String, sheetId: Schema.Int, sheetName: Schema.String,
  titleCell: Schema.String, bpmCell: Schema.String, sectionRow: Schema.Int, barRow: Schema.Int, leadInColumn: Schema.Int,
  startBar: Schema.Int, endBar: Schema.Int,
  meter: Schema.Struct({ numerator: Schema.Int, denominator: Schema.Int }),
  controls: list(Schema.Struct({ buttonId: ButtonSchema, voiceId: Schema.String, cueRow: Schema.Int, arrangementRow: Schema.Int, nameNoteCell: Schema.String, playbackMode: Schema.optionalKey(Schema.Literals(['loop', 'one-shot'])) })),
  sourceBindings: Schema.optionalKey(list(Schema.Struct({ buttonId: ButtonSchema, sourceName: Schema.String, voiceId: Schema.optionalKey(Schema.String), profile: Schema.optionalKey(Schema.Int), sourceCell: Schema.optionalKey(Schema.String), captureReplacement: Schema.optionalKey(Schema.Boolean), playbackMode: Schema.Literals(['loop', 'one-shot']), default: Schema.optionalKey(Schema.Boolean), sustain: Schema.optionalKey(Schema.Struct({ beginCount: Finite, endCount: Finite, loopCounts: Finite })) }))),
  liveParts: list(Schema.Struct({ id: Schema.String, labelCell: Schema.String, role: Schema.Literals(['default-live', 'rotation-live']) })),
  rotationRule: Schema.optionalKey(Schema.Struct({ row: Schema.Int, voiceId: Schema.String, inactivityBeats: Finite })),
  cueWindow: Schema.NullOr(CueWindowSchema),
  capturePolicies: list(Schema.Struct({ voiceId: Schema.String, retention: Schema.Literals(['layer', 'variant', 'replace']), gain: Finite })),
  layerGroups: list(Schema.Struct({ id: Schema.String, voiceId: Schema.String, armCells: list(Schema.String) })),
  variantRules: list(Schema.Struct({ voiceId: Schema.String, row: Schema.Int, fromBar: Schema.Int, sampledOnly: Schema.Boolean })),
  variantReuses: list(Schema.Struct({ cell: Schema.String, notation: Schema.String, sourceArmCell: Schema.String, sourceBar: Schema.optionalKey(Schema.Int), endCount: Finite })),
  overrides: list(OverrideSchema),
  deferredRows: list(Schema.Struct({ row: Schema.Int, reason: Schema.String })),
});
export type SongMapping = typeof SongMappingSchema.Type;
export const decodeSongMapping = Schema.decodeUnknownSync(SongMappingSchema);
const DiagnosticSchema = Schema.Struct({ severity: Schema.Literals(['error', 'warning', 'info']), code: Schema.String, message: Schema.String, owner: Schema.String, source: SourceRefSchema });
export const LegacyCueSchema = Schema.Struct({
  id: Schema.String, bar: Schema.Int, buttonId: ButtonSchema, voiceId: Schema.String, ...ActionFields, takeId: Schema.NullOr(Schema.String),
  commitTakeId: Schema.NullOr(Schema.String), selectionId: Schema.NullOr(Schema.String), source: SourceRefSchema,
});
const CueSchema = Schema.Struct({ ...LegacyCueSchema.fields,
  captureReplacement: Schema.Boolean,
  launchPolicy: Schema.Literals(['autoplay', 'store']), playbackMode: Schema.Literals(['loop', 'one-shot', 'held', 'gated']),
  sourceName: Schema.NullOr(Schema.String), groupId: Schema.NullOr(Schema.String),
});
const TakeSchema = Schema.Struct({
  id: Schema.String, voiceId: Schema.String, profile: Schema.optionalKey(Schema.Int), sourceVoiceId: Schema.optionalKey(Schema.String), sourceName: Schema.optionalKey(Schema.NullOr(Schema.String)), slot: Schema.Int, begin: PointSchema,
  captureEnd: Schema.NullOr(PointSchema), loopEnd: Schema.NullOr(PointSchema),
  groupId: Schema.NullOr(Schema.String), phraseAnchorTakeId: Schema.String,
  armCueId: Schema.String, commitCueId: Schema.NullOr(Schema.String), phrase: Schema.String,
  retention: Schema.Literals(['layer', 'variant', 'replace', 'unresolved']), gain: Schema.NullOr(Finite),
});
const PadStrings = Schema.Struct({ L1: Schema.String, L2: Schema.String, R1: Schema.String, R2: Schema.String });
export const ChartSchema = Schema.Struct({
  title: Schema.String, bpm: Finite, beatsPerBar: Schema.Int,
  bars: list(Schema.Struct({ bar: Schema.Int, column: Schema.Int, sectionId: Schema.String, section: Schema.String, partial: Schema.Boolean, cues: PadStrings })),
  sections: list(Schema.Struct({ id: Schema.String, label: Schema.String, startBar: Schema.Int, endBar: Schema.Int })),
  spreadsheetId: Schema.String, sheetId: Schema.Int, sheetName: Schema.String, leadInColumn: Schema.Int,
  leadInCues: PadStrings, controlNames: PadStrings, annotatedThroughBar: Schema.Int,
});
const SelectionWindowSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('full') }),
  Schema.Struct({ kind: Schema.Literal('prefix'), endCount: Finite }),
  Schema.Struct({ kind: Schema.Literal('slice'), beginCount: Finite, endCount: Finite, loopCounts: Finite }),
]);
export const CompiledSongSchema = Schema.Struct({
  schemaVersion: Schema.Literal(7), notationVersion: Schema.Literals(['dyc-v1', 'terse-v2']), id: Schema.String, title: Schema.String,
  ticksPerQuarter: Schema.Literal(960), meter: Schema.Struct({ numerator: Schema.Int, denominator: Schema.Int }),
  source: Schema.Struct({ spreadsheetId: Schema.String, sheetId: Schema.Int, sheetName: Schema.String, range: Schema.String, digest: Schema.String }),
  mappingDigest: Schema.String, chart: ChartSchema,
  voices: list(Schema.Struct({ id: Schema.String, buttonId: ButtonSchema, arrangementRow: Schema.Int })),
  sourceProfiles: Schema.optionalKey(list(Schema.Struct({ id: Schema.String, profile: Schema.Int, source: SourceRefSchema, name: Schema.String }))),
  parts: list(PartSchema), rotation: Schema.NullOr(RotationSchema),
  cueWindow: Schema.NullOr(CueWindowSchema),
  noteBanks: Schema.optionalKey(list(Schema.Struct({ buttonId: ButtonSchema, toleranceMs: Finite, notes: list(Schema.Struct({ slot: Schema.Int, at: PointSchema })) }))),
  externalSamples: Schema.optionalKey(list(Schema.Struct({ slot: Schema.Int, voiceId: Schema.String, begin: PointSchema, end: PointSchema }))),
  authoredCues: Schema.optionalKey(list(AuthoredCueSchema)),
  cues: list(CueSchema), takes: list(TakeSchema),
  selections: list(Schema.Struct({ id: Schema.String, voiceId: Schema.String, groupId: Schema.String, takeIds: list(Schema.String), gains: list(Finite), window: SelectionWindowSchema })),
  playback: list(Schema.Struct({ bar: Schema.Int, voiceId: Schema.String, selectionId: Schema.String })),
  diagnostics: list(DiagnosticSchema), executable: Schema.Boolean,
});
const LegacyCompiledSongSchema = Schema.Struct({ ...CompiledSongSchema.fields, schemaVersion: Schema.Literal(6), cues: list(LegacyCueSchema) });
export function migrateCompiledCueV6(cue: typeof LegacyCueSchema.Type): typeof CueSchema.Type {
  return { ...cue, captureReplacement: false, launchPolicy: 'autoplay', playbackMode: 'loop', sourceName: null, groupId: null };
}
export type CompiledSong = typeof CompiledSongSchema.Type;
export type CompiledPart = typeof PartSchema.Type;
export type CompiledCue = typeof CueSchema.Type;
export type CompiledTake = typeof TakeSchema.Type;
export type SongDiagnostic = typeof DiagnosticSchema.Type;
export type Execution = typeof ExecutionSchema.Type;
function cueBoundary(cue: CompiledCue): typeof PointSchema.Type {
  return cue.execution.kind === 'next-bar' ? { bar: cue.bar + 1, beat: 0 }
    : { bar: Math.max(1, cue.bar) + (cue.execution.kind === 'beat' ? cue.execution.barOffset ?? 0 : 0), beat: cue.execution.kind === 'beat' ? cue.execution.beat : cue.cueBeat ?? 0 };
}
function pointCount(point: typeof PointSchema.Type, beats: number): number { return (point.bar - 1) * beats + point.beat; }
function samePoint(a: typeof PointSchema.Type, b: typeof PointSchema.Type): boolean { return a.bar === b.bar && a.beat === b.beat; }
function loopCounts(take: CompiledTake, beats: number): number | null { return take.loopEnd ? pointCount(take.loopEnd, beats) - pointCount(take.begin, beats) : null; }
function overlappingCaptures(takes: readonly CompiledTake[], beats: number) {
  const conflicts: { earlier: CompiledTake; later: CompiledTake }[] = [];
  for (let first = 0; first < takes.length; first++) for (let second = first + 1; second < takes.length; second++) {
    const a = takes[first], b = takes[second];
    if (!a.captureEnd || !b.captureEnd) continue;
    if (Math.max(pointCount(a.begin, beats), pointCount(b.begin, beats)) < Math.min(pointCount(a.captureEnd, beats), pointCount(b.captureEnd, beats))) {
      conflicts.push(pointCount(a.begin, beats) <= pointCount(b.begin, beats) ? { earlier: a, later: b } : { earlier: b, later: a });
    }
  }
  return conflicts;
}
export function decodeCompiledSong(input: unknown): CompiledSong {
  const version = Schema.decodeUnknownSync(Schema.Struct({ schemaVersion: Schema.Int }))(input).schemaVersion;
  const song = version === 6 ? (() => {
    const legacy = Schema.decodeUnknownSync(LegacyCompiledSongSchema, { onExcessProperty: 'error' })(input);
    return { ...legacy, schemaVersion: 7, cues: legacy.cues.map(migrateCompiledCueV6) } satisfies CompiledSong;
  })() : Schema.decodeUnknownSync(CompiledSongSchema, { onExcessProperty: 'error' })(input);
  if (song.notationVersion === 'terse-v2') {
    if (song.authoredCues === undefined) throw new Error('Terse notation requires typed authored cues.');
    const keys = new Set<string>();
    for (const cell of song.authoredCues) {
      const key = `${cell.bar}/${cell.buttonId}`;
      if (keys.has(key)) throw new Error('Duplicate authored cue cell.');
      keys.add(key);
      const shown = cell.bar === 0 ? song.chart.leadInCues[cell.buttonId] : song.chart.bars.find(bar => bar.bar === cell.bar)?.cues[cell.buttonId];
      const parsed = parseSheetCues(cell.source.text, song.meter.numerator);
      if (shown !== cell.source.text.trim() || parsed.kind !== 'parsed' || canonicalSongJson(parsed.actions) !== canonicalSongJson(cell.actions)) throw new Error('Authored cue display or semantics disagree.');
      if (song.executable) {
        const native = song.cues.filter(cue => cue.bar === cell.bar && cue.buttonId === cell.buttonId);
        if (native.length !== cell.actions.length || cell.actions.some(action => {
          const expected = lowerSheetCue(action);
          return !native.some(cue => (cue.sourceName !== null || cue.voiceId === cell.voiceId) && cue.source.a1 === cell.source.a1 && cue.kind === expected.kind && cue.cueBeat === expected.cueBeat && canonicalSongJson(cue.execution) === canonicalSongJson(expected.execution) && cue.sourceName === action.sourceName && cue.launchPolicy === (action.operation === 'cx' ? 'store' : 'autoplay') && cue.groupId === (action.group === undefined ? null : `${cell.source.a1}/group-${action.group}`) && (action.operation !== 'h' || cue.playbackMode === 'held') && (action.operation !== 'g' || cue.playbackMode === 'gated'));
        })) throw new Error('Authored cues disagree with native lowering.');
      }
    }
    for (const bar of [{ bar: 0, cues: song.chart.leadInCues }, ...song.chart.bars]) for (const button of ['L1', 'L2', 'R1', 'R2'] satisfies (keyof typeof bar.cues)[]) {
      const parsed = parseSheetCues(bar.cues[button], song.meter.numerator);
      if (song.executable && parsed.kind === 'invalid') throw new Error('Invalid authored cue cannot execute.');
      if (bar.cues[button] && !keys.has(`${bar.bar}/${button}`) && parseSheetCues(bar.cues[button], song.meter.numerator).kind === 'parsed') throw new Error('Authored cue cell is missing.');
    }
  }
  if (!song.executable) return song;
  if (song.diagnostics.some(d => d.severity === 'error') || !song.cueWindow) throw new Error('An executable song cannot contain unresolved errors or cue policy.');
  const beats = song.meter.numerator;
  if (!(beats === 4 && song.meter.denominator === 4 || beats === 6 && song.meter.denominator === 8)
    || song.chart.beatsPerBar !== beats || !Number.isFinite(song.chart.bpm) || song.chart.bpm < 40 || song.chart.bpm > 240) throw new Error('Invalid executable meter or tempo.');
  const bars = song.chart.bars.length;
  if (bars < 1 || bars > 4096 || song.chart.bars.some((bar, index) => bar.bar !== index + 1 || bar.partial
    || !Number.isSafeInteger(bar.column) || bar.column < 1)
    || song.chart.annotatedThroughBar < 1 || song.chart.annotatedThroughBar > bars) throw new Error('Invalid executable measure map.');
  if ([song.cueWindow.earlyMs, song.cueWindow.lateMs].some(value => !Number.isFinite(value) || value < 0 || value > 100)) throw new Error('Invalid executable cue window; use 0 through 100 milliseconds.');
  if (song.voices.length !== 4 || new Set(song.voices.map(voice => voice.buttonId)).size !== 4) throw new Error('Invalid executable button bindings.');
  const validGain = (value: number) => Number.isFinite(value) && value >= 0 && value <= 4;
  const validBeat = (value: number) => Number.isFinite(value) && value >= 0 && value < beats && Number.isInteger(value * 960);
  const validPoint = (point: typeof PointSchema.Type, end: boolean) => Number.isSafeInteger(point.bar) && point.bar >= 1
    && point.bar <= bars + Number(end) && validBeat(point.beat) && (point.bar <= bars || point.beat === 0);
  const unique = (ids: readonly string[], kind: string) => { if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${kind} identity.`); };
  unique(song.voices.map(v => v.id), 'voice'); unique(song.cues.map(c => c.id), 'cue'); unique(song.takes.map(t => t.id), 'take'); unique(song.selections.map(s => s.id), 'selection');
  unique(song.chart.bars.map(bar => String(bar.column)), 'chart column');
  unique(song.parts.map(part => part.id), 'part'); unique(song.parts.map(part => String(part.profile)), 'effect profile');
  const sourceValid = (source: typeof SourceRefSchema.Type) => source.sheetId === song.source.sheetId && /^[A-Z]+[1-9]\d*$/.test(source.a1);
  for (const part of song.parts) {
    const name = (part.source.text.trim() || part.source.note.trim()).replace(/^AF\s*-\s*/, '').trim();
    if (!part.id.trim() || !sourceValid(part.source) || !name || part.name !== name) throw new Error('Invalid executable source part identity.');
    if (part.role.kind === 'pad') {
      const buttonId = part.role.buttonId;
      const index = song.voices.findIndex(voice => voice.id === part.id && voice.buttonId === buttonId);
      if (index < 0 || part.profile !== index) throw new Error('Invalid executable part binding.');
    } else if (part.profile !== (part.role.kind === 'default-live' ? 4 : 5)) throw new Error('Invalid executable live profile.');
  }
  if (song.parts.length < 4 || song.parts.length > 6 || song.voices.some(voice => !song.parts.some(part => part.id === voice.id && part.role.kind === 'pad'))
    || song.parts.filter(part => part.role.kind === 'default-live').length > 1 || song.parts.filter(part => part.role.kind === 'rotation-live').length > 1) throw new Error('Invalid executable voice registry.');
  unique((song.sourceProfiles ?? []).map(profile => profile.id), 'source profile');
  unique((song.sourceProfiles ?? []).map(profile => String(profile.profile)), 'source effect profile');
  for (const profile of song.sourceProfiles ?? []) {
    const name = (profile.source.text.trim() || profile.source.note.trim()).replace(/^AF\s*-\s*/, '').trim();
    if (!profile.id.trim() || !sourceValid(profile.source) || !name || profile.name !== name || !Number.isInteger(profile.profile)
      || profile.profile < 0 || profile.profile >= 6) throw new Error('Invalid executable source profile identity.');
  }
  const profileOwners = [...song.parts, ...song.sourceProfiles ?? []];
  for (const owner of profileOwners) if (profileOwners.some(other => other !== owner
    && (other.profile === owner.profile || other.id === owner.id || other.source.a1 === owner.source.a1)
    && (other.id !== owner.id || other.profile !== owner.profile || canonicalSongJson(other.source) !== canonicalSongJson(owner.source) || other.name !== owner.name))) throw new Error('Conflicting executable source profile ownership.');
  if (song.rotation) {
    if (!song.parts.some(part => part.id === song.rotation?.voiceId && part.role.kind === 'rotation-live')
      || !validInactivityBeats(song.rotation.inactivityBeats)) throw new Error('Invalid executable rotation route.');
    let previousEnd = -1;
    for (const window of song.rotation.windows) {
      const begin = pointCount(window.begin, beats), end = pointCount(window.end, beats);
      if (!validPoint(window.begin, false) || !validPoint(window.end, true) || begin < previousEnd || end <= begin
        || !sourceValid(window.source) || !sourceValid(window.endSource) || window.sources.length < 1
        || window.sources.some(source => !sourceValid(source)) || window.sources[0].a1 !== window.source.a1 || window.sources.at(-1)?.a1 !== window.endSource.a1) throw new Error('Invalid executable rotation window.');
      previousEnd = end;
    }
  }
  if (song.takes.length > 28 || new Set(song.takes.map(t => t.slot)).size !== song.takes.length) throw new Error('Invalid prepared take resource count or slot identity.');
  for (const take of song.takes) {
    const sourceVoiceId = take.sourceVoiceId ?? take.voiceId;
    const profile = take.profile ?? song.voices.findIndex(voice => voice.id === take.voiceId);
    if (!Number.isInteger(profile) || profile < 0 || profile >= 6
      || ![...song.parts, ...song.sourceProfiles ?? []].some(source => source.id === sourceVoiceId && source.profile === profile)) throw new Error('Invalid executable source effect profile.');
    if (!song.voices.some(v => v.id === take.voiceId) || !take.captureEnd || !take.loopEnd || !take.groupId || take.gain === null || !validGain(take.gain)
      || take.retention === 'unresolved' || take.slot < 4 || take.slot >= 32 || !validPoint(take.begin, false) || !validPoint(take.captureEnd, true) || !validPoint(take.loopEnd, true)
      || pointCount(take.captureEnd, beats) <= pointCount(take.begin, beats) || pointCount(take.loopEnd, beats) < pointCount(take.captureEnd, beats)) throw new Error('Invalid executable take resource.');
    const anchor = song.takes.find(candidate => candidate.id === take.phraseAnchorTakeId);
    const period = loopCounts(take, beats), anchorPeriod = anchor && loopCounts(anchor, beats);
    if (!anchor || anchor.voiceId !== take.voiceId || (anchor.sourceVoiceId ?? anchor.voiceId) !== sourceVoiceId || (anchor.profile ?? song.voices.findIndex(voice => voice.id === anchor.voiceId)) !== profile || anchor.groupId !== take.groupId || anchor.phraseAnchorTakeId !== anchor.id || !period || period !== anchorPeriod
      || anchor.phrase !== take.phrase || pointCount(take.begin, beats) < pointCount(anchor.begin, beats)
      || Math.round((pointCount(take.begin, beats) - pointCount(anchor.begin, beats)) * 960) % Math.round(period * 960) !== 0) throw new Error('Invalid executable phrase group or loop period.');
  }
  for (const selection of song.selections) {
    if (!selection.takeIds.length || selection.takeIds.length !== selection.gains.length || new Set(selection.takeIds).size !== selection.takeIds.length
      || selection.gains.some(gain => !validGain(gain)) || selection.takeIds.some(id => !song.takes.some(t => t.id === id && t.voiceId === selection.voiceId && t.groupId === selection.groupId))) throw new Error('Invalid executable take selection.');
    if (selection.window.kind === 'prefix') {
      const take = song.takes.find(take => take.id === selection.takeIds[0]);
      const end = selection.window.endCount;
      if (selection.takeIds.length !== 1 || !take?.captureEnd || !take.loopEnd || end <= 0 || !Number.isInteger(end * 960)
        || end >= pointCount(take.captureEnd, beats) - pointCount(take.begin, beats)
        || end >= pointCount(take.loopEnd, beats) - pointCount(take.begin, beats)) throw new Error('Invalid executable selection source window.');
    }
    if (selection.window.kind === 'slice') {
      const take = song.takes.find(take => take.id === selection.takeIds[0]);
      const { beginCount, endCount, loopCounts } = selection.window;
      if (selection.takeIds.length !== 1 || !take?.captureEnd || !take.loopEnd || beginCount < 0 || endCount <= beginCount || loopCounts < endCount - beginCount
        || [beginCount, endCount, loopCounts].some(value => !Number.isInteger(value * 960))
        || endCount > pointCount(take.captureEnd, beats) - pointCount(take.begin, beats)
        || beginCount + loopCounts > pointCount(take.loopEnd, beats) - pointCount(take.begin, beats)) throw new Error('Invalid executable capture slice.');
    }
  }
  for (const cue of song.cues) {
    if (cue.bar < 0 || cue.bar > bars || cue.cueBeat !== null && !validBeat(cue.cueBeat)
      || cue.execution.kind === 'beat' && !validBeat(cue.execution.beat)) throw new Error('Invalid executable cue timing.');
    if (cue.bar === 0 && (cue.kind === 'arm' || cue.kind === 'commit-arm') && cue.execution.kind !== 'next-bar') throw new Error('Immediate lead-in capture is unsupported; arm at the next song bar.');
    if (cue.tempoBeatHint && (cue.kind !== 'play' || cue.execution.kind !== 'now' || cue.cueBeat !== 0)
      || cue.captureTail !== 'none' && cue.kind !== 'commit') throw new Error('Invalid executable compound cue.');
    if ((cue.kind === 'arm' || cue.kind === 'commit-arm') && cue.takeId === null
      || (cue.kind === 'commit' || cue.kind === 'commit-arm') && cue.commitTakeId === null
      || cue.kind === 'play' && cue.selectionId === null) throw new Error('Invalid executable cue resource.');
    if (!song.voices.some(v => v.id === cue.voiceId)
      || (cue.kind === 'arm' || cue.kind === 'commit' || cue.kind === 'commit-arm') && !song.voices.some(v => v.id === cue.voiceId && v.buttonId === cue.buttonId)
      || cue.takeId !== null && !song.takes.some(t => t.id === cue.takeId && t.voiceId === cue.voiceId)
      || cue.commitTakeId !== null && !song.takes.some(t => t.id === cue.commitTakeId && t.voiceId === cue.voiceId)
      || cue.selectionId !== null && !song.selections.some(s => s.id === cue.selectionId && s.voiceId === cue.voiceId)) throw new Error('Invalid executable cue reference.');
    if (cue.commitTakeId !== null && cue.sourceName !== null && song.takes.find(take => take.id === cue.commitTakeId)?.sourceName !== cue.sourceName) throw new Error('Named commit source disagrees with its recording.');
    if ((cue.kind === 'arm' || cue.kind === 'commit-arm') !== (cue.takeId !== null)
      || (cue.kind === 'commit' || cue.kind === 'commit-arm') !== (cue.commitTakeId !== null)
      || (cue.kind === 'arm' && cue.selectionId !== null)
      || ((cue.kind === 'commit' || cue.kind === 'commit-arm') && cue.selectionId === null)
      || (cue.kind === 'play' && cue.selectionId === null)) throw new Error('Invalid executable capture cue kind.');
  }
  for (const take of song.takes) {
    const arms = song.cues.filter(cue => cue.takeId === take.id);
    const commits = song.cues.filter(cue => cue.commitTakeId === take.id);
    const arm = arms[0], commit = commits[0];
    const capturedCounts = take.captureEnd ? pointCount(take.captureEnd, beats) - pointCount(take.begin, beats) : null;
    if (arms.length !== 1 || commits.length !== 1 || arm.id !== take.armCueId || commit.id !== take.commitCueId
      || cueBoundary(arm).bar !== take.begin.bar || cueBoundary(arm).beat !== take.begin.beat
      || !take.captureEnd || !take.loopEnd || !samePoint(cueBoundary(commit), take.captureEnd)
      || !samePoint(take.loopEnd, commit.captureTail === 'silence-to-bar-end' ? { bar: take.captureEnd.bar + 1, beat: 0 } : take.captureEnd)
      || !song.selections.some(selection => selection.id === commit.selectionId && selection.takeIds.includes(take.id)
        && (selection.window.kind === 'full' || selection.window.kind === 'slice'
          && selection.window.endCount === capturedCounts
          && selection.window.beginCount === selection.window.endCount - beats && selection.window.loopCounts === beats))) {
      throw new Error('Invalid executable capture graph.');
    }
  }
  if (song.playback.some(p => p.bar < 1 || p.bar > bars || !song.selections.some(s => s.id === p.selectionId && s.voiceId === p.voiceId))) throw new Error('Invalid executable playback reference.');
  if (song.noteBanks) {
    const buttons = new Set<string>();
    for (const bank of song.noteBanks) {
      if (buttons.has(bank.buttonId) || bank.toleranceMs < 0 || bank.toleranceMs > 100 || !bank.notes.length) throw new Error('Invalid manual note bank.');
      buttons.add(bank.buttonId);
      let previous = -1;
      for (const note of bank.notes) {
        const at = pointCount(note.at, beats);
        if (note.slot < 0 || note.slot > 63 || !validPoint(note.at, false) || at <= previous) throw new Error('Invalid manual note order.');
        previous = at;
      }
    }
  }
  if (song.externalSamples) {
    const slots = new Set<number>();
    for (const sample of song.externalSamples) {
      if (!Number.isInteger(sample.slot) || sample.slot < 0 || sample.slot > 63 || slots.has(sample.slot)
        || !sample.voiceId.trim() || !validPoint(sample.begin, false) || !validPoint(sample.end, true)
        || pointCount(sample.end, beats) <= pointCount(sample.begin, beats)) throw new Error('Invalid external sample chart binding.');
      slots.add(sample.slot);
    }
  }
  const selectionReady = (id: string, point: typeof PointSchema.Type) => song.selections.find(selection => selection.id === id)?.takeIds.every(id => {
    const end = song.takes.find(take => take.id === id)?.captureEnd;
    return end && end.bar * beats + end.beat <= point.bar * beats + point.beat;
  });
  if (song.cues.some(cue => cue.selectionId !== null && !selectionReady(cue.selectionId, cueBoundary(cue)))
    || song.playback.some(playback => !selectionReady(playback.selectionId, { bar: playback.bar, beat: 0 }))) throw new Error('An executable selection cannot precede its captures.');
  if (overlappingCaptures(song.takes, beats).length) throw new Error('Executable recording intervals must not overlap. Future arming may overlap an earlier recording.');
  return song;
}

function canonical(value: Schema.MutableJson): string {
  if (typeof value === 'string') return JSON.stringify(value.replace(/\r\n?/g, '\n'));
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export function canonicalSongJson(value: unknown): string {
  return canonical(Schema.decodeUnknownSync(Schema.MutableJson)(value)) + '\n';
}
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSongJson(value));
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}
function coordinate(a1: string): { row: number; column: number } {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(a1);
  if (!match) throw new Error(`Invalid mapped cell ${a1}`);
  const column = Array.from(match[1]).reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
  return { row: Number(match[2]), column };
}
function at(values: readonly (readonly string[])[], row: number, column: number): string { return values[row - 1]?.[column - 1] ?? ''; }
type Action = Pick<CompiledCue, keyof typeof ActionFields>;
/** Explicit boundary migration; archived notation is never interpreted downstream. */
function migrateDycCue(text: string): { text: string; captureTail: Action['captureTail']; tempoBeatHint: 0 | 1 } {
  if (text === 'clb') return { text: 'c', captureTail: 'none', tempoBeatHint: 0 };
  if (text === '1p*') return { text: '1p', captureTail: 'none', tempoBeatHint: 1 };
  return { text, captureTail: /^[1-9]c[1-9]$/.test(text) ? 'silence-to-bar-end' : 'none', tempoBeatHint: 0 };
}
function lowerSheetCue(cue: SheetCue): Action {
  const execution: Execution = cue.execution.kind !== 'beat' ? cue.execution
    : cue.execution.barOffset === 1 && cue.execution.beat === 0 ? { kind: 'next-bar' }
    : { kind: 'beat', beat: cue.execution.beat, ...(cue.execution.barOffset ? { barOffset: cue.execution.barOffset } : {}) };
  const fields = { cueBeat: cue.pressBeat, execution, captureTail: 'none', tempoBeatHint: 0 } satisfies Omit<Action, 'kind'>;
  const kinds = { r: 'arm', c: 'commit', cr: 'commit-arm', cx: 'commit', x: 'stop', p: 'play', h: 'play', g: 'play' } satisfies Record<SheetCue['operation'], Action['kind']>;
  return { ...fields, kind: kinds[cue.operation] };
}
export function parseArrangementHits(text: string, beatsPerBar = 4): number[] | null {
  const value = text.trim().replace(/'$/, '');
  if (!value) return [];
  let anchor: number | null = null;
  let index = 0;
  const hits: number[] = [];
  while (index < value.length) {
    const anchored = /^\(([1-9]\d*)\)/.exec(value.slice(index));
    if (anchored) { anchor = Number(anchored[1]) - 1; index += anchored[0].length; continue; }
    const numbered = /^([1-9])/.exec(value.slice(index));
    if (numbered) { anchor = Number(numbered[1]) - 1; hits.push(anchor); index += numbered[0].length; continue; }
    const char = value[index++];
    if (/\s/.test(char)) continue;
    if (char !== 'e' && char !== '&' && char !== 'a') return null;
    if (anchor === null) return null;
    hits.push(anchor + (char === 'e' ? .25 : char === '&' ? .5 : .75));
  }
  return hits.every((beat, i) => beat >= 0 && beat < beatsPerBar && (i === 0 || beat > hits[i - 1])) ? hits : null;
}
function normalizedPhrase(text: string): string { return text.trim().replace(/'/g, '').replace(/\s+/g, ' '); }

export async function compileSheetsSong(sourceInput: unknown, mappingInput: unknown): Promise<CompiledSong> {
  const source = Schema.decodeUnknownSync(SongSourceSchema)(sourceInput);
  const mapping = decodeSongMapping(mappingInput);
  const diagnostics: SongDiagnostic[] = [];
  const ref = (row: number, column: number): typeof SourceRefSchema.Type => {
    const a1 = columnName(column) + row;
    return { sheetId: source.sheetId, a1, text: at(source.values, row, column), note: source.notes[a1] ?? '' };
  };
  const issue = (code: string, message: string, location: typeof SourceRefSchema.Type, severity: SongDiagnostic['severity'] = 'error', owner = 'Performance Engine') => diagnostics.push({ severity, code, message, owner, source: location });
  if (mapping.spreadsheetId !== source.spreadsheetId || mapping.sheetId !== source.sheetId || mapping.sheetName !== source.sheetName) issue('source-identity', 'The mapping worksheet identity does not match the frozen source.', ref(1, 1));
  if (!(mapping.meter.numerator === 4 && mapping.meter.denominator === 4 || mapping.meter.numerator === 6 && mapping.meter.denominator === 8)) issue('meter', 'This native capability supports dominant 4/4 or 6/8. Other meter declarations need an engine capability before execution.', ref(3, 2));
  if (mapping.startBar !== 1 || mapping.endBar < 1 || mapping.endBar > 4096) issue('range', 'The first compiled range must start at bar 1 and contain at most 4096 bars.', ref(mapping.barRow, 1));
  if (mapping.sourceBindings) {
    const names = new Set<string>(), defaults = new Set<string>();
    for (const binding of mapping.sourceBindings) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(binding.sourceName) || names.has(binding.sourceName)
        || binding.default && defaults.has(binding.buttonId)) issue('source-binding', 'Source names must be unique and each button can have one default source.', ref(1, 1));
      const control = mapping.controls.find(control => control.buttonId === binding.buttonId);
      if (binding.profile !== undefined && (!Number.isInteger(binding.profile) || binding.profile < 0 || binding.profile >= 6)) issue('source-profile', 'Source profiles must name a prepared profile from zero through five.', ref(control?.cueRow ?? 1, 1));
      if (binding.voiceId !== undefined && binding.voiceId !== control?.voiceId && binding.profile === undefined)
        issue('source-effects-capability', `Source ${binding.sourceName} belongs to ${binding.voiceId}; bind its independent prepared effect profile before execution.`, ref(control?.cueRow ?? 1, 1));
      names.add(binding.sourceName);
      if (binding.default) defaults.add(binding.buttonId);
    }
  }
  if (mapping.controls.length !== 4 || new Set(mapping.controls.map(c => c.buttonId)).size !== 4 || new Set(mapping.controls.map(c => c.voiceId)).size !== 4) issue('bindings', 'Map four distinct input buttons to four distinct logical voices.', ref(1, 1));
  if (new Set(mapping.overrides.map(o => o.a1)).size !== mapping.overrides.length) issue('duplicate-override', 'Each source cell can have only one explicit override.', ref(1, 1));
  if (new Set(mapping.capturePolicies.map(p => p.voiceId)).size !== mapping.capturePolicies.length) issue('duplicate-capture-policy', 'Each voice can have only one capture retention policy.', ref(1, 1));
  if (mapping.cueWindow === null) issue('cue-window', 'Specify the approved early/late cue window before loading this song.', ref(mapping.barRow, 1));
  else if ([mapping.cueWindow.earlyMs, mapping.cueWindow.lateMs].some(value => value < 0 || value > 100)) issue('cue-window', 'Cue windows must be finite milliseconds from 0 through 100; equal-distance ties reject.', ref(mapping.barRow, 1));
  const titleCell = coordinate(mapping.titleCell), bpmCell = coordinate(mapping.bpmCell);
  const title = at(source.values, titleCell.row, titleCell.column).trim();
  const bpm = Number(at(source.values, bpmCell.row, bpmCell.column));
  if (!title) issue('title', 'The title cell is empty.', ref(titleCell.row, titleCell.column));
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) issue('bpm', 'The initial reference BPM must be 40..240.', ref(bpmCell.row, bpmCell.column));
  const columns = new Map<number, number>();
  const barRow = source.values[mapping.barRow - 1] ?? [];
  barRow.forEach((text, index) => {
    if (!/^\d+(?:\*| \(part\))?$/.test(text.trim())) return;
    const bar = Number.parseInt(text, 10);
    if (bar < mapping.startBar || bar > mapping.endBar) return;
    if (columns.has(bar)) issue('duplicate-bar', `Bar ${bar} occurs more than once.`, ref(mapping.barRow, index + 1));
    else columns.set(bar, index + 1);
  });
  for (let bar = mapping.startBar; bar <= Math.min(mapping.endBar, 4096); bar++) if (!columns.has(bar)) issue('missing-bar', `Bar ${bar} is missing.`, ref(mapping.barRow, 1));
  const mappedColumns = new Set([mapping.leadInColumn, ...columns.values()]);
  for (const control of mapping.controls) for (const [index, text] of (source.values[control.cueRow - 1] ?? []).entries()) {
    const column = index + 1;
    if (column > mapping.leadInColumn && !mappedColumns.has(column) && text.trim()
      && !/^\d+(?:\*| \(part\))?$/.test(barRow[index]?.trim() ?? ''))
      issue('cue-timeline', `Cue belongs to ${barRow[index] || 'an uncounted column'} without an executable chart boundary. Add its explicit timeline before loading audio.`, ref(control.cueRow, column));
  }
  const sectionRow = source.values[mapping.sectionRow - 1] ?? [];
  const sections: ChartSection[] = [], bars: ChartBar[] = [];
  let section: ChartSection | null = null;
  const padRow = (column: number) => ({
    L1: at(source.values, mapping.controls.find(c => c.buttonId === 'L1')?.cueRow ?? 1, column).trim(),
    L2: at(source.values, mapping.controls.find(c => c.buttonId === 'L2')?.cueRow ?? 1, column).trim(),
    R1: at(source.values, mapping.controls.find(c => c.buttonId === 'R1')?.cueRow ?? 1, column).trim(),
    R2: at(source.values, mapping.controls.find(c => c.buttonId === 'R2')?.cueRow ?? 1, column).trim(),
  });
  let previousColumn = 0;
  for (const [bar, column] of [...columns].sort(([a], [b]) => a - b)) {
    let label = '';
    for (let c = previousColumn + 1; c <= column; c++) if (sectionRow[c - 1]?.trim()) label = sectionRow[c - 1].trim();
    previousColumn = column;
    if (label) { section = { id: `section-${bar}`, label, startBar: bar, endBar: bar }; sections.push(section); }
    if (!section) { issue('section', 'The first compiled bar needs a section label.', ref(mapping.sectionRow, column)); section = { id: `section-${bar}`, label: 'Unresolved section', startBar: bar, endBar: bar }; sections.push(section); }
    section.endBar = bar;
    if (barRow[column - 1]?.includes('(part)')) issue('partial-bar', 'Specify the short measure length before compiling this range.', ref(mapping.barRow, column));
    bars.push({ bar, column, sectionId: section.id, section: section.label, partial: barRow[column - 1]?.includes('(part)') ?? false, cues: padRow(column) });
  }
  const nameFor = (button: typeof ButtonSchema.Type) => {
    const control = mapping.controls.find(c => c.buttonId === button);
    return control ? source.notes[control.nameNoteCell]?.trim() || control.voiceId : button;
  };
  const partName = (location: typeof SourceRefSchema.Type) => (location.text.trim() || location.note.trim()).replace(/^AF\s*-\s*/, '').trim();
  const parts: CompiledPart[] = mapping.controls.map((control, profile) => {
    const noteCell = coordinate(control.nameNoteCell);
    const arrangement = ref(control.arrangementRow, 1);
    const location = arrangement.text.trim() ? arrangement : ref(noteCell.row, noteCell.column);
    const name = partName(location);
    if (!name) issue('part-label', 'A mapped voice needs a source label or note.', location);
    return { id: control.voiceId, name, source: location, role: { kind: 'pad', buttonId: control.buttonId }, profile };
  });
  for (const part of mapping.liveParts) {
    const cell = coordinate(part.labelCell), location = ref(cell.row, cell.column), name = partName(location);
    if (!name || !part.id.trim() || parts.some(existing => existing.id === part.id || existing.role.kind === part.role)) {
      issue('part-binding', 'Live parts need a source label, unique identity, and unique default or rotation role.', location);
    }
    parts.push({ id: part.id, name, source: location, role: { kind: part.role }, profile: part.role === 'default-live' ? 4 : 5 });
  }
  const sourceProfiles: NonNullable<CompiledSong['sourceProfiles']> = [];
  for (const binding of mapping.sourceBindings ?? []) {
    if (binding.profile === undefined) continue;
    const voiceId = binding.voiceId ?? mapping.controls.find(control => control.buttonId === binding.buttonId)?.voiceId;
    const existing = [...parts, ...sourceProfiles].find(part => part.id === voiceId);
    const location = binding.sourceCell ? (() => { const cell = coordinate(binding.sourceCell); return ref(cell.row, cell.column); })() : existing?.source;
    if (!voiceId || !location || !partName(location)) { issue('source-profile', 'A source effect profile needs its voice identity and source label cell.', ref(1, 1)); continue; }
    if ([...parts, ...sourceProfiles].some(part => (part.id === voiceId || part.profile === binding.profile || part.source.a1 === location.a1)
      && (part.id !== voiceId || part.profile !== binding.profile || part.source.a1 !== location.a1))) {
      issue('source-profile', 'Each prepared effect profile belongs to one source voice identity.', location); continue;
    }
    if (!existing) sourceProfiles.push({ id: voiceId, profile: binding.profile, source: location, name: partName(location) });
  }
  let rotation: CompiledSong['rotation'] = null;
  if (mapping.rotationRule) {
    const rule = mapping.rotationRule;
    rotation = { voiceId: rule.voiceId, inactivityBeats: rule.inactivityBeats, windows: [] };
    if (!parts.some(part => part.id === rule.voiceId && part.role.kind === 'rotation-live') || !validInactivityBeats(rule.inactivityBeats)
      || rule.row < 1 || mapping.deferredRows.some(deferred => deferred.row === rule.row)) issue('rotation-rule', 'Declare one rotation-live source part and a positive release grid of at most one counted beat on the 960-tick count lattice, without deferring the same row.', ref(Math.max(1, rule.row), 1));
    if (at(source.values, rule.row, mapping.leadInColumn).trim()) issue('rotation-lead-in', 'Rotation spans must begin in a song measure, after the count-in.', ref(rule.row, mapping.leadInColumn));
    let open: { begin: typeof PointSchema.Type; source: typeof SourceRefSchema.Type; sources: typeof SourceRefSchema.Type[] } | null = null;
    for (const [bar, column] of [...columns].sort(([a], [b]) => a - b)) {
      const location = ref(rule.row, column), text = location.text.replace(/\s+/g, '');
      if (!text) {
        if (open) issue('rotation-continuation', 'An open rotation span needs an explicit d continuation or closing boundary in each measure.', location);
        continue;
      }
      let remaining = text;
      while (remaining) {
        const token = /^(?:\[([1-9])d-|-([1-9])d\]|d)/.exec(remaining);
        if (!token) { issue('rotation-notation', 'Expected [Nd-, d, or -Nd] rotation-span notation.', location); break; }
        remaining = remaining.slice(token[0].length);
        const writtenBeat = Number(token[1] ?? token[2] ?? 1);
        if (writtenBeat > mapping.meter.numerator) { issue('rotation-beat', 'A rotation boundary must lie inside the declared measure.', location); continue; }
        if (token[1]) {
          if (open) { issue('rotation-overlap', 'Close the current rotation span before opening another.', location); continue; }
          open = { begin: { bar, beat: writtenBeat - 1 }, source: location, sources: [location] };
        } else if (token[2]) {
          if (!open) { issue('rotation-close', 'This rotation closing boundary has no preceding opening boundary.', location); continue; }
          const end = { bar, beat: writtenBeat - 1 };
          if (pointCount(end, mapping.meter.numerator) <= pointCount(open.begin, mapping.meter.numerator)) issue('rotation-span', 'A rotation closing boundary must follow its opening boundary.', location);
          if (open.sources.at(-1)?.a1 !== location.a1) open.sources.push(location);
          rotation.windows.push({ begin: open.begin, end, source: open.source, endSource: location, sources: open.sources });
          open = null;
        } else if (!open) issue('rotation-continuation', 'A d continuation needs an open rotation span.', location);
        else if (open.sources.at(-1)?.a1 !== location.a1) open.sources.push(location);
      }
    }
    if (open) issue('rotation-unclosed', 'This rotation span has no closing boundary inside the compiled range.', open.source);
  }
  const chart: Chart = { title, bpm: Number.isFinite(bpm) ? bpm : 0, beatsPerBar: mapping.meter.numerator, bars, sections,
    spreadsheetId: source.spreadsheetId, sheetId: source.sheetId, sheetName: source.sheetName, leadInColumn: mapping.leadInColumn,
    leadInCues: padRow(mapping.leadInColumn), controlNames: { L1: nameFor('L1'), L2: nameFor('L2'), R1: nameFor('R1'), R2: nameFor('R2') }, annotatedThroughBar: mapping.endBar };
  const cues: CompiledCue[] = [];
  const authoredCues: (typeof AuthoredCueSchema.Type)[] = [];
  const usedOverrides = new Set<string>();
  for (const { buttonId, voiceId, cueRow } of mapping.controls) {
    for (const [bar, column] of [[0, mapping.leadInColumn], ...[...columns].sort(([a], [b]) => a - b)]) {
      const location = ref(cueRow, column), text = location.text.trim();
      if (!text) continue;
      const override = mapping.overrides.find(o => o.a1 === location.a1);
      const migrated = mapping.notationVersion === 'dyc-v1' ? migrateDycCue(text) : { text, captureTail: 'none', tempoBeatHint: 0 } satisfies ReturnType<typeof migrateDycCue>;
      const parsed = parseSheetCues(migrated.text, mapping.meter.numerator);
      if (override) {
        usedOverrides.add(override.a1);
        if (override.notation !== text) { issue('stale-override', `Override expects ${JSON.stringify(override.notation)}, but the current cell differs.`, location); continue; }
        if (mapping.notationVersion === 'terse-v2') { issue('cue-override', 'Terse cues must describe their complete action in the cell; remove the override.', location); continue; }
      }
      if (!override && parsed.kind === 'invalid') {
        const hits = parseArrangementHits(text, mapping.meter.numerator);
        if (hits?.length) issue('manual-tap-capability', `Manual tap positions ${hits.map(beat => beat + 1).join(', ')} are recognized, but this compiled runtime needs one-shot/sparse playback capability before loading that cue.`, location);
        else issue('unknown-cue', `Define the exact cue and execution meaning of ${JSON.stringify(text)}.`, location);
        continue;
      }
      if (mapping.notationVersion === 'terse-v2' && parsed.kind === 'parsed') authoredCues.push({ bar, buttonId, voiceId, source: location, actions: parsed.actions });
      const actions: (Action & { authored?: SheetCue })[] = [];
      if (override) actions.push(override);
      else if (parsed.kind === 'parsed') for (const cue of parsed.actions) {
        const migratedCue: SheetCue = mapping.notationVersion === 'dyc-v1' && cue.execution.kind === 'beat' ? { ...cue, execution: { ...cue.execution, barOffset: 0 } } : cue;
        const lowered = lowerSheetCue(migratedCue);
        actions.push({ ...lowered, captureTail: migrated.captureTail, tempoBeatHint: migrated.tempoBeatHint, authored: migratedCue });
      }
      for (const [actionIndex, action] of actions.entries()) {
      if (action.cueBeat !== null && (!Number.isFinite(action.cueBeat) || action.cueBeat < 0 || action.cueBeat >= mapping.meter.numerator)
        || action.execution.kind === 'beat' && (!Number.isFinite(action.execution.beat) || action.execution.beat < 0 || action.execution.beat >= mapping.meter.numerator)) {
        issue('cue-timing', 'Cue and execution beats must lie inside the current measure.', location); continue;
      }
      if (bar === 0 && (action.kind === 'arm' || action.kind === 'commit-arm') && action.execution.kind !== 'next-bar') {
        issue('lead-in-capture-capability', 'Immediate lead-in capture is unsupported because its duration depends on the count-in. Declare capture at the next song bar.', location);
      }
      cues.push({ id: `${mapping.songId}/bar-${bar}/${buttonId}/${action.kind}${actions.length > 1 ? `/${actionIndex + 1}` : ''}`, bar, buttonId, voiceId, kind: action.kind,
        cueBeat: action.cueBeat, execution: action.execution, captureTail: action.captureTail, tempoBeatHint: action.tempoBeatHint,
        captureReplacement: mapping.sourceBindings?.find(binding => binding.buttonId === buttonId && (action.authored?.sourceName ? binding.sourceName === action.authored.sourceName : binding.default))?.captureReplacement ?? false,
        launchPolicy: action.authored?.operation === 'cx' ? 'store' : 'autoplay',
        playbackMode: action.authored?.operation === 'h' ? 'held' : action.authored?.operation === 'g' ? 'gated' : (mapping.sourceBindings?.find(binding => binding.buttonId === buttonId && (action.authored?.sourceName ? binding.sourceName === action.authored.sourceName : binding.default))?.playbackMode ?? mapping.controls.find(control => control.buttonId === buttonId)?.playbackMode ?? 'loop'),
        sourceName: action.authored?.sourceName ?? null,
        groupId: action.authored?.group === undefined ? null : `${location.a1}/group-${action.authored.group}`,
        takeId: null, commitTakeId: null, selectionId: null, source: location });
      }
    }
  }
  for (const override of mapping.overrides) if (!usedOverrides.has(override.a1)) issue('unused-override', 'The override does not identify a nonempty control cell inside the compiled range.', { sheetId: source.sheetId, a1: override.a1, text: '', note: '' });
  const mappedRows = new Set(mapping.controls.map(c => c.cueRow));
  if (mapping.rotationRule) mappedRows.add(mapping.rotationRule.row);
  for (const row of [17, 22, 23, 24]) {
    if (mappedRows.has(row)) continue;
    const nonempty = [[0, mapping.leadInColumn], ...columns].filter(([, c]) => at(source.values, row, c).trim());
    if (!nonempty.length) continue;
    const deferred = mapping.deferredRows.find(d => d.row === row);
    for (const [, column] of nonempty) issue(deferred ? 'deferred-control' : 'unbound-control', deferred?.reason ?? 'This control row needs an explicit executable binding or operator-approved deferral.', ref(row, column), deferred ? 'info' : 'error', row === 17 ? 'Filters / Video / Performance Engine' : 'Performance Engine');
  }
  const takes: CompiledTake[] = [];
  for (const control of mapping.controls) {
    let open: CompiledTake | null = null;
    const policy = mapping.capturePolicies.find(p => p.voiceId === control.voiceId);
    const defaultSource = mapping.sourceBindings?.find(binding => binding.buttonId === control.buttonId && binding.default)?.sourceName ?? null;
    const ordered = cues.filter(c => c.buttonId === control.buttonId).sort((a, b) => a.bar - b.bar || (a.cueBeat ?? 0) - (b.cueBeat ?? 0));
    for (let index = 0; index < ordered.length; index++) {
      let cue = ordered[index];
      if (cue.kind === 'commit' || cue.kind === 'commit-arm') {
        if (!open) issue('commit-without-take', 'No preceding known arm cue supplies this commit. Resolve any earlier ambiguous cue first.', cue.source);
        else {
          const activeName = open.sourceName ?? defaultSource;
          if (cue.sourceName !== null && activeName !== null && cue.sourceName !== activeName) issue('capture-source-mismatch', `This commit names ${cue.sourceName}, but the active recording is ${activeName}.`, cue.source);
          const end = cueBoundary(cue);
          const loopEnd = cue.captureTail === 'silence-to-bar-end' ? { bar: end.bar + 1, beat: 0 } : end;
          const begin = open.begin;
          if (end.bar < begin.bar || end.bar === begin.bar && end.beat <= begin.beat) issue('capture-span', 'The commit boundary must follow the capture boundary.', cue.source);
          const sourceName = open.sourceName ?? cue.sourceName ?? defaultSource;
          const sourceVoiceId = mapping.sourceBindings?.find(binding => binding.buttonId === control.buttonId && binding.sourceName === sourceName)?.voiceId ?? control.voiceId;
          const boundProfile = mapping.sourceBindings?.find(binding => binding.buttonId === control.buttonId && binding.sourceName === sourceName)?.profile;
          const final: CompiledTake = { ...open, ...(boundProfile === undefined ? {} : { profile: boundProfile }), sourceVoiceId, sourceName: open.sourceName ?? cue.sourceName ?? defaultSource, captureEnd: end, loopEnd, commitCueId: cue.id,
            phrase: Array.from({ length: Math.max(0, loopEnd.bar - begin.bar + (loopEnd.beat > 0 ? 1 : 0)) }, (_, offset) => {
              const column = columns.get(begin.bar + offset);
              return column ? normalizedPhrase(at(source.values, control.arrangementRow, column)) : '';
            }).join('|') };
          takes[takes.findIndex(t => t.id === open?.id)] = final;
          cue = { ...cue, commitTakeId: open.id };
          cues[cues.findIndex(c => c.id === cue.id)] = cue;
          open = null;
        }
      }
      if (cue.kind !== 'arm' && cue.kind !== 'commit-arm') continue;
      if (open) issue('overlapping-take', 'This arm occurs before the prior take has a known commit.', cue.source);
      const takeId = `${mapping.songId}/${control.voiceId}/take-${takes.filter(t => t.voiceId === control.voiceId).length + 1}`;
      const take: CompiledTake = { id: takeId, voiceId: control.voiceId, sourceName: cue.sourceName ?? defaultSource, slot: takes.length + 4, begin: cueBoundary(cue), captureEnd: null, loopEnd: null,
        groupId: takeId, phraseAnchorTakeId: takeId,
        armCueId: cue.id, commitCueId: null, phrase: '', retention: policy?.retention ?? 'unresolved', gain: policy?.gain ?? 1 };
      if (!policy) issue('capture-policy', `Specify layer, variant, or replacement retention for ${control.voiceId}. Playback starts at unity gain.`, cue.source);
      else if (!Number.isFinite(policy.gain) || policy.gain < 0 || policy.gain > 4) issue('capture-gain', 'Capture playback gain must be finite and between 0 and 4.', cue.source);
      takes.push(take); open = take;
      cues[cues.findIndex(c => c.id === cue.id)] = { ...cue, takeId };
    }
    if (open) issue('uncommitted-take', 'This capture has no known commit inside the compiled range.', cues.find(c => c.id === open?.armCueId)?.source ?? ref(control.cueRow, mapping.leadInColumn));
  }
  if (takes.length > 28) issue('take-limit', 'This build supports at most 28 prepared takes in addition to four legacy display channels.', ref(mapping.barRow, 1));
  for (const { earlier, later } of overlappingCaptures(takes, mapping.meter.numerator)) {
    const arm = cues.find(candidate => candidate.id === earlier.armCueId)?.source.a1 ?? '?';
    const commit = cues.find(candidate => candidate.id === earlier.commitCueId)?.source.a1 ?? '?';
    const location = cues.find(candidate => candidate.id === later.armCueId)?.source ?? ref(mapping.barRow, 1);
    issue('capture-record-overlap', `${later.voiceId} records before ${earlier.voiceId}'s capture ends (${arm} -> ${commit}). Recording intervals must be disjoint; earlier future arming is allowed.`, location);
  }
  const assigned = new Set<string>();
  const groupIds = new Set<string>();
  const takeSource = (take: CompiledTake) => cues.find(cue => cue.id === take.armCueId)?.source ?? ref(mapping.barRow, 1);
  for (const group of mapping.layerGroups) {
    const fallback = group.armCells[0] ? coordinate(group.armCells[0]) : { row: mapping.barRow, column: 1 };
    const location = ref(fallback.row, fallback.column);
    if (!group.id || groupIds.has(group.id) || !group.armCells.length || new Set(group.armCells).size !== group.armCells.length) {
      issue('layer-group', 'Layer groups need a unique identity and distinct source arm cells.', location); continue;
    }
    groupIds.add(group.id);
    const members = group.armCells.map(cell => takes.find(take => take.voiceId === group.voiceId && takeSource(take).a1 === cell));
    const anchor = members[0];
    if (!anchor || members.some(take => !take)) { issue('layer-group', 'Every declared layer-group arm cell must identify a capture in this voice.', location); continue; }
    const period = loopCounts(anchor, mapping.meter.numerator);
    for (const take of members) {
      if (!take) continue;
      if (assigned.has(take.id) || take.retention !== 'layer') { issue('layer-group', 'Each layered capture belongs to exactly one declared layer group.', takeSource(take)); continue; }
      assigned.add(take.id);
      const actual = loopCounts(take, mapping.meter.numerator);
      if (take.phrase !== anchor.phrase || actual !== period || !period) {
        issue('doubling-invariant', `Group ${group.id} expects phrase ${JSON.stringify(anchor.phrase)} and ${period ?? '?'} counted beats from ${takeSource(anchor).a1}; ${takeSource(take).a1} supplies ${JSON.stringify(take.phrase)} and ${actual ?? '?'}. No source or period was resized.`, takeSource(take));
      } else if (pointCount(take.begin, mapping.meter.numerator) < pointCount(anchor.begin, mapping.meter.numerator)
        || Math.round((pointCount(take.begin, mapping.meter.numerator) - pointCount(anchor.begin, mapping.meter.numerator)) * 960) % Math.round(period * 960) !== 0) {
        issue('doubling-phase', 'Layer capture must begin at the declared phrase origin modulo its period.', takeSource(take));
      }
      takes[takes.findIndex(candidate => candidate.id === take.id)] = { ...take, groupId: group.id, phraseAnchorTakeId: anchor.id };
    }
  }
  for (const take of takes) if (take.retention === 'layer' && !assigned.has(take.id)) issue('layer-group', 'Declare the source arm cells and identity of this doubling group.', takeSource(take));
  const selections: CompiledSong['selections'] = [];
  const selectionPhrases = new Map<string, string>();
  for (const take of takes) {
    if (!take.captureEnd || !take.loopEnd || !take.groupId || take.retention === 'unresolved' || take.gain === null) continue;
    const existing = take.retention === 'layer' ? selections.filter(s => s.groupId === take.groupId && s.voiceId === take.voiceId).at(-1) : undefined;
    selections.push({ id: `${take.voiceId}/selection-${selections.filter(s => s.voiceId === take.voiceId).length + 1}`, voiceId: take.voiceId,
      groupId: take.groupId,
      takeIds: [...existing?.takeIds ?? [], take.id], gains: [...existing?.gains ?? [], take.gain], window: { kind: 'full' } });
    const commitIndex = cues.findIndex(c => c.id === take.commitCueId);
    if (commitIndex >= 0) cues[commitIndex] = { ...cues[commitIndex], selectionId: selections.at(-1)?.id ?? null };
    const fullSelection = selections.at(-1);
    if (fullSelection) selectionPhrases.set(fullSelection.id, take.phrase);
    if (commitIndex >= 0 && cues[commitIndex].source.text.trim() === 'clb') {
      if (take.begin.beat !== 0 || take.captureEnd.beat !== 0 || take.retention !== 'variant') {
        issue('capture-slices', 'Commit-last-bar requires a whole-bar retained-variant capture.', cues[commitIndex].source);
        continue;
      }
      for (let bar = take.begin.bar; bar < take.captureEnd.bar; bar++) {
        const beginCount = (bar - take.begin.bar) * mapping.meter.numerator;
        const selection: CompiledSong['selections'][number] = { id: `${take.id}/bar-${bar}`, voiceId: take.voiceId,
          groupId: take.groupId, takeIds: [take.id], gains: [take.gain],
          window: { kind: 'slice', beginCount, endCount: beginCount + mapping.meter.numerator, loopCounts: mapping.meter.numerator } };
        selections.push(selection);
        const column = columns.get(bar);
        const control = mapping.controls.find(control => control.voiceId === take.voiceId);
        selectionPhrases.set(selection.id, column && control ? normalizedPhrase(at(source.values, control.arrangementRow, column)) : '');
      }
      cues[commitIndex] = { ...cues[commitIndex], selectionId: selections.at(-1)?.id ?? null };
    }
  }
  const playback: CompiledSong['playback'] = [];
  const reusedSelections = new Map<string, string>();
  const reusedCells = new Set<string>();
  for (const reuse of mapping.variantReuses) {
    const cell = coordinate(reuse.cell), location = ref(cell.row, cell.column);
    const bar = [...columns].find(([, column]) => column === cell.column)?.[0];
    const rule = mapping.variantRules.find(rule => rule.row === cell.row && bar !== undefined && bar >= rule.fromBar);
    const sourceTake = takes.find(take => takeSource(take).a1 === reuse.sourceArmCell);
    if (reusedCells.has(reuse.cell)) { issue('duplicate-variant-reuse', 'Each arrangement cell can have only one retained-take reuse.', location); continue; }
    reusedCells.add(reuse.cell);
    if (location.text !== reuse.notation) { issue('stale-variant-reuse', 'The arrangement cell no longer matches its explicit retained-take reuse.', location); continue; }
    if (!rule || bar === undefined || !location.text.trim() || rule.sampledOnly && !location.text.includes("'")) {
      issue('variant-reuse-target', 'A reuse must name a sampled arrangement cell covered by a variant rule.', location); continue;
    }
    if (!sourceTake || sourceTake.voiceId !== rule.voiceId || !sourceTake.captureEnd || !sourceTake.loopEnd || !sourceTake.groupId || sourceTake.gain === null
      || pointCount(sourceTake.captureEnd, mapping.meter.numerator) > pointCount({ bar, beat: 0 }, mapping.meter.numerator)) {
      issue('variant-reuse-source', 'The source arm cell must identify an earlier committed take in the same voice.', location); continue;
    }
    if (reuse.endCount <= 0 || !Number.isInteger(reuse.endCount * 960)
      || reuse.sourceBar !== undefined && reuse.endCount >= mapping.meter.numerator
      || reuse.endCount >= pointCount(sourceTake.captureEnd, mapping.meter.numerator) - pointCount(sourceTake.begin, mapping.meter.numerator)
      || reuse.endCount >= pointCount(sourceTake.loopEnd, mapping.meter.numerator) - pointCount(sourceTake.begin, mapping.meter.numerator)) {
      issue('variant-reuse-window', 'A prefix endpoint must lie strictly inside the captured source and loop on the 960-tick count lattice.', location); continue;
    }
    const beginCount = reuse.sourceBar === undefined ? 0 : (reuse.sourceBar - sourceTake.begin.bar) * mapping.meter.numerator;
    const sourceSlice = reuse.sourceBar === undefined ? undefined : selections.find(selection => selection.takeIds[0] === sourceTake.id
      && selection.window.kind === 'slice' && selection.window.beginCount === beginCount);
    if (reuse.sourceBar !== undefined && !sourceSlice) { issue('variant-reuse-source', 'The source bar must identify a retained capture slice.', location); continue; }
    const window: typeof SelectionWindowSchema.Type = sourceSlice ? { kind: 'slice', beginCount, endCount: beginCount + reuse.endCount, loopCounts: mapping.meter.numerator }
      : { kind: 'prefix', endCount: reuse.endCount };
    const existing = selections.find(selection => JSON.stringify(selection.window) === JSON.stringify(window)
      && selection.takeIds.length === 1 && selection.takeIds[0] === sourceTake.id);
    const selection = existing ?? { id: `${sourceTake.id}/prefix-${reuse.endCount * 960}`, voiceId: sourceTake.voiceId,
      groupId: sourceTake.groupId, takeIds: [sourceTake.id], gains: [sourceTake.gain], window };
    if (!existing) selections.push(selection);
    reusedSelections.set(reuse.cell, selection.id);
  }
  for (const rule of mapping.variantRules) {
    const available = selections.filter(s => s.voiceId === rule.voiceId && selectionPhrases.has(s.id));
    let previous: { bar: number; selection: CompiledSong['selections'][number] } | undefined;
    for (const [bar, column] of columns) {
      const text = at(source.values, rule.row, column);
      if (bar < rule.fromBar || !text.trim() || rule.sampledOnly && !text.includes("'")) continue;
      const reuse = reusedSelections.get(`${columnName(column)}${rule.row}`);
      if (reuse) {
        playback.push({ bar, voiceId: rule.voiceId, selectionId: reuse });
        const selection = selections.find(selection => selection.id === reuse);
        previous = selection ? { bar, selection } : undefined;
        continue;
      }
      const phrase = normalizedPhrase(text);
      const matches = available.filter(s => selectionPhrases.get(s.id) === phrase
        && s.takeIds.every(id => { const end = takes.find(t => t.id === id)?.captureEnd; return end && (end.bar < bar || end.bar === bar && end.beat === 0); }));
      const previousSlice = previous?.selection.window;
      const previousTake = previous?.selection.takeIds[0];
      const continuation = previous?.bar === bar - 1 && previousSlice?.kind === 'slice' ? matches.find(selection => selection.window.kind === 'slice'
        && selection.takeIds[0] === previousTake && selection.window.beginCount === previousSlice.beginCount + previousSlice.loopCounts) : undefined;
      const selection = continuation ?? matches.at(-1);
      if (!selection) issue('unknown-variant', 'No committed retained take matches this normalized arrangement phrase.', ref(rule.row, column));
      else { playback.push({ bar, voiceId: rule.voiceId, selectionId: selection.id }); previous = { bar, selection }; }
    }
  }
  cues.sort((a, b) => a.bar - b.bar || (a.cueBeat ?? 0) - (b.cueBeat ?? 0) || a.buttonId.localeCompare(b.buttonId));
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (cue.kind !== 'play' && !(cue.kind === 'stop' && cue.sourceName !== null)) continue;
    const boundary = cueBoundary(cue);
    const binding = cue.sourceName === null ? mapping.sourceBindings?.find(binding => binding.buttonId === cue.buttonId && binding.default)
      : mapping.sourceBindings?.find(binding => binding.sourceName === cue.sourceName);
    const control = mapping.controls.find(control => control.buttonId === (binding?.buttonId ?? cue.buttonId));
    const playbackMode = cue.playbackMode === 'held' || cue.playbackMode === 'gated' ? cue.playbackMode : binding?.playbackMode ?? control?.playbackMode ?? cue.playbackMode;
    const voiceId = control?.voiceId ?? cue.voiceId;
    if (mapping.notationVersion === 'terse-v2' && cue.kind === 'play' && playbackMode === 'loop' && !control?.playbackMode && !binding)
      issue('playback-mode', 'Declare loop or one-shot playback for this control.', cue.source);
    const available = takes.filter(take => take.voiceId === voiceId && take.captureEnd
      && pointCount(take.captureEnd, mapping.meter.numerator) <= pointCount(boundary, mapping.meter.numerator));
    const selectedSource = cue.sourceName ?? binding?.sourceName ?? null;
    let candidates = selectedSource === null ? available : available.filter(take => take.sourceName === selectedSource);
    if ((playbackMode === 'one-shot' || playbackMode === 'held') && cue.sourceName === null && cue.cueBeat !== null) {
      const parity = Math.floor(cue.cueBeat) % 2;
      const matching = candidates.filter(take => Math.floor(take.begin.beat) % 2 === parity);
      candidates = matching;
    }
    const previous = candidates.at(-1);
    let selectionId = (cue.sourceName === null && cue.playbackMode === 'loop' ? playback.find(entry => entry.voiceId === cue.voiceId && entry.bar === boundary.bar)?.selectionId : undefined)
      ?? selections.find(selection => previous && selection.takeIds.includes(previous.id))?.id ?? null;
    if ((playbackMode === 'held' || playbackMode === 'gated') && previous && selectionId !== null) {
      if (!binding?.sustain) issue('sustain-region', 'Declare a trimmed sustain source region before held playback.', cue.source);
      else {
        const selection = selections.find(selection => selection.id === selectionId);
        if (selection) {
          const id = `${selection.id}/held`;
          if (!selections.some(selection => selection.id === id)) selections.push({ ...selection, id, window: { kind: 'slice', ...binding.sustain } });
          selectionId = id;
        }
      }
    }
    cues[i] = { ...cue, voiceId, playbackMode, selectionId };
    if (selectionId === null)
      issue(cue.kind === 'stop' ? 'stop-selection' : 'play-selection', 'The named or played cue has no resolved committed source.', cue.source);
  }
  const artifact: CompiledSong = {
    schemaVersion: 7, notationVersion: mapping.notationVersion, id: mapping.songId, title, ticksPerQuarter: 960, meter: mapping.meter,
    source: { spreadsheetId: source.spreadsheetId, sheetId: source.sheetId, sheetName: source.sheetName, range: source.range, digest: await digest(source) },
    mappingDigest: await digest(mapping), chart, voices: mapping.controls.map(c => ({ id: c.voiceId, buttonId: c.buttonId, arrangementRow: c.arrangementRow })),
    ...(sourceProfiles.length ? { sourceProfiles } : {}), parts, rotation, cueWindow: mapping.cueWindow, ...(mapping.notationVersion === 'terse-v2' ? { authoredCues } : {}), cues, takes, selections, playback, diagnostics,
    executable: !diagnostics.some(d => d.severity === 'error'),
  };
  return decodeCompiledSong(artifact);
}

export function inspectCompiledSong(input: unknown): string {
  const song = decodeCompiledSong(input);
  const lines = [`${song.title} (${song.id})`, `Schema ${song.schemaVersion} · ${song.notationVersion} · ${song.executable ? 'executable' : 'BLOCKED'}`,
    `Source ${song.source.sheetName} / gid ${song.source.sheetId} / ${song.source.digest}`, `Range ${song.chart.bars[0]?.bar ?? '?'}..${song.chart.bars.at(-1)?.bar ?? '?'} · ${song.meter.numerator}/${song.meter.denominator}`];
  for (const part of song.parts) lines.push(`PART\t${part.source.a1}\t${part.name}\t${part.id}\tprofile ${part.profile}\t${part.role.kind}${part.role.kind === 'pad' ? ` ${part.role.buttonId}` : ''}`);
  if (song.rotation) {
    lines.push(`ROTATION\t${song.rotation.voiceId}\trelease after ${song.rotation.inactivityBeats} counted beats of inactivity after accepted jiggle; gate at written end; natural tails`);
    for (const window of song.rotation.windows) lines.push(`ROTATION WINDOW\t${window.source.a1} -> ${window.endSource.a1}\t${window.begin.bar}:${window.begin.beat + 1}..${window.end.bar}:${window.end.beat + 1}\thalf-open\t${window.sources.map(source => source.a1).join(',')}`);
  }
  for (const cell of song.authoredCues ?? []) for (const action of cell.actions) {
    const execution = action.execution.kind === 'beat' ? `bar ${cell.bar + action.execution.barOffset} count ${action.execution.beat + 1}` : action.execution.kind;
    lines.push(`AUTHORED\t${cell.source.a1}\t${cell.buttonId} -> ${cell.voiceId}\tpress ${action.pressBeat === null ? 'column' : action.pressBeat + 1}\t${action.operation}(${action.sourceName ?? 'default'})\t${execution}`);
  }
  for (const cue of song.cues) {
    const timing = cue.execution.kind === 'beat' ? `beat ${cue.execution.beat + 1}` : cue.execution.kind;
    lines.push(`${cue.source.a1}\t${cue.source.text}\t${cue.buttonId} -> ${cue.voiceId}\tbar ${cue.bar} cue ${cue.cueBeat === null ? 'column' : cue.cueBeat + 1}\t${cue.kind} ${timing}\tnew ${cue.takeId ?? '-'} commit ${cue.commitTakeId ?? '-'} selection ${cue.selectionId ?? '-'}\t${cue.captureTail} tempo-hit ${cue.tempoBeatHint ? 'actual press / hint 1' : '-'}`);
  }
  if (song.cueWindow) lines.push(`WINDOW\t${song.cueWindow.earlyMs} ms early / ${song.cueWindow.lateMs} ms late\tties reject`);
  const point = (value: typeof PointSchema.Type | null) => value ? `${value.bar}:${value.beat + 1}` : '?';
  for (const take of song.takes) {
    const arm = song.cues.find(cue => cue.id === take.armCueId)?.source.a1 ?? '?';
    const commit = song.cues.find(cue => cue.id === take.commitCueId)?.source.a1 ?? '?';
    const captured = take.captureEnd ? pointCount(take.captureEnd, song.meter.numerator) - pointCount(take.begin, song.meter.numerator) : null;
    const rest = take.captureEnd && take.loopEnd ? pointCount(take.loopEnd, song.meter.numerator) - pointCount(take.captureEnd, song.meter.numerator) : null;
    lines.push(`TAKE\t${take.id}\t${arm} -> ${commit}\tcapture ${point(take.begin)}..${point(take.captureEnd)} (${captured ?? '?'} counts)\trest ${point(take.captureEnd)}..${point(take.loopEnd)} (${rest ?? '?'} counts, zero source)\tloop ${point(take.begin)}..${point(take.loopEnd)} (${loopCounts(take, song.meter.numerator) ?? '?'} counts)\tgroup ${take.groupId ?? '?'} anchor ${take.phraseAnchorTakeId}\t${take.retention}\t${JSON.stringify(take.phrase)}`);
  }
  for (const selection of song.selections) if (selection.window.kind === 'prefix') lines.push(`SOURCE WINDOW\t${selection.id}\t${selection.takeIds[0]}\t0..${selection.window.endCount} counts, exclusive\toriginal source and loop period retained`);
  for (const selection of song.selections) if (selection.window.kind === 'slice') lines.push(`SOURCE SLICE\t${selection.id}\t${selection.takeIds[0]}\t${selection.window.beginCount}..${selection.window.endCount} counts, exclusive\tloop ${selection.window.loopCounts} counts; captured DSP history retained`);
  for (const diagnostic of song.diagnostics) lines.push(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}\t${diagnostic.source.a1}\t${JSON.stringify(diagnostic.source.text)}\t${diagnostic.message}\towner ${diagnostic.owner}`);
  return lines.join('\n') + '\n';
}
