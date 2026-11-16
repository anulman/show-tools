import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const domains = [
  {
    name: 'cues',
    purpose: 'Sheets cue grammar, compiler ingestion and canonical roundtrip',
    files: ['lib/performance/tests/sheet-cues.test.ts'],
    remaining: ['npm run verify:formal:cues', 'native/WASM execution for engine changes'],
  },
  {
    name: 'musicxml',
    purpose: 'Current canonical reader, writer, authoring and sheet projection',
    files: [
      'lib/performance/tests/musicxml-song.test.ts',
      'lib/performance/tests/musicxml-authoring.test.ts',
      'lib/performance/tests/sheet-musicxml.test.ts',
      'lib/performance/tests/musician-sheets.test.ts',
      'lib/performance/tests/musician-sheet-plan.test.ts',
    ],
    remaining: ['npm run verify:formal:musicxml', 'npm run verify:musicxml (frozen migration compatibility)'],
  },
  {
    name: 'commands',
    purpose: 'Command diagnostics and chart compile/inspect/encode boundaries',
    files: ['scripts/tests/command-diagnostics.test.ts', 'scripts/tests/chart-compiler.test.ts'],
    remaining: ['native/WASM execution for compiled packet changes'],
  },
];

const args = process.argv.slice(2);
const domain = domains.find(candidate => candidate.name === args[0]);
if (!domain || args.length > 2 || (args.length === 2 && args[1] !== '--list')) {
  console.error(`Usage: npm run check:focused -- <${domains.map(candidate => candidate.name).join('|')}> [--list]`);
  console.error('Select a domain explicitly. Shared or unknown changes require broader integration checks.');
  process.exitCode = 2;
} else {
  console.log(`Focused check: ${domain.name}. ${domain.purpose}.`);
  console.log('Prerequisites: npm ci. No WASM build or native fake host required.');
  for (const file of domain.files) console.log(`Selected: ${file}`);
  console.log(`Remaining integration: npm run typecheck; npm test (requires current WASM and native fake host); ${domain.remaining.join('; ')}.`);
  if (args[1] !== '--list') {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=4', ...domain.files], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: 'inherit',
    });
    if (result.error) console.error(result.error.message);
    process.exitCode = result.status ?? 1;
  }
}
