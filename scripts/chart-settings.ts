import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Schema } from 'effect';

export const LOCAL_PRACTICE_ORIGINS: readonly string[] = [
  'http://127.0.0.1:8082', 'http://localhost:8082',
  'http://127.0.0.1:8084', 'http://localhost:8084',
];

const decode = Schema.decodeUnknownSync(Schema.Struct({
  chromiumApp: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
  cdpPort: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65535)),
  profile: Schema.String.check(Schema.isPattern(/\S/)),
  practiceOrigin: Schema.String,
  setListURL: Schema.String,
}));

function spreadsheetURL(value: string, setting: string) {
  const url = new URL(value);
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})\/edit\/?$/.exec(url.pathname);
  const id = match?.[1];
  if (url.origin !== 'https://docs.google.com' || url.username || url.password || !id) {
    throw new Error(`${setting} must be a Google Sheets spreadsheet edit URL.`);
  }
  return { url: value, id };
}

export function chartSettings(env: NodeJS.ProcessEnv = process.env) {
  const settings = decode({
    ...(env.SHOW_TOOLS_CHROMIUM_APP ? { chromiumApp: env.SHOW_TOOLS_CHROMIUM_APP } : {}),
    cdpPort: Number(env.SHOW_TOOLS_CDP_PORT ?? '9222'),
    profile: env.SHOW_TOOLS_CDP_PROFILE ?? join(tmpdir(), 'show-tools-sheets-cdp'),
    practiceOrigin: env.SHOW_TOOLS_PRACTICE_ORIGIN ?? 'http://127.0.0.1:8082',
    setListURL: env.SHOW_TOOLS_SET_LIST_URL ?? 'https://docs.google.com/spreadsheets/d/1HZ6FipBtjaqPWAisDmjFY-Vvn_UtUfaH2gsNsY41USg/edit',
  });
  const setList = spreadsheetURL(settings.setListURL, 'SHOW_TOOLS_SET_LIST_URL');
  const copy = env.SHOW_TOOLS_SHEETS_COPY_URL === undefined ? undefined
    : spreadsheetURL(env.SHOW_TOOLS_SHEETS_COPY_URL, 'SHOW_TOOLS_SHEETS_COPY_URL');
  const origin = new URL(settings.practiceOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('SHOW_TOOLS_PRACTICE_ORIGIN must be an HTTP or HTTPS origin without a path.');
  }
  return { ...settings, setListURL: copy?.url ?? setList.url,
    spreadsheetRedirect: copy && { source: setList.id, target: copy.id },
    practiceOrigin: origin.origin, cdp: `http://127.0.0.1:${settings.cdpPort}` };
}
