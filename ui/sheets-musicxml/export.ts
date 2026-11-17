import { Schema } from 'effect';
import mapping from '../../songs/dance-yrself-clean.mapping.json';
import { SongSourceSchema } from '../../lib/performance/song-source.js';
import { importSheetMusicXml } from '../../lib/performance/sheet-musicxml.js';
import { createMusicianCharts } from '../../lib/performance/musician-sheets.js';

const Row = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1048576 }));
const Payload = Schema.Struct({ source: SongSourceSchema, selection: Schema.Array(Schema.Struct({ firstRow: Row, lastRow: Row })) });

export async function prepareSelectedMusicXml(input: unknown) {
  const payload = Schema.decodeUnknownSync(Payload)(input);
  if (payload.selection.some(range => range.firstRow > range.lastRow)) throw new Error('Invalid selected row range.');
  const selectedRows = payload.source.values.flatMap((_, index) => payload.selection.some(range => index + 1 >= range.firstRow && index + 1 <= range.lastRow) ? [index + 1] : []);
  const result = await importSheetMusicXml({ source: payload.source, mapping, selectedRows });
  const musicianSheets = await createMusicianCharts({ musicxml: result.xml, selectedRows });
  return { ...result, filename: `${mapping.songId}.musicxml`, musicianSheets };
}
