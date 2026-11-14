import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { decodeExternalSampleWav, prepareDeclaredExternalAssets } from '../external-assets.js';
import { decodeCompiledSong } from '../compiled-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../musicxml-song.js';
import { compiledProgramBytes } from '../compiled-native.js';
import { encodeInitialProfiles } from '../../remote-performance/commands.js';
import { validateInstalledPackage } from '../../remote-performance/prepare.js';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import { terseCaptureInput, terseCaptureFixture } from './fixtures/terse-capture.js';
import { externalWavFixture } from './fixtures/external-asset.js';

function packageFixture(song: Awaited<ReturnType<typeof terseCaptureFixture>>) {
  const packet = Buffer.from(compiledProgramBytes(song));
  const configurations = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: [] }));
  const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  const manifest = Buffer.from(JSON.stringify({ id: song.id, description: 'External asset fixture', compiled: song,
    practice: { startBar: 1, endBar: song.chart.bars.length }, takeCount: song.takes.length,
    packetSha256: hash(packet), profilesSha256: hash(encodeInitialProfiles(configurations)) }));
  return { manifest, packet, configurations };
}

test('standalone canonical XML retains verified WAV bytes and full license provenance', async () => {
  const fixture = externalWavFixture();
  const imported = await importSheetMusicXml(terseCaptureInput());
  const document = await readMusicXmlSong(imported.xml);
  const song = { ...document.song, externalSamples: [{ slot: 0, voiceId: 'tambourine', begin: { bar: 2, beat: 0 }, end: { bar: 4, beat: 0 }, asset: fixture.asset }] };
  const xml = await writeMusicXmlSong({ song, report: document.report });
  const restored = await readMusicXmlSong(xml);
  assert.equal(restored.source, null, 'the asset does not depend on an import archive');
  assert.deepEqual(restored.song.externalSamples, song.externalSamples);
  const prepared = await prepareDeclaredExternalAssets(restored.song.externalSamples);
  assert.deepEqual(Buffer.from(prepared[0].bytes), fixture.bytes);
  const packaged = packageFixture(restored.song);
  const installed = validateInstalledPackage(packaged.manifest, packaged.packet, packaged.configurations);
  assert.equal(installed.assets.length, 1);
  assert.equal(installed.assets[0].readUInt16LE(), 15);
  assert.equal(installed.assets[0].readUInt32LE(2), 0);
  assert.deepEqual(installed.assets[0].subarray(10), fixture.bytes);
});

