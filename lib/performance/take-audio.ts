export const TAKE_AUDIO_CHUNK_FRAMES = 4096;
export type TakeAudioRequest = { take: number; offset: number; frames: number; token: string };

export function decodeTakeAudio(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) throw new Error('Invalid sample audio response');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = data.getUint32(0, true), totalFrames = data.getUint32(4, true), frames = data.getUint32(8, true);
  if (sampleRate < 8000 || sampleRate > 384000 || !totalFrames || !frames || frames > TAKE_AUDIO_CHUNK_FRAMES || frames > totalFrames || bytes.byteLength !== 12 + frames * 8)
    throw new Error('Invalid sample audio dimensions');
  for (let i = 12; i < bytes.length; i += 4) if (!Number.isFinite(data.getFloat32(i, true))) throw new Error('Sample audio contains nonfinite PCM');
  return { sampleRate, totalFrames, frames, pcm: bytes.subarray(12) };
}
