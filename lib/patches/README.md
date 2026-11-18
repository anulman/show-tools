# Render live voice and replay processed takes

This standalone C++17 module renders ordered, full-output effects. Slapback and Chorus are prepared effect types. The fixed [Tribulations guitar](TRIBULATIONS.md) factory preserves the approved Legato fuzz instrument without adding production voice bindings. A take stores the exact processed live PCM for playback and auxiliary original source PCM for evolving effect history. Cached audio never enters its baked effects stack again.

The performance engine owns routing, effect activation, capture admission and recording boundaries. This module supplies prepared racks, capture storage and evolving playback; it does not select musical controls or schedule captures. The Performance Desk is the supported browser UI. Native/WASM fixtures do not establish physical device latency.

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

Run `node --import tsx scripts/verify-patches.ts` to build the native and WASM versions of both test executables and compare their complete PCM fixtures. The test source also compiles with Emscripten. Use the same source and flags when comparing its emitted fixture to native output. Enable `NODERAWFS` for the test executable so its fixture reaches the host filesystem. The module itself has no filesystem or browser dependency.

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

`capture` advances the live rack, writes that same result to the live output, and stores it in the processed cache. The caller must not run the live rack again for that block, or independently advance/reset it between `begin` and capture blocks. The same sole render owner uses the same rack instance throughout capture. Keep that rack alive and do not advance or reset it between the final captured frame and `commit()`, which snapshots its endpoint state. After commit, playback no longer depends on that live rack state. A different rack instance is rejected even if it has identical parameters.

Capture requires finite source PCM. The host owns external-input validation, logical voice identity, take identity, input-button bindings, sample rate, audio-frame provenance, and graph revision mapping. The numeric revision attached to a take is an opaque host value. Button IDs do not identify effects or logical voices here.

A take moves from prepared to capturing to committed. `commit(period_frames = 0)` seals the captured prefix and copies the bound live rack into a prepared capture-end snapshot. Zero selects the captured length as the period; an explicit period shorter than the captured prefix fails. Empty commit fails. `length()` remains the captured PCM length; `period()` is the logical loop length. A longer period adds an implicit zero-source suffix without allocating or clearing suffix PCM, and may exceed capture storage capacity. The host owns musical duration limits and conversion to frame counts. Capacity and incompatible-input rejection leave the live rack, take length, and output buffers unchanged. A committed take remains unchanged until an admitted `reset_for_capture()` prepares its storage for reuse. The first slice supports fixed graph and parameters. Live venue updates, automation timelines, graph edits, bypass/attach ramps, sparse slices, pitch/resampling, and arbitrary seeks are not implemented in this module. They must not be enabled through an integration fallback with incorrect cache-release state.

## Replay with evolving effect history

```cpp
if (!playback->start(true)) return;
playback->render(sample_left, sample_right, frames);
playback->stop();
playback->render(release_left, release_right, frames);
playback->reset();
```

Prepare `Playback` before the callback, even before capture begins. `PlaybackMode::evolving` is the supported mode and the default. Start succeeds only after commit. `start(loop, start_frame)` currently accepts only frame zero; a nonzero start fails without changing playback state. Only complete logical periods at unit playback rate are supported; a period can include a captured prefix and a zero-source suffix. `next()` returns one audible stereo frame, and `render()` calls that same path for every frame.

`begin()` snapshots the live rack at the actual capture boundary, including any warm history accumulated before recording. The first playback cycle emits the exact printed capture prefix while a shadow rack consumes the retained original source. During the zero-source suffix it emits the shadow rack output, including any natural tail. Subsequent cycles emit the shadow rack output across the entire period. Each wrap rewinds only the source cursor: the rack keeps its complete evolving history. Printed PCM never enters that rack.

Stop cuts before the next source frame and feeds zero through the whole current rack. Its release therefore includes history from every preceding loop. Upstream tails continue through downstream stages in order. A stop exactly after the final source frame preserves that final state. Nonloop playback automatically releases after the final logical-period frame. Repeated Stop is idempotent. Reset gates output, clears shadow state, and releases the take pin immediately.

This reproduces continuous processing of the repeated original-source prefix and zero-source suffix from the capture-begin snapshot, followed by zero input at Stop. Later loops can differ from the printed first cycle, including for one-frame loops. Exact captured length and logical period are retained; a nonperiodic source can still have an audible seam at its wrap.

To continue from the actual recording cutoff instead of replaying its beginning:

```cpp
if (!take->commit(period_frames)) return;
if (!playback->start_at_capture_end(true)) return;
```

`start_at_capture_end(loop)` copies the retained capture-end state and starts at `length()`. It advances through the implicit zero-source suffix, then wraps to source frame zero without resetting effect history. Every frame uses evolved output; it never replays the printed prefix as a fresh first cycle. The endpoint snapshot remains valid after the live rack advances. If captured length equals the period, the next frame wraps immediately with that endpoint state. Neither entry point seeks or reprocesses a source prefix during start.

The host must admit matching phrase periods and phase alignment before changing capture ownership, routing, or selected takes. Capture-end continuation transfers one audible rack history: the host must suppress the identical outgoing live-rack drain rather than mix that tail twice. Other detach operations keep their natural tails. Zero source after the cutoff does not force zero effect output. Arbitrary later phase joins remain unsupported.

The host may process a live block once and fan its result out to monitoring and capture:

```cpp
if (!take->begin(*live)) return; // actual recording boundary
if (!live->process(source_left, source_right, live_left, live_right, frames)) return;
if (!take->append_processed(*live, source_left, source_right,
                           live_left, live_right, frames)) return;
if (!take->commit()) return;
```

