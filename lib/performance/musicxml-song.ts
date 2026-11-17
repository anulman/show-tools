import { prepareDeclaredExternalAssets } from './external-assets.js';
import { MusicXmlValidationError } from './musicxml-errors.js';
export { MusicXmlValidationError } from './musicxml-errors.js';
import { Schema } from 'effect';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import { CompiledSongSchema, SongMappingSchema, RotationSchema, LegacyCueSchema, migrateCompiledCueV6, decodeCompiledSong, type CompiledSong } from './compiled-song.js';
import { SongSourceSchema, type SongSource } from './song-source.js';
import type { MusicXmlReport, MusicXmlCell, MusicalAnnotations } from './musicxml-model.js';
import { scoreXmlText as xml, stableMusicXmlJson } from './score-xml.js';
import { columnName } from './columns.js';
import { CatalogDocumentSchema, type CatalogDocument } from '../voice-catalog/model.js';

export const MUSICXML_SONG_PROFILE = 'show-tools-song-v3';
const buttons: (keyof CompiledSong['chart']['controlNames'])[] = ['L1', 'L2', 'R1', 'R2'];
const maximumBytes = 16 * 1024 * 1024;
const decodeSongArchive = Schema.decodeUnknownSync(SongSourceSchema, { onExcessProperty: 'error' });
const decodeSongVoices = Schema.decodeUnknownSync(CatalogDocumentSchema, { onExcessProperty: 'error' });
const list = <S extends Schema.Constraint>(schema: S) => Schema.mutable(Schema.Array(schema));
const partFields = CompiledSongSchema.fields.parts.schema.value.fields;
const RuntimePart = Schema.Struct({ id: partFields.id, source: partFields.source, role: partFields.role, profile: partFields.profile, scorePartId: Schema.String });
const ProvenancePart = Schema.Struct({ id: Schema.String, labelCell: Schema.String, managed: Schema.Boolean });
const VocalEligibility = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('lyric') }),
  Schema.Struct({ kind: Schema.Literal('inactive'), reason: Schema.Literals(['blank', 'notation']) }),
  Schema.Struct({ kind: Schema.Literal('unresolved'), message: Schema.String }),
]);
const StageCell = Schema.Union([
  Schema.Struct({ cell: Schema.String, eligibility: VocalEligibility, kind: Schema.Literal('resolved'), active: Schema.Boolean,
    emphasis: Schema.Literals(['normal', 'special', 'ultra']), sampled: Schema.Boolean,
    accents: list(Schema.Number.check(Schema.isFinite())), anchor: Schema.NullOr(Schema.Number.check(Schema.isFinite())) }),
  Schema.Struct({ cell: Schema.String, eligibility: VocalEligibility, kind: Schema.Literal('unresolved'), message: Schema.String }),
]);
const MusicalAnnotationsSchema = Schema.Struct({
  boundaryCues: Schema.optionalKey(list(Schema.Struct({ partId: Schema.String, cell: Schema.String,
    position: Schema.Literals(['lead-in', 'tail']), text: Schema.String }))),
  activities: list(Schema.Struct({ cell: Schema.String, kind: Schema.Literals(['rest', 'playing']) })),
  stageCells: list(StageCell),
  feels: list(Schema.Struct({ partId: Schema.String, startBar: Schema.Int, endBar: Schema.Int, text: Schema.Literals(['Funky', 'Extra funky', 'Higher intensity']) })),
  vocals: list(Schema.Union([
    Schema.Struct({ cell: Schema.String, kind: Schema.Literal('text') }),
    Schema.Struct({ cell: Schema.String, kind: Schema.Literal('count-and'), countOffset: Schema.Number.check(Schema.isFinite()), andOffset: Schema.Number.check(Schema.isFinite()) }),
  ])),
  instrumentDisplays: list(Schema.Struct({ cell: Schema.String, text: Schema.String })),
});
const Performance = Schema.Struct({
  version: Schema.Literal(2), scope: Schema.Literal('complete'),
  id: CompiledSongSchema.fields.id, notationVersion: CompiledSongSchema.fields.notationVersion,
  source: CompiledSongSchema.fields.source, mappingDigest: CompiledSongSchema.fields.mappingDigest,
  inputBindings: CompiledSongSchema.fields.inputBindings,
  voices: CompiledSongSchema.fields.voices, parts: list(RuntimePart),
  rotation: CompiledSongSchema.fields.rotation, cueWindow: CompiledSongSchema.fields.cueWindow,
  sourceProfiles: CompiledSongSchema.fields.sourceProfiles,
  noteBanks: CompiledSongSchema.fields.noteBanks,
  externalSamples: CompiledSongSchema.fields.externalSamples,
  terminalStops: CompiledSongSchema.fields.terminalStops,
  authoredCues: CompiledSongSchema.fields.authoredCues,
  cues: CompiledSongSchema.fields.cues, takes: CompiledSongSchema.fields.takes,
  selections: CompiledSongSchema.fields.selections, playback: CompiledSongSchema.fields.playback,
  diagnostics: CompiledSongSchema.fields.diagnostics, executable: Schema.Boolean,
  chartBinding: Schema.Struct({
    columns: list(Schema.Int), labels: Schema.optionalKey(list(Schema.NonEmptyString)), partialBars: list(Schema.Int),
    leadInColumn: Schema.Int, leadInCues: CompiledSongSchema.fields.chart.fields.leadInCues,
    controlNames: CompiledSongSchema.fields.chart.fields.controlNames,
    annotatedThroughBar: Schema.Int,
  }),
  stageCells: list(StageCell),
  scoreParts: list(ProvenancePart), selectedLabelCells: list(Schema.String), conventions: list(Schema.String),
});
type PerformanceData = typeof Performance.Type;
const LegacyPerformance = Schema.Struct({ ...Performance.fields, version: Schema.Literal(1), cues: list(LegacyCueSchema) });
function decodePerformance(input: unknown): PerformanceData {
  const version = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.Int }))(input).version;
  if (version !== 1) return Schema.decodeUnknownSync(Performance, { onExcessProperty: 'error' })(input);
  const legacy = Schema.decodeUnknownSync(LegacyPerformance, { onExcessProperty: 'error' })(input);
  return { ...legacy, version: 2, cues: legacy.cues.map(migrateCompiledCueV6) };
}

