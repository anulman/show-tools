import { runSessionCli } from '../lib/remote-performance/session-cli.js';

try { await runSessionCli(process.argv.slice(2)); }
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Session command failed.'}\n`);
  process.exitCode = 1;
}
