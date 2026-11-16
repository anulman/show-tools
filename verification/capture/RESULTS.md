# Capture verification result

## GNU header portability maintenance

Outcome: **updated** at `9050285`. Adding the explicit `<iterator>` include changes no capture semantics. The original gate rejected the header hash before execution. The complete pinned rerun passes 201,097 generated and 11,894 distinct main states, 782 display states and 102 overview states. All six model mutants, seven actual-source mutants and twelve pristine/restored native scenarios pass their expected checks. Receipt: `/private/tmp/capture-portability-final/receipt.json`.

All nine statechart interpretations have no unchecked rules and retain their expected two- or three-step mutant counterexamples. Reports: `/private/tmp/capture-portability-statecharts/outcomes.json`. The model, finite bounds and native scenarios are unchanged. This does not establish producer isolation, spinner history, LED wiring or physical hardware acceptance.

## Staged held-owner execution maintenance

Outcome: **updated** at source `7740b3bf9b98d77f2e0a85b6db7f8dd650403313`, after reviewing fix `8947b62`. The original gate rejected the changed `compiled_program.cpp` hash before model execution. That was source correspondence drift. The native playback defect that motivated the fix is outside this capture model; no capture-policy counterexample was found.

The complete pinned run passes 201,097 generated and 11,894 distinct main states with an empty queue. The unchanged display and overview finish at 782 and 102 states. All eleven invariants, six model mutants, twelve pristine native scenarios, seven assertion-specific source mutants and twelve restored scenarios pass their expected checks. Receipt: `/private/tmp/capture-owner-fixed-final/receipt.json`. All recorded source hashes match after restoration.

All nine statechart interpretations finish with no unchecked rules. The overview retains six labels, thirteen arrows and 156 hidden same-label steps. Each intended mutation has a two-step shortest counterexample except the three-step retained-bank violation. Reports are in `/private/tmp/capture-owner-statecharts/`. The three runner failure regressions also pass.

Only held or gated `PF_PLAY` execution receives the new owner check. Capture preflight, commit-before-arm execution, protected banks, publication and launch policy remain unchanged. The model, finite bounds, replay scenarios and mutation controls are unchanged. Producer isolation, Panic priority, hardware behavior and successful cross-row held-playback policy remain outside this formal claim.

## Identified input routing maintenance

Outcome: **updated** at `dfd9c1fc61dd6273b08026f8f2da29516e8f58d8`. The complete run passes 201,097 generated and 11,894 distinct main states with an empty queue, all eleven invariants, six model mutants, twelve pristine/restored native scenarios and seven assertion-specific real-source mutants. The separate display and overview checks finish at 782 and 102 states. Receipt: `/private/tmp/routing-capture-final-restored/receipt.json`.

All nine current statechart interpretations finish with no unchecked rules. The 102-state overview retains six labels, thirteen arrows and 156 hidden same-label transitions. Source-fence drift and the standalone/mutant compiler dependencies were verification maintenance; no capture-policy product defect was found. [SOURCE-SYNC.md](SOURCE-SYNC.md) maps the reviewed dispatch and ownership changes. Producer leases and held-playback isolation remain outside this capture proof.

## Consolidated practice release

The source-fenced run at `cd3ae7e08c7a852b3d14766ffd9c9a6a1827aaa4` passes: 201,097 generated and 11,894 distinct main-model states with an empty final queue, all eleven invariants, six model mutants, twelve actual-native scenarios and seven assertion-specific source mutants. The 782-state display and 102-state overview models also finish. The twelve-scenario pristine rerun and production-source hashes pass after all mutations. Receipt: `/private/tmp/practice-tonight-capture-final-cd3ae7e/receipt.json`.

The store-only scenario now runs with automatic sustain analysis enabled, under profiles 0, 4 and 5 at 8, 44.1 and 48 kHz. Pressed and missed stores preserve their full sources and remain silent. A later ordinary play still works; a held press over the unsuitable constant source rejects without changing the retained take or its playing loop. The launch-policy mutants still fail the original autoplay/store assertions. No model property, bound, original scenario or mutation was weakened.

The initial source-hash rejection and the new witness's first error-code assertion were verification drift. No capture-policy product defect was found. The finite model and configurations are byte-identical to the previous checked versions, so their prior statechart interpretation still applies. This run refreshes source correspondence and native execution evidence; it does not prove the periodic analyzer's musical quality, phase arithmetic or real-time cost. See [SOURCE-SYNC.md](SOURCE-SYNC.md).

