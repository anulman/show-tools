import { Schema } from 'effect';
import { selectionFromEvent, type ChartSelection } from './sheets-extension/selection.js';

const Result = Schema.Struct({ ok: Schema.Literal(true), selectedRange: Schema.String, url: Schema.String });
const ErrorResponse = Schema.Struct({ error: Schema.String });
const parseResult = Schema.decodeUnknownSync(Result);
const parseError = Schema.decodeUnknownOption(ErrorResponse);

async function selectChart(selection: { spreadsheetId: string; sheetId: number; range: string; activate?: boolean },
  helper: string, request: typeof fetch = fetch, signal: AbortSignal = AbortSignal.timeout(18000)) {
  let response: Response;
  try {
    response = await request(helper + '/open', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selection), signal });
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

export function createChartFollower({ onStatus = () => {}, helper = 'http://127.0.0.1:9223', fetch: request = fetch }:
  { onStatus?: (status: string) => void; helper?: string; fetch?: typeof fetch } = {}) {
  let pending: ChartSelection | null = null;
  let active: AbortController | null = null;
  let applying = false;
  let generation = 0;
  let lastKey = '';
  let runId: string | null = null;
  let seq = -1;

  const drain = async () => {
    applying = true;
    try {
      while (pending) {
        const selection = pending;
        pending = null;
        const current = generation;
        const controller = new AbortController();
        active = controller;
        try {
          const result = await selectChart({ spreadsheetId: selection.spreadsheetId, sheetId: selection.sheetId,
            range: selection.range, activate: false }, helper, request,
          AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]));
          if (current === generation) onStatus(`Following ${result.selectedRange}`);
        } catch (error) {
          if (current === generation) onStatus(error instanceof Error ? error.message : 'Chart following is unavailable');
        } finally { if (active === controller) active = null; }
      }
    } finally { applying = false; }
  };

  return {
    receive(input: unknown): void {
      const selection = selectionFromEvent(input);
      if (!selection || (runId === selection.runId && selection.seq <= seq)) return;
      const key = `${selection.runId}/${selection.spreadsheetId}/${selection.sheetId}/${selection.range}`;
      runId = selection.runId; seq = selection.seq;
      if (key === lastKey) return;
      lastKey = key;
      pending = selection;
      if (!applying) void drain();
    },
    stop(): void {
      generation++;
      pending = null;
      active?.abort(); active = null;
      lastKey = ''; runId = null; seq = -1;
    },
  };
}
