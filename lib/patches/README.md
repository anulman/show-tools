# Render live voice and replay processed takes

This standalone C++17 module renders ordered, full-output effects. Slapback is the first effect type. A take stores the exact processed live PCM for playback and auxiliary original source PCM for evolving effect history. Cached audio never enters its baked effects stack again.

The performance engine owns routing, effect activation, capture admission and recording boundaries. This module supplies prepared racks, capture storage and evolving playback; it does not select musical controls or schedule captures. The practice desk is the supported browser UI. Native/WASM fixtures do not establish physical device latency.

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

All `create`, `make_slapback`, `snapshot`, and destructor calls belong outside audio processing. They allocate or reclaim memory. The prepared processing, capture, start, stop, reset, and state-copy operations allocate and free nothing. State copies and resets still copy or clear entire prepared buffers. Loop wraps only rewind the source cursor; they never copy or reset the rack. No callback deadline or hardware realtime claim follows from the allocation test.

## Capture the live result once

```cpp
// The render owner calls these at its existing audio boundaries.
if (!take->begin(*live)) return;
if (!take->capture(*live, microphone, nullptr, live_left, live_right, frames)) return;
if (!take->commit()) return;
```

`ProcessedTake::create(rack, capacity, revision, source_channels)` fixes original-source storage to one or two channels for the bank lifetime. The default is two. Other channel counts fail preparation. A mono bank accepts a null right source, identical source pointers, or separate channels with equal values throughout the block. Unequal source channels reject the entire block before any rack, cache, or output mutation. Effects and printed PCM remain stereo regardless of source storage.

A null right input duplicates the left microphone channel into right at equal unity amplitude. Two input pointers preserve stereo. A null left input supplies zero on that side. Supply distinct left and right output buffers. Nonoverlapping buffers and exact in-place input/output buffers are supported. Partially overlapping buffers are not supported.

`capture` advances the live rack, writes that same result to the live output, and stores it in the processed cache. The caller must not run the live rack again for that block, or independently advance/reset it between `begin` and capture blocks. The same sole render owner uses the same rack instance throughout capture. A different rack instance is rejected even if it has identical parameters.

Capture requires finite source PCM. The host owns external-input validation, logical voice identity, take identity, input-button bindings, sample rate, audio-frame provenance, and graph revision mapping. The numeric revision attached to a take is an opaque host value. Button IDs do not identify effects or logical voices here.

A take moves from prepared to capturing to committed. Empty commit fails. Capacity and incompatible-input rejection leave the live rack, take length, and output buffers unchanged. A committed take remains unchanged until an admitted `reset_for_capture()` prepares its storage for reuse. The first slice supports fixed graph and parameters. Live venue updates, automation timelines, graph edits, bypass/attach ramps, sparse slices, pitch/resampling, and arbitrary seeks are not implemented in this module. They must not be enabled through an integration fallback with incorrect cache-release state.

## Replay with evolving effect history

```cpp
if (!playback->start(true)) return;
playback->render(sample_left, sample_right, frames);
playback->stop();
playback->render(release_left, release_right, frames);
playback->reset();
```

Prepare `Playback` before the callback, even before capture begins. `PlaybackMode::evolving` is the supported mode and the default. Start succeeds only after commit. `start(loop, start_frame)` currently accepts only frame zero; a nonzero start fails without changing playback state. Only full takes at unit playback rate are supported. `next()` returns one audible stereo frame, and `render()` calls that same path for every frame.

`begin()` snapshots the live rack at the actual capture boundary, including any warm history accumulated before recording. The first playback cycle emits the exact printed capture PCM while a shadow rack consumes the retained original source. Subsequent cycles emit the shadow rack output. Each wrap rewinds only the source cursor: the rack keeps its complete evolving history. Printed PCM never enters that rack.

Stop cuts before the next source frame and feeds zero through the whole current rack. Its release therefore includes history from every preceding loop. Upstream tails continue through downstream stages in order. A stop exactly after the final source frame preserves that final state. Nonloop playback automatically releases after the final frame. Repeated Stop is idempotent. Reset gates output, clears shadow state, and releases the take pin immediately.

This reproduces continuous processing of the repeated original source from the capture-begin snapshot, followed by zero input at Stop. Later loops can differ from the printed first cycle, including for one-frame loops. Exact take length is retained; a nonperiodic source can still have an audible seam at its wrap.

The host may process a live block once and fan its result out to monitoring and capture:

```cpp
if (!take->begin(*live)) return; // actual recording boundary
if (!live->process(source_left, source_right, live_left, live_right, frames)) return;
if (!take->append_processed(*live, source_left, source_right,
                           live_left, live_right, frames)) return;
if (!take->commit()) return;
```

`append_processed()` stores original source and already processed stereo PCM without advancing DSP. Both processed channels are required for a nonempty block. The bound live rack, fixed graph and parameters, take state, and remaining capacity are checked before any storage mutation. Source pointer semantics match `capture()`. The appended source must be the same sanitized original input consumed by the rack. The sole render owner must preserve that original source before processing in place, including mono source; it must not pass overwritten source to append.

Keep each take alive until every prepared playback borrowing it is destroyed, including idle objects. Each concurrent playback needs its own prepared shadow rack. One render owner uses each mutable object. Playing and releasing playbacks pin their take. `reset_for_capture()` rejects reuse while any such pin exists, and succeeds after completion, reset, or playback destruction. Prepared idle playback objects do not pin storage and can start a newly committed capture from the same bank. The host must separately protect external sample borrowers; this guard tracks only this module's playback objects. Reuse clears logical length and state without allocating, freeing, or clearing the prepared PCM buffers.

Original-source and printed PCM use `(source_channels + 2) * sizeof(float)` bytes per prepared take frame. Mono source uses 12 bytes per frame; the default stereo source uses 16. Mono original samples expand to both effect input channels on playback, while stereo effect output remains intact. A take also owns one rack snapshot; each playback owns another. Every played source frame runs the shadow DSP, including the first cycle. Printing preserves exact first-cycle capture provenance; it does not provide a DSP speedup. `memory_bytes()` reports owned object and buffer bytes, excluding allocator bookkeeping. Host lifetime and concurrent-voice limits must account for every retained take and playback.

## Slapback limits

Slapback accepts sample rates from 1,000 through 384,000 Hz, delay from 40 through 250 ms, feedback from 0 through 0.7, and wet amount from 0 through 1. Defaults are 100 ms, zero feedback, and 0.25 wet. Invalid and nonfinite parameters fail preparation.

Each channel has independent fractional-delay interpolation. Mono therefore remains equal on both sides unless another stage deliberately changes stereo. Output is complete dry-plus-delayed audio. The generic rack does not apply that formula to other effect types.

Fixed zero wet has no audible release. Fixed zero feedback releases for exactly `ceil(sample_rate * delay_ms / 1000)` frames, including the last fractional-delay impulse contribution. Positive feedback with nonzero wet has a 12-second release cap. Residual audio after that cap is truncated; this first milestone has no release-end fade or energy-based early completion. Serial rack release bounds add. The native tests verify PCM state correctness within the declared release interval. Auditioning, live parameter smoothing, and production drain completion remain follow-up work.
