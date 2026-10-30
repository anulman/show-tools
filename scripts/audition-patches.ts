import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { endianness } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chiefHandoff, commandFailureExitCode, formatCommandFailure, productFailure } from './lib/command-diagnostics.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const maxSeconds = 30;
export class AuditionError extends Error {
  constructor(readonly code: string, cause: string, readonly nextStep: string, readonly status: 'blocked' | 'needs-chief' = 'blocked') { super(cause); }
}
function fail(code: string, cause: string, nextStep: string, status: 'blocked' | 'needs-chief' = 'blocked'): never { throw new AuditionError(code, cause, nextStep, status); }
type Patch = 'tribulations-guitar' | 'slapback' | 'chorus';
type Rate = 44100 | 48000;
type Source = { kind: 'synthetic'; rate: Rate } | { kind: 'file'; path: string };
export interface AuditionOptions { source: Source; patch: Patch; inputGain: number; outputGain: number; out: string }
const help = `Usage: node --import tsx scripts/audition-patches.ts
  --source synthetic --rate 44100|48000 | --input INPUT.wav
  --patch tribulations-guitar|slapback|chorus
  --input-gain NUMBER --output-gain NUMBER --out NEW_DIRECTORY [--json]

Produces source.wav, A.wav (dry), B.wav (patch), C.wav (exact B duplicate), and manifest.json.
Input WAV: mono/stereo PCM16 or float32, 44.1/48 kHz, nonempty, at most 30 seconds.
Gains are linear and required, within 0–16. No loudness matching, limiter, resampling, or playback.
`;
function gain(value: string | undefined, name: string): number {
  const parsed = value === undefined || value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 16)
    fail('INVALID_GAIN', `${name} must be an explicit finite linear gain from 0 through 16.`, `Set --${name} 1 for unity, or choose a lower gain for headroom.`);
  return parsed;
}
export function parseArguments(args: readonly string[]): AuditionOptions {
  const values = new Map<string, string>();
  const allowed = new Set(['--source', '--input', '--rate', '--patch', '--input-gain', '--output-gain', '--out']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!allowed.has(key) || values.has(key) || value === undefined || value.startsWith('--'))
      fail('INVALID_ARGUMENTS', `Unknown, repeated, or incomplete option: ${key}`, 'Run with --help and supply each option once.');
    values.set(key, value);
  }
  const selected = values.get('--patch');
  if (selected !== 'tribulations-guitar' && selected !== 'slapback' && selected !== 'chorus')
    fail('UNKNOWN_PATCH', 'Choose an existing canonical patch.', 'Set --patch tribulations-guitar, slapback, or chorus.');
  let source: Source;
  const input = values.get('--input');
  if (input !== undefined && input.length > 0 && !values.has('--source') && !values.has('--rate')) source = { kind: 'file', path: resolve(input) };
  else if (values.get('--source') === 'synthetic' && !values.has('--input')) {
    const rate = Number(values.get('--rate'));
    if (rate !== 44100 && rate !== 48000) fail('INVALID_RATE', 'Synthetic source needs an explicit supported rate.', 'Set --rate 44100 or --rate 48000.');
    source = { kind: 'synthetic', rate };
  } else fail('INVALID_SOURCE', 'Choose exactly one source. File input retains its own rate.', 'Supply --source synthetic --rate 48000, or --input INPUT.wav without --rate.');
  const out = values.get('--out');
  if (!out?.trim()) fail('MISSING_OUTPUT', 'No output directory was selected.', 'Supply --out with a new directory path.');
  return { source, patch: selected, inputGain: gain(values.get('--input-gain'), 'input-gain'), outputGain: gain(values.get('--output-gain'), 'output-gain'), out: resolve(out) };
}
function invalidWave(cause: string): never {
  fail('INVALID_WAV', cause, 'Export a nonempty mono/stereo PCM16 or float32 RIFF WAV at 44100 or 48000 Hz, at most 30 seconds. No file was substituted.');
}
export function decodeWave(bytes: Buffer) {
  if (bytes.length < 12 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) invalidWave('The input is not a complete standard RIFF WAV.');
  let format: { encoding: number; channels: 1 | 2; rate: Rate; bits: number; align: number } | undefined;
  let data: Buffer | undefined;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) invalidWave('Truncated WAV chunk header.');
    const kind = bytes.toString('latin1', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    const end = start + size, next = end + (size % 2);
    if (next > bytes.length) invalidWave('Truncated WAV chunk data or alignment padding.');
    if (kind === 'fmt ') {
      if (format || size < 16) invalidWave('The WAV format chunk is missing fields or repeated.');
      const encoding = bytes.readUInt16LE(start), channels = bytes.readUInt16LE(start + 2), rate = bytes.readUInt32LE(start + 4);
      const align = bytes.readUInt16LE(start + 12), bits = bytes.readUInt16LE(start + 14);
      if ((channels !== 1 && channels !== 2) || (rate !== 44100 && rate !== 48000)
        || !((encoding === 1 && bits === 16) || (encoding === 3 && bits === 32))) invalidWave('Unsupported WAV encoding, channel count, or sample rate.');
      if (align !== channels * bits / 8 || bytes.readUInt32LE(start + 8) !== rate * align) invalidWave('WAV frame alignment or byte rate is inconsistent.');
      format = { encoding, channels, rate, bits, align };
    } else if (kind === 'data') {
      if (data) invalidWave('Multiple WAV data chunks are not supported.');
      data = bytes.subarray(start, end);
    }
    offset = next;
  }
  if (!format || !data || data.length === 0 || data.length % format.align !== 0) invalidWave('WAV must contain one format and nonempty complete data frames.');
  const frames = data.length / format.align;
  if (frames > format.rate * maxSeconds) invalidWave('Input exceeds the thirty-second audition limit.');
  const pcm = Buffer.alloc(frames * format.channels * 4);
  for (let i = 0; i < frames * format.channels; ++i) {
    const value = format.encoding === 1 ? data.readInt16LE(i * 2) / 32768 : data.readFloatLE(i * 4);
    if (!Number.isFinite(value) || Math.abs(value) > 1) invalidWave('Input contains nonfinite or out-of-range PCM. Samples must be within [-1, 1].');
    pcm.writeFloatLE(value, i * 4);
  }
  return { pcm, rate: format.rate, channels: format.channels, frames, encoding: format.encoding === 1 ? 'pcm16' : 'float32' };
}
export function encodeWave(pcm: Buffer, rate: Rate, channels: 1 | 2): Buffer {
  if (pcm.length % (channels * 4) !== 0) throw new Error('Renderer produced incomplete PCM frames.');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * 4, 28); header.writeUInt16LE(channels * 4, 32);
  header.writeUInt16LE(32, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
function sha(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function run(command: string, args: readonly string[], phase: string): string {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr.trim() ?? `Exit ${result.status}`;
    if (phase === 'render' && detail.includes('Rendered peak exceeds full scale.'))
      fail('OUTPUT_OVERLOAD', detail, 'Lower --input-gain or --output-gain and rerun into a new output directory. No limiter or normalization was applied.');
    fail(phase === 'render' ? 'RENDER_FAILED' : 'BUILD_FAILED', `${phase} failed: ${detail || `exit ${result.status}`}`,
      'The Chief must repair the renderer or its C++17 toolchain, then rerun this command. Keep the audition blocked until that check passes.', 'needs-chief');
  }
  return result.stdout.trim();
}
function summarize(pcm: Buffer) {
  let peak = 0, squared = 0;
  if (pcm.length === 0 || pcm.length % 4 !== 0) fail('INVALID_RENDER', 'Renderer output is empty or truncated.', 'The Chief must repair the renderer and rerun; no audition was published.', 'needs-chief');
  for (let i = 0; i < pcm.length; i += 4) {
    const value = pcm.readFloatLE(i);
    if (!Number.isFinite(value) || Math.abs(value) > 1) fail('INVALID_RENDER', 'Renderer output is nonfinite or above full scale.', 'The Chief must repair output validation and rerun; no audition was published.', 'needs-chief');
    peak = Math.max(peak, Math.abs(value)); squared += value * value;
  }
  return { peak, rms: Math.sqrt(squared / (pcm.length / 4)) };
}
export function audition(options: AuditionOptions) {
  if (endianness() !== 'LE') fail('UNSUPPORTED_HOST', 'The native PCM adapter requires a little-endian host.', 'The Chief must select a supported little-endian render host. No byte-order fallback was applied.', 'needs-chief');
  if (existsSync(options.out)) fail('OUTPUT_EXISTS', 'The output path already exists. Existing auditions are not overwritten.', 'Choose a new --out directory, or explicitly remove an obsolete audition before rerunning.');
  let decoded: ReturnType<typeof decodeWave> | undefined;
  let sourceIdentity: { kind: 'synthetic'; generator: string } | { kind: 'file'; sha256: string };
  if (options.source.kind === 'file') {
    let bytes: Buffer;
    try {
      if (statSync(options.source.path).size > 16 * 1024 * 1024) invalidWave('Input file exceeds the sixteen-megabyte audition limit.');
      bytes = readFileSync(options.source.path);
    } catch (error) {
      if (error instanceof AuditionError) throw error;
      fail('INPUT_UNAVAILABLE', `Cannot read the explicitly selected source: ${error instanceof Error ? error.message : String(error)}`, 'Check --input, file permissions, and whether the file is locally available. No synthetic source was substituted.');
    }
    decoded = decodeWave(bytes);
    sourceIdentity = { kind: 'file', sha256: sha(bytes) };
  } else sourceIdentity = { kind: 'synthetic', generator: 'harmonic-voice-v1' };
  const rate = options.source.kind === 'synthetic' ? options.source.rate : decoded?.rate;
  if (rate === undefined) throw new Error('File source must be decoded before rendering.');
  mkdirSync(dirname(options.out), { recursive: true });
  const staging = mkdtempSync(join(dirname(options.out), '.audition-'));
  try {
    const build = join(staging, 'build'); mkdirSync(build);
    const sourceDirectory = join(root, 'lib/patches/src');
    const sources = readdirSync(sourceDirectory).filter(name => name.endsWith('.cpp')).sort().map(name => join(sourceDirectory, name));
    const helper = join(root, 'lib/patches/tools/audition.cpp');
    const includes = join(root, 'lib/patches/include');
    const headers = [...readdirSync(includes).filter(name => name.endsWith('.h')).map(name => join(includes, name)),
      ...readdirSync(sourceDirectory).filter(name => name.endsWith('.h')).map(name => join(sourceDirectory, name))].sort();
    const sourceHash = createHash('sha256');
    for (const path of [helper, ...sources, ...headers]) sourceHash.update(path.slice(root.length)).update('\0').update(readFileSync(path)).update('\0');
    const flags = ['-O2', '-std=c++17', '-fno-exceptions', '-ffp-contract=off'];
    const compiler = run('c++', ['--version'], 'compiler inspection');
    const renderer = join(build, 'render');
    run('c++', [...flags, '-I', includes, ...sources, helper, '-o', renderer], 'compile');
    const source = join(build, 'source.f32'), dry = join(build, 'dry.f32'), processed = join(build, 'processed.f32');
    const input = decoded ? join(build, 'input.f32') : 'synthetic';
    if (decoded) writeFileSync(input, decoded.pcm);
    run(renderer, [input, String(decoded?.channels ?? 1), String(rate), String(options.inputGain), String(options.outputGain), options.patch, source, dry, processed], 'render');
    const mono = readFileSync(source), a = readFileSync(dry), b = readFileSync(processed);
    if (a.length !== b.length || a.length % 8 !== 0 || mono.length % 4 !== 0)
      fail('INVALID_RENDER', 'Renderer frame counts disagree.', 'The Chief must repair the renderer protocol and rerun; no audition was published.', 'needs-chief');
    const sourceStats = summarize(mono), dryStats = summarize(a), wetStats = summarize(b);
    const sourceFrames = mono.length / 4, frames = a.length / 8;
    if (sourceFrames === 0 || sourceFrames > rate * maxSeconds || frames < sourceFrames || frames > sourceFrames + rate * 12)
      fail('INVALID_RENDER', 'Renderer frame counts exceed the declared source or tail bounds.', 'The Chief must repair the renderer protocol and rerun; no audition was published.', 'needs-chief');
    const rendered = [
      { label: 'A', role: 'dry', pcm: a, stats: dryStats },
      { label: 'B', role: 'processed', pcm: b, stats: wetStats },
      { label: 'C', role: 'duplicate-of-B', pcm: b, stats: wetStats },
    ];
    const wavSource = encodeWave(mono, rate, 1); writeFileSync(join(staging, 'source.wav'), wavSource);
    const clips = rendered.map(clip => {
      const file = `${clip.label}.wav`, bytes = encodeWave(clip.pcm, rate, 2);
      writeFileSync(join(staging, file), bytes);
      return { label: clip.label, role: clip.role, file, frames, channels: 2, sha256: sha(bytes), pcmSha256: sha(clip.pcm), ...clip.stats };
    });
    const manifest = {
      schema: 1, tool: 'show-tools-patch-audition', source: { ...sourceIdentity, sampleRate: rate, channels: decoded?.channels ?? 1,
        encoding: decoded?.encoding ?? 'synthetic-float32', frames: sourceFrames, downmix: 'arithmetic-channel-mean',
        monoFile: 'source.wav', monoSha256: sha(wavSource), ...sourceStats },
      patch: { type: options.patch, parameters: 'canonical-factory-defaults' },
      gains: { input: options.inputGain, output: options.outputGain, units: 'linear', normalization: 'none', limiter: 'none' },
      renderer: { sourceSha256: sourceHash.digest('hex'), toolSha256: sha(readFileSync(fileURLToPath(import.meta.url))), flags },
      release: { frames: frames - sourceFrames, mode: 'zero-source-through-shared-effect-tail-bound' },
      labels: 'A=dry; B=processed; C=exact duplicate of B', clips,
    };
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(join(staging, 'provenance.json'), JSON.stringify({ compiler, node: process.versions.node, platform: process.platform, arch: process.arch,
      inputName: options.source.kind === 'file' ? basename(options.source.path) : null }, null, 2) + '\n');
    rmSync(build, { recursive: true });
    renameSync(staging, options.out);
    return manifest;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
export function auditionFailure(error: unknown) {
  if (error instanceof AuditionError) {
    const details = { code: error.code, message: error.message, nextSteps: [error.nextStep] satisfies [string], locations: ['scripts/audition-patches.ts'] };
    return error.status === 'blocked' ? productFailure(details) : chiefHandoff(details);
  }
  const message = (error instanceof Error ? error.message : String(error)).trim() || 'Unexpected audition tool failure.';
  return chiefHandoff({ code: 'AUDITION_TOOL_FAILED', message,
    nextSteps: ['The Chief must inspect and repair the audition tool, then rerun. Do not publish a fallback or waive validation.'], locations: ['scripts/audition-patches.ts'] });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = process.argv.slice(2), json = raw.includes('--json');
  try {
    if (raw.filter(arg => arg === '--json').length > 1) fail('INVALID_ARGUMENTS', '--json was supplied more than once.', 'Supply --json at most once.');
    const args = raw.filter(arg => arg !== '--json');
    if (args.length === 1 && args[0] === '--help') process.stdout.write(help);
    else {
      const options = parseArguments(args), manifest = audition(options);
      process.stdout.write(json ? JSON.stringify({ schemaVersion: 1, status: 'ready', directory: options.out, manifest }) + '\n'
        : `Audition ready: ${options.out}\nA: dry · B: ${options.patch} · C: exact B duplicate\n`);
    }
  } catch (error) {
    const failure = auditionFailure(error);
    if (json) process.stdout.write(formatCommandFailure(failure, 'json'));
    else process.stderr.write(formatCommandFailure(failure, 'human'));
    process.exitCode = commandFailureExitCode(failure);
  }
}
