# Capture verification result

Verified against source sync `09e5ecfbed4d37bd3ea595dc5c35ea9339ed15f0`, with the unchanged mapped source files checked by SHA-256. This is a bounded model safety result with actual C++ witness/mutation sensitivity. It is not an unrestricted implementation or DSP proof.

The reproducible command is `node verification/capture/verify.ts` after provisioning the pinned `JAVA` and `TLA2TOOLS` environment paths. Logs and the full machine receipt are generated outside Git.

- Full model: 3 takes, 2 banks each, at most 3 capture beginnings. TLC generated 42,863 states, found 4,904 distinct states, and exhausted its queue. All ten configured invariants passed.
- Smaller display model: 2 takes and at most 2 beginnings. TLC generated 1,825 states, found 362 distinct states, and exhausted its queue. The same invariants passed. The current `/statechart` output draws 7 user-visible states and 23 arrows; it omits 382 self-label transitions.
- All 10 actual C++ scenarios passed. Five actual-source mutants failed at their intended policy assertions. The pristine executable passed all 10 scenarios again afterward. Production source hashes remained unchanged.
- All five model mutants produced their named invariant failures. Their shortest counterexamples have two steps after the initial state, except latest-bank overwrite, which has three. Every result was read through `/statechart`. The invalid-release mutant also received the finite-domain repair described below.
- Strict TypeScript checking, the project skill validator, and `git diff --check` passed. The current-source maintenance delta and source classifications are in [SOURCE-SYNC.md](SOURCE-SYNC.md).

The rejected-arm path is: arm a recording, reject its combined incoming target, and incorrectly lose the outgoing recording. The real C++ mutant produces the corresponding unavailable-CRB assertion failure. An earlier mutation only inside `execute` survived because public admission blocked it earlier; that version was discarded rather than counted as evidence.

The invalid-release path is: arm a recording, fail its outgoing validation, and incorrectly start an incoming recording. The real C++ mutant fails the source-cue/status assertion. The other counterexamples expose recording over a retained bank, missing autoplay, and missing authored endpoint completion.

The finite model does not prove clock advancement, numeric boundary conversion, arbitrary effect state, physical timing, or exhaustive trace equivalence with C++. Successful endpoint publication is conditional on evaluating the modeled endpoint. Selected actual native witnesses check missed-finish delivery at 8, 44.1, and 48 kHz. Stop-complete behavior has a direct real `Program` witness so adapter endpoint evaluation cannot conceal that distinct transition.

Current-source native coverage also includes automatic final-bar slice publication across three captures, immutable-parent readback, audible playback, and unified cue-button ordering, held repeats, release, and independent outcomes. The no-autoplay source mutant disables both full-take and slice start paths plus selection playback. No production files, invariant wording, or finite bounds changed.

Statechart first exposed a verification-only bound defect in continued exploration after the invalid-release mutant's intended counterexample. That broken branch could start a fourth generation and then read outside the finite publication domain. The negative variant now requires remaining generation capacity for its deliberate invalid start. Its two-step `InvalidReleaseCannotAdmit` counterexample is preserved, and the corrected statechart checks all remaining rules without an evaluator error. The corrected mutant statechart reaches 4,484 states. The pristine model still exhausts exactly 4,904 states.

## Shared-tuner maintenance

Updated at source sync `9b51479061fa48fbfffb8271541c1cf475a7e101`. The ten invariant definitions and finite bounds are unchanged. The pristine full graph again exhausts 4,904 states and the display graph exhausts 362. All five formal mutants retain their named failures. All eleven native scenarios pass before and after six assertion-specific actual-source mutations. The added native-only mutation removes the tuner gate during recording and fails the new isolation assertion. It does not extend the formal model to tuner state. Production hashes are checked after restoration.

The original hash rejection and missing tuner dependency in the standalone witness build were verification drift. No capture-policy product bug was found. The source classification and scope exclusions are recorded in [SOURCE-SYNC.md](SOURCE-SYNC.md).

## Native cue-light source synchronization

Outcome: **updated** at source sync `b356501773ecae24d31e2f20abffa4e88c4b3600`. The initial source-hash rejection was expected verification drift. The new const cue query and its use in light publication do not change capture transitions; model, invariants, bounds and mutation witnesses remain unchanged. Cue-warning timing and physical LED delivery are not proved here.

The pinned full rerun exhausted 42,863 generated / 4,904 distinct states and passed all ten configured invariants. The smaller display model exhausted 1,825 generated / 362 distinct states. All five model mutants failed their named rules; all eleven native scenarios passed before and after six assertion-specific actual-source mutant failures. Production source hashes were unchanged after the final pristine rerun.

All seven results were independently read through the current `/statechart` entry point, with no unchecked rules or evaluator errors. The display view remains seven states and 23 arrows, omitting 382 same-label transitions. The deliberately broken latest-bank variant also breaks `LatestIsComplete`, and missing endpoint completion also breaks `SuccessfulPublicationAutoplays`; these are expected additional mutant consequences, not pristine product findings. The finite counterexample paths retain their previous lengths and meanings.

Native-audio's five recorded files and MusicXML's eleven recorded files are byte-identical to their existing source fences; those checks remain **in sync**, with no record/model update or unrelated proof rerun. The capture skill validator and `git diff --check` passed. Temporary receipts, statechart reports, traces and native mutation logs remain in the coordinator's retained proof directories.