test('asset hash, URI, container and native manifest limits fail before preparation', async () => {
  const { asset } = externalWavFixture();
  await assert.rejects(prepareDeclaredExternalAssets([{ slot: 0, asset: { ...asset, sha256: '0'.repeat(64) } }]), /SHA-256/);
  assert.throws(() => decodeExternalSampleWav({ ...asset, uri: 'https://example.test/sound.wav' }), /portable WAV/);
  assert.throws(() => decodeExternalSampleWav({ ...asset, uri: 'data:audio/wav;base64,AAAA' }), /container/);
  const song = await terseCaptureFixture();
  const externalSamples = [{ slot: 0, voiceId: 'tambourine', begin: { bar: 2, beat: 0 }, end: { bar: 4, beat: 0 }, asset: { ...asset, sha256: '0'.repeat(64) } }];
  const prepared = packageFixture(decodeCompiledSong({ ...song, externalSamples }));
  assert.throws(() => validateInstalledPackage(prepared.manifest, prepared.packet, prepared.configurations), /SHA-256/);
  assert.throws(() => validateInstalledPackage(Buffer.alloc(1024 * 1024 + 1), prepared.packet, prepared.configurations), /1 MiB/);
  assert.throws(() => decodeCompiledSong({ ...song, externalSamples, noteBanks: [{ buttonId: 'R2', toleranceMs: 25, notes: [{ slot: 0, at: { bar: 2, beat: 0 } }] }] }), /cannot own the same slot/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function createHarness(resolveAssets: () => Promise<{ slot: number; bytes: Uint8Array }[]>, afterAsset?: () => void) {
  const source = await sourceForVM(new URL('../../../ui/practice/audio.ts', import.meta.url));
  const method = source.slice(source.indexOf('static async create('), source.indexOf('\n  constructor(')).replace('static async create(', 'async function create(');
  const created: { operations: { command: string; payload: unknown }[]; disposed: boolean }[] = [];
  const instances: Audio[] = [];
  class Audio {
    disposed = false;
    peripheralReady = Promise.resolve();
    constructor(readonly options: { endpoint: Endpoint }) { instances.push(this); }
    attachPeripheral() { this.options.endpoint.operations.push({ command: 'attach-peripheral', payload: undefined }); }
    async dispose() { this.disposed = true; }
  }
  class Endpoint {
    operations: { command: string; payload: unknown }[] = [];
    constructor() { created.push({ operations: this.operations, disposed: false }); }
    async request(command: string, payload?: unknown) { this.operations.push({ command, payload }); if (command === 'practice.external-wav') afterAsset?.(); }
  }
  const context = vm.createContext({ prepareDeclaredExternalAssets: resolveAssets, PracticeAudio: Audio, AudioEndpoint: Endpoint,
    BeatTracker: { async create() { return { node: { port: { postMessage() {} } }, async dispose() {} }; } },
    MessageChannel: class { port1 = {}; port2 = {}; }, URL, document: { baseURI: 'https://example.test/' },
    crypto: { randomUUID: () => 'fixture' }, encodeCompiledProgram: () => [], });
  vm.runInContext(`${method}\nglobalThis.create = create;`, context);
  return { created, instances, create: (options: object) => vm.runInContext('create', context)(options) };
}

test('deferred asset verification cancellation creates no engine and overlapping documents keep their own preparation owner', async () => {
  const first = deferred<{ slot: number; bytes: Uint8Array }[]>();
  let calls = 0;
  const harness = await createHarness(() => ++calls === 1 ? first.promise : Promise.resolve([{ slot: 0, bytes: new Uint8Array([2]) }]));
  const chart = { bars: [{ column: 1 }], bpm: 120, beatsPerBar: 4 };
  const abort = new AbortController();
  const canceled = harness.create({ chart, signal: abort.signal });
  abort.abort(new Error('Song replaced'));
  const current = await harness.create({ chart });
  first.resolve([{ slot: 0, bytes: new Uint8Array([1]) }]);
  await assert.rejects(canceled, /Song replaced/);
  assert.equal(harness.created.length, 1);
  assert.deepEqual(harness.created[0].operations.map(operation => operation.command), ['state', 'practice.external-wav', 'attach-peripheral']);
  const operation = harness.created[0].operations[1].payload;
  assert.equal(JSON.stringify(operation), JSON.stringify({ slot: 0, bytes: new Uint8Array([2]) }), 'old document bytes never reach the current engine');
  await current.dispose();
});

test('asset preparation waits for stopped host acknowledgments before completing the package', async () => {
  const { once } = await import('node:events');
  const { createServer } = await import('node:net');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { encodeFrame, FrameDecoder } = await import('../../remote-performance/framing.js');
  const { prepareInstalledPackage } = await import('../../remote-performance/prepare.js');
  const { PF } = await import('../wasm-abi.js');
  const { asset, bytes } = externalWavFixture();
  const base = await terseCaptureFixture();
  const packaged = packageFixture({ ...base, externalSamples: [{ slot: 0, voiceId: 'tambourine', begin: { bar: 2, beat: 0 }, end: { bar: 4, beat: 0 }, asset }] });
  const installed = validateInstalledPackage(packaged.manifest, packaged.packet, packaged.configurations);
  const directory = await mkdtemp(join(tmpdir(), 'external-package-'));
  const path = join(directory, 'host.sock');
  const operations: number[] = [];
  const received = deferred<void>();
  const release = deferred<void>();
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    const hello = Buffer.alloc(40); hello.writeUInt32LE(PF.ABI_VERSION, 32); hello.writeUInt32LE(PF.COMPILED_VERSION, 36);
    socket.write(encodeFrame({ tag: 1, sequence: 0, payload: hello }));
    const decoder = new FrameDecoder();
    socket.on('data', data => {
      for (const frame of decoder.push(Buffer.from(data))) {
        if (frame.tag === 2) socket.write(encodeFrame({ tag: 5, sequence: 0, payload: Buffer.alloc(0) }));
        if (frame.tag !== 3) continue;
        const opcode = frame.payload.readUInt16LE(32); operations.push(opcode);
        const acknowledge = () => socket.write(encodeFrame({ tag: 4, sequence: frame.sequence, payload: Buffer.alloc(16) }));
        if (opcode === 15) {
          assert.equal(frame.payload.readUInt32LE(34), 0); assert.equal(frame.payload.readUInt32LE(38), bytes.length);
          assert.deepEqual(frame.payload.subarray(42), bytes);
          received.resolve(); void release.promise.then(acknowledge);
        } else acknowledge();
      }
    });
  });
  try {
    server.listen(path); await once(server, 'listening');
    let ready = false;
    const preparing = prepareInstalledPackage(path, installed).then(() => { ready = true; });
    await received.promise; assert.equal(ready, false, 'Ready waits for the asset preparation acknowledgment');
    assert.deepEqual(operations, [9, 15]); release.resolve(); await preparing; assert.equal(ready, true);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});


test('disposing an owned engine during asset acknowledgment never attaches its controller', async () => {
  let dispose: () => void = () => {};
  const harness = await createHarness(async () => [{ slot: 0, bytes: new Uint8Array([1]) }], () => dispose());
  dispose = () => { void harness.instances[0].dispose(); };
  await assert.rejects(harness.create({ chart: { bars: [{ column: 1 }], bpm: 120, beatsPerBar: 4 } }), /preparation was disposed/);
  assert.deepEqual(harness.created[0].operations.map(operation => operation.command), ['state', 'practice.external-wav']);
});
