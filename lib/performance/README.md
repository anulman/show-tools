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

Song scripts under `songs/` produce declarative instructions. C++ executes them without per-beat JavaScript callbacks. For compiled programs, use `pf_configure_compiled()` with numeric tables or `pf_load_compiled_bytes()` with the compiler's `.pfp` bytes. Both loaders validate and atomically replace a stopped program. The byte format consists of little-endian IEEE-754 doubles; constants and row widths are defined in the header. The native host provides fake PCM and an ALSA backend; installed-device validation, physical controls, and a relay producer remain future work.

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

## Compile a canonical song

```sh
./show-tools chart fetch --url 'https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=SHEET_ID' --mapping IMPORT_MAPPING.json --out /tmp/song.musicxml
./show-tools chart inspect /tmp/song.musicxml
./show-tools chart compile --musicxml /tmp/song.musicxml --out /tmp/song.json
./show-tools chart encode --song /tmp/song.json --out /tmp/song.pfp
```

Compilation runs offline after fetch. `--draft` saves source-located diagnostics and cannot emit `.pfp` bytes. Schema/packet 5 and ABI 7 retain explicit capture end, loop end, and group anchor. Import a resolved artifact through the practice desk while stopped. Current DYC authoring answers are encoded. Its disjoint recording intervals permit F21 future arming while R1 still records; native state keeps live routing, capture ownership, and reservations separate.

`encode` validates and converts the exact inspected JSON into native bytes. It does not fetch or recompile the worksheet. Replace the removed `compile --native-out` option with this separate command. Each command validates its input before publishing one complete output by rename; concurrent runs use separate temporary directories. Input aliases are rejected. Validation and pre-publication failures preserve the previous output. This does not establish power-loss durability or a transaction across the JSON and `.pfp` files.

Add `--json` to receive one failure record on stdout. Invalid input and unresolved chart diagnostics exit with code 2 and include correction steps. Unexpected tooling failures exit with code 3 and request Chief intervention. Human failures go to stderr. Neither status permits a draft to become executable. The shared [failure policy](../../docs/implementation/deterministic-pipelines.md) defines these outcomes.

Lead-in capture must execute at the next song bar. Immediate lead-in capture is rejected because its duration depends on the runtime count-in and is not represented by a song-bar take interval. Individual stops report native countdown and release feedback through the final audible tail, then extinguish the pad light.

After a venue edit retains an older take, the first new capture uses the refreshed spare bank. Recapturing again during the same transport run can exhaust current-revision banks. Arm then rejects nonfatally before changing the route or capture state; existing audio continues. Stop and prepare effects to refresh reusable banks before another capture. Callback processing never replaces or reallocates a bank.

`npm run verify:dyc` saves the current compiled inspection, portable bytes when executable, and source-linked scripted input under a fresh temporary directory. It runs the same `.pfp` through native and WASM at 44.1 and 48 kHz, comparing complete A results and stem aggregates. Synthetic input verifies software execution, not room acoustics or browser MP3 export. The saved baseline F21 rejection exposed a software ownership bug and is retained as evidence; it does not identify a source defect.

`control({ id: 'tempo' })` uses the shared native hit path; no key or device is implicitly mapped to it. `1p*` uses that same path with beat hint 1 after playback readiness preflight. Phase, serial, and epoch remain unchanged. The existing bounded six-interval median policy is retained without rephasing; isolated hits may produce no new BPM estimate. `tempo-hit` events and `tempoHitInfo()` expose actual-frame provenance. Cached loops remain unit-rate; arbitrary live tempo stretching is not claimed.

The current artifact preserves six AF part identities and ten explicit DYC
rotation windows. Four capture voice indices remain unchanged. Native six-profile
preparation keeps independent revisions and exposes actual ordered graph readback.
Backup processing stops feeding source after a full quarter-count without
meaningful jiggle, capped by its written interval; signed motion remains observable.

Mappings and compiled JSON use version 6, numeric packets use version 6, and the
engine handshake is ABI 8. `rotationRule.inactivityBeats: 0.25` means a full
quarter chart-count after meaningful jiggle, capped by the written window end.
Native C++ confirms travel and reversals using configurable raw-input thresholds;
zero, duplicate and subthreshold noise do not refresh the deadline. Tempo changes
preserve the remaining count-beat distance. The explicit MusicXML v2 migration
rewrites the old grid field into profile v3; normal readers reject old profiles.
The source snapshot format remains version 1. Inactivity durations must be
positive, at most one chart count, and representable on the 960-tick count lattice.

Native `cueButton` control 7 accepts held/released values 1/0. A rising edge
selects all current eligible cues before mutations, commits before arms, and
reports independent failures. Repeats do not retrigger; release performs no cue.
`pf_set_jiggle_thresholds` prepares ordered integer travel/reversal thresholds
while stopped. `pf_light_output` returns a complete clock-backed light image:
held 100%, otherwise an unused compiled button cue or recording pulses to 70%,
otherwise playing 70%, otherwise off. Timed cue warnings span the two chart counts
leading up to the authored cue, including count-in when applicable. Full-bar cues
warn only within their authored bar. A successfully accepted press clears that
cue's warning immediately, including queued actions; a rejected press does not.
Warnings respect the requested practice range, rearm on loop wrap, and preserve
existing cue admission windows and execution. It supplies values rather than
performing device IO.
