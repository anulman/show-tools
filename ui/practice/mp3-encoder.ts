import { createMp3Encoder } from 'wasm-media-encoders';

export type TakePCM = { sampleRate: number; channels: [Float32Array] | [Float32Array, Float32Array] };

export function isTakePCM(value: unknown): value is TakePCM {
  if (typeof value !== 'object' || value === null || !('sampleRate' in value) || !('channels' in value)) return false;
  const { sampleRate, channels } = value;
  return typeof sampleRate === 'number' && Number.isFinite(sampleRate) && sampleRate > 0
    && Array.isArray(channels) && (channels.length === 1 || channels.length === 2)
    && channels.every(channel => channel instanceof Float32Array && channel.length > 0
      && channel.length === channels[0].length);
}

export async function encodeMp3({ sampleRate, channels }: TakePCM): Promise<Blob> {
  const encoder = await createMp3Encoder();
  encoder.configure({ sampleRate, channels: channels.length, bitrate: 192 });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < channels[0].length; offset += 16384) {
    // The encoder owns its output buffer and reuses it on the next call.
    chunks.push(new Uint8Array(encoder.encode(channels.map(channel => channel.subarray(offset, offset + 16384)))));
  }
  chunks.push(new Uint8Array(encoder.finalize()));
  return new Blob(chunks, { type: 'audio/mpeg' });
}