`append_processed()` stores original source and already processed stereo PCM without advancing DSP. Both processed channels are required for a nonempty block. The bound live rack, fixed graph and parameters, take state, and remaining capacity are checked before any storage mutation. Source pointer semantics match `capture()`. The appended source must be the same sanitized original input consumed by the rack. The sole render owner must preserve that original source before processing in place, including mono source; it must not pass overwritten source to append.

Keep each take alive until every prepared playback borrowing it is destroyed, including idle objects. Each concurrent playback needs its own prepared shadow rack. One render owner uses each mutable object. Playing and releasing playbacks pin their take. `reset_for_capture()` rejects reuse while any such pin exists, and succeeds after completion, reset, or playback destruction. Prepared idle playback objects do not pin storage and can start a newly committed capture from the same bank. The host must separately protect external sample borrowers; this guard tracks only this module's playback objects. Reuse clears captured length, logical period, and state without allocating, freeing, or clearing the prepared PCM buffers.

Original-source and printed PCM use `(source_channels + 2) * sizeof(float)` bytes per prepared take frame. Mono source uses 12 bytes per frame; the default stereo source uses 16. Mono original samples expand to both effect input channels on playback, while stereo effect output remains intact. A take also owns capture-begin and capture-end rack snapshots; each playback owns another. Include both take snapshots in preparation budgets. The virtual suffix adds no PCM storage. Every played source frame runs the shadow DSP, including the first cycle. Printing preserves exact first-cycle capture provenance; it does not provide a DSP speedup. `memory_bytes()` reports owned object and buffer bytes, excluding allocator bookkeeping. Host lifetime and concurrent-voice limits must account for every retained take and playback.

## Slapback limits

Slapback accepts sample rates from 1,000 through 384,000 Hz, delay from 40 through 250 ms, feedback from 0 through 0.7, and wet amount from 0 through 1. Defaults are 100 ms, zero feedback, and 0.25 wet. Invalid and nonfinite parameters fail preparation.

Each channel has independent fractional-delay interpolation. Mono therefore remains equal on both sides unless another stage deliberately changes stereo. Output is complete dry-plus-delayed audio. The generic rack does not apply that formula to other effect types.

Fixed zero wet has no audible release. Fixed zero feedback releases for exactly `ceil(sample_rate * delay_ms / 1000)` frames, including the last fractional-delay impulse contribution. Positive feedback with nonzero wet has a 12-second release cap. Residual audio after that cap is truncated; this first milestone has no release-end fade or energy-based early completion. Serial rack release bounds add. The native tests verify PCM state correctness within the declared release interval. Auditioning, live parameter smoothing, and production drain completion remain follow-up work.


## Chorus limits and state

```cpp
ChorusParameters parameters{.8, 5, 20, .35};
auto chorus = make_chorus(48000, parameters);
```

The parameter order is `rate_hz`, `depth_ms`, `base_delay_ms`, and `wet`. Admitted ranges are 0.05–5 Hz, 0–9 ms, 10–40 ms, and 0–1. The sample-rate range is 1,000–384,000 Hz. All values must be finite. The defaults above are editable engineering starting values, not operator preferences.

The stage adds one sinusoidally modulated, linearly interpolated delayed copy to the direct input: `output = input + wet * delayed_input`. There is no feedback or automatic normalization. This belongs to the modulated-delay chorus family described in [Julius O. Smith's Physical Audio Signal Processing](https://www.dsprelated.com/freebooks/pasp/Chorus_Effect.html). The implementation is local C++ and has no new library dependency.

Delay is `base_delay_ms + depth_ms * sin(2 * pi * phase)`, with phase starting at zero and advancing by `rate_hz / sample_rate` per frame. The independent parameter bounds keep delay between 1 and 49 ms. Depth zero reduces to a fixed fractional delay; wet zero is exact identity. Direct latency is zero. Equal left/right source stays exactly centered: the two independent source rings use the same modulation phase, without crossfeed or stereo widening. Existing stereo differences remain separate.

Snapshots and prepared state copies retain both rings, cursor, and modulation phase. Reset clears the rings and restores phase zero. Phase keeps advancing through zero-source rests and natural release, and evolving playback never resets it at a loop wrap. Captured printed PCM is never fed through its baked Chorus again. Factory, snapshot, and destruction allocate or reclaim memory; process, prepared copy, reset, commit, and playback do neither.

Each ring has `ceil(sample_rate * (base_delay_ms + depth_ms) / 1000) + 2` frames. At the supported maximum this is 18,818 frames per channel, or 150,544 ring bytes per effect instance, plus its object. `memory_bytes()` includes both rings. Budget every live, detached-tail, take snapshot, and playback instance separately.

With nonzero wet, the release bound is `ceil(sample_rate * (base_delay_ms + depth_ms) / 1000)` frames; wet zero has no audible release. After that many zero-input frames, all possible interpolated reads refer only to zero source. This is a maximum support bound, not a promise of energy on its final frame. Serial Rack release bounds add. The delayed branch uses the complete upstream output, so Slapback then Chorus also modulates the slapback repeats; the host must not add a second dry contribution around either full-output stage.

Native/WASM fixtures exercise an independent source-history oracle, modulation phase, snapshot/reset, channel independence, ordered nonlinear composition, processed capture, evolving wraps, endpoint continuation, zero-source rests, and natural Stop. These prove PCM behavior under fixed parameters; they do not establish a physical callback deadline. Song routing, activation windows, knob activity expiry, and stopped venue configuration belong to Performance Engine and its bridge.
