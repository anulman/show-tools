# Use the native performance engine

The shared C++ performance engine executes the complete instrument. It owns the clock, song transport, chart actions, generic sequencing, capture, playback, mixing, and click generation. The browser uses the same source through WASM. Read [how the instrument fits together](../../docs/architecture.md) for the audio and control flow.

The public interface is [include/performance_engine.h](include/performance_engine.h). Its implementation is [src/performance_engine.cpp](src/performance_engine.cpp). The TypeScript [wasm-performance.ts](wasm-performance.ts) bridge converts declarative song data and browser blocks to that interface. It also formats native state and adds host run IDs. It does not execute musical decisions.

## Build and test the native engine

Install a C++17 compiler and CMake 3.20 or newer. From the repository root, run these commands.

```sh
cmake -S lib/performance -B /tmp/show-tools-performance -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/show-tools-performance
ctest --test-dir /tmp/show-tools-performance --output-on-failure
```

This target links a manual-tempo clock, sequencer, and sampler. It requires neither aubio nor libsndfile. Its tests process PCM without opening audio devices. The target is a library and test executable, not an EliteDesk device service.

## Configure and process a song

1. Create one engine with `pf_create()` in `PF_PRACTICE` mode for chart-driven performance. Compiled practice supports 4/4 and six eighth-note counts in 6/8; legacy practice uses four beats per bar.
2. While stopped, upload the song through `pf_configure()`. The interface copies scheduled events, lead-in and numbered-bar cues, capture hints, and whole-bar variant playback assignments. Invalid replacement data preserves the previous configuration.
3. Pass device readiness through `pf_set_microphone()`. Submit controls through `pf_control()` and channel settings through `pf_set_channel()`.
4. Start with `pf_start()`. The engine selects manual tempo, applies the starting BPM, and begins the requested count-in and range.
5. Clear each output block, then call `pf_process_stems()` with mono microphone PCM and separate sample/click and live stereo pointers. `pf_process()` retains the sample/click API and discards the live stem without scratch allocation. A null input supplies silence. The engine advances time, splits the block at clock crossings, executes actions, and adds rendered PCM to the outputs.
6. On the engine's owning thread, drain native events and tracker telemetry into a bounded host queue. Serialize and publish copied records outside the device callback. Do not use receipt time as musical time.
7. Stop through `pf_stop()` and destroy the engine through `pf_destroy()` when the host releases it.

Give one caller ownership of each engine. The component handles returned by `pf_tracker()`, `pf_sampler()`, and `pf_sequencer()` are borrowed. Do not separately advance the clock or dispatch sequencer beats while `pf_process()` owns block processing. The diagnostic `pf_on_beat()` API exercises native behavior in tests; it is not an additional scheduling path for a live host.

Song scripts under `songs/` produce declarative instructions. C++ executes them without per-beat JavaScript callbacks. For compiled programs, use `pf_configure_compiled()` with numeric tables or `pf_load_compiled_bytes()` with the compiler's `.pfp` bytes. Both loaders validate and atomically replace a stopped program. The byte format consists of little-endian IEEE-754 doubles; constants and row widths are defined in the header. Native device hosting, physical controls, and a relay producer remain future work.

## Preserve state and command identity

The event queue holds 512 records. Each record contains an immutable transport snapshot and four channel snapshots. Overflow retains recent events and increments the drop count. Start clears prior-run events and resets the native sequence. The host adds its run ID and chart metadata when publishing the existing event protocol.

`pf_control()` receives command IDs as explicit UTF-16 code units and a length. IDs contain at most 200 units. Native deduplication preserves Unicode, lone surrogate, and embedded NUL identity. A null pointer with zero length omits the ID. The browser bridge validates string length before crossing the WASM boundary.

Configuration and pattern definitions are copied. Active and queued pattern versions keep their prior definition when the same pattern ID is redefined. A stopped channel stays stopped when a song's automatic variant assignment is reached.

## Keep processing separate from preparation

The browser module has a fixed 256 MiB heap and disables growth. `pf_process()` and native beat dispatch use prepared buffers and fixed queues. Song configuration, pattern definition, capture preparation, and file loading are command-time operations that may allocate. Native reset operations that replace analyzer state also belong outside the audio callback.

The C header defines query layouts and the performance ABI version. The build generates `wasm-abi.ts` from that header and derives exported function names from the public headers. The browser checks `pf_abi_version()` before constructing the engine. Rebuild both the WASM artifact and browser bundle after an interface change.

The browser owns device access and routing of the native sample/click and processed-live stereo stems. It mixes both once into the demo recording and separately gates live monitoring using explicit physical-device confirmation. MP3 export runs after capture in its own worker. The native engine does not open a microphone, monitor live voice, encode MP3, host a UI, or start the future relay.

## Prepare the default live voice before practice

`pf_prepare_live_effects()` atomically installs copied effect definitions while stopped and without active/pending capture. The first supported type is slapback version 1. Count zero explicitly prepares identity processing. Revisions are positive and host-owned. An identical request at the same revision is idempotent; a lower or conflicting revision rejects. `pf_live_info()` reports preparation, actual activation, revision, and stage count.

Start authorizes live input only with microphone ready and a prepared rack. Stop/Panic, end, fatal faults, and microphone loss clear authorization and DSP history. Readiness alone does not rearm. `pf_process_stems()` adds planar PCM to nullable caller-cleared channel buffers, maps mono input equally to left/right, and processes live input once even if its outputs are discarded. Non-null spans must not overlap. Invalid aliasing rejects before modifying engine state, last error, or output.

Default-live effects apply during count-in and playing. The click and cached sample mix stay outside the effect input. Compiled arm immediately routes live input through the target voice stack; recording waits for its declared boundary. Prepared dual banks retain original mono source, printed stereo PCM, and graph state. Playback evolves effects from original source across iterations without processing printed PCM or resetting DSP on wrap. Overlap rejects atomically; `crb` remains legal. Legacy and generic raw capture still reject with effects enabled.

## Compile a worksheet

```sh
./show-tools chart fetch --url 'https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=SHEET_ID' --out /tmp/source.json
./show-tools chart compile --source /tmp/source.json --mapping songs/dance-yrself-clean.mapping.json --out /tmp/song.json --native-out /tmp/song.pfp
./show-tools chart inspect /tmp/song.json
```

Compilation runs offline after fetch. `--draft` saves source-located diagnostics for an unresolved song and cannot emit `.pfp` bytes. The checked-in current DYC mapping remains blocked pending operator authoring answers. Import a resolved artifact through the practice desk while stopped. Native and WASM fixture tests prove execution mechanics, not completion of that unresolved arrangement.
