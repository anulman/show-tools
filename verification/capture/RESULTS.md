# Capture verification result

Current outcome: **updated** against native source commit `7e3b3c19c71b14b1370c2b36bf6c8a804bbd7935`. Exact production hashes are retained in [source-record.json](source-record.json). The finite model explicitly carries the outgoing `autoplay` or `store-only` launch policy. Ordinary commit and commit-and-arm keep their conditional autoplay promise. Store-only publication never launches its newly retained bank.

The pinned command `node verification/capture/verify.ts` passes with explicit `JAVA` and `TLA2TOOLS` paths. The retained execution receipt is `/private/tmp/native-cues-capture-final-7e3b3c1/receipt.json`. Temporary execution files are evidence, not canonical application data.

- Main bound remains 3 takes, 2 banks each, and at most 3 capture beginnings. TLC generates 201,097 states, finds 11,894 distinct states, and exhausts its queue. All eleven configured invariants pass.
- The original smaller bound remains 2 takes and at most 2 beginnings. It exhausts 6,327 generated and 782 distinct states. Launch policy makes it larger than the statechart tool's 500-state complete-chart budget.
- The separate one-beginning overview exhausts 555 generated and 102 distinct states. Its generated chart has 6 labels and 13 arrows. It omits 156 transitions whose endpoints share a label, and cannot display a successful second capture.
- Six model mutants fail their named invariants. Seven actual-source mutants fail their intended native assertions. All twelve native scenarios pass before and after the temporary mutations, and production hashes remain unchanged.
- Store-only native witnesses check pressed and missed endpoints at 8, 44.1, and 48 kHz. They check exact retained length and period, silent sample output, missed-play silence, and later explicit launch of the immutable source. Additional paths retain another source in the same voice and preserve newly published autoplay under a replacing combined commit-and-arm.
- Strict TypeScript checking of the verifier, view, and runner passes. All three runner failure tests and `git diff --check` pass.

All pristine and mutated model outcomes were interpreted through the current `/statechart` command. Every rule is checked. The store-only mutation has a two-step shortest counterexample after the initial state: arm a capture, then incorrectly autoplay its store-only publication. The latest-bank mutation has three steps. Each other intended policy violation has two. Additional mutant consequences remain visible, including retained-bank completeness and conditional autoplay after a missing endpoint.

The newly added replacing combined witness exposed a product bug during implementation. Capture-start replacement stopped its own just-published outgoing take. The native fix excludes that outgoing take, and the unchanged autoplay expectation now passes. The initial sandbox socket failure was a harness restriction. Packet and source-fence updates were verification drift. These categories are recorded in [SOURCE-SYNC.md](SOURCE-SYNC.md).

This remains a bounded model safety result with selected real C++ witnesses and mutation sensitivity. It does not prove arbitrary audio arithmetic, source phase, finite playback duration, pitch bend, held release, per-note selection, external sample loading, physical timing, or exhaustive refinement of C++. The main bound and the original two-capture display bound were not reduced.

The source refresh from `8d9dd8b` to `7e3b3c1` changes playback gate ownership, practice-loop note availability, immutable source phase conversion, authored next-bar quantization, and packet group validation. The capture model, eleven invariant definitions, finite bounds, and all mutation controls are unchanged. The complete twelve-scenario native and seven-source-mutant rerun passes against the refreshed source hashes. These playback regressions require separate WASM execution checks and are not new claims of the finite capture proof.

## Historical verification results

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

## Idempotent jiggle reconnect source synchronization

Outcome: **updated** at source sync `5a3a4ba0dbf368f3b5ac74270901107e46e33169`. The original runner's header-hash rejection was expected verification drift. Read every covered-source diff since `b356501`; the three changed files add the intentional same-value configuration no-op, its public comment and its regression fixture. Capture admission, publication and cleanup are unchanged. No model property, finite bound or mutation witness changed; gesture-history and reconnect correctness remain outside this capture proof.

The maintained pinned run exhausted the full graph (42,863 generated / 4,904 distinct states) and display graph (1,825 / 362). All ten invariants and all eleven native scenarios passed; all five model mutants and six assertion-specific actual-source mutants were rejected. The final eleven-scenario pristine rerun and all source-hash checks passed. Every one of the seven results was read through the current `/statechart` tool with no unchecked rules or evaluator errors. The seven-state/23-arrow display chart is byte-identical to the retained chart and still omits 382 same-label steps. The deliberate mutant paths and additional invariant consequences retain their previous meanings.

Native-audio's five and MusicXML's eleven covered files remain byte-identical to their fences: **in sync**, without unrelated proof reruns or mapping changes. The capture skill validator and `git diff --check` passed. Full receipts, traces, charts and mutation logs remain outside Git in the retained temporary proof directories. No product source was changed by maintenance.
