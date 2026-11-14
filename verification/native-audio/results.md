# Initial checked result

## Consolidated practice release

Outcome: **in sync** at `cd3ae7e08c7a852b3d14766ffd9c9a6a1827aaa4`. All five covered source files, the lifecycle model, configurations, replay and dependency versions are byte-identical to `894915f`. The baseline run passed before this maintenance; a fresh rerun with the release revision in `coverage.json` also exhausts 1,761 states with all seven invariants. Six real controller-source mutants are rejected, including both pending-ownership paths. Scoped TypeScript and diff checks pass. Receipt: `/private/tmp/practice-tonight-lifecycle-final-cd3ae7e/receipt.json`.

No ownership promise changed and no lifecycle bug was found. The unchanged model bytes retain their previous complete statechart interpretation. New native periodic analysis, pickup display, static manager recovery, physical process/device behavior and sound quality are outside this proof.

The repaired source is synced to `09e5ecfbed4d37bd3ea595dc5c35ea9339ed15f0`; the exact source and dependency pins are in `coverage.json`. The pinned TLC release is 1.7.4, reporting TLC2 version 2.19, run with Temurin 25.0.5+8, Node 25.6.0 and Effect 4.0.6 on macOS ARM64. A fresh run records its actual versions and model/source hashes in its receipt.

The complete baseline search found 1,761 distinct reachable states and exhausted its queue with all seven invariants holding. It uses two distinct attempts and one issued command in total. It has no depth cutoff and makes no fairness or eventual-termination claim. This is a finite-model result with selected actual-code correspondence, not an unbounded implementation proof.

| Changed source guard | Model invariant exposed | Source replay |
| --- | --- | --- |
| Omit stop abort | `NoCanceledReady` | Unmodified path passes; changed source incorrectly republishes Ready. |
| Omit known-handle exit hold | `OneOwnedChild` | Unmodified path passes; changed source releases an alive child. |
| Omit command completion fence | `NoStaleApplied` | Unmodified path passes; changed source reports old completion Applied. |
| Omit observer admission fence | `NoStaleEvent` | Unmodified path passes; changed source publishes a canceled observer event. |
| Omit pending-ownership hold | `UnknownOwnershipHeld` | Failed launch with no returned handle releases the attempt. |
| Publish a wrong Ready identity | `ReadyIdentity` | Unmodified path passes; changed source replaces the reserved attempt identity. |
| Same pending-ownership mutant, second path | `OneOwnedChild` | Failed launch after child acquisition releases a live unreported child. |

Every listed model path was replayed against the actual controller and the corresponding temporary changed source. The checker requires the expected behavioral assertion, not an arbitrary thrown error. Twelve ordinary controller regressions, the package TypeScript check, the repository TypeScript check and the project-skill validator passed. The source files remained unchanged during proof runs.

The original unassigned-child finding led to a production safety correction. The conservative behavior is intentionally sticky after an ambiguous launch: the operator must recover the managed service before enabling another attempt. Pre-request failures and known-handle confirmed exit remain recoverable. Read [the finding and resolution](finding.md) for the reproduced before/after sequence.

The current `/statechart` skill interpreted the full baseline and all six mutant models. The full baseline exceeds the skill's 500-state drawing budget, so it has a rule report rather than a full chart. [The illustrative chart](illustration.mmd) uses `Chart.cfg` with one attempt: 86 model states map to seven displayed states and twelve arrows. It hides 174 within-label steps. That image is not a substitute for the two-attempt proof.

The ownership mutant produces two distinct shortest failures, four steps without a known child and five with a live acquired child. The other shortest failures have seven steps for cancellation or known cleanup, nine for an old command result, eight for an old observer event, and six for a wrong Ready identity. Their full logs and changed source copies are regenerated in the proof command's fresh output directory; raw process evidence is not committed.

No actual audio device, native application process, live service, browser, Figma file, deployment or managed-service restart was used. The verifier itself runs local Java/esbuild tooling. Physical process cleanup, all process-group behavior, duplicated controllers and unconditional shutdown remain outside the claim.

## Current-schema maintenance

