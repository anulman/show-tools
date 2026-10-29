# Logical LED recipes

[peripheral_lights.h](include/peripheral_lights.h) defines reusable C routines for off, steady low/mid/max, smooth pulse, and blink. The same C++ source builds natively and to WASM. A recipe describes one logical LED. Sampling produces that ID and a normalized brightness without accessing hardware or advancing time.

## Routines

Every constructor returns `0` on success or `PP_INVALID` on invalid input. Failure leaves the output unchanged.

| Routine | Result |
| --- | --- |
| `pp_light_off(id, out)` | Constant zero brightness |
| `pp_light_on(id, strength, levels, out)` | Constant brightness selected by `PP_LIGHT_LOW`, `PP_LIGHT_MID`, or `PP_LIGHT_MAX` |
| `pp_light_pulse(id, strength, levels, origin, period, out)` | Cosine pulse between zero and the selected brightness |
| `pp_light_blink(id, strength, levels, origin, period, duty, out)` | Rectangular blink between zero and the selected brightness |
| `pp_light_evaluate(recipe, position, out)` | A `pp_light_sample` containing the recipe's logical ID and current level |

IDs are opaque `uint32_t` values. They do not select I-PAC SDK channels or Performance Engine voices. The host owns the explicit mapping from logical ID to physical output. Changing one recipe does not write an LED enable mask or affect another recipe.

`pp_light_levels` supplies `low`, `mid`, and `max`. All three values must be finite and satisfy `0 <= low <= mid <= max <= 1`. Recipes copy their selected value. Later changes to the level table do not alter an existing recipe. No venue brightness defaults are selected by this API.

## Timing and endpoints

`origin_beat`, `period_beats`, and the supplied sampling position share Performance Engine's authoritative count-beat coordinate. Periods must be finite and positive. Fractional periods are supported. Use the engine's count-beat unit rather than assuming quarter notes. In the confirmed 6/8 workflow, a count beat is an eighth note. The engine owns conversion from bars or note lengths to this coordinate. The constructors preserve the supplied origin and period exactly. They do not round, align, delay activation, or derive timing from BPM.

Pulse brightness peaks at the origin and every full-period boundary. It reaches zero at each half-period. The cosine has a smooth peak and trough. Blink is on from phase zero up to, but excluding, `duty * period`, then off until the next full-period boundary. Duty must be strictly between zero and one. Use off or on for a constant result.

Sampling before the origin wraps periodically, matching the existing `pp_pattern_value` convention. An origin defines phase, not an activation deadline. A recipe with a future origin is not silent until that origin. Performance Engine exclusively owns scheduled musical activation and cancellation. The host does not turn a phase origin into its own activation timer.

Duplicate samples return the same result. Delayed, skipped, or reordered samples do not restart the recipe. The evaluator has no internal cursor or prior sample. Sample position and the difference between position and origin must be finite. Invalid recipes, nonfinite values, and arithmetic overflow return `PP_INVALID` without changing the sample output. Timing fields unused by a recipe kind do not control its result.

## Caller ownership

Performance Engine exclusively owns the musical meaning, quantized period, keyframes, phase origin, continuous phase, and activation/cancellation boundaries. An output host samples or delivers engine-authored output. It does not choose musical timing or reconstruct phase from BPM or message arrival. The evaluator must receive a coordinate with the continuity selected by PE. `PF_POSITION_BEAT` is chart-relative and wraps on range loops. It is not a monotonic phase source. Current PE ABI 6 does not publish a complete continuous light-phase contract.

The caller must discard stale recipes across the appropriate run, clock epoch, device session, and binding revision. `PF_EPOCH` alone is not a run or device-session identity. A stateless evaluator cannot enforce those gates. Event loss or reconnect requires the caller's recovery policy before old recipes can be reused. On a restart, PE explicitly retains or replaces the origin according to its musical policy. The host discards stale publications rather than inventing a replacement origin. No input-edge or spinner behavior changes in this module.

