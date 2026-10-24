import { Option, Schema } from 'effect';
import { columnName } from '../../../lib/performance/columns.js';
export { columnName };

const PositionEvent = Schema.Struct({
  v: Schema.Literal(1),
  runId: Schema.String,
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  state: Schema.Struct({
    phase: Schema.Literals(['idle', 'count-in', 'playing', 'ended']),
    bar: Schema.NullOr(Schema.Int),
    chart: Schema.Struct({
      spreadsheetId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{20,}$/)),
      sheetId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      columns: Schema.Array(Schema.Int),
      leadInColumn: Schema.Int,
    }),
  }),
});
const decodePosition = Schema.decodeUnknownOption(PositionEvent);
export interface ChartSelection {
  spreadsheetId: string;
  sheetId: number;
  range: string;
  runId: string;
  seq: number;
}

export function selectionFromEvent(input: unknown): ChartSelection | null {
  const parsed = decodePosition(input);
  if (Option.isNone(parsed)) return null;
  const event = parsed.value;
  const { state } = event;
  const { chart } = state;
  const column = state.phase === 'count-in' ? chart.leadInColumn :
    state.phase === 'playing' && state.bar !== null && state.bar > 0 ? chart.columns[state.bar - 1] : null;
  if (column === null || column === undefined || column < 1 || column > 18278) return null;
  const name = columnName(column);
  return { spreadsheetId: chart.spreadsheetId, sheetId: chart.sheetId, range: `${name}:${name}`,
    runId: event.runId, seq: event.seq };
}

export function selectionURL(currentURL: string, selection: ChartSelection, navigate = false): string {
  const url = new URL(currentURL);
  if (url.origin !== 'https://docs.google.com' ||
      !url.pathname.startsWith(`/spreadsheets/d/${selection.spreadsheetId}/`)) throw new Error('The selected tab is a different spreadsheet');
  const parameters = new URLSearchParams(url.hash.slice(1));
  parameters.set('gid', String(selection.sheetId));
  parameters.set('range', selection.range);
  if (navigate) url.searchParams.set('gid', String(selection.sheetId));
  url.hash = parameters.toString();
  return url.href;
}
