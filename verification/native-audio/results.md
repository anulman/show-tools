# Initial checked result

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
