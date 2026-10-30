import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { audition, auditionFailure, AuditionError, decodeWave, encodeWave, parseArguments } from '../audition-patches.js';
import { parseCommandFailure } from '../lib/command-diagnostics.js';

function hash(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
function pcm16Stereo(rate: number) {
  const header = Buffer.alloc(44), pcm = Buffer.alloc(32 * 4);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  pcm.writeInt16LE(8192, 0); pcm.writeInt16LE(24576, 2);
  return Buffer.concat([header, pcm]);
}
function options(out: string, patch = 'tribulations-guitar', rate = '48000') {
  return parseArguments(['--source', 'synthetic', '--rate', rate, '--patch', patch, '--input-gain', '1', '--output-gain', '1', '--out', out]);
}
test('CLI requires explicit source, gains, supported patch and unambiguous options', () => {
  const base = ['--source', 'synthetic', '--rate', '48000', '--patch', 'tribulations-guitar', '--input-gain', '1', '--output-gain', '1', '--out', '/tmp/audition-placeholder'];
  for (const args of [[], [...base, '--patch', 'chorus'], base.filter((_, i) => i !== 8 && i !== 9), [...base, '--input', '/tmp/missing.wav'], base.map(x => x === '48000' ? '96000' : x), base.map(x => x === 'tribulations-guitar' ? 'unavailable-patch' : x)]) {
    assert.throws(() => parseArguments(args), error => error instanceof AuditionError && error.nextStep.length > 0);
  }
});
test('WAV decoder rejects corrupt, truncated, unsupported and nonfinite audio instead of substituting it', () => {
  const valid = pcm16Stereo(44100);
  const badSignature = Buffer.from(valid); badSignature[0] |= 0x80;
  const wrongAlign = Buffer.from(valid); wrongAlign.writeUInt16LE(8, 32);
  const unsupported = Buffer.from(valid); unsupported.writeUInt16LE(6, 20);
  const tooLong = Buffer.alloc(44 + 44100 * 31 * 4); valid.copy(tooLong, 0, 0, 44); tooLong.writeUInt32LE(tooLong.length - 8, 4); tooLong.writeUInt32LE(tooLong.length - 44, 40);
  const badFloat = Buffer.alloc(4); badFloat.writeFloatLE(NaN);
  for (const bytes of [Buffer.from('not audio'), badSignature, valid.subarray(0, valid.length - 1), wrongAlign, unsupported, tooLong, encodeWave(badFloat, 44100, 1)]) {
    assert.throws(() => decodeWave(bytes), error => error instanceof AuditionError && error.code === 'INVALID_WAV');
  }
  const decoded = decodeWave(valid);
  assert.equal(decoded.channels, 2); assert.equal(decoded.rate, 44100); assert.equal(decoded.frames, 32);
  assert.equal(decoded.pcm.readFloatLE(0), .25); assert.equal(decoded.pcm.readFloatLE(4), .75);
});
test('native synthetic auditions repeat byte-for-byte and publish exact labeled duplicate controls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audition-repeat-'));
  try {
    for (const rate of ['44100', '48000']) {
      const first = join(dir, `first-${rate}`), second = join(dir, `second-${rate}`);
      const manifest = audition(options(first, 'tribulations-guitar', rate));
      const repeated = audition(options(second, 'tribulations-guitar', rate));
      assert.deepEqual(manifest, repeated);
      for (const name of ['source.wav', 'A.wav', 'B.wav', 'C.wav', 'manifest.json']) assert.deepEqual(readFileSync(join(first, name)), readFileSync(join(second, name)));
      assert.deepEqual(readFileSync(join(first, 'B.wav')), readFileSync(join(first, 'C.wav')));
      assert.notDeepEqual(readFileSync(join(first, 'A.wav')), readFileSync(join(first, 'B.wav')));
      assert.equal(manifest.source.kind, 'synthetic'); assert.equal(manifest.source.sampleRate, Number(rate));
      assert.equal(manifest.gains.normalization, 'none'); assert.equal(manifest.release.frames, 4 * Number(rate));
      assert.deepEqual(manifest.clips.map(c => c.label), ['A', 'B', 'C']);
      for (const clip of manifest.clips) assert.equal(hash(readFileSync(join(first, clip.file))), clip.sha256);
      assert.throws(() => audition(options(first)), error => error instanceof AuditionError && error.code === 'OUTPUT_EXISTS');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('file audition keeps arithmetic mean and explicit gains, and uses the actual shared Slapback delay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audition-file-'));
  try {
    for (const rate of [44100, 48000]) {
      const input = join(dir, `source-${rate}.wav`), out = join(dir, `result-${rate}`);
      const bytes = pcm16Stereo(rate); writeFileSync(input, bytes);
      const manifest = audition(parseArguments(['--input', input, '--patch', 'slapback', '--input-gain', '.5', '--output-gain', '.5', '--out', out]));
      const source = decodeWave(readFileSync(join(out, 'source.wav'))), a = decodeWave(readFileSync(join(out, 'A.wav'))), b = decodeWave(readFileSync(join(out, 'B.wav')));
      assert.equal(source.pcm.readFloatLE(0), .5); assert.equal(a.pcm.readFloatLE(0), .125);
      assert.equal(b.pcm.readFloatLE(0), .125);
      assert.equal(b.pcm.readFloatLE((rate / 10) * 8), .03125);
      assert.equal(a.pcm.readFloatLE((rate / 10) * 8), 0);
      assert.equal(b.frames, 32 + rate / 10); assert.equal(manifest.source.frames, 32);
      assert.equal(manifest.source.kind, 'file'); assert.equal(manifest.source.channels, 2);
      assert.equal(manifest.source.downmix, 'arithmetic-channel-mean');
      assert.equal(manifest.source.kind === 'file' && manifest.source.sha256, hash(bytes));
      assert.deepEqual(readFileSync(input), bytes);
    }
    const chorus = audition(options(join(dir, 'chorus'), 'chorus'));
    assert.equal(chorus.patch.type, 'chorus'); assert(chorus.release.frames > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('input and render failures identify the cause and next step and leave no published audition', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audition-fail-'));
  try {
    const out = join(dir, 'result');
    assert.throws(() => audition(parseArguments(['--input', join(dir, 'missing.wav'), '--patch', 'slapback', '--input-gain', '1', '--output-gain', '1', '--out', out])), error => error instanceof AuditionError && error.code === 'INPUT_UNAVAILABLE' && /No synthetic/.test(error.nextStep));
    const overloaded = options(out); overloaded.outputGain = 16;
    assert.throws(() => audition(overloaded), error => error instanceof AuditionError && error.code === 'OUTPUT_OVERLOAD' && /full scale/.test(error.message) && /Lower/.test(error.nextStep));
    assert(!existsSync(out)); assert.deepEqual(readdirSync(dir), []);
    const script = fileURLToPath(new URL('../audition-patches.ts', import.meta.url));
    const missingCompiler = spawnSync(process.execPath, ['--import', 'tsx', script, '--source', 'synthetic', '--rate', '48000', '--patch', 'chorus', '--input-gain', '1', '--output-gain', '1', '--out', out], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    assert.equal(missingCompiler.status, 3); assert.match(missingCompiler.stderr, /Chief handoff required \[BUILD_FAILED\]/); assert.match(missingCompiler.stderr, /C\+\+17 toolchain/);
    assert(!existsSync(out)); assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('shared diagnostics distinguish operator blocks from Chief tool failures and JSON emits one object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audition-diagnostics-'));
  try {
    const script = fileURLToPath(new URL('../audition-patches.ts', import.meta.url));
    const args = ['--import', 'tsx', script, '--input', join(dir, 'missing.wav'), '--patch', 'slapback', '--input-gain', '1', '--output-gain', '1', '--out', join(dir, 'out'), '--json'];
    const product = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(product.status, 2); assert.equal(product.stderr, '');
    const failure = parseCommandFailure(JSON.parse(product.stdout));
    assert.equal(failure.status, 'blocked'); assert.equal(failure.code, 'INPUT_UNAVAILABLE');
    assert(failure.nextSteps.length > 0); assert.equal(product.stdout.trim().split('\n').length, 1);
    const compiler = spawnSync(process.execPath, ['--import', 'tsx', script, '--source', 'synthetic', '--rate', '48000', '--patch', 'chorus', '--input-gain', '1', '--output-gain', '1', '--out', join(dir, 'out'), '--json'], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    assert.equal(compiler.status, 3); assert.equal(compiler.stderr, '');
    assert.equal(parseCommandFailure(JSON.parse(compiler.stdout)).status, 'needs-chief');
    assert.equal(auditionFailure(new Error('Unexpected renderer protocol failure')).status, 'needs-chief');
    assert.equal(auditionFailure(new Error('')).status, 'needs-chief');
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('successful CLI JSON points to a complete published pack', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audition-cli-ready-'));
  try {
    const script = fileURLToPath(new URL('../audition-patches.ts', import.meta.url)), out = join(dir, 'pack');
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, '--source', 'synthetic', '--rate', '48000', '--patch', 'tribulations-guitar', '--input-gain', '1', '--output-gain', '1', '--out', out, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
    const ready: unknown = JSON.parse(result.stdout);
    assert(ready && typeof ready === 'object' && 'status' in ready && 'manifest' in ready);
    assert.equal(ready.status, 'ready');
    assert.deepEqual(ready.manifest, JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')));
    assert.equal(result.stdout.trim().split('\n').length, 1);
    assert.deepEqual(readdirSync(out).sort(), ['A.wav', 'B.wav', 'C.wav', 'manifest.json', 'provenance.json', 'source.wav']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
