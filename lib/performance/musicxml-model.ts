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
export interface MusicXmlReport {
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
