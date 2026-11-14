# Verify capture handoffs

The operator needs capture policy changes to be explicit rather than discovered during a performance. This package model-checks a finite capture/bank state machine and checks corresponding policies against the actual C++ implementation. It changes no musical engine code.

## Run the check

Use the pinned runtime and TLC jar described in [the toolchain guide](../tools/README.md). Set `JAVA` and `TLA2TOOLS` to their absolute paths. Use Node 22.18 or later with TypeScript stripping, and a C++17 compiler.

```sh
node verification/capture/verify.ts
```

By default, the command creates a fresh owned temporary output directory and reports its receipt path. To retain a result at a chosen location, pass `--out /absolute/path/to/new-result`; that directory must be new. `CXX` can name a compiler executable. The command checks the TLC checksum and Temurin version, verifies source hashes, exhausts the model, rejects six model mutants, builds a narrow native witness host, rejects seven actual-source mutants, reruns the pristine witnesses, and writes `receipt.json`. Mutants are separate temporary files; production sources are never rewritten. No device, service, browser, or live audio is opened. TLC needs permission for its internal localhost coordination socket.

A missing dependency, changed source mapping, wrong tool version, unfinished state queue, surviving mutant, or unrelated assertion failure rejects the run. No success receipt is written for a partial run. Logs and generated counterexamples remain in the chosen result directory.

## Rules the operator can review

- There is at most one active recording, and it never records into the latest retained bank.
- A published take is complete and its capture generation is published at most once.
- A rejected combined commit-and-arm preserves its outgoing recording. Independent incoming admission is a different policy: its failure does not undo a valid standalone outgoing commit.
- An invalid outgoing draft cannot create a slot that admits a dependent incoming recording.
- A successful autoplay commit starts playback. A store-only commit publishes the completed source without starting its playback. At an evaluated authored endpoint, a valid outgoing recording completes under its declared launch policy even when the finish press was missed or the incoming capture is unavailable.
- Stop discards an incomplete draft and preserves the latest retained take. Current C++ also retains a complete valid draft on Stop, without continuing playback. That separate transition is intentional.

These are existing code promises, not a blanket rule that every failure rolls back every change. Resource failures may stop the operation before or after cache publication. `FaultBeforePublication` and `FaultAfterPublication` preserve that distinction; the conditional autoplay and store-only claims concern successful publication, not fatal failure recovery.

## Model boundary

`CaptureHandoff.tla` checks three take identities, two banks per take, and at most three capture beginnings. It explores the complete finite reachable graph, without a TLC `CONSTRAINT` pruning successor states. Once the last beginning is used, final commit, failed combined admission, automatic completion without another start, Stop, and failure cleanup remain enabled. A fourth successful recording is outside the stated bound.

Each capture carries an explicit `autoplay` or `store-only` launch policy chosen when that modeled capture begins. The policy describes the authored outgoing commit, not the physical arm button. Store-only publication leaves existing playback unchanged and never launches the newly published bank.

The model treats a whole `press` or `apply_pending` boundary as one serialized owner-thread transaction. It does not let an external button press interleave inside C++ instructions. Incoming readiness abstracts the bank/revision/anchor/phase preflight result. A failed readiness result requires no candidate bank, so an entirely unavailable target is represented. Successful readiness chooses a nonlatest, nonplaying bank. Numerical period and selection validation are explicit valid/invalid inputs to the boundary action, not proofs of the arithmetic.

Combined handoff targets differ from their outgoing take because `Program::create` rejects equal `cue.take` and `cue.commit`. Independent same-boundary handoffs also use distinct authored takes: each take has one arm at its strictly earlier begin and one commit at its end. Actual loop-wrap draft cancellation and retention have a separate native witness. The finite model does not represent wrap-specific playback continuity; its Stop action must not stand in for that transition.

This is a safety proof of the model under these abstractions. It does not establish exhaustive refinement of every model trace to C++, floating-point timing, rack fidelity, effect-history ownership, allocation failure behavior, physical latency, or unrestricted liveness. The automatic endpoint rule is conditional on evaluating that boundary. Actual native clock witnesses additionally check that evaluation in selected real compiled programs at 8, 44.1, and 48 kHz. No fairness assumption makes a stopped or stalled clock advance.

## Source mapping and sensitivity

The last source sync is `8d9dd8b12ce696e75565aaf4ff7d4970a8e30c52`. [source-record.json](source-record.json) contains exact hashes. If covered source changes, inspect model drift before moving that sync record forward.

| Model action or rule | Current source boundary |
| --- | --- |
| Begin and protected bank selection | `Program::available_bank`, `Program::press` / `press_current` through `press_selected`, `Program::execute` in `lib/performance/src/compiled_program.cpp`. |
| Combined admission before any outgoing change | `Program::press` admission guard and `Program::execute` preflight ordering. |
| Standalone/automatic release before incoming start | `Program::apply_pending` staged preflight and two passes. |
| Complete publication and declared launch policy | `Program::preflight_commit` and `Program::finish_capture`; `ProcessedTake::commit` and `Playback::start_at_capture_end` / `start_window_at_capture_end` in `lib/patches/src/patch_engine.cpp`. |
| Stop and draft discard | `Program::stop` and `Program::discard_invalid_draft`. The wrap branch in `Program::beat` has a separate native witness. |
| Real native witness entry | `pf_control`, `pf_process_stems`, take/channel readback, and existing `compiled_program_tests.cpp` fixtures. |

