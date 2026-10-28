# Engine-owned light execution

The operator requires Performance Engine to own light activation, keyframes,
quantization, continuous musical phase, and tempo-change behavior. Hosts render
or deliver evaluated engine output. They do not infer phase from BPM or receipt
time.

## Current milestone

`lib/performance/src/performance_lights.h` supplies a bounded, allocation-free
bank of explicit light instructions. It consumes an authoritative count
coordinate supplied by its owner. It does not read the tracker, advance time, or
publish live engine state. Existing PE ABI 5 and browser behavior are unchanged.

`performance_light_output.h` defines the proposed complete output image; its
generated TypeScript constants and validated types share that layout. There is
no native producer connected to it yet. Decoder tests prove validation, not
live synchronization.

A replacement supplies all IDs, patterns, normalized strengths, count periods,
and blink duties. No venue presets or pad-state assignments are selected. Missing
IDs mean off in the consumer's explicit owned mapping. One active bank and one
pending replacement avoid partial updates. The prior bank continues until the
pending activation boundary. Repeating an identical revision preserves its
origin; stale or conflicting requests fail atomically.

The bank selects either the current count or the next inclusive grid boundary
from the explicit request. Grid arithmetic uses the supplied binary64 coordinate
and `ceil(count / quantum) * quantum`, without a wall-clock tolerance. A value
one representable step after an exact boundary selects the following boundary.
The clock integration must provide coherent coordinates and test their numerical
behavior at real crossings.

## Design decision

Two designs were compared: an atomic bank of callable instructions and a
prepared finite song score. The bank is the base because no authored light score
or production semantic assignments exist. The score candidate contributed the
requirement for coherent complete publications and explicit engine-incarnation
fences. A separate reviewer preferred the bank, 23/25 versus 21/25. The agents
used the same available model family; this was independent review, not model
diversity.

Future output images contain evaluated brightness plus native sequence, run,
generation, clock epoch, coherent frame, sample rate, and diagnostic count.
Every image is complete, so a lost intermediate image does not require replay.
Publication sequence is a positive exact integer across runs in one engine
incarnation. Its maximum JavaScript-safe value, 2^53-1, is reserved for terminal
all-off output with no pending activation. Further activation requires a new
engine incarnation; a sequence must never wrap or be reused.
An adapter must fence engine incarnation, device session, binding revision, and
the request that obtained a fresh image. A new binding cannot retag an old image
as fresh. USB delivery and its cadence remain outside PE.

Historical PE events cannot simply append the tracker's current phase:
`pf_process` advances the tracker chunk before dispatching historical crossings.
A light image must instead come from a coherent completed boundary.

## Pending clock policy

Ordinary tempo edits and taps must preserve the active bank. Existing
`BT_APPLY_BPM` and `BT_TAP` deliberately rephase the audio clock;
`bt_tempo_hit` preserves its phase. The operator has been asked whether lights
should preserve their current curve phase and change speed, or align to the
audio clock's new beat phase after a deliberate rephase. That decision is
pending. No cancellation or alignment policy is implemented by this milestone.

The later clock integration must test both ordinary command paths, midpoint
tempo changes in pulse and blink, range loops, restart/reset, historical-frame
coherence, and stale/reordered delivery. Numeric brightness presets, musical
grids, blink duties, state assignments, physical mapping, and physical delivery
timing remain explicit operator choices.

## Verification

Run `npm run test:lights` for the portable native/WASM fixture and TypeScript
boundary tests. It retains its generated binaries in the reported temporary
directory. A native Performance Engine CMake build also runs the bank fixture.

The domain fixture runs the same C++ tests natively and in WASM. It covers
pending replacement, exact and neighboring grid coordinates, cosine and blink
boundaries, idempotency, invalid-input atomicity, stale generations, all 32
logical IDs, and allocation-free replacement and sampling. Sanitized execution
also passes. Counter threshold assertions reserve a terminal generation; no
runtime near-exhaustion injection has been performed.

TypeScript tests validate complete images, duplicate IDs, normalized output,
identity bounds, zero padding, and atomic command encoding. No device is opened.
These checks establish reusable mechanisms, not live PE publication, browser
synchronization, or physical LED behavior.

The milestone passed six native CTest cases, the native/WASM bank verifier and
four TypeScript boundary/ABI cases, typecheck, and the normal app build. The full
suite passed 297 of 299 tests with two optional follower skips. The new C header
also passes a C11 syntax check.
