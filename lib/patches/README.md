# Render live voice and replay processed takes

This standalone C++17 module renders ordered, full-output effects. Slapback is the first effect type. A take stores the exact processed live PCM for playback and auxiliary source PCM for release-state reconstruction. Cached audio never enters its baked effects stack again.

The module is not connected to `pf_process()`, the sampler, practice controls, browser monitoring, song cues, or downloads yet. Its native and WASM fixtures establish the first DSP and cache-release milestone. They do not establish physical device latency or a complete performance route.

## Build and run the native tests

From the repository root, run these commands.

```sh
cmake -S lib/patches -B /tmp/show-tools-patches -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/show-tools-patches
ctest --test-dir /tmp/show-tools-patches --output-on-failure
/tmp/show-tools-patches/patch_engine_tests --fixture /tmp/patches-native.f32
/tmp/show-tools-patches/patch_engine_tests --demo /tmp/patches-audition
```

`--fixture` writes deterministic, interleaved stereo float32 PCM with no header. `--demo` writes three seconds of synthetic dry and wet stereo PCM at 48 kHz to `PREFIX-dry.f32` and `PREFIX-wet.f32`. These are local verification artifacts, not recordings from a microphone. Keep them outside Git.

Run `node --import tsx scripts/verify-patches.ts` to build both targets and compare their complete PCM fixtures. The test source also compiles with Emscripten. Use the same source and flags when comparing its emitted fixture to native output. Enable `NODERAWFS` for the test executable so its fixture reaches the host filesystem. The module itself has no filesystem or browser dependency.

## Prepare the graph before audio processing

```cpp
#include "patch_engine.h"
using namespace patches;

std::unique_ptr<Effect> effects[] = {make_slapback(48000)};
auto live = Rack::create(effects, 1);
if (!live) return;
auto take = ProcessedTake::create(*live, 48000 * 4, 17);
if (!take) return;
auto playback = Playback::create(*take);
if (!playback) return;
```

`Rack::create` takes ownership of the supplied stage pointers only on success. Stage order is signal order. An empty rack is exact bypass. The current admission limit is 64 stages per rack. It is an implementation limit, not a relationship between voices and physical buttons.

Effect descriptors declare parameter metadata, latency, a finite maximum release length, deterministic source replay, and complete state snapshots. The release bound must include all zero-input continuation, including audio still pending in a latency buffer. Both capture capabilities default to false. `ProcessedTake::create` rejects a rack whose effects do not declare both capabilities. A future random or oscillator-based effect must include all replay-relevant state before opting in.

A type implements complete `process`, `reset`, `snapshot`, compatibility, state-copy, and memory accounting operations. Compatibility includes every fixed parameter and resource dimension needed for a valid copy. State-copy must succeed for a compatible pair and must not allocate or free. The rack checks all stage compatibility before changing any state. The interface does not assume a wet parameter, unity dry gain, a delay ring, or a particular stereo interaction. Tests use independent gain and nonlinear stages to prove order.

All `create`, `make_slapback`, `snapshot`, and destructor calls belong outside audio processing. They allocate or reclaim memory. The prepared processing, capture, start, stop, reset, and state-copy operations allocate and free nothing. State copies and resets still copy or clear entire prepared buffers. Tiny loops can perform many such copies per block. No callback deadline or hardware realtime claim follows from the allocation test.

## Capture the live result once

```cpp
// The render owner calls these at its existing audio boundaries.
if (!take->begin(*live)) return;
if (!take->capture(*live, microphone, nullptr, live_left, live_right, frames)) return;
if (!take->commit()) return;
```

A null right input duplicates the left microphone channel into right at equal unity amplitude. Two input pointers preserve stereo. A null left input supplies zero on that side. Supply distinct left and right output buffers. Nonoverlapping buffers and exact in-place input/output buffers are supported. Partially overlapping buffers are not supported.

`capture` advances the live rack, writes that same result to the live output, and stores it in the processed cache. The caller must not run the live rack again for that block, or independently advance/reset it between `begin` and capture blocks. The same sole render owner uses the same rack instance throughout capture. A different rack instance is rejected even if it has identical parameters.

Capture requires finite source PCM. The host owns external-input validation, logical voice identity, take identity, input-button bindings, sample rate, audio-frame provenance, and graph revision mapping. The numeric revision attached to a take is an opaque host value. Button IDs do not identify effects or logical voices here.

A take moves from prepared to capturing to committed. Empty commit fails. Capacity and incompatible-input rejection leave the live rack, take length, and output buffers unchanged. A committed take is immutable. The first slice supports fixed graph and parameters. Live venue updates, automation timelines, graph edits, bypass/attach ramps, sparse slices, pitch/resampling, and arbitrary seeks are not implemented in this module. They must not be enabled through an integration fallback with incorrect cache-release state.

## Replay printed PCM and release its matching state

```cpp
if (!playback->start(true)) return;
playback->render(sample_left, sample_right, frames);
playback->stop();
playback->render(release_left, release_right, frames);
playback->reset();
```

Prepare `Playback` before the callback, even before capture begins. Start succeeds only after commit. Keep the take and its captured graph/source storage alive through both playing and releasing, and until every prepared playback borrowing it is destroyed. Each concurrent playback needs its own prepared object. One render owner uses each mutable object.

While playing, output comes directly from the printed cache. A silent shadow rack consumes the auxiliary original source at the same phase. Stop cuts before the next source frame, feeds zero to the first stage of that shadow rack, and exposes its full-output release. Upstream tails continue through downstream stages in order. No cached PCM is processed again.

Each actual loop wrap restores the complete capture-start snapshot, including warm ring contents and cursor. A stop exactly after the final frame uses the final state; it does not restore the start state early. Nonloop playback automatically releases after the final cached frame. Repeated Stop is idempotent. Reset gates output and clears shadow state immediately, allowing a future host to implement global Stop/Panic without stale tails.

These are captured-phase releases. They reproduce the original source prefix followed by zero input from the capture-start state. They do not claim equivalence to continuously processing an infinitely repeated source. Repeating a nonperiodic printed interval can have an audible seam. Exact loop length is retained; periodic-cache refinement and musical loop continuity remain separate integration work.

The shadow model retains one initial state and runs source DSP throughout playback. Caching guarantees fixed audible PCM here, not a DSP speedup. Source and printed stereo PCM use 16 bytes per prepared take frame. A take also owns one rack snapshot; each playback owns another. `memory_bytes()` reports owned object and buffer bytes, excluding allocator bookkeeping. Host lifetime and concurrent-voice limits must account for every retained take and playback.

Sparse state checkpoints could reduce repeated DSP but increase snapshot storage and concentrate catch-up work at Stop. Effect-specific release journals could reduce both costs but require a codec for every stateful type. The shadow model is the simple correctness baseline against which those optimizations can be tested.

## Slapback limits

Slapback accepts sample rates from 1,000 through 384,000 Hz, delay from 40 through 250 ms, feedback from 0 through 0.7, and wet amount from 0 through 1. Defaults are 100 ms, zero feedback, and 0.25 wet. Invalid and nonfinite parameters fail preparation.

Each channel has independent fractional-delay interpolation. Mono therefore remains equal on both sides unless another stage deliberately changes stereo. Output is complete dry-plus-delayed audio. The generic rack does not apply that formula to other effect types.

The descriptor caps slapback release at 12 seconds. Residual audio after that cap is truncated; this first milestone has no release-end fade or energy-based early completion. Serial rack release bounds add. The native tests verify PCM state correctness within the declared release interval. Auditioning, live parameter smoothing, and production drain completion remain follow-up work.
