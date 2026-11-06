# Verify capture handoffs

The operator needs capture policy changes to be explicit rather than discovered during a performance. This package model-checks a finite capture/bank state machine and checks corresponding policies against the actual C++ implementation. It changes no musical engine code.

## Run the check

Use the pinned runtime and TLC jar described in [the toolchain guide](../tools/README.md). Set `JAVA` and `TLA2TOOLS` to their absolute paths. Use Node 22.18 or later with TypeScript stripping, and a C++17 compiler.

```sh
node verification/capture/verify.ts
```

By default, the command creates a fresh owned temporary output directory and reports its receipt path. To retain a result at a chosen location, pass `--out /absolute/path/to/new-result`; that directory must be new. `CXX` can name a compiler executable. The command checks the TLC checksum and Temurin version, verifies source hashes, exhausts the model, rejects five model mutants, builds a narrow native witness host, rejects five actual-source mutants, reruns the pristine witnesses, and writes `receipt.json`. Mutants are separate temporary files; production sources are never rewritten. No device, service, browser, or live audio is opened. TLC needs permission for its internal localhost coordination socket.

A missing dependency, changed source mapping, wrong tool version, unfinished state queue, surviving mutant, or unrelated assertion failure rejects the run. No success receipt is written for a partial run. Logs and generated counterexamples remain in the chosen result directory.

## Rules the operator can review

- There is at most one active recording, and it never records into the latest retained bank.
- A published take is complete and its capture generation is published at most once.
- A rejected combined commit-and-arm preserves its outgoing recording. Independent incoming admission is a different policy: its failure does not undo a valid standalone outgoing commit.
- An invalid outgoing draft cannot create a slot that admits a dependent incoming recording.
- Successful commit starts playback. At an evaluated authored endpoint, a valid outgoing recording completes even when the finish press was missed or the incoming capture is unavailable.
- Stop discards an incomplete draft and preserves the latest retained take. Current C++ also retains a complete valid draft on Stop, without continuing playback. That separate transition is intentional.

These are existing code promises, not a blanket rule that every failure rolls back every change. Resource failures may stop the operation before or after cache publication. `FaultBeforePublication` and `FaultAfterPublication` preserve that distinction; the autoplay claim concerns successful publication, not fatal failure recovery.

## Model boundary

`CaptureHandoff.tla` checks three take identities, two banks per take, and at most three capture beginnings. It explores the complete finite reachable graph, without a TLC `CONSTRAINT` pruning successor states. Once the last beginning is used, final commit, failed combined admission, automatic completion without another start, Stop, and failure cleanup remain enabled. A fourth successful recording is outside the stated bound.

The model treats a whole `press` or `apply_pending` boundary as one serialized owner-thread transaction. It does not let an external button press interleave inside C++ instructions. Incoming readiness abstracts the bank/revision/anchor/phase preflight result. A failed readiness result requires no candidate bank, so an entirely unavailable target is represented. Successful readiness chooses a nonlatest, nonplaying bank. Numerical period and selection validation are explicit valid/invalid inputs to the boundary action, not proofs of the arithmetic.

Combined handoff targets differ from their outgoing take because `Program::create` rejects equal `cue.take` and `cue.commit`. Independent same-boundary handoffs also use distinct authored takes: each take has one arm at its strictly earlier begin and one commit at its end. Actual loop-wrap draft cancellation and retention have a separate native witness. The finite model does not represent wrap-specific playback continuity; its Stop action must not stand in for that transition.

This is a safety proof of the model under these abstractions. It does not establish exhaustive refinement of every model trace to C++, floating-point timing, rack fidelity, effect-history ownership, allocation failure behavior, physical latency, or unrestricted liveness. The automatic endpoint rule is conditional on evaluating that boundary. Actual native clock witnesses additionally check that evaluation in selected real compiled programs at 8, 44.1, and 48 kHz. No fairness assumption makes a stopped or stalled clock advance.

