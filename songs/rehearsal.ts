import { decodeCompiledSong, type CompiledSong } from '../lib/performance/compiled-song.js';
import { writeMusicXmlSong, type MusicXmlSong } from '../lib/performance/musicxml-song.js';

export function rehearsalProgram(draft: CompiledSong): CompiledSong {
  if (draft.executable) throw new Error('Timing rehearsal requires an unfinished chart.');
  const emptyCues = { L1: '', L2: '', R1: '', R2: '' };
  return decodeCompiledSong({
    schemaVersion: draft.schemaVersion,
    notationVersion: 'terse-v2',
    id: draft.id,
    title: draft.title,
    ticksPerQuarter: draft.ticksPerQuarter,
    meter: draft.meter,
    source: draft.source,
    mappingDigest: draft.mappingDigest,
    chart: {
      ...draft.chart,
      bars: draft.chart.bars.map(bar => ({ ...bar, cues: emptyCues })),
      leadInCues: emptyCues,
      annotatedThroughBar: draft.chart.bars.length,
    },
    parts: draft.parts.filter(part => part.role.kind === 'default-live'),
    voices: [],
    rotation: null,
    cueWindow: { earlyMs: 0, lateMs: 0, ties: 'reject' },
    authoredCues: [],
    cues: [],
    takes: [],
    selections: [],
    playback: [],
    diagnostics: [],
    executable: true,
  });
}

export async function rehearsalMusicXml(draft: MusicXmlSong): Promise<string> {
  const song = rehearsalProgram(draft.song);
  return writeMusicXmlSong({
    song,
    report: draft.report,
    ...(draft.voices ? { voices: draft.voices } : {}),
  });
}
