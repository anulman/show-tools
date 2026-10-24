import { Schema } from 'effect';
import type { Chart } from '../../lib/performance/model.js';
import { rangeForBar } from '../../lib/performance/chart.js';

const Result = Schema.Struct({ ok: Schema.Literal(true), selectedRange: Schema.String, url: Schema.String });
const ErrorResponse = Schema.Struct({ error: Schema.String });
const parseResult = Schema.decodeUnknownSync(Result);
const parseError = Schema.decodeUnknownOption(ErrorResponse);

export async function openCurrentChart(chart: Chart, bar: number, phase = 'playing', helper = 'http://127.0.0.1:9223') {
  let response: Response;
  try {
    response = await fetch(helper + '/open', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheetId: chart.spreadsheetId, sheetId: chart.sheetId, range: rangeForBar(chart, bar, phase) }),
      signal: AbortSignal.timeout(18000) });
  } catch {
    throw new Error('The local chart helper is unavailable. Run node --import tsx scripts/open-chart.ts with Chrome CDP enabled. This does not affect practice audio.');
  }
  const result: unknown = await response.json();
  if (!response.ok) {
    const parsed = parseError(result);
    throw new Error(parsed._tag === 'Some' ? parsed.value.error : 'The chart helper could not select this bar');
  }
  return parseResult(result);
}
