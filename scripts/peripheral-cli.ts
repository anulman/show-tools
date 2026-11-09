import { runPeripheralCli } from '../lib/peripherals/bridge-cli.js';

try { await runPeripheralCli(process.argv.slice(2)); }
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Peripheral command failed.'}\n`);
  process.exitCode = 1;
}
