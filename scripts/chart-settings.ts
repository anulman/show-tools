import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Schema } from 'effect';

const decode = Schema.decodeUnknownSync(Schema.Struct({
  chromiumApp: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
  cdpPort: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65535)),
  profile: Schema.String.check(Schema.isPattern(/\S/)),
  practiceOrigin: Schema.String,
}));

export function chartSettings(env: NodeJS.ProcessEnv = process.env) {
  const settings = decode({
    ...(env.SHOW_TOOLS_CHROMIUM_APP === undefined ? {} : { chromiumApp: env.SHOW_TOOLS_CHROMIUM_APP }),
    cdpPort: Number(env.SHOW_TOOLS_CDP_PORT ?? '9222'),
    profile: env.SHOW_TOOLS_CDP_PROFILE ?? join(tmpdir(), 'show-tools-sheets-cdp'),
    practiceOrigin: env.SHOW_TOOLS_PRACTICE_ORIGIN ?? 'http://127.0.0.1:8082',
  });
  const origin = new URL(settings.practiceOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('SHOW_TOOLS_PRACTICE_ORIGIN must be an HTTP or HTTPS origin without a path.');
  }
  return { ...settings, practiceOrigin: origin.origin, cdp: `http://127.0.0.1:${settings.cdpPort}` };
}