const Text = Schema.Struct({ id: Schema.optionalKey(Schema.String), '#text': Schema.optionalKey(Schema.String) });
const Direction = Schema.Struct({
  'direction-type': Schema.Struct({
    words: Schema.optionalKey(list(Text)), rehearsal: Schema.optionalKey(list(Text)),
    'other-direction': Schema.optionalKey(list(Text)),
    metronome: Schema.optionalKey(Schema.Struct({ 'beat-unit': Schema.String, 'per-minute': Schema.String })),
  }),
  offset: Schema.optionalKey(Schema.String),
});
const Measure = Schema.Struct({ number: Schema.String,
  attributes: Schema.optionalKey(Schema.Struct({
    divisions: Schema.optionalKey(Schema.String),
    time: Schema.optionalKey(Schema.Struct({ beats: Schema.String, 'beat-type': Schema.String })),
  })),
  direction: Schema.optionalKey(list(Direction)),
  note: list(Schema.Struct({ 'print-object': Schema.Literal('no'), rest: Schema.Struct({ measure: Schema.Literal('yes') }), duration: Schema.String })),
});
const XmlDocument = Schema.Struct({ 'score-partwise': Schema.Struct({
  version: Schema.Literal('4.0'), work: Schema.Struct({ 'work-title': Schema.String }),
  identification: Schema.Struct({ miscellaneous: Schema.Struct({
    'miscellaneous-field': list(Schema.Struct({ name: Schema.String, '#text': Schema.optionalKey(Schema.String) })),
  }) }),
  'part-list': Schema.Struct({ 'score-part': list(Schema.Struct({ id: Schema.String, 'part-name': Schema.String })) }),
  part: list(Schema.Struct({ id: Schema.String, measure: list(Measure) })),
}) });

function numeric(text: string, name: string): number {
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value)) throw new MusicXmlValidationError(`Invalid MusicXML ${name}.`);
  return value;
}
function unique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) throw new MusicXmlValidationError(`Duplicate MusicXML ${name}.`);
}
function addressRow(cell: string): number {
  const match = /^[A-Z]+([1-9]\d*)$/.exec(cell);
  if (!match) throw new MusicXmlValidationError(`Invalid MusicXML source coordinate ${cell}.`);
  return Number(match[1]);
}
function addressColumn(cell: string): number {
  addressRow(cell);
  return [...cell.replace(/\d+$/, '')].reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0);
}
function direction(text: string, id: string, offset = 0, other = false): string {
  const content = other ? `<other-direction id="${xml(id)}" print-object="no">${xml(text)}</other-direction>`
    : `<words id="${xml(id)}">${xml(text)}</words>`;
  return `<direction><direction-type>${content}</direction-type>${offset ? `<offset>${offset}</offset>` : ''}</direction>`;
}
function sectionDirection(section: MusicXmlReport['sections'][number]): string {
  return `<direction><direction-type><rehearsal id="${xml(section.id)}">${xml(section.label)}</rehearsal></direction-type></direction>`;
}

function runtimeParts(performance: PerformanceData, parts: MusicXmlReport['parts']): CompiledSong['parts'] {
  return performance.parts.map(part => {
    const scorePart = parts.find(candidate => candidate.id === part.scorePartId);
    if (!scorePart) throw new MusicXmlValidationError(`Missing canonical runtime part ${part.id}.`);
    const { scorePartId, ...fields } = part;
    const originalName = (part.source.text.trim() || part.source.note.trim()).replace(/^AF\s*-\s*/, '').trim();
    const source = originalName === scorePart.name ? part.source : { ...part.source, text: `AF - ${scorePart.name}` };
    return { ...fields, name: scorePart.name, source };
  });
}

