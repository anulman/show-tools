#!/usr/bin/env bash
set -euo pipefail

module_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$module_dir/build-manual-wasm"
dist_dir="$module_dir/../../ui/practice/wasm"
sampler_dir="$module_dir/../sampler"
sequencer_dir="$module_dir/../sequencer"
performance_dir="$module_dir/../performance"
patches_dir="$module_dir/../patches"
repo_dir="$module_dir/../.."

for tool in em++ node; do
    command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 1; }
done
mkdir -p "$build_dir" "$dist_dir"
export EM_CACHE="${EM_CACHE:-$build_dir/emscripten-cache}"
node --import tsx "$repo_dir/scripts/generate-sampler-abi.ts"
node --import tsx "$repo_dir/scripts/generate-sampler-abi.ts" "$sequencer_dir/include/audio_sequence_engine.h" "$sequencer_dir/wasm-abi.ts" SQ
node --import tsx "$repo_dir/scripts/generate-sampler-abi.ts" "$performance_dir/include/performance_engine.h" "$performance_dir/wasm-abi.ts" PF
node --import tsx "$repo_dir/scripts/generate-sampler-abi.ts" "$performance_dir/include/performance_light_output.h" "$performance_dir/light-abi.ts" PF
exports="$(node --import tsx "$repo_dir/scripts/wasm-exports.ts" "$module_dir/include/beat_tracker.h" "$sampler_dir/include/sample_engine.h" "$sequencer_dir/include/audio_sequence_engine.h" "$performance_dir/include/performance_engine.h")"

em++ -O3 -std=c++17 -fno-exceptions -DBT_MANUAL_ONLY \
    -I"$module_dir/include" -I"$sampler_dir/include" -I"$sequencer_dir/include" -I"$performance_dir/include" -I"$patches_dir/include" -I"$performance_dir/../tuner/include" \
    "$module_dir/src/beat_tracker.cpp" "$module_dir/src/beat_clock.cpp" "$module_dir/src/tempo_follower.cpp" \
    "$sampler_dir/src/sample_engine.cpp" "$sequencer_dir/src/audio_sequence_engine.cpp" "$performance_dir/src/performance_engine.cpp" "$performance_dir/src/compiled_program.cpp" "$patches_dir/src/patch_engine.cpp" "$performance_dir/../tuner/src/tuner.cpp" \
    --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0 -sABORTING_MALLOC=0 \
    -sINITIAL_MEMORY=268435456 -sSTACK_SIZE=1048576 \
    "-sEXPORTED_FUNCTIONS=$exports" \
    -o "$dist_dir/manual-clock.wasm"

em++ --version > "$dist_dir/manual-clock-compiler.txt"
cat > "$dist_dir/manual-clock-build.json" <<'EOF'
{"mode":"manual","microphoneTempoDetection":false,"aubio":null,"sampler":"cpp","performance":"cpp","thirdPartyAudioDependencies":[],"initialMemory":268435456,"memoryGrowth":false}
EOF
node --test "$module_dir/tests/manual_wasm_tests.mjs"
echo "Built $dist_dir/manual-clock.wasm without aubio."
