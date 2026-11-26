cmake_minimum_required(VERSION 3.20)
project(show_tools_manual_wasm LANGUAGES CXX)
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Configure the manual WASM build through emcmake")
endif()
if(NOT DEFINED MANUAL_WASM_EXPORTS OR MANUAL_WASM_EXPORTS STREQUAL "")
  message(FATAL_ERROR "Generate MANUAL_WASM_EXPORTS from the public headers first")
endif()
if(NOT DEFINED MANUAL_WASM_INITIAL_MEMORY)
  message(FATAL_ERROR "Specify the fixed manual WASM heap budget")
endif()
get_filename_component(repo_dir "${CMAKE_CURRENT_LIST_DIR}/../../../.." ABSOLUTE)
add_executable(manual-clock
  "${repo_dir}/lib/beat-tracker/src/beat_tracker.cpp"
  "${repo_dir}/lib/beat-tracker/src/beat_clock.cpp"
  "${repo_dir}/lib/beat-tracker/src/tempo_follower.cpp"
  "${repo_dir}/lib/sampler/src/sample_engine.cpp"
  "${repo_dir}/lib/sequencer/src/audio_sequence_engine.cpp"
  "${repo_dir}/lib/performance/src/performance_engine.cpp"
  "${repo_dir}/lib/performance/src/compiled_program.cpp"
  "${repo_dir}/lib/peripherals/src/peripheral_controls.cpp"
  "${repo_dir}/lib/patches/src/patch_engine.cpp"
  "${repo_dir}/lib/patches/src/shake_percussion.cpp"
  "${repo_dir}/lib/tuner/src/tuner.cpp")
set_target_properties(manual-clock PROPERTIES SUFFIX ".wasm" CXX_STANDARD 17 CXX_STANDARD_REQUIRED YES CXX_EXTENSIONS NO)
target_compile_definitions(manual-clock PRIVATE BT_MANUAL_ONLY)
target_compile_options(manual-clock PRIVATE -O3 -fno-exceptions)
target_include_directories(manual-clock PRIVATE
  "${repo_dir}/lib/beat-tracker/include" "${repo_dir}/lib/sampler/include"
  "${repo_dir}/lib/sequencer/include" "${repo_dir}/lib/performance/include"
  "${repo_dir}/lib/peripherals/include" "${repo_dir}/lib/patches/include" "${repo_dir}/lib/tuner/include")
target_link_options(manual-clock PRIVATE -O3 -fno-exceptions --no-entry
  -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0 -sABORTING_MALLOC=0
  "-sINITIAL_MEMORY=${MANUAL_WASM_INITIAL_MEMORY}" -sSTACK_SIZE=1048576 "-sEXPORTED_FUNCTIONS=${MANUAL_WASM_EXPORTS}")
