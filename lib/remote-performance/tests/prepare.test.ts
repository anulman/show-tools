import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import song from '../../../songs/dance-yrself-clean.js';
import { compiledProgramBytes } from '../../performance/compiled-native.js';
import { encodeInitialProfiles } from '../commands.js';
import { prepareHost } from '../prepare.js';

test('rejects mismatched song and profiles before contacting the host', async () => {
  assert.ok(song.compiled);
  const packet = Buffer.from(compiledProgramBytes(song.compiled));
  const configurations = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: [] }));
  const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  const fields = { id: song.id, description: song.description, compiled: song.compiled, practice: song.practice,
    takeCount: song.compiled.takes.length, packetSha256: hash(packet), profilesSha256: hash(encodeInitialProfiles(configurations)) };
  const manifest = (value: typeof fields) => Buffer.from(JSON.stringify(value));
  const modified = Buffer.from(packet); modified[modified.length - 1] ^= 1;
  await assert.rejects(prepareHost('/nonexistent', manifest(fields), modified, configurations), /digest mismatch/);
  const differentProfiles = configurations.map(profile => profile.profile === 0 ? { ...profile, effects: [{ kind: 'slapback', delayMs: 100, feedback: .2, wet: .3 }] } : profile);
  await assert.rejects(prepareHost('/nonexistent', manifest(fields), packet, differentProfiles), /digest mismatch/);
  await assert.rejects(prepareHost('/nonexistent', manifest({ ...fields, takeCount: fields.takeCount + 1 }), packet, configurations), /manifest identity/);
});