PE advances the authoritative phase using the current tempo. A tempo change during a pulse or blink changes the remaining duration in frames while preserving the musical phase required by PE. Beat-based keyframes remain engine-owned. This evaluator supplies the curve math; it does not implement that engine publication contract. The host must not extrapolate position from snapshot arrival time. The output adapter owns sampling cadence, normalized-to-device quantization, USB delivery, and reconnect behavior. No audio-thread device IO is introduced. Production adapters must preserve their owned enable masks rather than calling the isolated bench commands that disable seven peer outputs.

The [complete-image delivery gate](DELIVERY.md) validates the engine publication schema and connection identity, then prepares brightness reports. It adds no host musical scheduling or actual device delivery.

## Calling shape

The following calls use configured levels and PE-selected timing values. They illustrate separate recipe choices, not a sequence to send to hardware.

```cpp
pp_light_recipe recipe;
pp_light_on(led_id, PP_LIGHT_LOW, &configured_levels, &recipe);
pp_light_on(led_id, PP_LIGHT_MID, &configured_levels, &recipe);
pp_light_on(led_id, PP_LIGHT_MAX, &configured_levels, &recipe);
pp_light_off(led_id, &recipe);
pp_light_pulse(led_id, PP_LIGHT_MAX, &configured_levels,
  grid_origin_beat, period_beats, &recipe);
pp_light_blink(led_id, PP_LIGHT_MAX, &configured_levels,
  grid_origin_beat, period_beats, duty, &recipe);

pp_light_sample sample;
if (pp_light_evaluate(&recipe, authoritative_position_beat, &sample) == 0) {
  // Route sample.led_id and sample.level through the host's explicit mapping.
}
```

Check each constructor's result before retaining a recipe. The existing `pp_trigger_value` remains available for explicit attack/hold/decay evaluation. No trigger overlap policy or pending/recording pattern assignment is selected here.

## Verification boundary

The portable fixtures cover named levels, opaque IDs, smooth periodic endpoints, fractional periods, pre-origin wrapping, duty boundaries, duplicate and skipped sampling, explicit origin replacement, and invalid-input output preservation. Native and WASM execute the same cases. Fixture brightness levels are synthetic, not chosen operator presets. Building and testing opens no devices.

The earlier [bench demonstration](../../docs/guides/ipac-mac/bench-verification.md) established that LED 1 can visibly follow a cosine brightness sequence. It did not exercise this recipe API. Actual PE snapshot publication, run/session gates, production LED delivery, browser pad rendering, exact physical timing, and venue preset selection remain separate integration work. The Performance Engine session agreed to this seam without a PE ABI change.

## Milestone checks

The coordinated implementation passed these checks on the Mac:

- `node --import tsx lib/peripherals/scripts/verify.ts /tmp/ipac-light-routines-build`: 14 native CTest cases, 94 matching native/WASM observations, and three capture-summary tests. All five new C ABI exports were present in WASM.
- `npm run typecheck` and `npm run build` passed.
- `npm test` passed 295 tests with two optional follower tests skipped. Localhost fixture sockets required permission outside the restricted sandbox.
- Local Markdown targets and `git diff --check` passed.

`npm run check:layout` could not pass in the isolated checkout because the optional follower `beat-tracker.wasm` and video `video-pose.wasm` artifacts were not built. The normal practice build passed. This milestone changes no UI files or optional module sources.

Performance Engine reviewed the API, ownership, and documentation with no blocking findings and independently passed the native 14-case suite. No device was opened for this milestone. Low/mid/max venue values and musical alignment defaults remain operator choices, so the API requires explicit configuration.

## Required integration checks

The next PE-owned publication milestone must test tempo changes in the middle of a pulse and a blink, phase continuity at loop boundaries, explicit restart/epoch behavior, and stale or reordered publications. Those checks must exercise the real engine clock and publication path. The pure evaluator's native/WASM agreement does not establish tempo synchronization or reset enforcement in a live output host.