Outcome: updated from source fix `7e70234` to integration `09e5ecf`. The old checker correctly rejected the changed session schema before running a model. Reviewed the covered controller (byte-identical), session schema, native schema and gateway changes from PR #113. The new required light publication is payload data, not a new lifecycle await or ownership transition. The cue-button control variant and selection index similarly leave this model's contract unchanged. The replay now supplies the canonical test light fixture, and coverage additionally pins the native schema and light ABI. The seven invariants and bounds are unchanged; the six real-source mutants still challenge the same behavioral promises. This was verification fixture drift, not a new product defect. Light rendering, knob semantics and musical selection correctness remain outside the lifecycle claim.

## Shared-tuner maintenance

Outcome: updated at `9b51479061fa48fbfffb8271541c1cf475a7e101`. Reviewed every covered-source change since `09e5ecf`, including tuner implementation `c158856` and the integration of merged controller fix #120. The controller, light ABI, and locked Effect dependencies are byte-identical to that sync. Both observation schemas now require a validated tuner payload. No ownership action, await, admission fence, or public attempt identity changed, so the model and its seven properties retain their bounds and wording.

The baseline correctly failed on schema source drift. The replay now supplies a native C3 major observation and validates it with `TunerStateSchema` before running any schedule; coverage pins that schema too. An initial one-target synthetic payload was rejected by the real schema and prevented Ready, which was verification-fixture drift, not a controller bug. The validated eight-target fixture removes that mismatch without changing the production schema or lifecycle contract.

The complete pristine graph again has 1,761 states. All six real-source mutants fail their intended assertions, including both pending-ownership paths; all corresponding pristine schedules pass. Every model result and the smaller illustration were interpreted through the current statechart skill with no unchecked rules. Production source remained unchanged. Tuner command payload semantics, native utility audio pumping, physical audio, and browser modal attachment are not established by this ownership proof.

## Pad-release maintenance

Outcome: updated at `4f4e5579e7bee222acc976acbd95823ad7148454`. The previous source fence correctly rejected the changed native event schema. Reviewed all five covered files against `9b514790`; only the pad release control shape changed. The controller, Effect dependencies and ownership transitions remain unchanged, so this update preserves the model and all seven invariant definitions.

The first actual-controller replay then exposed a product integration failure. Package admission required packet 7 even though the compatibility encoder intentionally preserved packet 6 for legacy-default songs. It failed before a lifecycle schedule could prepare its fixture. Product commit `4f4e557` accepts the two declared packet versions after exact byte re-encoding validation. This was a package-version bug, not a lifecycle counterexample or permission to weaken the replay fixture.

The repaired full run exhausts the same 1,761-state pristine graph. Six actual controller-source mutants fail their named assertions, including both pending-ownership counterexample paths, and all pristine schedules pass. The current statechart skill independently interpreted the baseline, all six mutation variants and the 86-state illustration with no unchecked rules. The main model remains over the 500-state chart budget. It has a complete rule report; the smaller illustration still shows seven labels and twelve arrows.

The final receipt is regenerated in a fresh output directory by the documented verifier. It records the new sync revision and exact controller/model/replay hashes. Physical key-up latency, native held playback, package format completeness, external sample triggering and audio devices remain outside this ownership proof.

## External-sample maintenance

Outcome: updated at `894915fd154c07529d08c79182cafe46cc9191ef`. The source fence again rejected the changed native control schema. Its only new variant is the bounded external sample slot. The lifecycle controller, session schema, light ABI and tuner schema remain byte-identical to the previous check. Reviewed the asset upload loop in `prepareInstalledPackage`; every upload is awaited within the existing attempt-owned preparation promise, before the unchanged stopped-readback and identity/cancellation fences. The helper checks cancellation before every operation, and retains its existing abort listener and final cleanup. This is an intentional validated-input extension, not a changed ownership promise.

The fresh full verifier exhausts the same 1,761-state graph with all seven invariants. All six actual-controller source mutants are rejected at their named assertions, including both pending-ownership paths. The model, configuration, replay implementation and bounds remain unchanged; the prior complete statechart interpretation therefore still describes these identical model bytes. Scoped TypeScript and diff checks pass. The final receipt is `/private/tmp/native-cues-lifecycle-final-894915f/receipt.json`.

The controller replay substitutes package preparation. This proof does not establish native sample decoding, per-asset upload cancellation, old-engine sample ownership, note preparation, physical phone input or musical triggering. Those remain separate integration and native playback claims.
