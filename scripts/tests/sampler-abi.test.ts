import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const generator = fileURLToPath(new URL('../generate-sampler-abi.ts', import.meta.url));
const header = fileURLToPath(new URL('../../lib/sampler/include/sample_engine.h', import.meta.url));

test('browser query constants match the authoritative C header', () => {
  const directory = mkdtempSync(join(tmpdir(), 'show-tools-abi-'));
  try {
    const output = join(directory, 'abi.ts');
    execFileSync(process.execPath, ['--import', 'tsx', generator, header, output]);
    assert.equal(readFileSync(output, 'utf8'), readFileSync(new URL('../../lib/sampler/wasm-abi.ts', import.meta.url), 'utf8'));
  } finally { rmSync(directory, { recursive: true }); }
});

test('ABI generation preserves explicit and implicit enum values and rejects expressions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'show-tools-abi-'));
  try {
    const input = join(directory, 'fixture.h'), output = join(directory, 'abi.mjs');
    writeFileSync(input, 'enum layout { ST_PRESENT, ST_FRAME = 0x10, ST_END, ST_NONE = -1 };');
    execFileSync(process.execPath, ['--import', 'tsx', generator, input, output]);
    const generated = await import(pathToFileURL(output).href);
    assert.deepEqual(generated.ST, { PRESENT: 0, FRAME: 16, END: 17, NONE: -1 });
    writeFileSync(input, 'enum layout { ST_FRAME = 1 << 4 };');
    assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', generator, input, output], { stdio: 'pipe' }), /Unsupported sampler enum value/);
  } finally { rmSync(directory, { recursive: true }); }
});