async function semanticDigest(report: Pick<MusicXmlReport, 'title' | 'meter' | 'bpmPerChartCount' | 'sections' | 'parts' | 'vocalCues' | 'annotations'>,
  performance: PerformanceData, voices: CatalogDocument | null): Promise<string> {
  const { source, mappingDigest, selectedLabelCells, conventions, ...data } = performance;
  const { digest, ...sourceIdentity } = source;
  const parts = runtimeParts(performance, report.parts);
  const controlNames = { ...data.chartBinding.controlNames };
  for (const part of parts) if (part.role.kind === 'pad') controlNames[part.role.buttonId] = part.name;
  const meaning = { profile: MUSICXML_SONG_PROFILE, music: report,
    performance: { ...data, source: sourceIdentity, parts, chartBinding: { ...data.chartBinding, controlNames } }, voices };
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableMusicXmlJson(meaning)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface MusicXmlSong {
  song: CompiledSong;
  report: MusicXmlReport;
  source: SongSource | null;
  mapping: unknown | null;
  voices: CatalogDocument | null;
}
export interface WriteMusicXmlSong {
  song: CompiledSong;
  report: MusicXmlReport;
  source?: SongSource;
  mapping?: unknown;
  voices?: CatalogDocument;
}

function validateAnnotations(report: Pick<MusicXmlReport, 'annotations' | 'parts' | 'vocalCues' | 'sections' | 'measureCount' | 'meter'>): void {
  const annotations = Schema.decodeUnknownSync(MusicalAnnotationsSchema, { onExcessProperty: 'error' })(report.annotations);
  if (annotations.boundaryCues?.length === 0) throw new MusicXmlValidationError('Empty canonical boundary cues must be omitted.');
  const boundaryCues = annotations.boundaryCues ?? [];
  unique(boundaryCues.map(cue => cue.cell), 'boundary source cell');
  for (const cue of boundaryCues) {
    const part = report.parts.find(part => part.id === cue.partId);
    const edge = cue.position === 'lead-in' ? part?.cells[0] : part?.cells.at(-1);
    if (!part || !edge || addressRow(cue.cell) !== addressRow(part.labelCell) || !cue.text.trim()
      || (cue.position === 'lead-in' ? addressColumn(cue.cell) >= addressColumn(edge.cell) : addressColumn(cue.cell) <= addressColumn(edge.cell))) {
      throw new MusicXmlValidationError('Invalid canonical boundary cue source or position.');
    }
  }
  const cells = new Set(report.parts.flatMap(part => part.cells.map(cell => cell.cell)));
  unique(annotations.stageCells.map(stage => stage.cell), 'stage annotation');
  if (annotations.stageCells.length !== cells.size || annotations.stageCells.some(stage => !cells.has(stage.cell))) throw new MusicXmlValidationError('Canonical stage annotations must cover the complete score.');
  const activityCells = new Set(report.parts.flatMap(part => part.managed ? [] : part.cells.map(cell => cell.cell)));
  unique(annotations.activities.map(activity => activity.cell), 'activity annotation');
  if (annotations.activities.length !== activityCells.size || annotations.activities.some(activity => !activityCells.has(activity.cell) || activity.kind !== 'rest' && activity.kind !== 'playing')) throw new MusicXmlValidationError('Canonical activity annotations must cover every reference-instrument measure.');
  unique(annotations.vocals.map(vocal => vocal.cell), 'vocal annotation');
  unique(annotations.instrumentDisplays.map(display => display.cell), 'instrument display');
  const vocalCells = new Set(report.vocalCues.map(cue => cue.cell));
  if (annotations.vocals.length !== vocalCells.size || annotations.vocals.some(vocal => !vocalCells.has(vocal.cell))) throw new MusicXmlValidationError('Canonical vocal annotations must match the complete vocal cue list.');
  const countTicks = 960 * 4 / report.meter.denominator;
  const validOffset = (offset: number) => offset >= 0 && offset < report.meter.numerator && Number.isInteger(offset * countTicks);
  for (const stage of annotations.stageCells) if (stage.kind === 'resolved' && (stage.accents.some((offset, index) => !validOffset(offset) || index > 0 && offset <= stage.accents[index - 1]) || stage.anchor !== null && !validOffset(stage.anchor))) throw new MusicXmlValidationError('Invalid canonical stage timing.');
  for (const vocal of annotations.vocals) if (vocal.kind === 'count-and' && (!validOffset(vocal.countOffset) || !validOffset(vocal.andOffset) || vocal.andOffset <= vocal.countOffset)) throw new MusicXmlValidationError('Unsupported canonical vocal count timing.');
  if (annotations.instrumentDisplays.some(display => !cells.has(display.cell) || !display.text.trim())) throw new MusicXmlValidationError('Canonical instrument displays must reference nonempty score cells.');
  for (const [index, feel] of annotations.feels.entries()) {
    if (!report.parts.some(part => part.id === feel.partId && !part.managed) || !Number.isSafeInteger(feel.startBar) || !Number.isSafeInteger(feel.endBar) || feel.startBar < 1 || feel.endBar < feel.startBar || feel.endBar > report.measureCount || feel.text !== 'Funky' && feel.text !== 'Extra funky' && feel.text !== 'Higher intensity'
      || !report.sections.some(section => feel.startBar >= section.startBar && feel.endBar <= section.endBar)
      || annotations.feels.slice(0, index).some(other => other.partId === feel.partId && other.startBar <= feel.endBar && other.endBar >= feel.startBar)) throw new MusicXmlValidationError('Invalid or overlapping canonical feel range.');
  }
}

export async function writeMusicXmlSong(options: WriteMusicXmlSong): Promise<string> {
  const { song, report } = options;
  await prepareDeclaredExternalAssets(song.externalSamples);
  validateAnnotations(report);
  if (report.parts.length < 1 || report.parts.some(part => part.cells.length !== song.chart.bars.length)) throw new MusicXmlValidationError('Canonical MusicXML needs complete chronological measures for every score part.');
  const partBindings = song.parts.map(part => {
    const scorePart = report.parts.find(candidate => candidate.labelCell === part.source.a1);
    if (!scorePart) throw new MusicXmlValidationError(`Canonical MusicXML is missing runtime part ${part.name}. Export the complete song.`);
    const { name, ...fields } = part;
    return { ...fields, scorePartId: scorePart.id };
  });
  const performance: PerformanceData = {
    version: 2, scope: 'complete', id: song.id, notationVersion: song.notationVersion,
    ...(song.inputBindings === undefined ? {} : { inputBindings: song.inputBindings }),
    ...(song.sourceProfiles === undefined ? {} : { sourceProfiles: song.sourceProfiles }),
    ...(song.noteBanks === undefined ? {} : { noteBanks: song.noteBanks }),
    ...(song.externalSamples === undefined ? {} : { externalSamples: song.externalSamples }),
    source: song.source, mappingDigest: song.mappingDigest, voices: song.voices, parts: partBindings,
    ...(song.terminalStops === undefined ? {} : { terminalStops: song.terminalStops }),
    ...(song.authoredCues === undefined ? {} : { authoredCues: song.authoredCues }),
    rotation: song.rotation, cueWindow: song.cueWindow, cues: song.cues, takes: song.takes,
    selections: song.selections, playback: song.playback, diagnostics: song.diagnostics, executable: song.executable,
    chartBinding: { columns: song.chart.bars.map(bar => bar.column),
      ...(song.chart.bars.some(bar => bar.label !== undefined) ? { labels: song.chart.bars.map(bar => bar.label ?? String(bar.bar)) } : {}), partialBars: song.chart.bars.filter(bar => bar.partial).map(bar => bar.bar),
      leadInColumn: song.chart.leadInColumn, leadInCues: song.chart.leadInCues,
      controlNames: song.chart.controlNames, annotatedThroughBar: song.chart.annotatedThroughBar },
    stageCells: report.annotations.stageCells,
    scoreParts: report.parts.map(({ id, labelCell, managed }) => ({ id, labelCell, managed })),
    selectedLabelCells: report.selectedLabelCells, conventions: report.conventions,
  };
  Schema.decodeUnknownSync(Performance, { onExcessProperty: 'error' })(performance);
  const voices = options.voices === undefined ? null : decodeSongVoices(options.voices);
  const digest = await semanticDigest({ title: report.title, meter: report.meter, bpmPerChartCount: report.bpmPerChartCount,
    sections: report.sections, parts: report.parts, vocalCues: report.vocalCues, annotations: report.annotations }, performance, voices);
  const normalizedPerformance = { ...performance, source: { ...performance.source, digest }, mappingDigest: digest };
  const metadata: [string, string][] = [
    ['show-tools:profile', MUSICXML_SONG_PROFILE], ['show-tools:performance', stableMusicXmlJson(normalizedPerformance)],
    ['show-tools:source-sha256', digest], ['show-tools:mapping-sha256', digest],
  ];
  if (options.source !== undefined) metadata.push(['show-tools:source', stableMusicXmlJson(options.source)]);
  if (options.mapping !== undefined) metadata.push(['show-tools:mapping', stableMusicXmlJson(options.mapping)]);
  if (voices !== null) metadata.push(['show-tools:voices', stableMusicXmlJson(voices)]);
  const countTicks = 960 * 4 / report.meter.denominator;
  const vocalCells = new Set(report.vocalCues.map(cue => cue.cell));
  const parts = report.parts.map((part, index) => `<part id="${xml(part.id)}">${part.cells.map(cell => {
    let body = '';
    if (cell.bar === 1) {
      body += `<attributes><divisions>960</divisions><time><beats>${report.meter.numerator}</beats><beat-type>${report.meter.denominator}</beat-type></time><clef><sign>none</sign></clef></attributes>`;
      if (index === 0) body += `<direction><direction-type><metronome><beat-unit>${report.meter.denominator === 8 ? 'eighth' : 'quarter'}</beat-unit><per-minute>${report.bpmPerChartCount}</per-minute></metronome></direction-type></direction>`;
    }
    if (index === 0) {
      for (const section of report.sections.filter(section => section.startBar === cell.bar)) body += sectionDirection(section);
      const chartBar = song.chart.bars.find(bar => bar.bar === cell.bar);
      if (!chartBar) throw new MusicXmlValidationError(`Canonical MusicXML is missing bar ${cell.bar}.`);
      for (const button of buttons) if (chartBar.cues[button]) body += direction(chartBar.cues[button], `command-${button}-${cell.bar}`);
    }
    for (const cue of report.annotations.boundaryCues ?? []) {
      if (cue.partId === part.id && cell.bar === (cue.position === 'lead-in' ? 1 : report.measureCount)) {
        body += direction(cue.text, `boundary-${cue.position}-${cue.cell}`, cue.position === 'tail' ? report.meter.numerator * countTicks : 0);
      }
    }
    const vocal = report.annotations.vocals.find(vocal => vocal.cell === cell.cell);
    const hiddenSource = !part.managed || vocal?.kind === 'count-and';
    if (cell.text) body += hiddenSource ? direction(cell.text, `source-${cell.cell}`, 0, true)
      : direction(cell.text, `${vocalCells.has(cell.cell) ? 'vocal' : 'cell'}-${cell.cell}`);
    if (vocal?.kind === 'count-and') {
      body += direction('3', `vocal-count-${cell.cell}`, vocal.countOffset * countTicks);
      body += direction('&', `vocal-and-${cell.cell}`, vocal.andOffset * countTicks);
      body += direction('>', `vocal-accent-${cell.cell}`, vocal.andOffset * countTicks);
    }
    for (const feel of report.annotations.feels.filter(feel => feel.partId === part.id && feel.startBar === cell.bar)) body += direction(feel.text, `feel-${part.id}-${feel.startBar}-${feel.endBar}`);
    const activity = report.annotations.activities.find(activity => activity.cell === cell.cell);
    if (activity) body += direction(activity.kind === 'rest' ? 'Rest' : 'Playing', `activity-${cell.cell}`, 0, true);
    const display = report.annotations.instrumentDisplays.find(display => display.cell === cell.cell);
    if (display) body += direction(display.text, `instrument-${cell.cell}`);
    if (cell.reading.kind === 'text') body += direction(cell.reading.reason, `reading-${cell.cell}`, 0, true);
    if (cell.reading.kind === 'hits') {
      for (const [hit, offset] of cell.reading.offsets.entries()) body += direction(cell.reading.sampled ? 'show-tools:onset:sampled' : 'show-tools:onset', `onset-${cell.cell}-${hit}`, offset * countTicks, true);
    }
    body += `<note print-object="no"><rest measure="yes"/><duration>${report.meter.numerator * countTicks}</duration></note>`;
    return `<measure number="${xml(song.chart.bars[cell.bar - 1]?.label ?? String(cell.bar))}">${body}</measure>`;
  }).join('\n')}</part>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${xml(report.title)}</work-title></work><identification><encoding><software>${MUSICXML_SONG_PROFILE}</software><encoding-description>Complete canonical song. Hidden measure rests are layout spacers. Onset-only directions do not specify played duration or pitch.</encoding-description></encoding><miscellaneous>${metadata.map(([name, text]) => `<miscellaneous-field name="${name}">${xml(text)}</miscellaneous-field>`).join('')}</miscellaneous></identification><part-list>${report.parts.map(part => `<score-part id="${xml(part.id)}"><part-name>${xml(part.name)}</part-name></score-part>`).join('')}</part-list>\n${parts}\n</score-partwise>\n`;
}

function decodeCanonicalProgram(input: unknown): CompiledSong {
  try { return decodeCompiledSong(input); }
  catch (error) {
    if (error instanceof Error && error.constructor === Error) throw new MusicXmlValidationError(error.message);
    throw error;
  }
}

export async function readMusicXmlSong(input: string): Promise<MusicXmlSong> {
  if (new TextEncoder().encode(input).byteLength > maximumBytes) throw new MusicXmlValidationError('Canonical MusicXML exceeds the 16 MiB limit.');
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new MusicXmlValidationError('MusicXML DTD and entity declarations are not supported.');
  const validation = XMLValidator.validate(input);
  if (validation !== true) throw new MusicXmlValidationError(`Invalid MusicXML: ${validation.err.msg}`);
  const allowedElements = new Set(['score-partwise', 'work', 'work-title', 'identification', 'encoding', 'software', 'encoding-description',
    'miscellaneous', 'miscellaneous-field', 'part-list', 'score-part', 'part-name', 'part', 'measure', 'attributes', 'divisions', 'time', 'beats',
    'beat-type', 'clef', 'sign', 'direction', 'direction-type', 'metronome', 'beat-unit', 'per-minute', 'rehearsal', 'words', 'other-direction',
    'offset', 'note', 'rest', 'duration']);
  for (const element of input.matchAll(/<([A-Za-z_][\w:.-]*)(?:\s|\/?\>)/g)) {
    if (!allowedElements.has(element[1])) throw new MusicXmlValidationError(`Unsupported MusicXML element <${element[1]}>. Import this notation explicitly before loading.`);
  }
  const OrderedNodes = Schema.Array(Schema.Record(Schema.String, Schema.Unknown));
  const decodeOrdered = Schema.decodeUnknownSync(OrderedNodes);
  const ordered: unknown = new XMLParser({ preserveOrder: true, ignoreAttributes: false }).parse(input);
  for (const root of decodeOrdered(ordered)) {
    if (!('score-partwise' in root)) continue;
    for (const part of decodeOrdered(root['score-partwise'])) {
      if (!('part' in part)) continue;
      for (const measure of decodeOrdered(part.part)) {
        if (!('measure' in measure)) continue;
        const children = decodeOrdered(measure.measure);
        const spacer = children.findIndex(child => 'note' in child);
        if (spacer >= 0 && children.slice(spacer + 1).some(child => 'direction' in child || 'attributes' in child)) throw new MusicXmlValidationError('Canonical MusicXML directions and attributes must precede the measure spacer.');
      }
    }
  }
  const value: unknown = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false,
    parseAttributeValue: false, trimValues: false,
    isArray: (name, _path, _leaf, isAttribute) => !isAttribute && ['miscellaneous-field', 'score-part', 'part', 'measure', 'direction', 'words', 'rehearsal', 'other-direction', 'note'].includes(name),
  }).parse(input);
  const score = Schema.decodeUnknownSync(XmlDocument)(value)['score-partwise'];
  const fields = score.identification.miscellaneous['miscellaneous-field'];
  unique(fields.map(field => field.name), 'metadata field');
  const knownFields = new Set(['show-tools:profile', 'show-tools:performance', 'show-tools:source-sha256', 'show-tools:mapping-sha256', 'show-tools:source', 'show-tools:mapping', 'show-tools:voices']);
  if (fields.some(field => !knownFields.has(field.name))) throw new MusicXmlValidationError('Unsupported canonical MusicXML metadata field. Migrate its profile before importing.');
  const metadata = new Map(fields.map(field => [field.name, field['#text'] ?? '']));
  if (metadata.get('show-tools:profile') !== MUSICXML_SONG_PROFILE) throw new MusicXmlValidationError('Expected a complete canonical Show Tools MusicXML song, not a study or part projection.');
  const encoded = metadata.get('show-tools:performance');
  if (!encoded) throw new MusicXmlValidationError('Canonical MusicXML is missing required performance metadata.');
  const extension: unknown = JSON.parse(encoded);
  const performance = decodePerformance(extension);
  const standardIds = score.part.flatMap(part => part.measure.flatMap(measure => (measure.direction ?? []).flatMap(direction => [
    ...(direction['direction-type'].words ?? []), ...(direction['direction-type'].rehearsal ?? []), ...(direction['direction-type']['other-direction'] ?? []),
  ].flatMap(marker => marker.id ? [marker.id] : []))));
  unique(standardIds, 'direction identity');
  unique(score.part.map(part => part.id), 'part identity');
  unique(score['part-list']['score-part'].map(part => part.id), 'part-list identity');
  unique(performance.scoreParts.map(part => part.id), 'part binding');
  const partNames = new Map(score['part-list']['score-part'].map(part => [part.id, part['part-name']]));
  if (partNames.size !== score.part.length || performance.scoreParts.length !== score.part.length) throw new MusicXmlValidationError('Canonical MusicXML score parts and bindings must match exactly.');
  const first = score.part[0];
  if (!first || first.measure.length < 1 || first.measure.length > 4096) throw new MusicXmlValidationError('Canonical MusicXML needs 1 through 4096 measures.');
  const labels = performance.chartBinding.labels;
  if (labels && (labels.length !== first.measure.length || new Set(labels).size !== labels.length)) throw new MusicXmlValidationError('Canonical measure labels must identify the complete chronological timeline uniquely.');
  const initial = first.measure[0].attributes;
  if (!initial?.time) throw new MusicXmlValidationError('Canonical MusicXML needs an explicit initial meter.');
  const meter = { numerator: numeric(initial.time.beats, 'meter'), denominator: numeric(initial.time['beat-type'], 'meter') };
  if (!(meter.numerator === 4 && meter.denominator === 4 || meter.numerator === 6 && meter.denominator === 8)) throw new MusicXmlValidationError('Canonical MusicXML currently supports 4/4 and 6/8.');
  if (score.part.slice(1).some(part => part.measure.some(measure => (measure.direction ?? []).some(direction => direction['direction-type'].metronome || direction['direction-type'].rehearsal)))) throw new MusicXmlValidationError('Canonical global tempo and section directions belong to the first score part.');
  const metronomes = first.measure.flatMap(measure => (measure.direction ?? []).flatMap(direction => direction['direction-type'].metronome ? [direction['direction-type'].metronome] : []));
  if (first.measure.slice(1).some(measure => (measure.direction ?? []).some(direction => direction['direction-type'].metronome))) throw new MusicXmlValidationError('The reference tempo must occur in the first measure.');
  if (metronomes.length !== 1) throw new MusicXmlValidationError('Canonical MusicXML requires one reference tempo; tempo changes need an explicit capability.');
  const metronome = metronomes[0], tempoUnit = metronome['beat-unit'] === 'quarter' ? 4 : metronome['beat-unit'] === 'eighth' ? 8 : 0;
  if (!tempoUnit) throw new MusicXmlValidationError('Unsupported canonical MusicXML tempo unit.');
  const bpm = numeric(metronome['per-minute'], 'tempo') * meter.denominator / tempoUnit;
  if (bpm < 40 || bpm > 240) throw new MusicXmlValidationError('Canonical MusicXML reference tempo must be 40 through 240 per chart count.');
  const countTicks = 960 * 4 / meter.denominator;
  const sections: MusicXmlReport['sections'] = [];
  for (const [index, measure] of first.measure.entries()) {
    for (const rehearsal of (measure.direction ?? []).flatMap(direction => direction['direction-type'].rehearsal ?? [])) {
      if (!rehearsal.id || !rehearsal['#text']?.trim()) throw new MusicXmlValidationError('Canonical sections require stable rehearsal IDs and labels.');
      if (sections.at(-1)?.startBar === index + 1) throw new MusicXmlValidationError('Each measure can begin only one section.');
      if (sections.length) sections[sections.length - 1] = { ...sections[sections.length - 1], endBar: index };
      sections.push({ id: rehearsal.id, label: rehearsal['#text'], startBar: index + 1, endBar: first.measure.length });
    }
  }
  if (sections[0]?.startBar !== 1) throw new MusicXmlValidationError('Canonical MusicXML must begin with a section.');
  unique(sections.map(section => section.id), 'section identity');
  if (performance.chartBinding.columns.length !== first.measure.length || new Set(performance.chartBinding.columns).size !== first.measure.length) throw new MusicXmlValidationError('Canonical MusicXML has an incomplete source-column map.');
  const vocalCues: MusicXmlReport['vocalCues'] = [];
  const annotations: MusicalAnnotations = { stageCells: performance.stageCells, activities: [], feels: [], vocals: [], instrumentDisplays: [] };
  const parts: MusicXmlReport['parts'] = score.part.map(part => {
    const binding = performance.scoreParts.find(binding => binding.id === part.id), name = partNames.get(part.id);
    if (!binding || !name?.trim() || part.measure.length !== first.measure.length) throw new MusicXmlValidationError(`Canonical MusicXML part ${part.id} has an incomplete identity or timeline.`);
    const cells = part.measure.map((measure, index): MusicXmlCell => {
      if (measure.number !== (performance.chartBinding.labels?.[index] ?? String(index + 1))) throw new MusicXmlValidationError('Canonical MusicXML measures must be chronological and contiguous from 1.');
      const attributes = measure.attributes;
      if (index === 0 && (!attributes?.time || numeric(attributes.divisions ?? '', 'divisions') !== 960)
        || attributes?.time && (numeric(attributes.time.beats, 'meter') !== meter.numerator || numeric(attributes.time['beat-type'], 'meter') !== meter.denominator)
        || attributes?.divisions && numeric(attributes.divisions, 'divisions') !== 960) throw new MusicXmlValidationError('Canonical MusicXML parts must share one fixed meter and 960 divisions.');
      if (measure.note.length !== 1 || numeric(measure.note[0].duration, 'spacer duration') !== meter.numerator * countTicks) throw new MusicXmlValidationError('Canonical MusicXML writing spacers must fill each complete measure.');
      const cell = `${columnName(performance.chartBinding.columns[index])}${addressRow(binding.labelCell)}`;
      for (const direction of measure.direction ?? []) {
        const boundaryWords = (direction['direction-type'].words ?? []).filter(word => word.id?.startsWith('boundary-'));
        if (boundaryWords.length) {
          const word = boundaryWords[0], match = /^boundary-(lead-in|tail)-([A-Z]+[1-9]\d*)$/.exec(word.id ?? '');
          if (!match || boundaryWords.length !== 1 || direction['direction-type'].words?.length !== 1
            || direction['direction-type'].rehearsal || direction['direction-type'].metronome || direction['direction-type']['other-direction']) {
            throw new MusicXmlValidationError('Invalid canonical boundary direction.');
          }
          const position = match[1] === 'lead-in' ? 'lead-in' : 'tail';
          if (index !== (position === 'lead-in' ? 0 : first.measure.length - 1)
            || numeric(direction.offset ?? '0', 'boundary offset') !== (position === 'tail' ? meter.numerator * countTicks : 0)) {
            throw new MusicXmlValidationError('Misplaced canonical boundary direction.');
          }
          const cue: NonNullable<MusicalAnnotations['boundaryCues']>[number] = { partId: part.id, cell: match[2], position, text: word['#text'] ?? '' };
          (annotations.boundaryCues ??= []).push(cue);
          continue;
        }
        if (numeric(direction.offset ?? '0', 'direction offset') !== 0 && (direction['direction-type'].words?.some(word => ![`vocal-count-${cell}`, `vocal-and-${cell}`, `vocal-accent-${cell}`].includes(word.id ?? '')) || direction['direction-type'].rehearsal?.length || direction['direction-type'].metronome || !direction['direction-type'].words?.length && !(direction['direction-type']['other-direction'] ?? []).some(marker => marker.id?.startsWith(`onset-${cell}-`)))) throw new MusicXmlValidationError('Nonzero offsets on text, section and tempo directions need an explicit MusicXML capability.');
      }
      const words = (measure.direction ?? []).flatMap(direction => direction['direction-type'].words ?? []);
      for (const word of words) if (word.id !== `cell-${cell}` && word.id !== `vocal-${cell}` && ![`vocal-count-${cell}`, `vocal-and-${cell}`, `vocal-accent-${cell}`, `instrument-${cell}`].includes(word.id ?? '') && !word.id?.startsWith(`feel-${part.id}-`) && !word.id?.startsWith('boundary-')
        && !(part === first && buttons.some(button => word.id === `command-${button}-${index + 1}`))) throw new MusicXmlValidationError(`Unsupported canonical text direction ${word.id ?? '(without ID)'}.`);
      const others = (measure.direction ?? []).flatMap(direction => direction['direction-type']['other-direction'] ?? []);
      if (others.some(marker => marker.id !== `reading-${cell}` && marker.id !== `source-${cell}` && marker.id !== `activity-${cell}` && !marker.id?.startsWith(`onset-${cell}-`))) throw new MusicXmlValidationError(`Unsupported canonical annotation in ${cell}.`);
      const arrangement = words.filter(word => word.id === `cell-${cell}` || word.id === `vocal-${cell}`);
      if (arrangement.length > 1) throw new MusicXmlValidationError(`Duplicate canonical arrangement cell ${cell}.`);
      const activities = others.filter(marker => marker.id === `activity-${cell}`);
      if (binding.managed ? activities.length !== 0 : activities.length !== 1) throw new MusicXmlValidationError(`Missing or misplaced canonical activity in ${cell}.`);
      if (activities.length) {
        const kind = activities[0]['#text'] === 'Rest' ? 'rest' : activities[0]['#text'] === 'Playing' ? 'playing' : null;
        if (!kind) throw new MusicXmlValidationError(`Invalid canonical activity in ${cell}.`);
        annotations.activities.push({ cell, kind });
      }
      const sources = others.filter(marker => marker.id === `source-${cell}`);
      if (sources.length > 1 || sources.length && arrangement.length) throw new MusicXmlValidationError(`Conflicting canonical source text in ${cell}.`);
      const text = arrangement[0]?.['#text'] ?? sources[0]?.['#text'] ?? '';
      const countWords = words.filter(word => [`vocal-count-${cell}`, `vocal-and-${cell}`, `vocal-accent-${cell}`].includes(word.id ?? ''));
      if (countWords.length) {
        if (countWords.length !== 3 || !sources.length || !text) throw new MusicXmlValidationError(`Incomplete canonical vocal count annotation in ${cell}.`);
        const at = (id: string, expected: string) => {
          const word = countWords.find(word => word.id === id);
          const positioned = (measure.direction ?? []).find(direction => direction['direction-type'].words?.some(candidate => candidate.id === id));
          if (word?.['#text'] !== expected || !positioned || positioned['direction-type'].words?.length !== 1) throw new MusicXmlValidationError(`Invalid canonical vocal count annotation in ${cell}.`);
          return numeric(positioned.offset ?? '0', 'vocal offset') / countTicks;
        };
        const countOffset = at(`vocal-count-${cell}`, '3'), andOffset = at(`vocal-and-${cell}`, '&');
        if (at(`vocal-accent-${cell}`, '>') !== andOffset) throw new MusicXmlValidationError(`Unsupported canonical vocal count timing in ${cell}.`);
        annotations.vocals.push({ cell, kind: 'count-and', countOffset, andOffset });
        vocalCues.push({ bar: index + 1, cell, text });
      } else if (arrangement[0]?.id === `vocal-${cell}` && text) {
        vocalCues.push({ bar: index + 1, cell, text });
        annotations.vocals.push({ cell, kind: 'text' });
      }
      for (const word of words.filter(word => word.id?.startsWith(`feel-${part.id}-`))) {
        const suffix = word.id?.slice(`feel-${part.id}-`.length) ?? '';
        const span = /^([1-9]\d*)-([1-9]\d*)$/.exec(suffix);
        const feelText = word['#text'];
        if (!span || Number(span[1]) !== index + 1 || feelText !== 'Funky' && feelText !== 'Extra funky' && feelText !== 'Higher intensity') throw new MusicXmlValidationError(`Invalid canonical feel annotation in ${cell}.`);
        annotations.feels.push({ partId: part.id, startBar: Number(span[1]), endBar: Number(span[2]), text: feelText });
      }
      const display = words.find(word => word.id === `instrument-${cell}`);
      if (display) {
        if (!display['#text']?.trim()) throw new MusicXmlValidationError(`Empty canonical instrument display in ${cell}.`);
        annotations.instrumentDisplays.push({ cell, text: display['#text'] });
      }
      const readings = (measure.direction ?? []).flatMap(direction => (direction['direction-type']['other-direction'] ?? [])
        .filter(marker => marker.id === `reading-${cell}`));
      const onsetDirections = (measure.direction ?? []).filter(direction => (direction['direction-type']['other-direction'] ?? [])
        .some(marker => marker.id?.startsWith(`onset-${cell}-`)));
      const offsets = onsetDirections.map(direction => numeric(direction.offset ?? '0', 'onset offset') / countTicks);
      if (offsets.some((offset, index) => offset < 0 || offset >= meter.numerator || !Number.isInteger(offset * countTicks) || index > 0 && offset <= offsets[index - 1])) throw new MusicXmlValidationError(`Invalid canonical onset sequence in ${cell}.`);
      const markers = onsetDirections.flatMap(direction => direction['direction-type']['other-direction'] ?? []);
      if (markers.some(marker => marker['#text'] !== 'show-tools:onset' && marker['#text'] !== 'show-tools:onset:sampled') || readings.length > 1 || offsets.length && readings.length) throw new MusicXmlValidationError(`Conflicting canonical arrangement reading in ${cell}.`);
      const reading: MusicXmlCell['reading'] = offsets.length ? { kind: 'hits', offsets, sampled: markers.some(marker => marker['#text'] === 'show-tools:onset:sampled') }
        : readings.length ? { kind: 'text', text, reason: readings[0]['#text'] ?? '' } : text.trim() ? { kind: 'text', text, reason: 'Authored MusicXML words; no note duration inferred.' } : { kind: 'blank' };
      return { cell, bar: index + 1, text, reading };
    });
    return { id: part.id, name, labelCell: binding.labelCell, managed: binding.managed, cells };
  });
  const resolvedParts = runtimeParts(performance, parts);
  const sourceField = metadata.get('show-tools:source'), mappingField = metadata.get('show-tools:mapping');
  const source = sourceField === undefined ? null : decodeSongArchive(JSON.parse(sourceField));
  const mapping: unknown | null = mappingField === undefined ? null : JSON.parse(mappingField);
  const voiceField = metadata.get('show-tools:voices');
  const voices = voiceField === undefined ? null : decodeSongVoices(JSON.parse(voiceField));
  for (const binding of voices?.bindings ?? []) {
    const part = parts.find(part => part.labelCell === binding.labelCell);
    const label = part ? `${part.managed ? 'AF - ' : ''}${part.name}` : '';
    if (binding.spreadsheetId !== performance.source.spreadsheetId || binding.sheetId !== performance.source.sheetId || binding.sourceLabel !== label) throw new MusicXmlValidationError('MusicXML voice metadata must match the canonical song parts and source identity.');
  }
  const controlNames = { ...performance.chartBinding.controlNames };
  for (const part of resolvedParts) if (part.role.kind === 'pad') controlNames[part.role.buttonId] = part.name;
  const chart: CompiledSong['chart'] = {
    title: score.work['work-title'], bpm, beatsPerBar: meter.numerator,
    bars: first.measure.map((measure, index) => {
      const section = sections.find(section => index + 1 >= section.startBar && index + 1 <= section.endBar);
      if (!section) throw new MusicXmlValidationError('Canonical MusicXML section coverage is incomplete.');
      const words = (measure.direction ?? []).flatMap(direction => direction['direction-type'].words ?? []);
      const cueText = (button: string) => words.find(word => word.id === `command-${button}-${index + 1}`)?.['#text'] ?? '';
      return { bar: index + 1, ...(performance.chartBinding.labels ? { label: performance.chartBinding.labels[index] } : {}), column: performance.chartBinding.columns[index], sectionId: section.id, section: section.label,
        partial: performance.chartBinding.partialBars.includes(index + 1), cues: { L1: cueText('L1'), L2: cueText('L2'), R1: cueText('R1'), R2: cueText('R2') } };
    }), sections, spreadsheetId: performance.source.spreadsheetId, sheetId: performance.source.sheetId,
    sheetName: performance.source.sheetName, leadInColumn: performance.chartBinding.leadInColumn,
    leadInCues: performance.chartBinding.leadInCues,
    controlNames, annotatedThroughBar: performance.chartBinding.annotatedThroughBar,
  };
  if (performance.executable) {
    for (const cue of performance.cues) {
      const shown = cue.bar === 0 ? chart.leadInCues[cue.buttonId] : chart.bars[cue.bar - 1]?.cues[cue.buttonId];
      if (shown !== cue.source.text.trim()) throw new MusicXmlValidationError(`MusicXML command display disagrees with the typed action at ${cue.source.a1}. Update both explicitly.`);
    }
    for (const bar of chart.bars) for (const button of buttons) if (bar.cues[button] && !performance.cues.some(cue => cue.bar === bar.bar && cue.buttonId === button)) throw new MusicXmlValidationError(`MusicXML command ${button} at bar ${bar.bar} lacks a typed action.`);
  }
  const digest = await semanticDigest({ title: chart.title, meter, bpmPerChartCount: bpm, sections, vocalCues, parts, annotations }, performance, voices);
  const song = decodeCanonicalProgram({
    schemaVersion: 7, notationVersion: performance.notationVersion, id: performance.id, title: chart.title,
    ticksPerQuarter: 960, meter, source: { ...performance.source, digest }, mappingDigest: digest, chart,
    ...(performance.inputBindings === undefined ? {} : { inputBindings: performance.inputBindings }),
    ...(performance.terminalStops === undefined ? {} : { terminalStops: performance.terminalStops }),
    ...(performance.sourceProfiles === undefined ? {} : { sourceProfiles: performance.sourceProfiles }),
    ...(performance.noteBanks === undefined ? {} : { noteBanks: performance.noteBanks }),
    ...(performance.externalSamples === undefined ? {} : { externalSamples: performance.externalSamples }),
    voices: performance.voices, parts: resolvedParts, rotation: performance.rotation, cueWindow: performance.cueWindow,
    ...(performance.authoredCues === undefined ? {} : { authoredCues: performance.authoredCues }),
    cues: performance.cues, takes: performance.takes, selections: performance.selections, playback: performance.playback,
    diagnostics: performance.diagnostics, executable: performance.executable,
  });
  const report: MusicXmlReport = {
    annotations, profile: MUSICXML_SONG_PROFILE, title: chart.title, sourceDigest: digest,
    mappingDigest: digest, meter, bpmPerChartCount: bpm,
    measureCount: first.measure.length, selectedLabelCells: performance.selectedLabelCells,
    nativeCompilationExecutable: song.executable, compilerDiagnostics: song.diagnostics, conventions: performance.conventions,
    sections, vocalCues, parts,
  };
  validateAnnotations(report);
  await prepareDeclaredExternalAssets(song.externalSamples);
  return { song, report, source, mapping, voices };
}

