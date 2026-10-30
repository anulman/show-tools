import type { ActorFrame, PreparedStreetScene } from './street-score.js';

export async function createStreetSampler(bytes: BufferSource, scene: PreparedStreetScene) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const { memory, malloc, free, vs_validate, vs_sample } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof malloc !== 'function' || typeof free !== 'function' || typeof vs_validate !== 'function' || typeof vs_sample !== 'function') throw new Error('Incompatible Street sampler WASM');
  const wasmMemory = memory, validate = vs_validate;
  const allocateBytes = malloc;
  const allocations: number[] = [];
  function allocate(size: number) {
    const pointer = Number(allocateBytes(size));
    if (!pointer) throw new Error('Street sampler allocation failed');
    allocations.push(pointer); return pointer;
  }
  try {
    function pack(rows: readonly (readonly number[])[]) {
      const values = Float64Array.from(rows.flat());
      const pointer = allocate(values.byteLength);
      new Float64Array(wasmMemory.buffer, pointer, values.length).set(values);
      if (!validate(pointer, rows.length)) throw new Error('Invalid Street HOLD table');
      return { pointer, count: rows.length };
    }
    const packed = scene.tracks.map(track => {
      return { actor: track.actor, ...pack(track.keys.map(key => [key.at, key.clip, key.pose, Number(key.grayscale)])) };
    });
    // The second native table carries effect selector, drawing, and visibility.
    const presence = new Map(scene.staging.kind === 'poof' ? scene.staging.tracks.map(track => [track.actor,
      pack(track.keys.map(key => [key.at, key.poof ? key.poof.effect + 1 : 0, key.poof?.pose ?? 0, Number(key.visible)]))]) : []);
    const output = allocate(24);
    let disposed = false;
    return {
      sample(count: number): readonly ActorFrame[] {
        if (disposed) throw new Error('Street sampler is disposed');
        if (!Number.isFinite(count)) throw new Error('Street count must be finite');
        return packed.map(track => {
          if (!vs_sample(track.pointer, track.count, count, output)) throw new Error('Street sample failed');
          const result = new Float64Array(memory.buffer, output, 3);
          const body = { actor: track.actor, clip: result[0], pose: result[1], grayscale: result[2] === 1 };
          const presentation = presence.get(track.actor);
          if (!presentation) return { ...body, visible: true, poof: null };
          if (!vs_sample(presentation.pointer, presentation.count, count, output)) throw new Error('Street presence sample failed');
          const selected = new Float64Array(memory.buffer, output, 3);
          return { ...body, visible: selected[2] === 1, poof: selected[0] === 0 ? null : { effect: selected[0] - 1, pose: selected[1] } };
        });
      },
      dispose() { if (!disposed) { disposed = true; for (const pointer of allocations) free(pointer); } },
    };
  } catch (error) { for (const pointer of allocations) free(pointer); throw error; }
}
export type StreetSampler = Awaited<ReturnType<typeof createStreetSampler>>;
