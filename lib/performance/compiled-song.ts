import { Schema } from 'effect';
import type { Chart, ChartBar, ChartSection } from './model.js';
import { columnName } from './columns.js';
import { SongSourceSchema } from './song-source.js';

const list = <S extends Schema.Constraint>(schema: S) => Schema.mutable(Schema.Array(schema));
const Finite = Schema.Number.check(Schema.isFinite());
const ButtonSchema = Schema.Literals(['L1', 'L2', 'R1', 'R2']);
const CueKindSchema = Schema.Literals(['arm', 'commit', 'commit-arm', 'stop', 'play']);
export const ExecutionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('now') }),
  Schema.Struct({ kind: Schema.Literal('next-bar') }),
  Schema.Struct({ kind: Schema.Literal('beat'), beat: Finite }),
]);
const PointSchema = Schema.Struct({ bar: Schema.Int, beat: Finite });
const SourceRefSchema = Schema.Struct({ sheetId: Schema.Int, a1: Schema.String, text: Schema.String, note: Schema.String });
const ActionFields = {
  kind: CueKindSchema, cueBeat: Schema.NullOr(Finite), execution: ExecutionSchema,
  captureTail: Schema.Literals(['none', 'silence-to-bar-end']), tempoBeatHint: Schema.Literals([0, 1]),
};
const CueWindowSchema = Schema.Struct({ earlyMs: Finite, lateMs: Finite, ties: Schema.Literal('reject') });
const OverrideSchema = Schema.Struct({
  a1: Schema.String, notation: Schema.String, ...ActionFields,
});
export const SongMappingSchema = Schema.Struct({
  mappingVersion: Schema.Literal(2), notationVersion: Schema.Literal('dyc-v1'), songId: Schema.String,
  spreadsheetId: Schema.String, sheetId: Schema.Int, sheetName: Schema.String,
  titleCell: Schema.String, bpmCell: Schema.String, sectionRow: Schema.Int, barRow: Schema.Int, leadInColumn: Schema.Int,
  startBar: Schema.Int, endBar: Schema.Int,
  meter: Schema.Struct({ numerator: Schema.Int, denominator: Schema.Int }),
  controls: list(Schema.Struct({ buttonId: ButtonSchema, voiceId: Schema.String, cueRow: Schema.Int, arrangementRow: Schema.Int, nameNoteCell: Schema.String })),
  cueWindow: Schema.NullOr(CueWindowSchema),
  capturePolicies: list(Schema.Struct({ voiceId: Schema.String, retention: Schema.Literals(['layer', 'variant', 'replace']), gain: Finite })),
  layerGroups: list(Schema.Struct({ id: Schema.String, voiceId: Schema.String, armCells: list(Schema.String) })),
  variantRules: list(Schema.Struct({ voiceId: Schema.String, row: Schema.Int, fromBar: Schema.Int, sampledOnly: Schema.Boolean })),
  overrides: list(OverrideSchema),
  deferredRows: list(Schema.Struct({ row: Schema.Int, reason: Schema.String })),
});
export type SongMapping = typeof SongMappingSchema.Type;
export const decodeSongMapping = Schema.decodeUnknownSync(SongMappingSchema);
const DiagnosticSchema = Schema.Struct({ severity: Schema.Literals(['error', 'warning', 'info']), code: Schema.String, message: Schema.String, owner: Schema.String, source: SourceRefSchema });
const CueSchema = Schema.Struct({
  id: Schema.String, bar: Schema.Int, buttonId: ButtonSchema, voiceId: Schema.String, ...ActionFields, takeId: Schema.NullOr(Schema.String),
  commitTakeId: Schema.NullOr(Schema.String), selectionId: Schema.NullOr(Schema.String), source: SourceRefSchema,
});
const TakeSchema = Schema.Struct({
  id: Schema.String, voiceId: Schema.String, slot: Schema.Int, begin: PointSchema,
  captureEnd: Schema.NullOr(PointSchema), loopEnd: Schema.NullOr(PointSchema),
  groupId: Schema.NullOr(Schema.String), phraseAnchorTakeId: Schema.String,
  armCueId: Schema.String, commitCueId: Schema.NullOr(Schema.String), phrase: Schema.String,
  retention: Schema.Literals(['layer', 'variant', 'replace', 'unresolved']), gain: Schema.NullOr(Finite),
});
const PadStrings = Schema.Struct({ L1: Schema.String, L2: Schema.String, R1: Schema.String, R2: Schema.String });
const ChartSchema = Schema.Struct({
  title: Schema.String, bpm: Finite, beatsPerBar: Schema.Int,
  bars: list(Schema.Struct({ bar: Schema.Int, column: Schema.Int, sectionId: Schema.String, section: Schema.String, partial: Schema.Boolean, cues: PadStrings })),
  sections: list(Schema.Struct({ id: Schema.String, label: Schema.String, startBar: Schema.Int, endBar: Schema.Int })),
  spreadsheetId: Schema.String, sheetId: Schema.Int, sheetName: Schema.String, leadInColumn: Schema.Int,
  leadInCues: PadStrings, controlNames: PadStrings, annotatedThroughBar: Schema.Int,
});
export const CompiledSongSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2), notationVersion: Schema.Literal('dyc-v1'), id: Schema.String, title: Schema.String,
  ticksPerQuarter: Schema.Literal(960), meter: Schema.Struct({ numerator: Schema.Int, denominator: Schema.Int }),
  source: Schema.Struct({ spreadsheetId: Schema.String, sheetId: Schema.Int, sheetName: Schema.String, range: Schema.String, digest: Schema.String }),
  mappingDigest: Schema.String, chart: ChartSchema,
  voices: list(Schema.Struct({ id: Schema.String, buttonId: ButtonSchema, arrangementRow: Schema.Int })),
  cueWindow: Schema.NullOr(CueWindowSchema),
  cues: list(CueSchema), takes: list(TakeSchema),
  selections: list(Schema.Struct({ id: Schema.String, voiceId: Schema.String, groupId: Schema.String, takeIds: list(Schema.String), gains: list(Finite) })),
  playback: list(Schema.Struct({ bar: Schema.Int, voiceId: Schema.String, selectionId: Schema.String })),
  diagnostics: list(DiagnosticSchema), executable: Schema.Boolean,
});
export type CompiledSong = typeof CompiledSongSchema.Type;
export type CompiledCue = typeof CueSchema.Type;
export type CompiledTake = typeof TakeSchema.Type;
export type SongDiagnostic = typeof DiagnosticSchema.Type;
export type Execution = typeof ExecutionSchema.Type;
function cueBoundary(cue: CompiledCue): typeof PointSchema.Type {
  return cue.execution.kind === 'next-bar' ? { bar: cue.bar + 1, beat: 0 }
    : { bar: Math.max(1, cue.bar), beat: cue.execution.kind === 'beat' ? cue.execution.beat : cue.cueBeat ?? 0 };
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
  const song = Schema.decodeUnknownSync(CompiledSongSchema)(input);
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
  if (song.takes.length > 28 || new Set(song.takes.map(t => t.slot)).size !== song.takes.length) throw new Error('Invalid prepared take resource count or slot identity.');
  for (const take of song.takes) {
    if (!song.voices.some(v => v.id === take.voiceId) || !take.captureEnd || !take.loopEnd || !take.groupId || take.gain === null || !validGain(take.gain)
      || take.retention === 'unresolved' || take.slot < 4 || take.slot >= 32 || !validPoint(take.begin, false) || !validPoint(take.captureEnd, true) || !validPoint(take.loopEnd, true)
      || pointCount(take.captureEnd, beats) <= pointCount(take.begin, beats) || pointCount(take.loopEnd, beats) < pointCount(take.captureEnd, beats)) throw new Error('Invalid executable take resource.');
    const anchor = song.takes.find(candidate => candidate.id === take.phraseAnchorTakeId);
    const period = loopCounts(take, beats), anchorPeriod = anchor && loopCounts(anchor, beats);
    if (!anchor || anchor.voiceId !== take.voiceId || anchor.groupId !== take.groupId || anchor.phraseAnchorTakeId !== anchor.id || !period || period !== anchorPeriod
      || anchor.phrase !== take.phrase || pointCount(take.begin, beats) < pointCount(anchor.begin, beats)
      || Math.round((pointCount(take.begin, beats) - pointCount(anchor.begin, beats)) * 960) % Math.round(period * 960) !== 0) throw new Error('Invalid executable phrase group or loop period.');
  }
  for (const selection of song.selections) {
    if (!selection.takeIds.length || selection.takeIds.length !== selection.gains.length || new Set(selection.takeIds).size !== selection.takeIds.length
      || selection.gains.some(gain => !validGain(gain)) || selection.takeIds.some(id => !song.takes.some(t => t.id === id && t.voiceId === selection.voiceId && t.groupId === selection.groupId))) throw new Error('Invalid executable take selection.');
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
    if (!song.voices.some(v => v.id === cue.voiceId && v.buttonId === cue.buttonId)
      || cue.takeId !== null && !song.takes.some(t => t.id === cue.takeId && t.voiceId === cue.voiceId)
      || cue.commitTakeId !== null && !song.takes.some(t => t.id === cue.commitTakeId && t.voiceId === cue.voiceId)
      || cue.selectionId !== null && !song.selections.some(s => s.id === cue.selectionId && s.voiceId === cue.voiceId)) throw new Error('Invalid executable cue reference.');
    if ((cue.kind === 'arm' || cue.kind === 'commit-arm') !== (cue.takeId !== null)
      || (cue.kind === 'commit' || cue.kind === 'commit-arm') !== (cue.commitTakeId !== null)
      || (cue.kind === 'commit' || cue.kind === 'commit-arm' || cue.kind === 'play') !== (cue.selectionId !== null)) throw new Error('Invalid executable capture cue kind.');
  }
  for (const take of song.takes) {
    const arms = song.cues.filter(cue => cue.takeId === take.id);
    const commits = song.cues.filter(cue => cue.commitTakeId === take.id);
    const arm = arms[0], commit = commits[0];
    if (arms.length !== 1 || commits.length !== 1 || arm.id !== take.armCueId || commit.id !== take.commitCueId
      || cueBoundary(arm).bar !== take.begin.bar || cueBoundary(arm).beat !== take.begin.beat
      || !take.captureEnd || !take.loopEnd || !samePoint(cueBoundary(commit), take.captureEnd)
      || !samePoint(take.loopEnd, commit.captureTail === 'silence-to-bar-end' ? { bar: take.captureEnd.bar + 1, beat: 0 } : take.captureEnd)
      || !song.selections.some(selection => selection.id === commit.selectionId && selection.takeIds.includes(take.id))) {
      throw new Error('Invalid executable capture graph.');
    }
  }
  if (song.playback.some(p => p.bar < 1 || p.bar > bars || !song.selections.some(s => s.id === p.selectionId && s.voiceId === p.voiceId))) throw new Error('Invalid executable playback reference.');
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
function parsedCue(text: string, beatsPerBar: number): Pick<CompiledCue, keyof typeof ActionFields> | null {
  const cutoff = /^([1-9])c([1-9])$/.exec(text.trim());
  if (cutoff && Number(cutoff[1]) <= beatsPerBar && Number(cutoff[2]) <= beatsPerBar) return {
    kind: 'commit', cueBeat: Number(cutoff[1]) - 1, execution: { kind: 'beat', beat: Number(cutoff[2]) - 1 }, captureTail: 'silence-to-bar-end', tempoBeatHint: 0,
  };
  if (text.trim() === '1p*') return { kind: 'play', cueBeat: 0, execution: { kind: 'now' }, captureTail: 'none', tempoBeatHint: 1 };
  const match = /^(?:([1-9]\d*))?(cr|r|c|x|p)(b|e|&|a)?$/.exec(text.trim());
  if (!match) return null;
  const kinds: Record<string, CompiledCue['kind']> = { r: 'arm', c: 'commit', cr: 'commit-arm', x: 'stop', p: 'play' };
  const kind = kinds[match[2]];
  const cueBeat = match[1] ? Number(match[1]) - 1 : null;
  if (cueBeat !== null && (cueBeat < 0 || cueBeat >= beatsPerBar)) return null;
  if (match[3] === 'b') return { kind, cueBeat, execution: { kind: 'next-bar' }, captureTail: 'none', tempoBeatHint: 0 };
  if (match[3]) {
    if (cueBeat === null) return null;
    const fractions: Record<string, number> = { e: .25, '&': .5, a: .75 };
    return { kind, cueBeat, execution: { kind: 'beat', beat: cueBeat + fractions[match[3]] }, captureTail: 'none', tempoBeatHint: 0 };
  }
  return { kind, cueBeat, execution: { kind: 'now' }, captureTail: 'none', tempoBeatHint: 0 };
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

export async function compileSong(sourceInput: unknown, mappingInput: unknown): Promise<CompiledSong> {
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
  const chart: Chart = { title, bpm: Number.isFinite(bpm) ? bpm : 0, beatsPerBar: mapping.meter.numerator, bars, sections,
    spreadsheetId: source.spreadsheetId, sheetId: source.sheetId, sheetName: source.sheetName, leadInColumn: mapping.leadInColumn,
    leadInCues: padRow(mapping.leadInColumn), controlNames: { L1: nameFor('L1'), L2: nameFor('L2'), R1: nameFor('R1'), R2: nameFor('R2') }, annotatedThroughBar: mapping.endBar };
  const cues: CompiledCue[] = [];
  const usedOverrides = new Set<string>();
  for (const { buttonId, voiceId, cueRow } of mapping.controls) {
    for (const [bar, column] of [[0, mapping.leadInColumn], ...[...columns].sort(([a], [b]) => a - b)]) {
      const location = ref(cueRow, column), text = location.text.trim();
      if (!text) continue;
      const override = mapping.overrides.find(o => o.a1 === location.a1);
      const action = override ?? parsedCue(text, mapping.meter.numerator);
      if (override) {
        usedOverrides.add(override.a1);
        if (override.notation !== text) { issue('stale-override', `Override expects ${JSON.stringify(override.notation)}, but the current cell differs.`, location); continue; }
      }
      if (!action) {
        const hits = parseArrangementHits(text, mapping.meter.numerator);
        if (hits?.length) issue('manual-tap-capability', `Manual tap positions ${hits.map(beat => beat + 1).join(', ')} are recognized, but this compiled runtime needs one-shot/sparse playback capability before loading that cue.`, location);
        else issue('unknown-cue', `Define the exact cue and execution meaning of ${JSON.stringify(text)}.`, location);
        continue;
      }
      if (action.cueBeat !== null && (!Number.isFinite(action.cueBeat) || action.cueBeat < 0 || action.cueBeat >= mapping.meter.numerator)
        || action.execution.kind === 'beat' && (!Number.isFinite(action.execution.beat) || action.execution.beat < 0 || action.execution.beat >= mapping.meter.numerator)) {
        issue('cue-timing', 'Cue and execution beats must lie inside the current measure.', location); continue;
      }
      if (bar === 0 && (action.kind === 'arm' || action.kind === 'commit-arm') && action.execution.kind !== 'next-bar') {
        issue('lead-in-capture-capability', 'Immediate lead-in capture is unsupported because its duration depends on the count-in. Declare capture at the next song bar.', location);
      }
      cues.push({ id: `${mapping.songId}/bar-${bar}/${buttonId}/${action.kind}`, bar, buttonId, voiceId, kind: action.kind,
        cueBeat: action.cueBeat, execution: action.execution, captureTail: action.captureTail, tempoBeatHint: action.tempoBeatHint,
        takeId: null, commitTakeId: null, selectionId: null, source: location });
    }
  }
  for (const override of mapping.overrides) if (!usedOverrides.has(override.a1)) issue('unused-override', 'The override does not identify a nonempty control cell inside the compiled range.', { sheetId: source.sheetId, a1: override.a1, text: '', note: '' });
  const mappedRows = new Set(mapping.controls.map(c => c.cueRow));
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
    const ordered = cues.filter(c => c.buttonId === control.buttonId).sort((a, b) => a.bar - b.bar || (a.cueBeat ?? 0) - (b.cueBeat ?? 0));
    for (let index = 0; index < ordered.length; index++) {
      let cue = ordered[index];
      if (cue.kind === 'commit' || cue.kind === 'commit-arm') {
        if (!open) issue('commit-without-take', 'No preceding known arm cue supplies this commit. Resolve any earlier ambiguous cue first.', cue.source);
        else {
          const end = cueBoundary(cue);
          const loopEnd = cue.captureTail === 'silence-to-bar-end' ? { bar: end.bar + 1, beat: 0 } : end;
          const begin = open.begin;
          if (end.bar < begin.bar || end.bar === begin.bar && end.beat <= begin.beat) issue('capture-span', 'The commit boundary must follow the capture boundary.', cue.source);
          const final: CompiledTake = { ...open, captureEnd: end, loopEnd, commitCueId: cue.id,
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
      const take: CompiledTake = { id: takeId, voiceId: control.voiceId, slot: takes.length + 4, begin: cueBoundary(cue), captureEnd: null, loopEnd: null,
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
  for (const take of takes) {
    if (!take.captureEnd || !take.loopEnd || !take.groupId || take.retention === 'unresolved' || take.gain === null) continue;
    const existing = take.retention === 'layer' ? selections.filter(s => s.groupId === take.groupId && s.voiceId === take.voiceId).at(-1) : undefined;
    selections.push({ id: `${take.voiceId}/selection-${selections.filter(s => s.voiceId === take.voiceId).length + 1}`, voiceId: take.voiceId,
      groupId: take.groupId,
      takeIds: [...existing?.takeIds ?? [], take.id], gains: [...existing?.gains ?? [], take.gain] });
    const commitIndex = cues.findIndex(c => c.id === take.commitCueId);
    if (commitIndex >= 0) cues[commitIndex] = { ...cues[commitIndex], selectionId: selections.at(-1)?.id ?? null };
  }
  const playback: CompiledSong['playback'] = [];
  for (const rule of mapping.variantRules) {
    const available = selections.filter(s => s.voiceId === rule.voiceId);
    for (const [bar, column] of columns) {
      const text = at(source.values, rule.row, column);
      if (bar < rule.fromBar || !text.trim() || rule.sampledOnly && !text.includes("'")) continue;
      const phrase = normalizedPhrase(text);
      const selection = available.filter(s => takes.find(t => t.id === s.takeIds[0])?.phrase === phrase
        && s.takeIds.every(id => { const end = takes.find(t => t.id === id)?.captureEnd; return end && (end.bar < bar || end.bar === bar && end.beat === 0); })).at(-1);
      if (!selection) issue('unknown-variant', 'No committed retained take matches this normalized arrangement phrase.', ref(rule.row, column));
      else playback.push({ bar, voiceId: rule.voiceId, selectionId: selection.id });
    }
  }
  cues.sort((a, b) => a.bar - b.bar || (a.cueBeat ?? 0) - (b.cueBeat ?? 0) || a.buttonId.localeCompare(b.buttonId));
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (cue.kind !== 'play') continue;
    const previous = takes.filter(t => t.voiceId === cue.voiceId && t.captureEnd && t.captureEnd.bar <= cue.bar).at(-1);
    const selection = selections.find(s => previous && s.takeIds.includes(previous.id));
    cues[i] = { ...cue, selectionId: selection?.id ?? null };
    if (!selection) issue('play-selection', 'The play cue has no resolved committed take selection.', cue.source);
  }
  const artifact: CompiledSong = {
    schemaVersion: 2, notationVersion: 'dyc-v1', id: mapping.songId, title, ticksPerQuarter: 960, meter: mapping.meter,
    source: { spreadsheetId: source.spreadsheetId, sheetId: source.sheetId, sheetName: source.sheetName, range: source.range, digest: await digest(source) },
    mappingDigest: await digest(mapping), chart, voices: mapping.controls.map(c => ({ id: c.voiceId, buttonId: c.buttonId, arrangementRow: c.arrangementRow })),
    cueWindow: mapping.cueWindow, cues, takes, selections, playback, diagnostics,
    executable: !diagnostics.some(d => d.severity === 'error'),
  };
  return decodeCompiledSong(artifact);
}

export function inspectCompiledSong(input: unknown): string {
  const song = decodeCompiledSong(input);
  const lines = [`${song.title} (${song.id})`, `Schema ${song.schemaVersion} · ${song.notationVersion} · ${song.executable ? 'executable' : 'BLOCKED'}`,
    `Source ${song.source.sheetName} / gid ${song.source.sheetId} / ${song.source.digest}`, `Range ${song.chart.bars[0]?.bar ?? '?'}..${song.chart.bars.at(-1)?.bar ?? '?'} · ${song.meter.numerator}/${song.meter.denominator}`];
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
  for (const diagnostic of song.diagnostics) lines.push(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}\t${diagnostic.source.a1}\t${JSON.stringify(diagnostic.source.text)}\t${diagnostic.message}\towner ${diagnostic.owner}`);
  return lines.join('\n') + '\n';
}
