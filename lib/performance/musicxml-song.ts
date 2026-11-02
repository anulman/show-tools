import { Schema } from 'effect';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { CompiledSongSchema, decodeCompiledSong, type CompiledSong } from './compiled-song.js';
import { parseSongSource, type SongSource } from './song-source.js';
import type { MusicXmlReport, MusicXmlCell } from './musicxml-model.js';
import { scoreXmlText as xml, stableMusicXmlJson } from './score-xml.js';
import { columnName } from './columns.js';
import { parseCatalogDocument, type CatalogDocument } from '../voice-catalog/model.js';

export const MUSICXML_SONG_PROFILE = 'show-tools-song-v1';
const buttons: (keyof CompiledSong['chart']['controlNames'])[] = ['L1', 'L2', 'R1', 'R2'];
const maximumBytes = 16 * 1024 * 1024;
const list = <S extends Schema.Constraint>(schema: S) => Schema.mutable(Schema.Array(schema));
const partFields = CompiledSongSchema.fields.parts.schema.value.fields;
const RuntimePart = Schema.Struct({ id: partFields.id, source: partFields.source, role: partFields.role, profile: partFields.profile, scorePartId: Schema.String });
const ProvenancePart = Schema.Struct({ id: Schema.String, labelCell: Schema.String, managed: Schema.Boolean });
const Performance = Schema.Struct({
  version: Schema.Literal(1), scope: Schema.Literal('complete'),
  id: CompiledSongSchema.fields.id, notationVersion: CompiledSongSchema.fields.notationVersion,
  source: CompiledSongSchema.fields.source, mappingDigest: CompiledSongSchema.fields.mappingDigest,
  voices: CompiledSongSchema.fields.voices, parts: list(RuntimePart),
  rotation: CompiledSongSchema.fields.rotation, cueWindow: CompiledSongSchema.fields.cueWindow,
  cues: CompiledSongSchema.fields.cues, takes: CompiledSongSchema.fields.takes,
  selections: CompiledSongSchema.fields.selections, playback: CompiledSongSchema.fields.playback,
  diagnostics: CompiledSongSchema.fields.diagnostics, executable: Schema.Boolean,
  chartBinding: Schema.Struct({
    columns: list(Schema.Int), partialBars: list(Schema.Int),
    leadInColumn: Schema.Int, leadInCues: CompiledSongSchema.fields.chart.fields.leadInCues,
    controlNames: CompiledSongSchema.fields.chart.fields.controlNames,
    annotatedThroughBar: Schema.Int,
  }),
  scoreParts: list(ProvenancePart), selectedLabelCells: list(Schema.String), conventions: list(Schema.String),
});
type PerformanceData = typeof Performance.Type;

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
  if (!text.trim() || !Number.isFinite(value)) throw new Error(`Invalid MusicXML ${name}.`);
  return value;
}
function unique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate MusicXML ${name}.`);
}
function addressRow(cell: string): number {
  const match = /^[A-Z]+([1-9]\d*)$/.exec(cell);
  if (!match) throw new Error(`Invalid MusicXML source coordinate ${cell}.`);
  return Number(match[1]);
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
    if (!scorePart) throw new Error(`Missing canonical runtime part ${part.id}.`);
    const { scorePartId, ...fields } = part;
    const originalName = (part.source.text.trim() || part.source.note.trim()).replace(/^AF\s*-\s*/, '').trim();
    const source = originalName === scorePart.name ? part.source : { ...part.source, text: `AF - ${scorePart.name}` };
    return { ...fields, name: scorePart.name, source };
  });
}

async function semanticDigest(report: Pick<MusicXmlReport, 'title' | 'meter' | 'bpmPerChartCount' | 'sections' | 'parts' | 'vocalCues'>,
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

export async function writeMusicXmlSong(options: WriteMusicXmlSong): Promise<string> {
  const { song, report } = options;
  if (report.parts.length < 1 || report.parts.some(part => part.cells.length !== song.chart.bars.length)) throw new Error('Canonical MusicXML needs complete chronological measures for every score part.');
  const partBindings = song.parts.map(part => {
    const scorePart = report.parts.find(candidate => candidate.labelCell === part.source.a1);
    if (!scorePart) throw new Error(`Canonical MusicXML is missing runtime part ${part.name}. Export the complete song.`);
    const { name, ...fields } = part;
    return { ...fields, scorePartId: scorePart.id };
  });
  const performance: PerformanceData = {
    version: 1, scope: 'complete', id: song.id, notationVersion: song.notationVersion,
    source: song.source, mappingDigest: song.mappingDigest, voices: song.voices, parts: partBindings,
    rotation: song.rotation, cueWindow: song.cueWindow, cues: song.cues, takes: song.takes,
    selections: song.selections, playback: song.playback, diagnostics: song.diagnostics, executable: song.executable,
    chartBinding: { columns: song.chart.bars.map(bar => bar.column), partialBars: song.chart.bars.filter(bar => bar.partial).map(bar => bar.bar),
      leadInColumn: song.chart.leadInColumn, leadInCues: song.chart.leadInCues,
      controlNames: song.chart.controlNames, annotatedThroughBar: song.chart.annotatedThroughBar },
    scoreParts: report.parts.map(({ id, labelCell, managed }) => ({ id, labelCell, managed })),
    selectedLabelCells: report.selectedLabelCells, conventions: report.conventions,
  };
  Schema.decodeUnknownSync(Performance, { onExcessProperty: 'error' })(performance);
  const voices = options.voices === undefined ? null : parseCatalogDocument(options.voices);
  const digest = await semanticDigest({ title: report.title, meter: report.meter, bpmPerChartCount: report.bpmPerChartCount,
    sections: report.sections, parts: report.parts, vocalCues: report.vocalCues }, performance, voices);
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
      if (!chartBar) throw new Error(`Canonical MusicXML is missing bar ${cell.bar}.`);
      for (const button of buttons) if (chartBar.cues[button]) body += direction(chartBar.cues[button], `command-${button}-${cell.bar}`);
    }
    if (cell.text) body += direction(cell.text, `${vocalCells.has(cell.cell) ? 'vocal' : 'cell'}-${cell.cell}`);
    if (cell.reading.kind === 'text') body += direction(cell.reading.reason, `reading-${cell.cell}`, 0, true);
    if (cell.reading.kind === 'hits') {
      for (const [hit, offset] of cell.reading.offsets.entries()) body += direction(cell.reading.sampled ? 'show-tools:onset:sampled' : 'show-tools:onset', `onset-${cell.cell}-${hit}`, offset * countTicks, true);
    }
    body += `<note print-object="no"><rest measure="yes"/><duration>${report.meter.numerator * countTicks}</duration></note>`;
    return `<measure number="${cell.bar}">${body}</measure>`;
  }).join('\n')}</part>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${xml(report.title)}</work-title></work><identification><encoding><software>${MUSICXML_SONG_PROFILE}</software><encoding-description>Complete canonical song. Hidden measure rests are layout spacers. Onset-only directions do not specify played duration or pitch.</encoding-description></encoding><miscellaneous>${metadata.map(([name, text]) => `<miscellaneous-field name="${name}">${xml(text)}</miscellaneous-field>`).join('')}</miscellaneous></identification><part-list>${report.parts.map(part => `<score-part id="${xml(part.id)}"><part-name>${xml(part.name)}</part-name></score-part>`).join('')}</part-list>\n${parts}\n</score-partwise>\n`;
}

