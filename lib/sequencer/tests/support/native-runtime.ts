import { readFile } from 'node:fs/promises';
import { afterEach } from 'node:test';

const module = await WebAssembly.compile(await readFile(new URL('../../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
let memory: WebAssembly.Memory | undefined;
const instance = new WebAssembly.Instance(module, {
  env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
  wasi_snapshot_preview1: {
    fd_write(_descriptor: number, vectors: number, count: number, written: number) {
      if (!memory) throw new Error('WASM memory is unavailable');
      const view = new DataView(memory.buffer);
      let length = 0;
      for (let index = 0; index < count; index++) length += view.getUint32(vectors + index * 8 + 4, true);
      view.setUint32(written, length, true);
      return 0;
    },
    fd_close: () => 0,
    fd_seek: () => 0,
    proc_exit(code: number) { throw new Error(`WASM exited (${code})`); },
  },
});
if (!(instance.exports.memory instanceof WebAssembly.Memory)) throw new Error('WASM memory is unavailable');
memory = instance.exports.memory;
if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
export const nativeApi = instance.exports;
export const nativeMemory = memory;
const owned: { dispose(): void }[] = [];
export function own<T extends { dispose(): void }>(engine: T): T { owned.push(engine); return engine; }
afterEach(() => { for (const engine of owned.reverse()) engine.dispose(); owned.length = 0; });
