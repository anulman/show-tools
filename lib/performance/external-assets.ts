import { Schema } from 'effect';

export const MAX_EXTERNAL_WAV_BYTES = 4 * 1024 * 1024;
const url = Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/));
export const ExternalSampleAssetSchema = Schema.Struct({
  uri: Schema.String.check(Schema.isMaxLength(Math.ceil(MAX_EXTERNAL_WAV_BYTES / 3) * 4 + 32)),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  license: Schema.Struct({ id: Schema.NonEmptyString, url, source: url, author: Schema.NonEmptyString,
    title: Schema.NonEmptyString, preparation: Schema.optionalKey(Schema.NonEmptyString) }),
});
export type ExternalSampleAsset = typeof ExternalSampleAssetSchema.Type;

export function decodeExternalSampleWav(asset: ExternalSampleAsset): Uint8Array<ArrayBuffer> {
  const match = /^data:audio\/wav;base64,([A-Za-z0-9+/]+={0,2})$/.exec(asset.uri);
  if (!match || match[1].length % 4 !== 0) throw new Error('External sample requires a portable WAV data URI');
  const encoded = match[1];
  if (encoded.length > Math.ceil(MAX_EXTERNAL_WAV_BYTES / 3) * 4) throw new Error('External WAV exceeds the preparation limit');
  const binary = atob(encoded);
  if (btoa(binary) !== encoded) throw new Error('External WAV base64 is not canonical');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < bytes.length; index++) bytes[index] = binary.charCodeAt(index);
  const text = (begin: number, end: number) => String.fromCharCode(...bytes.subarray(begin, end));
  if (bytes.length < 44 || bytes.length > MAX_EXTERNAL_WAV_BYTES || text(0, 4) !== 'RIFF' || text(8, 12) !== 'WAVE'
    || new DataView(bytes.buffer).getUint32(4, true) !== bytes.length - 8) throw new Error('Invalid external WAV container');
  return bytes;
}

export async function verifyExternalSampleAsset(asset: ExternalSampleAsset): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = decodeExternalSampleWav(asset);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== asset.sha256) throw new Error('External WAV SHA-256 mismatch');
  return bytes;
}

export async function prepareDeclaredExternalAssets(samples: readonly { slot: number; asset?: ExternalSampleAsset }[] = []) {
  return Promise.all(samples.flatMap(sample => sample.asset === undefined ? [] : [
    verifyExternalSampleAsset(sample.asset).then(bytes => ({ slot: sample.slot, bytes })),
  ]));
}
