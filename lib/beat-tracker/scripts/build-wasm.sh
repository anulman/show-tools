#!/usr/bin/env bash
set -euo pipefail

module_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deps_dir="$module_dir/deps"
build_dir="$module_dir/build-wasm"
dist_dir="$module_dir/dist"
aubio_version=0.4.9
aubio_sha256=d48282ae4dab83b3dc94c16cf011bcb63835c1c02b515490e1883049c3d1f3da
archive="$deps_dir/aubio-$aubio_version.tar.bz2"
aubio_dir="$deps_dir/aubio-$aubio_version"

for tool in emcc em++ emar curl shasum tar node; do
    command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 1; }
done
mkdir -p "$deps_dir" "$build_dir/aubio" "$build_dir/include/aubio" "$dist_dir"
export EM_CACHE="${EM_CACHE:-$build_dir/emscripten-cache}"
if [[ ! -f "$archive" ]]; then
    curl --fail --location --retry 2 "https://aubio.org/pub/aubio-$aubio_version.tar.bz2" -o "$archive.part"
    mv "$archive.part" "$archive"
fi
actual_sha256="$(shasum -a 256 "$archive")"
actual_sha256="${actual_sha256%% *}"
if [[ "$actual_sha256" != "$aubio_sha256" ]]; then
    echo "aubio archive checksum mismatch. Expected $aubio_sha256, received $actual_sha256" >&2
    exit 1
fi
tar -xjf "$archive" -C "$deps_dir"
cp "$aubio_dir/src/"*.h "$build_dir/include/aubio/"
cat > "$build_dir/aubio/config.h" <<'EOF'
#define HAVE_STDLIB_H 1
#define HAVE_STDIO_H 1
#define HAVE_MATH_H 1
#define HAVE_STRING_H 1
#define HAVE_ERRNO_H 1
#define HAVE_LIMITS_H 1
#define HAVE_STDARG_H 1
#define HAVE_C99_VARARGS_MACROS 1
EOF

aubio_sources=(
    fvec.c cvec.c lvec.c fmat.c mathutils.c musicutils.c vecutils.c
    spectral/fft.c spectral/ooura_fft8g.c spectral/phasevoc.c spectral/specdesc.c spectral/statistics.c
    tempo/tempo.c tempo/beattracking.c onset/peakpicker.c
    temporal/filter.c temporal/biquad.c utils/hist.c utils/scale.c utils/log.c
)
objects=()
for relative in "${aubio_sources[@]}"; do
    object="$build_dir/aubio/${relative//\//_}.o"
    emcc -O3 -std=c99 -DHAVE_CONFIG_H -I"$build_dir/aubio" -I"$aubio_dir/src" \
        -c "$aubio_dir/src/$relative" -o "$object"
    objects+=("$object")
done
emar rcs "$build_dir/libaubio.a" "${objects[@]}"

engine_sources=(beat_tracker.cpp beat_clock.cpp aubio_detector.cpp tempo_follower.cpp)
sources=()
for relative in "${engine_sources[@]}"; do
    sources+=("$module_dir/src/$relative")
done
em++ -O3 -std=c++17 -fno-exceptions \
    -I"$module_dir/include" -I"$build_dir/include" -I"$aubio_dir/src" \
    "${sources[@]}" "$build_dir/libaubio.a" \
    --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0 \
    -sINITIAL_MEMORY=16777216 -sSTACK_SIZE=1048576 \
    '-sEXPORTED_FUNCTIONS=["_bt_create","_bt_destroy","_bt_process","_bt_command","_bt_snapshot","_bt_drain_events","_bt_observe","_malloc","_free"]' \
    -o "$dist_dir/beat-tracker.wasm"

emcc --version > "$dist_dir/compiler.txt"
cp "$aubio_dir/COPYING" "$dist_dir/aubio-COPYING.txt"
cat > "$dist_dir/build.json" <<EOF
{"aubio":"$aubio_version","aubioArchiveSha256":"$aubio_sha256","fft":"ooura","precision":"float","initialMemory":16777216,"memoryGrowth":false}
EOF
node --input-type=module - "$dist_dir/beat-tracker.wasm" <<'EOF'
import { readFileSync } from 'node:fs';
const module = await WebAssembly.compile(readFileSync(process.argv[2]));
console.log(JSON.stringify({ imports: WebAssembly.Module.imports(module), exports: WebAssembly.Module.exports(module) }, null, 2));
let instance;
const wasi = {
    fd_close: () => 0,
    fd_seek: () => 29,
    fd_write(fd, iovs, count, written) {
        const memory = new DataView(instance.exports.memory.buffer);
        let length = 0;
        for (let i = 0; i < count; ++i) length += memory.getUint32(iovs + i * 8 + 4, true);
        memory.setUint32(written, length, true);
        return 0;
    },
    proc_exit: code => { throw new Error(`WASM exited with ${code}`); },
};
instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi });
const engine = instance.exports;
engine._initialize();
const tracker = engine.bt_create(48000);
if (!tracker) throw new Error('WASM tracker initialization failed');
const snapshot = engine.malloc(22 * 8);
if (!snapshot) throw new Error('WASM snapshot allocation failed');
const command = engine.bt_command(tracker, 1, 120, 0, 1, 1);
engine.bt_process(tracker, 0, 512);
engine.bt_snapshot(tracker, snapshot);
const state = new Float64Array(engine.memory.buffer, snapshot, 22);
if (command !== 0 || state[0] !== 512 || Math.abs(state[6] - 120) > 1e-9) {
    throw new Error(`WASM seeded-clock smoke failed: ${JSON.stringify([...state])}`);
}
engine.free(snapshot);
engine.bt_destroy(tracker);
console.log('WASM initialized and processed a 120 BPM seeded clock at 48 kHz.');
EOF
echo "Built $dist_dir/beat-tracker.wasm"
