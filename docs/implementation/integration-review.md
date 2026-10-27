# DYC integration review checkpoint

This record separates verified components from a performance-ready song. The [decision trail](integration-decisions.tsv) preserves the review decisions and later corrections.

## Landed changes

[PR 5](https://github.com/anulman/show-tools/pull/5) adds the standalone effects foundation. [PR 7](https://github.com/anulman/show-tools/pull/7) adds peripheral diagnostics and portable input and light utilities. Both passed independent review before merge. No physical device was accessed.

Combined main at `c5261a83f38c035a0c53f74e4b1576fcd717013e` passed the browser build, typecheck, layout check, and 193 tests with two optional skips. This checkpoint adds documentation only.

## Draft integration checks

[PR 9](https://github.com/anulman/show-tools/pull/9) contains the capture-capable integration. Its native engine passed independent review at `92e5b3692edb301d5b5827d047d53de4b3c44d07`. Later browser-key and settled-authoring changes do not change that native engine.

Independent checks passed five native suites in Release and sanitizer builds, fresh WASM checks, and real PCM probes. The [preserved probe receipts](integration-engine-receipts.txt) cover audible release feedback, unsupported lead-in rejection, safe stale-bank refusal, exact meter-dependent capture lengths, and preservation of audible takes after rejected replacement.

The corresponding regressions are in the committed [native tests](https://github.com/anulman/show-tools/blob/92e5b3692edb301d5b5827d047d53de4b3c44d07/lib/performance/tests/compiled_program_tests.cpp) and [WASM tests](https://github.com/anulman/show-tools/blob/92e5b3692edb301d5b5827d047d53de4b3c44d07/lib/performance/tests/compiled-wasm.test.ts). Their repository commands are documented in the PR and performance README. Temporary review programs are not required by the application.

Coordinator checks at `33fdbb4` passed actual app-handler probes for the first Escape and fresh Q press after refocus, 35 lifecycle and peripheral tests, and typecheck. The final settled-authoring change at `3759f2b` passed 22 compiler and import tests. Chart-panel DOM checks covered literal external text, blocked instructions, stopped loading, and disposal. These are offline host checks, not live browser or microphone verification.

After an effect edit preserves an older take, repeated capture within one transport run can exhaust compatible banks. The engine then refuses before changing audio or capture state. Stop and prepare effects before trying again. Unlimited uninterrupted recapture after an edit is not established.

## Readiness holds

Current DYC remains blocked on `2c3`, starred playback, exact layer groups, cue proximity, and knob binding or explicit deferral. Unity gains and chart-selected cowbell variants are already settled. The blocked default song must not replace working practice on main.

Fresh browser, microphone, MP3-download, and physical-control verification remain outstanding. [PR 6](https://github.com/anulman/show-tools/pull/6) must not land alone because it disables effected capture. PR 9 remains draft until its dependent holds are resolved.

[PR 8](https://github.com/anulman/show-tools/pull/8) passed source, native, and WASM checks. Its delivered animation visibly contains eight models changing poses. Independent interactive review was inconclusive because computer-use browser access was unavailable. It remains unmerged; neither live clock delivery nor Figma completion is claimed.

The existing tempo-tap path restarts the clock. It remains disconnected from the proposed pedal integration until phase preservation is implemented and verified. Physical mappings, wiring, and light policies remain installation facts.

## Commit provenance

1Password signing failed during this run. Implementation commits and the video conflict-resolution merge use an explicit per-command unsigned exception. Repository and global signing configuration remain unchanged. GitHub publication still uses authenticated access. The initial effects push rejection was resolved by verifying the private repository and destination before a normal reviewed retry.