export async function compileMusicXmlSong(input: string): Promise<CompiledSong> {
  return (await readMusicXmlSong(input)).song;
}

/** Explicit authoring migration. The normal reader accepts only the current profile. */
export async function migrateMusicXmlSongV2(input: string): Promise<string> {
  if (new TextEncoder().encode(input).byteLength > maximumBytes) throw new MusicXmlValidationError('Canonical MusicXML exceeds the 16 MiB limit.');
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new MusicXmlValidationError('MusicXML DTD and entity declarations are not supported.');
  if (XMLValidator.validate(input) !== true) throw new MusicXmlValidationError('Invalid MusicXML syntax.');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false,
    parseAttributeValue: false, trimValues: false, isArray: name => name === 'miscellaneous-field' });
  const Fields = Schema.Struct({ 'score-partwise': Schema.Struct({ identification: Schema.Struct({ miscellaneous: Schema.Struct({
    'miscellaneous-field': Schema.Array(Schema.Struct({ name: Schema.String, '#text': Schema.optionalKey(Schema.String) })),
  }) }) }) });
  const fields = Schema.decodeUnknownSync(Fields)(parser.parse(input))['score-partwise'].identification.miscellaneous['miscellaneous-field'];
  unique(fields.map(field => field.name), 'metadata field');
  const metadata = new Map(fields.map(field => [field.name, field['#text'] ?? '']));
  const profile = metadata.get('show-tools:profile');
  if (profile === MUSICXML_SONG_PROFILE) return canonicalize(await readMusicXmlSong(input));
  if (profile !== 'show-tools-song-v2') throw new MusicXmlValidationError('Migration requires a complete show-tools-song-v2 or current canonical song.');
  const oldRotation = Schema.Struct({ voiceId: Schema.String, releaseGridBeats: Schema.Number.check(Schema.isFinite()),
    windows: RotationSchema.fields.windows });
  const oldWindow = Schema.Union([Schema.Struct({ kind: Schema.Literal('full') }),
    Schema.Struct({ kind: Schema.Literal('prefix'), endCount: Schema.Number.check(Schema.isFinite()) })]);
  const oldSelection = Schema.Struct({ ...CompiledSongSchema.fields.selections.schema.value.fields, window: oldWindow });
  const oldPerformance = Schema.Struct({ ...LegacyPerformance.fields, rotation: Schema.NullOr(oldRotation), selections: list(oldSelection) });
  const performance = Schema.decodeUnknownSync(oldPerformance, { onExcessProperty: 'error' })(JSON.parse(metadata.get('show-tools:performance') ?? 'null'));
  const rotation = performance.rotation ? { voiceId: performance.rotation.voiceId, inactivityBeats: performance.rotation.releaseGridBeats,
    windows: performance.rotation.windows } : null;
  const replacements = new Map<string, string>([
    ['show-tools:profile', MUSICXML_SONG_PROFILE],
    ['show-tools:performance', stableMusicXmlJson({ ...performance, version: 2, cues: performance.cues.map(migrateCompiledCueV6), rotation })],
  ]);
  const mapping = metadata.get('show-tools:mapping');
  if (mapping) {
    const value: unknown = JSON.parse(mapping);
    const version = Schema.decodeUnknownSync(Schema.Struct({ mappingVersion: Schema.optionalKey(Schema.Int) }))(value);
    if (version.mappingVersion !== undefined) {
      const oldRule = Schema.Struct({ row: Schema.Int, voiceId: Schema.String, releaseGridBeats: Schema.Number.check(Schema.isFinite()) });
      const oldReuse = Schema.Struct({ cell: Schema.String, notation: Schema.String, sourceArmCell: Schema.String,
        endCount: Schema.Number.check(Schema.isFinite()) });
      const oldMapping = Schema.Struct({ ...SongMappingSchema.fields, mappingVersion: Schema.Literal(5),
        rotationRule: Schema.optionalKey(oldRule), variantReuses: list(oldReuse) });
      const legacy = Schema.decodeUnknownSync(oldMapping, { onExcessProperty: 'error' })(value);
      const { rotationRule, ...rest } = legacy;
      replacements.set('show-tools:mapping', stableMusicXmlJson({ ...rest, mappingVersion: 6, ...(rotationRule ? {
        rotationRule: { row: rotationRule.row, voiceId: rotationRule.voiceId, inactivityBeats: rotationRule.releaseGridBeats },
      } : {}) }));
    }
  }
  const decodeNodes = Schema.decodeUnknownSync(list(Schema.Record(Schema.String, Schema.Unknown)));
  const nodes = decodeNodes(new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '',
    parseTagValue: false, parseAttributeValue: false, trimValues: false }).parse(input));
  const attributes = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }));
  const rewrite = (elements: typeof nodes, path: readonly string[]): typeof nodes => elements.map(element => {
    const [name, ...rest] = path;
    if (name) return Object.hasOwn(element, name) ? { ...element, [name]: rewrite(decodeNodes(element[name]), rest) } : element;
    if (!Object.hasOwn(element, 'miscellaneous-field')) return element;
    const replacement = replacements.get(attributes(element[':@']).name);
    return replacement === undefined ? element : { ...element, 'miscellaneous-field': [{ '#text': replacement }] };
  });
  const converted = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '' })
    .build(rewrite(nodes, ['score-partwise', 'identification', 'miscellaneous']));
  return canonicalize(await readMusicXmlSong(converted));
}

function canonicalize(current: MusicXmlSong): Promise<string> {
  return writeMusicXmlSong({ song: current.song, report: current.report, ...(current.source ? { source: current.source } : {}),
    ...(current.mapping !== null ? { mapping: current.mapping } : {}), ...(current.voices ? { voices: current.voices } : {}) });
}