## Source mapping and sensitivity

The last source sync is `09e5ecfbed4d37bd3ea595dc5c35ea9339ed15f0`. [source-record.json](source-record.json) contains exact hashes. If covered source changes, inspect model drift before moving that sync record forward.

| Model action or rule | Current source boundary |
| --- | --- |
| Begin and protected bank selection | `Program::available_bank`, `Program::press` / `press_current` through `press_selected`, `Program::execute` in `lib/performance/src/compiled_program.cpp`. |
| Combined admission before any outgoing change | `Program::press` admission guard and `Program::execute` preflight ordering. |
| Standalone/automatic release before incoming start | `Program::apply_pending` staged preflight and two passes. |
| Complete publication and autoplay | `Program::preflight_commit` and `Program::finish_capture`; `ProcessedTake::commit` and `Playback::start_at_capture_end` / `start_window_at_capture_end` in `lib/patches/src/patch_engine.cpp`. |
| Stop and draft discard | `Program::stop` and `Program::discard_invalid_draft`. The wrap branch in `Program::beat` has a separate native witness. |
| Real native witness entry | `pf_control`, `pf_process_stems`, take/channel readback, and existing `compiled_program_tests.cpp` fixtures. |

The model mutants and actual-source mutants represent the same broken policy. The native witnesses concretize those policies using real compiled fixtures and PCM assertions; they are not an exhaustive C++ trace equivalence proof.

| Deliberate broken policy | TLC rule that fails | Actual C++ witness |
| --- | --- | --- |
| Discard outgoing capture when combined incoming-bank admission rejects | `CombinedRejectPreservesDraft` | `crb_unavailable_start_preserves_old_capture`. |
| Admit an incoming recording after an invalid outgoing release | `InvalidReleaseCannotAdmit` | `failed_period_blocks_same_boundary_start`. |
| Allow recapture into the latest retained bank | `CaptureBankNotLatest` | `stopped_partial_capture_preserves_latest`. |
| Omit both initial playback start and selection playback | `SuccessfulPublicationAutoplays` | `capture_layers_and_boundaries`. |
| Skip authored automatic completion | `AutomaticEndpointCompletes` | `authored_capture_end_finishes_without_finish_press`. |

The native host also checks independent failed admission, full selection preflight, both button orders, complete-draft Stop without playback, repeated Stop idempotence, and loop-wrap retention. Current-source additions check unified cue-button ordering and independent outcomes, and automatic publication of a final-bar slice across three captures into reusable protected banks. Slice readback retains the full immutable parent and reports the playing selection; these finite witnesses do not prove arbitrary slice arithmetic or rack checkpoint fidelity. All checks use the actual engine and patch sources. A first attempted execute-only admission mutant survived because the public `press` guard rejected it earlier. It was not credited; the final mutation changes the reachable admission boundary itself.

## Read the statechart

Read every model result with the current `/statechart` skill. Follow its installed guidance rather than a copied command or path. The full model exceeds that skill's complete-chart budget. [CaptureHandoff-chart.cfg](CaptureHandoff-chart.cfg) is a separately complete two-take, two-beginning display model using the same invariants; it is not a substitute for the larger check.

[statechart.mmd](statechart.mmd) is the readable successful display graph. Labels distinguish playing retained takes, stopped retained takes, rejected handoffs, and failures. The view also gives each broken policy a distinct visible state rather than merging it into an ordinary Ready state. The chart omits transitions whose source and target share a label. No temporal promise is inferred from those omitted self-transitions.

The last verified run is summarized in [RESULTS.md](RESULTS.md). The source-change classification is in [SOURCE-SYNC.md](SOURCE-SYNC.md).

Use `/maintain-formal-verification-skill` after source changes that did not rerun this package. An intended policy change updates the contract, model, witnesses, and source record together. A counterexample remains a finding until it replays against the real implementation; never weaken a rule to silence it.
