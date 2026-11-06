import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import song from '../../../songs/dance-yrself-clean.js';
import { compiledProgramBytes } from '../../performance/compiled-native.js';
import { encodeInitialProfiles } from '../commands.js';
import { validateInstalledPackage } from '../prepare.js';
import { decodeSessionProfile } from '../session-profile.js';
import { NativeTargetSchema, DeskViewSchema, type DeskController } from '../session-schema.js';
import { Schema } from 'effect';

export function installedPackage() {
  if (!song.compiled) throw new Error('Missing compiled song');
  const packet = Buffer.from(compiledProgramBytes(song.compiled));
  const configurations = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: [] }));
  const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  const manifest = Buffer.from(JSON.stringify({ id: song.id, description: song.description, compiled: song.compiled, practice: song.practice,
    takeCount: song.compiled.takes.length, packetSha256: hash(packet), profilesSha256: hash(encodeInitialProfiles(configurations)) }));
  return { manifest, packet, configurations, installed: validateInstalledPackage(manifest, packet, configurations) };
}
export function sessionProfile(directory: string) {
  return decodeSessionProfile({ schemaVersion: 1, serviceName: 'show-tools-test.service', host: '127.0.0.1', port: 9999,
    origin: 'http://127.0.0.1:9999', tokenFile: `${directory}/token`, staticRoot: `${directory}/static`, runtimeRoot: `${directory}/runtime`,
    server: { nodeExecutable: process.execPath, entrypoint: resolve('lib/remote-performance/server.ts') },
    native: { executable: resolve(process.env.NATIVE_FAKE_HOST ?? 'build/native-host/native_fake_host'), sampleRate: 8000, blockFrames: 127, maxVoices: 32, maxSeconds: 30, driver: { kind: 'fake', inputLevel: .25 } },
    package: { manifest: `${directory}/manifest`, packet: `${directory}/packet`, effects: `${directory}/effects` } });
}
export const target = Schema.decodeUnknownSync(NativeTargetSchema)({ attempt: 'test-attempt', hostEpoch: 'test-native' });
export function deskFixture(overrides: Partial<DeskController> = {}): DeskController {
  const view = Schema.decodeUnknownSync(DeskViewSchema)({ serverEpoch: 'test-server', revision: '0', song: installedPackage().installed.song, audio: { kind: 'off' } });
  return { snapshot: () => view, command: async () => ({ outcome: 'unknown' }), subscribe: () => () => {},
    setAudio: () => ({ outcome: 'accepted', view }), close: async () => {}, ...overrides };
}
export async function until<T>(read: () => T | undefined, message = 'condition timed out'): Promise<T> {
  for (let count = 0; count < 800; count++) { const value = read(); if (value !== undefined) return value; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(message);
}