The model mutants and actual-source mutants represent the same broken policy. The native witnesses concretize those policies using real compiled fixtures and PCM assertions; they are not an exhaustive C++ trace equivalence proof.

| Deliberate broken policy | TLC rule that fails | Actual C++ witness |
| --- | --- | --- |
| Discard outgoing capture when combined incoming-bank admission rejects | `CombinedRejectPreservesDraft` | `crb_unavailable_start_preserves_old_capture`. |
| Admit an incoming recording after an invalid outgoing release | `InvalidReleaseCannotAdmit` | `failed_period_blocks_same_boundary_start`. |
| Allow recapture into the latest retained bank | `CaptureBankNotLatest` | `stopped_partial_capture_preserves_latest`. |
| Change autoplay publication into store-only publication | `SuccessfulPublicationAutoplays` | `capture_layers_and_boundaries`. |
| Change store-only publication into autoplay | `StoreOnlyPublicationDoesNotLaunch` | `store_only_endpoint`. |
| Skip authored automatic completion | `AutomaticEndpointCompletes` | `authored_capture_end_finishes_without_finish_press`. |

The native host also checks independent failed admission, full selection preflight, both button orders, complete-draft Stop without playback, repeated Stop idempotence, and loop-wrap retention. Current-source additions check unified cue-button ordering and independent outcomes, and automatic publication of a final-bar slice across three captures into reusable protected banks. Slice readback retains the full immutable parent and reports the playing selection; these finite witnesses do not prove arbitrary slice arithmetic or rack checkpoint fidelity. All checks use the actual engine and patch sources. A first attempted execute-only admission mutant survived because the public `press` guard rejected it earlier. It was not credited; the final mutation changes the reachable admission boundary itself.

The eleventh native scenario, `tuner-isolation`, uses the shared engine to start a scale preview and listening, then Start and record. It checks that Start clears tuning, reference playback rejects during capture, tuner Close/Silence preserve the draft, and automatic completion retains the expected microphone PCM. A separate native-only actual-source mutant removes the running-transport tuner gate and must fail the reference-rejection assertion. This is selected native integration evidence, separate from the six formal-model mutants. The runner links and pins the actual tuner sources. Pitch accuracy, preview timing, stopped utility pumping, and browser/remote modal lifecycle are outside this model.

## Read the statechart

Read every model result with the current `/statechart` skill. Follow its installed guidance rather than a copied command or path. The full model exceeds that skill's complete-chart budget. [CaptureHandoff-chart.cfg](CaptureHandoff-chart.cfg) preserves the separately complete two-take, two-beginning display bound. Explicit launch policies now put that graph above the chart budget too. [CaptureHandoff-overview.cfg](CaptureHandoff-overview.cfg) checks a separate two-take, one-beginning overview with the same invariants. Neither smaller check substitutes for the main proof.

[statechart.mmd](statechart.mmd) is the readable successful one-capture overview graph. It cannot show a successful incoming capture after publication because that requires a second beginning. Labels distinguish playing retained takes, stopped retained takes, rejected handoffs, and failures. The view also gives each broken policy a distinct visible state rather than merging it into an ordinary Ready state. The chart omits transitions whose source and target share a label. No temporal promise is inferred from those omitted self-transitions.

The last verified run is summarized in [RESULTS.md](RESULTS.md). The source-change classification is in [SOURCE-SYNC.md](SOURCE-SYNC.md).

Use `/maintain-formal-verification-skill` after source changes that did not rerun this package. An intended policy change updates the contract, model, witnesses, and source record together. A counterexample remains a finding until it replays against the real implementation; never weaken a rule to silence it.

## Store-only capture coverage

`store-only-endpoint` checks actual `pf_process_stems` execution at 8, 44.1, and 48 kHz. Each rate checks a pressed store and a missed store. Both retain the complete source and period at the written endpoint while sample output stays silent. A separate declared nonreplacement capture in the same voice retains another playing source without silencing it or adding a second loop. A replacing combined commit-and-arm also keeps its just-published outgoing source playing, preserving the ordinary `cr` autoplay promise. Missing the later manual play also stays silent. Pressing that later play launches the same retained source without changing its length or revision.

The paired `storeAutoplays` model and native mutants replace store-only publication with autoplay and must fail the dedicated store-only rule or native assertion. The existing `noAutoplay` pair remains separate. Its actual-source mutation changes the outgoing launch policy rather than deleting individual start calls, so both full-take and slice launch paths remain covered when their implementation moves.

This extends capture publication verification. Finite playback duration, source phase, grouped action resolution, held release, bend mapping, per-note selection, and external sample preparation need their own execution witnesses. These behaviors are not established by the capture state machine.
