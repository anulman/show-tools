#!/usr/bin/env bash
set -euo pipefail

module_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$module_dir/build-manual-wasm"
dist_dir="$module_dir/../../ui/practice/wasm"

for tool in em++ node; do
    command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 1; }
done
mkdir -p "$build_dir" "$dist_dir"
export EM_CACHE="${EM_CACHE:-$build_dir/emscripten-cache}"

em++ -O3 -std=c++17 -fno-exceptions -DBT_MANUAL_ONLY \
    -I"$module_dir/include" \
    "$module_dir/src/beat_tracker.cpp" "$module_dir/src/beat_clock.cpp" "$module_dir/src/tempo_follower.cpp" \
    --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0 \
    -sINITIAL_MEMORY=16777216 -sSTACK_SIZE=1048576 \
    '-sEXPORTED_FUNCTIONS=["_bt_create","_bt_destroy","_bt_process","_bt_command","_bt_snapshot","_bt_drain_events","_bt_observe","_malloc","_free"]' \
    -o "$dist_dir/manual-clock.wasm"

em++ --version > "$dist_dir/manual-clock-compiler.txt"
cat > "$dist_dir/manual-clock-build.json" <<'EOF'
{"mode":"manual","microphoneTempoDetection":false,"aubio":null,"thirdPartyAudioDependencies":[],"initialMemory":16777216,"memoryGrowth":false}
EOF
node --test "$module_dir/tests/manual_wasm_tests.mjs"
echo "Built $dist_dir/manual-clock.wasm without aubio."
