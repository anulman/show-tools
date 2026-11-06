---
name: verify-capture-handoff
description: Verify compiled C++ capture admission, bank ownership, publication, automatic completion, or Stop/wrap policy changes with the bounded TLA+ model and actual-source mutation witnesses.
---

# Verify capture handoffs

Read `verification/capture/README.md` before changing compiled capture policy. The rules protect outgoing capture on rejected combined admission, preserve a valid independent commit despite failed incoming admission, block starts after invalid release, protect retained banks, and require successful completion/autoplay.

Last confirmed source sync: `09e5ecfbed4d37bd3ea595dc5c35ea9339ed15f0`. `verification/capture/source-record.json` records covered file hashes. Coverage includes `compiled_program.cpp` bank selection, `press`, preflight, `execute`, `finish_capture`, `apply_pending`, Stop, and wrap; the engine C interface, patch cache/playback methods, and real compiled-program fixtures are source-coupled through witnesses. Unified cue-button dispatch and sliced automatic completion/bank reuse have additional focused native witnesses. Slice arithmetic, effect checkpoints, jiggle semantics, and light delivery are outside the formal claim. Wrap is covered by a native witness, not a formal model of playback continuity. The model does not prove every C++ trace or DSP behavior.

1. Inspect changes since that source sync in every recorded file. Confirm the model still describes the real serialized owner-thread boundaries. Preserve the distinct combined, independent, automatic, Stop-incomplete, and Stop-complete policies.
2. Provision the pinned toolchain through `verification/tools/README.md`, then run `node verification/capture/verify.ts` with absolute `JAVA` and `TLA2TOOLS` environment paths. The default result is a fresh owned temporary directory; an explicit `--out` directory must be new.
3. Read `receipt.json` and logs. Require complete model queue exhaustion, all five named model counterexamples, all ten pristine native witnesses, five assertion-specific actual-source mutant failures, and a final pristine native rerun. The runner refuses changed source hashes and tool drift.
4. Read every TLA+ result with `/statechart`, using that skill's current instructions. Use the smaller `CaptureHandoff-chart.cfg` for the full readable graph; it carries the same rules at a smaller bound. Preserve the full larger model result separately.
5. If source behavior intentionally changes, update the plain-language contract, model, native witnesses, and source hashes together. Move the sync commit forward only after confirming that mapping and repeating the deliberate actual-source mutation check. Never change a property merely to obtain PASS.

A model counterexample is not automatically a product defect. Replay it using the real C++ witness or a new focused fixture. If the real code does not reproduce it, first investigate an incorrect abstraction. Expected broken-variant failures require no operator interruption. Unexpected product violations are reported with the concrete event order and suggested next steps; hold only dependent work. Tool/socket/compiler failures return to Chief rather than becoming operator product questions.

The proven finite domain has three takes, two banks each, and at most three capture beginnings. Final boundary and cleanup actions remain checked after the last allowed beginning. Period/phase arithmetic, arbitrary resource failures, effects fidelity, physical timing, and unbounded liveness remain outside the claim. Use `/maintain-formal-verification-skill` when keeping these checks in step with later source changes.