Current outcome: **updated** against native source commit `cd3ae7e08c7a852b3d14766ffd9c9a6a1827aaa4`. Exact production hashes are retained in [source-record.json](source-record.json). The finite model explicitly carries the outgoing `autoplay` or `store-only` launch policy. Ordinary commit and commit-and-arm keep their conditional autoplay promise. Store-only publication never launches its newly retained bank.

The pinned command `node verification/capture/verify.ts` passes with explicit `JAVA` and `TLA2TOOLS` paths. The retained execution receipt is `/private/tmp/native-cues-capture-final-894915f-profiles/receipt.json`. Temporary execution files are evidence, not canonical application data.

- Main bound remains 3 takes, 2 banks each, and at most 3 capture beginnings. TLC generates 201,097 states, finds 11,894 distinct states, and exhausts its queue. All eleven configured invariants pass.
- The original smaller bound remains 2 takes and at most 2 beginnings. It exhausts 6,327 generated and 782 distinct states. Launch policy makes it larger than the statechart tool's 500-state complete-chart budget.
- The separate one-beginning overview exhausts 555 generated and 102 distinct states. Its generated chart has 6 labels and 13 arrows. It omits 156 transitions whose endpoints share a label, and cannot display a successful second capture.
- Six model mutants fail their named invariants. Seven actual-source mutants fail their intended native assertions. All twelve native scenarios pass before and after the temporary mutations, and production hashes remain unchanged.
- Store-only native witnesses check pressed and missed endpoints at 8, 44.1, and 48 kHz for source profiles 0, 4, and 5 on physical bank 0. They check exact retained length and period, silent sample output, missed-play silence, and later explicit launch of the immutable source. Additional paths retain another source in the same voice and preserve newly published autoplay under a replacing combined commit-and-arm.
- Strict TypeScript checking of the verifier, view, and runner passes. All three runner failure tests and `git diff --check` pass.

All pristine and mutated model outcomes were interpreted through the current `/statechart` command. Every rule is checked. The store-only mutation has a two-step shortest counterexample after the initial state: arm a capture, then incorrectly autoplay its store-only publication. The latest-bank mutation has three steps. Each other intended policy violation has two. Additional mutant consequences remain visible, including retained-bank completeness and conditional autoplay after a missing endpoint.

The newly added replacing combined witness exposed a product bug during implementation. Capture-start replacement stopped its own just-published outgoing take. The native fix excludes that outgoing take, and the unchanged autoplay expectation now passes. The initial sandbox socket failure was a harness restriction. Packet and source-fence updates were verification drift. These categories are recorded in [SOURCE-SYNC.md](SOURCE-SYNC.md).

This remains a bounded model safety result with selected real C++ witnesses and mutation sensitivity. It does not prove arbitrary audio arithmetic, source phase, finite playback duration, pitch bend, held release, per-note selection, external sample loading, physical timing, or exhaustive refinement of C++. The main bound and the original two-capture display bound were not reduced.

The source refresh from `8d9dd8b` to `7e3b3c1` changes playback gate ownership, practice-loop note availability, immutable source phase conversion, authored next-bar quantization, and packet group validation. The capture model, eleven invariant definitions, finite bounds, and all mutation controls are unchanged. The complete twelve-scenario native and seven-source-mutant rerun passes against the refreshed source hashes. These playback regressions require separate WASM execution checks and are not new claims of the finite capture proof.

The source refresh through `894915f` separates each take's effect profile from its physical bank, expands source rack ownership to six profiles with separate default and backup monitor routes, and adds stopped Tuning note preparation plus native WAV preparation and external controls. The capture model and all eleven invariant definitions remain unchanged. The existing tuner-isolation scenario and its gate-removal mutant still pass their positive and negative checks. The native store-only witness now directly exercises profiles 4 and 5 in addition to the default profile. The complete source-fenced suite passes again with six model mutants, seven source mutants, and twelve native scenarios before and after mutation.

Three focused real WASM regressions independently pass for same-bank source profile independence, sung-note Tuning capture and runtime isolation, and native WAV rate conversion with atomic malformed replacement rejection. Twelve focused canonical/source/asset tests also pass. Their owned Unix-socket acknowledgment test first hit sandbox `EPERM`; the reviewed retry passes. This was a harness permission restriction, not a product failure. These checks are selected integration evidence, not additions to the finite capture proof. Pitch stability arithmetic, WAV parsing, profile-specific DSP, and physical inputs remain outside the model.

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