export async function readMusicXmlSong(input: string): Promise<MusicXmlSong> {
  if (new TextEncoder().encode(input).byteLength > maximumBytes) throw new Error('Canonical MusicXML exceeds the 16 MiB limit.');
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error('MusicXML DTD and entity declarations are not supported.');
  const validation = XMLValidator.validate(input);
  if (validation !== true) throw new Error(`Invalid MusicXML: ${validation.err.msg}`);
  const allowedElements = new Set(['score-partwise', 'work', 'work-title', 'identification', 'encoding', 'software', 'encoding-description',
    'miscellaneous', 'miscellaneous-field', 'part-list', 'score-part', 'part-name', 'part', 'measure', 'attributes', 'divisions', 'time', 'beats',
    'beat-type', 'clef', 'sign', 'direction', 'direction-type', 'metronome', 'beat-unit', 'per-minute', 'rehearsal', 'words', 'other-direction',
    'offset', 'note', 'rest', 'duration']);
  for (const element of input.matchAll(/<([A-Za-z_][\w:.-]*)(?:\s|\/?\>)/g)) {
    if (!allowedElements.has(element[1])) throw new Error(`Unsupported MusicXML element <${element[1]}>. Import this notation explicitly before loading.`);
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
        if (spacer >= 0 && children.slice(spacer + 1).some(child => 'direction' in child || 'attributes' in child)) throw new Error('Canonical MusicXML directions and attributes must precede the measure spacer.');
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
  if (fields.some(field => !knownFields.has(field.name))) throw new Error('Unsupported canonical MusicXML metadata field. Migrate its profile before importing.');
  const metadata = new Map(fields.map(field => [field.name, field['#text'] ?? '']));
  if (metadata.get('show-tools:profile') !== MUSICXML_SONG_PROFILE) throw new Error('Expected a complete canonical Show Tools MusicXML song, not a study or part projection.');
  const encoded = metadata.get('show-tools:performance');
  if (!encoded) throw new Error('Canonical MusicXML is missing required performance metadata.');
  const extension: unknown = JSON.parse(encoded);
  const performance = Schema.decodeUnknownSync(Performance, { onExcessProperty: 'error' })(extension);
  const standardIds = score.part.flatMap(part => part.measure.flatMap(measure => (measure.direction ?? []).flatMap(direction => [
    ...(direction['direction-type'].words ?? []), ...(direction['direction-type'].rehearsal ?? []), ...(direction['direction-type']['other-direction'] ?? []),
  ].flatMap(marker => marker.id ? [marker.id] : []))));
  unique(standardIds, 'direction identity');
  unique(score.part.map(part => part.id), 'part identity');
  unique(score['part-list']['score-part'].map(part => part.id), 'part-list identity');
  unique(performance.scoreParts.map(part => part.id), 'part binding');
  const partNames = new Map(score['part-list']['score-part'].map(part => [part.id, part['part-name']]));
  if (partNames.size !== score.part.length || performance.scoreParts.length !== score.part.length) throw new Error('Canonical MusicXML score parts and bindings must match exactly.');
  const first = score.part[0];
  if (!first || first.measure.length < 1 || first.measure.length > 4096) throw new Error('Canonical MusicXML needs 1 through 4096 measures.');
  const initial = first.measure[0].attributes;
  if (!initial?.time) throw new Error('Canonical MusicXML needs an explicit initial meter.');
  const meter = { numerator: numeric(initial.time.beats, 'meter'), denominator: numeric(initial.time['beat-type'], 'meter') };
  if (!(meter.numerator === 4 && meter.denominator === 4 || meter.numerator === 6 && meter.denominator === 8)) throw new Error('Canonical MusicXML currently supports 4/4 and 6/8.');
  if (score.part.slice(1).some(part => part.measure.some(measure => (measure.direction ?? []).some(direction => direction['direction-type'].metronome || direction['direction-type'].rehearsal)))) throw new Error('Canonical global tempo and section directions belong to the first score part.');
  const metronomes = first.measure.flatMap(measure => (measure.direction ?? []).flatMap(direction => direction['direction-type'].metronome ? [direction['direction-type'].metronome] : []));
  if (first.measure.slice(1).some(measure => (measure.direction ?? []).some(direction => direction['direction-type'].metronome))) throw new Error('The reference tempo must occur in the first measure.');
  if (metronomes.length !== 1) throw new Error('Canonical MusicXML requires one reference tempo; tempo changes need an explicit capability.');
  const metronome = metronomes[0], tempoUnit = metronome['beat-unit'] === 'quarter' ? 4 : metronome['beat-unit'] === 'eighth' ? 8 : 0;
  if (!tempoUnit) throw new Error('Unsupported canonical MusicXML tempo unit.');
  const bpm = numeric(metronome['per-minute'], 'tempo') * meter.denominator / tempoUnit;
  if (bpm < 40 || bpm > 240) throw new Error('Canonical MusicXML reference tempo must be 40 through 240 per chart count.');
  const countTicks = 960 * 4 / meter.denominator;
  const sections: MusicXmlReport['sections'] = [];
  for (const [index, measure] of first.measure.entries()) {
    for (const rehearsal of (measure.direction ?? []).flatMap(direction => direction['direction-type'].rehearsal ?? [])) {
      if (!rehearsal.id || !rehearsal['#text']?.trim()) throw new Error('Canonical sections require stable rehearsal IDs and labels.');
      if (sections.at(-1)?.startBar === index + 1) throw new Error('Each measure can begin only one section.');
      if (sections.length) sections[sections.length - 1] = { ...sections[sections.length - 1], endBar: index };
      sections.push({ id: rehearsal.id, label: rehearsal['#text'], startBar: index + 1, endBar: first.measure.length });
    }
  }
  if (sections[0]?.startBar !== 1) throw new Error('Canonical MusicXML must begin with a section.');
  unique(sections.map(section => section.id), 'section identity');
  if (performance.chartBinding.columns.length !== first.measure.length || new Set(performance.chartBinding.columns).size !== first.measure.length) throw new Error('Canonical MusicXML has an incomplete source-column map.');
  const vocalCues: MusicXmlReport['vocalCues'] = [];
  const parts: MusicXmlReport['parts'] = score.part.map(part => {
    const binding = performance.scoreParts.find(binding => binding.id === part.id), name = partNames.get(part.id);
    if (!binding || !name?.trim() || part.measure.length !== first.measure.length) throw new Error(`Canonical MusicXML part ${part.id} has an incomplete identity or timeline.`);
    const cells = part.measure.map((measure, index): MusicXmlCell => {
      if (numeric(measure.number, 'measure number') !== index + 1) throw new Error('Canonical MusicXML measures must be chronological and contiguous from 1.');
      const attributes = measure.attributes;
      if (index === 0 && (!attributes?.time || numeric(attributes.divisions ?? '', 'divisions') !== 960)
        || attributes?.time && (numeric(attributes.time.beats, 'meter') !== meter.numerator || numeric(attributes.time['beat-type'], 'meter') !== meter.denominator)
        || attributes?.divisions && numeric(attributes.divisions, 'divisions') !== 960) throw new Error('Canonical MusicXML parts must share one fixed meter and 960 divisions.');
      if (measure.note.length !== 1 || numeric(measure.note[0].duration, 'spacer duration') !== meter.numerator * countTicks) throw new Error('Canonical MusicXML writing spacers must fill each complete measure.');
      const cell = `${columnName(performance.chartBinding.columns[index])}${addressRow(binding.labelCell)}`;
      for (const direction of measure.direction ?? []) {
        if (numeric(direction.offset ?? '0', 'direction offset') !== 0 && (direction['direction-type'].words?.length || direction['direction-type'].rehearsal?.length || direction['direction-type'].metronome || !(direction['direction-type']['other-direction'] ?? []).some(marker => marker.id?.startsWith(`onset-${cell}-`)))) throw new Error('Nonzero offsets on text, section and tempo directions need an explicit MusicXML capability.');
      }
      const words = (measure.direction ?? []).flatMap(direction => direction['direction-type'].words ?? []);
      for (const word of words) if (word.id !== `cell-${cell}` && word.id !== `vocal-${cell}`
        && !(part === first && buttons.some(button => word.id === `command-${button}-${index + 1}`))) throw new Error(`Unsupported canonical text direction ${word.id ?? '(without ID)'}.`);
      const others = (measure.direction ?? []).flatMap(direction => direction['direction-type']['other-direction'] ?? []);
      if (others.some(marker => marker.id !== `reading-${cell}` && !marker.id?.startsWith(`onset-${cell}-`))) throw new Error(`Unsupported canonical annotation in ${cell}.`);
      const arrangement = words.filter(word => word.id === `cell-${cell}` || word.id === `vocal-${cell}`);
      if (arrangement.length > 1) throw new Error(`Duplicate canonical arrangement cell ${cell}.`);
      const text = arrangement[0]?.['#text'] ?? '';
      if (arrangement[0]?.id === `vocal-${cell}` && text) vocalCues.push({ bar: index + 1, cell, text });
      const readings = (measure.direction ?? []).flatMap(direction => (direction['direction-type']['other-direction'] ?? [])
        .filter(marker => marker.id === `reading-${cell}`));
      const onsetDirections = (measure.direction ?? []).filter(direction => (direction['direction-type']['other-direction'] ?? [])
        .some(marker => marker.id?.startsWith(`onset-${cell}-`)));
      const offsets = onsetDirections.map(direction => numeric(direction.offset ?? '0', 'onset offset') / countTicks);
      if (offsets.some((offset, index) => offset < 0 || offset >= meter.numerator || !Number.isInteger(offset * countTicks) || index > 0 && offset <= offsets[index - 1])) throw new Error(`Invalid canonical onset sequence in ${cell}.`);
      const markers = onsetDirections.flatMap(direction => direction['direction-type']['other-direction'] ?? []);
      if (markers.some(marker => marker['#text'] !== 'show-tools:onset' && marker['#text'] !== 'show-tools:onset:sampled') || readings.length > 1 || offsets.length && readings.length) throw new Error(`Conflicting canonical arrangement reading in ${cell}.`);
      const reading: MusicXmlCell['reading'] = offsets.length ? { kind: 'hits', offsets, sampled: markers.some(marker => marker['#text'] === 'show-tools:onset:sampled') }
        : readings.length ? { kind: 'text', text, reason: readings[0]['#text'] ?? '' } : text.trim() ? { kind: 'text', text, reason: 'Authored MusicXML words; no note duration inferred.' } : { kind: 'blank' };
      return { cell, bar: index + 1, text, reading };
    });
    return { id: part.id, name, labelCell: binding.labelCell, managed: binding.managed, cells };
  });
  const resolvedParts = runtimeParts(performance, parts);
  const sourceField = metadata.get('show-tools:source'), mappingField = metadata.get('show-tools:mapping');
  const source = sourceField === undefined ? null : parseSongSource(JSON.parse(sourceField));
  const mapping: unknown | null = mappingField === undefined ? null : JSON.parse(mappingField);
  const voiceField = metadata.get('show-tools:voices');
  const voices = voiceField === undefined ? null : parseCatalogDocument(JSON.parse(voiceField));
  for (const binding of voices?.bindings ?? []) {
    const part = parts.find(part => part.labelCell === binding.labelCell);
    const label = part ? `${part.managed ? 'AF - ' : ''}${part.name}` : '';
    if (binding.spreadsheetId !== performance.source.spreadsheetId || binding.sheetId !== performance.source.sheetId || binding.sourceLabel !== label) throw new Error('MusicXML voice metadata must match the canonical song parts and source identity.');
  }
  const controlNames = { ...performance.chartBinding.controlNames };
  for (const part of resolvedParts) if (part.role.kind === 'pad') controlNames[part.role.buttonId] = part.name;
  const chart: CompiledSong['chart'] = {
    title: score.work['work-title'], bpm, beatsPerBar: meter.numerator,
    bars: first.measure.map((measure, index) => {
      const section = sections.find(section => index + 1 >= section.startBar && index + 1 <= section.endBar);
      if (!section) throw new Error('Canonical MusicXML section coverage is incomplete.');
      const words = (measure.direction ?? []).flatMap(direction => direction['direction-type'].words ?? []);
      const cueText = (button: string) => words.find(word => word.id === `command-${button}-${index + 1}`)?.['#text'] ?? '';
      return { bar: index + 1, column: performance.chartBinding.columns[index], sectionId: section.id, section: section.label,
        partial: performance.chartBinding.partialBars.includes(index + 1), cues: { L1: cueText('L1'), L2: cueText('L2'), R1: cueText('R1'), R2: cueText('R2') } };
    }), sections, spreadsheetId: performance.source.spreadsheetId, sheetId: performance.source.sheetId,
    sheetName: performance.source.sheetName, leadInColumn: performance.chartBinding.leadInColumn,
    leadInCues: performance.chartBinding.leadInCues,
    controlNames, annotatedThroughBar: performance.chartBinding.annotatedThroughBar,
  };
  if (performance.executable) {
    for (const cue of performance.cues) {
      const shown = cue.bar === 0 ? chart.leadInCues[cue.buttonId] : chart.bars[cue.bar - 1]?.cues[cue.buttonId];
      if (shown !== cue.source.text.trim()) throw new Error(`MusicXML command display disagrees with the typed action at ${cue.source.a1}. Update both explicitly.`);
    }
    for (const bar of chart.bars) for (const button of buttons) if (bar.cues[button] && !performance.cues.some(cue => cue.bar === bar.bar && cue.buttonId === button)) throw new Error(`MusicXML command ${button} at bar ${bar.bar} lacks a typed action.`);
  }
  const digest = await semanticDigest({ title: chart.title, meter, bpmPerChartCount: bpm, sections, vocalCues, parts }, performance, voices);
  const song = decodeCompiledSong({
    schemaVersion: 5, notationVersion: performance.notationVersion, id: performance.id, title: chart.title,
    ticksPerQuarter: 960, meter, source: { ...performance.source, digest }, mappingDigest: digest, chart,
    voices: performance.voices, parts: resolvedParts, rotation: performance.rotation, cueWindow: performance.cueWindow,
    cues: performance.cues, takes: performance.takes, selections: performance.selections, playback: performance.playback,
    diagnostics: performance.diagnostics, executable: performance.executable,
  });
  const report: MusicXmlReport = {
    profile: MUSICXML_SONG_PROFILE, title: chart.title, sourceDigest: digest,
    mappingDigest: digest, meter, bpmPerChartCount: bpm,
    measureCount: first.measure.length, selectedLabelCells: performance.selectedLabelCells,
    nativeCompilationExecutable: song.executable, compilerDiagnostics: song.diagnostics, conventions: performance.conventions,
    sections, vocalCues, parts,
  };
  return { song, report, source, mapping, voices };
}

export async function compileMusicXmlSong(input: string): Promise<CompiledSong> {
  return (await readMusicXmlSong(input)).song;
}
