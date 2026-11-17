import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compiledCaptureFixture } from '../../performance/tests/fixtures/compiled-capture.js';
import { voiceSampleArchive } from '../../../ui/practice/sample-downloads.js';
import { unzipSync } from 'fflate';
import { decodeTakeAudio } from '../../performance/take-audio.js';
import { PersistentDesk } from '../controller.js';
import { createGateway } from '../gateway.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';

for (const rate of [8000, 48000]) test(`authenticated full sample exports survive telemetry at ${rate} Hz and fence changed captures`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'take-audio-'));
  const compiled = await compiledCaptureFixture();
  const profile = sessionProfile(directory);
  const controller = new PersistentDesk({ ...profile, native: { ...profile.native, sampleRate: rate } }, installedPackage(compiled).installed);
  const origin = 'http://127.0.0.1', key = '012345678901234567890123456789ab';
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(key), staticRoot: directory }, controller);
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/take-audio`;
    controller.setAudio('on');
    const ready = () => { const audio = controller.snapshot().audio; return audio.kind === 'ready' ? audio : undefined; };
    const audio = await until(ready);
    const target = { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch };
    assert.equal((await controller.command(target, { command: 'start', args: { bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false } })).outcome, 'applied');
    assert.equal((await controller.command(target, { command: 'control', args: { control: { id: 'R1' }, commandId: 'record' } })).outcome, 'applied');
    await until(() => ready()?.performance.state.bar === 1 ? true : undefined);
    await controller.command(target, { command: 'control', args: { control: { id: 'R1' } } });
    await until(() => ready()?.performance.state.compiledTakes?.[0]?.ready ? true : undefined, () => JSON.stringify(ready()?.performance.state));
    assert.equal((await controller.command(target, { command: 'stop', args: {} })).outcome, 'applied');
    const stopped = ready(); assert(stopped);
    const request = { target, take: 0, offset: 0, frames: 64, token: stopped.performance.state.runId };
    const headers = { authorization: `Bearer ${key}`, origin, 'content-type': 'application/json' };
    const post = (body: object, useHeaders = headers) => fetch(url, { method: 'POST', headers: useHeaders, body: JSON.stringify(body) });
    assert.equal((await post(request, { ...headers, authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await post({ ...request, frames: 4097 })).status, 400);
    assert.equal((await post({ ...request, target: { ...target, hostEpoch: 'stale' } })).status, 409);
    const response = await post(request); assert.equal(response.status, 200);
    const chunk = decodeTakeAudio(new Uint8Array(await response.arrayBuffer()));
    assert.equal(chunk.sampleRate, rate); assert.equal(chunk.frames, 64);
    const pcm = new DataView(chunk.pcm.buffer, chunk.pcm.byteOffset, chunk.pcm.byteLength);
    for (let index = 0; index < 128; ++index) assert.equal(pcm.getFloat32(index * 4, true), .25);
    assert.equal(ready()?.performance.state.runId, stopped.performance.state.runId, 'read preserves capture identity');
    assert.equal((await post({ ...request, offset: chunk.totalFrames })).status, 409);
    await controller.command(target, { command: 'setClick', args: { enabled: false } });
    assert.equal((await post(request)).status, 200, 'non-capture commands preserve committed source PCM');
    let chunks = 0, afterEffectRevision = '';
    const archive = unzipSync(await voiceSampleArchive(compiled, 'drums', stopped.performance.state, {
      takeAudioToken: () => { const current = ready(); assert(current); return current.performance.state.runId; },
      takeAudio: async chunkRequest => {
        ++chunks;
        if (chunks === 2) await until(() => {
          const current = ready();
          return current && current.performance.revision !== afterEffectRevision ? true : undefined;
        });
        const response = await post({ target, ...chunkRequest }); assert.equal(response.status, 200);
        if (chunks === 1) {
          const current = ready(); assert(current);
          const profile = compiled.parts.find(part => part.id === 'drums')?.profile; assert.notEqual(profile, undefined);
          const expectedRevision = current.performance.state.voiceEffects?.find(voice => voice.profile === profile)?.revision;
          const edited = await controller.command(target, { command: 'configureVoiceProfile', args: { profile, expectedRevision,
            effects: [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .5 }] } });
          assert.equal(edited.outcome, 'applied', 'stopped effect edit preserves committed printed PCM');
          afterEffectRevision = ready()?.performance.revision ?? '';
        }
        return new Uint8Array(await response.arrayBuffer());
      },
    }));
    assert(chunks >= 4, 'actual HTTP ZIP export crosses multiple telemetry refreshes');
    assert(afterEffectRevision);
    assert.notEqual(ready()?.performance.revision, afterEffectRevision, 'telemetry refreshed after the last command during export');
    const wav = Object.entries(archive).find(([name]) => name.endsWith('.wav'))?.[1]; assert(wav);
    assert.equal(wav.length, 58 + chunk.totalFrames * 8);
    const samples = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    for (let offset = 58; offset < wav.length; offset += 4) assert.equal(samples.getFloat32(offset, true), .25);
    const current = ready(); assert(current);
    await controller.command(target, { command: 'start', args: { bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false } });
    const running = ready(); assert(running);
    assert.equal((await post({ ...request, token: running.performance.state.runId })).status, 409, 'running capture cannot be read');
    await controller.command(target, { command: 'stop', args: {} });
    assert.equal((await post(request)).status, 409, 'a new run invalidates the prior committed-source identity');
    controller.setAudio('off'); await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined);
    controller.setAudio('on'); const replaced = await until(ready);
    assert.notEqual(replaced.attempt, target.attempt);
    assert(replaced.performance.state.compiledTakes?.every(take => !take.ready), 'package preparation creates empty capture banks');
    assert.equal((await post(request)).status, 409, 'package replacement fences the prior native target');
  } finally {
    await controller.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
