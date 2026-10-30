import type { ActorFrame, PreparedStreetScene } from './street-score.js';

export async function createStreetSampler(bytes: BufferSource, scene: PreparedStreetScene) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const { memory, malloc, free, vs_validate, vs_sample } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof malloc !== 'function' || typeof free !== 'function' || typeof vs_validate !== 'function' || typeof vs_sample !== 'function') throw new Error('Incompatible Street sampler WASM');
  const allocateBytes = malloc;
  const allocations: number[] = [];
  function allocate(size: number) {
    const pointer = Number(allocateBytes(size));
    if (!pointer) throw new Error('Street sampler allocation failed');
    allocations.push(pointer); return pointer;
  }
  try {
    const packed = scene.tracks.map(track => {
      const values = Float64Array.from(track.keys.flatMap(key => [key.at, key.clip, key.pose, Number(key.grayscale)]));
      const pointer = allocate(values.byteLength);
      new Float64Array(memory.buffer, pointer, values.length).set(values);
      if (!vs_validate(pointer, track.keys.length)) throw new Error('Invalid Street HOLD table');
      return { actor: track.actor, pointer, count: track.keys.length };
    });
    const output = allocate(24);
    let disposed = false;
    return {
      sample(count: number): readonly ActorFrame[] {
        if (disposed) throw new Error('Street sampler is disposed');
        if (!Number.isFinite(count)) throw new Error('Street count must be finite');
        return packed.map(track => {
          if (!vs_sample(track.pointer, track.count, count, output)) throw new Error('Street sample failed');
          const result = new Float64Array(memory.buffer, output, 3);
          return { actor: track.actor, clip: result[0], pose: result[1], grayscale: result[2] === 1 };
        });
      },
      dispose() { if (!disposed) { disposed = true; for (const pointer of allocations) free(pointer); } },
    };
  } catch (error) { for (const pointer of allocations) free(pointer); throw error; }
}
export type StreetSampler = Awaited<ReturnType<typeof createStreetSampler>>;
