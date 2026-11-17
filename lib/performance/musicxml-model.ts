import type { CompiledSong } from './compiled-song.js';

export type CellReading =
  | { kind: 'blank' }
  | { kind: 'hits'; offsets: number[]; sampled: boolean }
  | { kind: 'text'; text: string; reason: string };

export interface MusicXmlCell {
  cell: string;
  bar: number;
  text: string;
  reading: CellReading;
}
export type VocalEligibility =
  | { kind: 'lyric' }
  | { kind: 'inactive'; reason: 'blank' | 'notation' }
  | { kind: 'unresolved'; message: string };
export type StageCellAnnotation =
  | { cell: string; eligibility: VocalEligibility; kind: 'resolved'; active: boolean; emphasis: 'normal' | 'special' | 'ultra'; sampled: boolean; accents: number[]; anchor: number | null }
  | { cell: string; eligibility: VocalEligibility; kind: 'unresolved'; message: string };

export interface MusicalAnnotations {
  boundaryCues?: { partId: string; cell: string; position: 'lead-in' | 'tail'; text: string }[];
  stageCells: StageCellAnnotation[];
  activities: { cell: string; kind: 'rest' | 'playing' }[];
  feels: { partId: string; startBar: number; endBar: number; text: 'Funky' | 'Extra funky' | 'Higher intensity' }[];
  vocals: ({ cell: string; kind: 'text' } | { cell: string; kind: 'count-and'; countOffset: number; andOffset: number })[];
  instrumentDisplays: { cell: string; text: string }[];
}

export interface MusicXmlReport {
  annotations: MusicalAnnotations;
  profile: string;
  title: string;
  sourceDigest: string;
  mappingDigest: string;
  meter: { numerator: number; denominator: number };
  bpmPerChartCount: number;
  measureCount: number;
  selectedLabelCells: string[];
  nativeCompilationExecutable: boolean;
  compilerDiagnostics: CompiledSong['diagnostics'];
  conventions: string[];
  sections: CompiledSong['chart']['sections'];
  vocalCues: { bar: number; cell: string; text: string }[];
  parts: { id: string; name: string; labelCell: string; managed: boolean; cells: MusicXmlCell[] }[];
}
