import { createHash } from 'node:crypto';
import type { ExternalSampleAsset } from '../../external-assets.js';

export function externalWavFixture() {
  const bytes = Buffer.alloc(52);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(8, 40);
  for (let offset = 44; offset < bytes.length; offset += 2) bytes.writeInt16LE(8192, offset);
  const asset: ExternalSampleAsset = { uri: `data:audio/wav;base64,${bytes.toString('base64')}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', source: 'https://example.test/synthetic-fixture', author: 'Synthetic fixture', title: 'Constant synthetic PCM' } };
  return { bytes, asset };
}
