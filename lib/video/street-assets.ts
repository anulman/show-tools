import { Schema } from 'effect';

export const StreetAsset = Schema.Struct({
  path: Schema.NonEmptyString,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
export type StreetAsset = typeof StreetAsset.Type;

export async function verifyStreetAsset(asset: StreetAsset, bytes: Uint8Array): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== asset.sha256) throw new Error(`Asset hash mismatch: ${asset.path}`);
}

export async function fetchStreetAsset(asset: StreetAsset, fetcher: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetcher(asset.path);
  if (!response.ok) throw new Error(`Cannot load Street asset ${asset.path}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await verifyStreetAsset(asset, bytes);
  return bytes;
}
