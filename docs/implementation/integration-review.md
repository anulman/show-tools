# DYC integration review checkpoint

This record separates verified components from a performance-ready song. The [decision trail](integration-decisions.tsv) preserves the review decisions and later corrections.

## Landed changes

[PR 5](https://github.com/anulman/show-tools/pull/5) adds the standalone effects foundation. [PR 7](https://github.com/anulman/show-tools/pull/7) adds peripheral diagnostics and portable input and light utilities. Both passed independent review before merge. No physical device was accessed.

[PR 8](https://github.com/anulman/show-tools/pull/8) landed at `ee1958bd63d355223a01573981591f8dbe9aac4c` after a fresh independent PASS+NOTES review of its complete visual milestone. Asset hashes, registered poses, native/WASM evaluation, builds, and both exact four-second exports passed checks. Browser interaction, live clock delivery, and CRT behavior remain outside that verdict. PixiJS is MIT; the authoring tool uses LGPL libvips through sharp, as recorded in the video license notices.

Combined main at `ee1958bd63d355223a01573981591f8dbe9aac4c` passed the practice and video builds, typecheck, layout check, 193 practice tests with two optional skips, and five video tests. This checkpoint adds documentation only.

## Earlier integration checks

[PR 9](https://github.com/anulman/show-tools/pull/9) contains the capture-capable integration. Its native engine passed independent review at `92e5b3692edb301d5b5827d047d53de4b3c44d07`. At the earlier `3759f2b` checkpoint, browser-key and settled-authoring changes left that native engine unchanged. The later ABI 4 implementation changed the engine and needed a fresh independent review, recorded below.

Independent checks passed five native suites in Release and sanitizer builds, fresh WASM checks, and real PCM probes. The [preserved probe receipts](integration-engine-receipts.txt) cover audible release feedback, unsupported lead-in rejection, safe stale-bank refusal, exact meter-dependent capture lengths, and preservation of audible takes after rejected replacement.

The corresponding regressions are in the committed [native tests](https://github.com/anulman/show-tools/blob/92e5b3692edb301d5b5827d047d53de4b3c44d07/lib/performance/tests/compiled_program_tests.cpp) and [WASM tests](https://github.com/anulman/show-tools/blob/92e5b3692edb301d5b5827d047d53de4b3c44d07/lib/performance/tests/compiled-wasm.test.ts). Their repository commands are documented in the PR and performance README. Temporary review programs are not required by the application.

Coordinator checks at `33fdbb4` passed actual app-handler probes for the first Escape and fresh Q press after refocus, 35 lifecycle and peripheral tests, and typecheck. The final settled-authoring change at `3759f2b` passed 22 compiler and import tests. Chart-panel DOM checks covered literal external text, blocked instructions, stopped loading, and disposal. These are offline host checks, not live browser or microphone verification.

After an effect edit preserves an older take, repeated capture within one transport run can exhaust compatible banks. The engine then refuses before changing audio or capture state. Stop and prepare effects before trying again. Unlimited uninterrupted recapture after an edit is not established.

## Operator answers and first test

The operator supplied the remaining authoring meanings after the earlier checkpoint. Do not reopen these as unanswered questions:

- `2c3` means press on 2, commit capture on 3, and rest for the remaining bar.
- `1p*` also sends a beat-1 tempo hit, equivalent to pressing the BPM pedal simultaneously. The prior phase-preservation requirement still applies.
- Doubled phrases are assumed to have equal lengths. Unequal authored periods must fail and notify the operator.
- Cue matching uses milliseconds or small beat fractions rather than whole phrases. The coordinator selected a configurable initial window of 25 ms on each side and rejects equal-distance ties. The exact 25 ms value is a starting implementation choice, not an operator quote.
- Knob execution is deferred for the first A-section run. Future audio effects react to the existence of rotation input; video uses its actual signed values. No inactivity timeout is implied.

The stated implementation interpretation separates recording cutoff from phrase period. Bing Bong records six counts, then has two explicit zero-source rest counts within its eight-count phrase. The new layer joins the existing phrase phase instead of replaying its first note on beat 3. Natural effect tails remain allowed. This does not authorize silently resizing genuinely unequal phrase periods.

The actual chart also arms Bing Bong during bar 4 while Drums & Claps is still recording. Their recording windows meet at bar 5 without overlap. The earlier coordinator restriction against overlapping arming was too broad and is withdrawn. Live routing, the current recording, and the next reservation are separate states. The next voice can arm and change live effects while the existing recording retains its processing until commit. Actual recording overlap still rejects without terminating the existing recording or transport.

These answers are implemented in ABI 4 and independently reviewed at `c26276f5d9c3889467386f7dd8651c16a3df2399`. PR 9 merged into main at `a2158dbf637a755ddd46a13c049bb316aa68ff0a`. The earlier component PASS at `92e5b36` was not reused as approval for those changes. Unity gains and chart-selected cowbell variants remain preserved.

Fresh browser, microphone, MP3-download, and physical-control verification remain outstanding. Computer Use reports no browser surfaces and a failed native pipe. The delivery target is readiness for the first operator DYC A-section test, not a claim that the room test already succeeded. A complete actual-source native/WASM run and independent software review must precede that test. The physical run must not become a circular prerequisite to making reviewed software available. [PR 6](https://github.com/anulman/show-tools/pull/6) was included through PR 9 ancestry and automatically marked merged. Its capture-disabled intermediate state never landed alone.

The [Figma gallery](https://www.figma.com/design/QWreOYAnaje2LlywefJFiK?node-id=2-12) and [motion study](https://www.figma.com/design/QWreOYAnaje2LlywefJFiK?node-id=2-154) now exist in the operator-selected Aidan's Starter team. Coordinator MCP screenshots show eight models with 24 poses. Fresh decoding of the exported study shows the pose changes; its 20 frames at 5 FPS last exactly four seconds. The images remain raster artwork inside editable components. Optional original PDF-page copies were excluded after automatic approval review rejected their upload. The completed pose library does not depend on those copies. Neither preview has a live Performance Engine subscription.

The shared native tempo-hit path now preserves phase, beat ID, and epoch. A direct WASM check changed 120 BPM to 100 BPM while retaining those values. Physical pedal bindings, mappings, wiring, and light policies remain installation facts.

## Final software review

Two fresh independent reviews passed the final integration head. Capture review rebuilt sanitizer tests and used a separate scalar delay recurrence as its PCM oracle. The comparison matched 472,000 stereo frames through warm capture, endpoint handoff, silent-source remainder, five evolving wraps, and natural release. Four transaction regressions also passed, including reversed button order. Missing selected members reject before publication. Invalid-period cleanup discards only the incompatible draft and cancels its dependent start. A valid independent commit survives a new reservation failure.

Clock and host review rebuilt ABI 4 WASM, passed 81 focused tests and five native suites, and verified the immutable offline manifest. Its offline VM checks do not certify an upgrade from an actual installed old worker. No live-browser result is inferred.

Primary clean-checkout verification passed all 278 follower-enabled tests, typecheck, UI build, layout checks, and five video tests. The actual frozen A-section chart compiled to one retained portable artifact, then passed native and WASM execution at both 44.1 and 48 kHz. Each run produced nine ready takes, two tempo hits, and 361 events before silent completion. Reproduce the chart run with `npm run build` and `npm run verify:dyc`. The program prints its retained artifact directory. [The final PR review](https://github.com/anulman/show-tools/pull/9#issuecomment-6450432230) records the exact reviewed head and limits.

The software is available for the first operator test. Run `npm start`, open `http://127.0.0.1:8082/ui/practice/`, select the actual audio devices, keep bars 1 through 76, and disable Loop range for one complete A pass. Enable Slapback before Start if testing effects. Confirm the physical monitoring setup after microphone acquisition. [The practice guide](../../ui/practice/README.md#try-live-microphone-effects-during-practice) covers monitoring and MP3 download. Sheets, CDP, a relay, and hardware are optional. Chorus and knob execution remain deferred.

## Commit provenance

1Password signing failed during this run. Implementation commits and the video conflict-resolution merge use an explicit per-command unsigned exception. Repository and global signing configuration remain unchanged. GitHub publication still uses authenticated access. The initial effects push rejection was resolved by verifying the private repository and destination before a normal reviewed retry.
