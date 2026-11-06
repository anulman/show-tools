---
name: verify-native-audio-lifecycle
description: Verify native audio attempt ownership, cancellation, pending spawn cleanup and stale control/event fences when PersistentDesk or its scoped process boundaries change.
---

# Verify native audio lifecycle

Read `verification/native-audio/README.md`, `finding.md`, and `coverage.json` before changing the covered code. The operator's safety contract is that Terminate cannot be undone by delayed startup, a canceled/old attempt cannot publish controls or events into its replacement, and a requested but unresolved child cannot release ownership.

The finite TLA+ model covers two attempt identities and at most one issued command in total. It proves seven stated safety invariants in that scope. Actual-controller replays and six deliberate source mutants provide selected conformance and sensitivity checks, not a complete refinement proof of TypeScript, Effect, or the operating system. Do not broaden the claim to physical silence, process groups, every device, duplicated gateway processes or eventual shutdown.

## Run the check

Use the pinned toolchain from `verification/tools/README.md`, set `JAVA` and `TLA2TOOLS`, and install the checkout's locked dependencies. From the repository root run:

```sh
node --import tsx verification/native-audio/verify.ts
node_modules/.bin/tsc --project verification/native-audio
node --import tsx --test lib/remote-performance/tests/controller-ownership.test.ts
```

The first command creates a fresh temporary directory and prints its receipt path. It rejects source drift, an unpinned checker, incomplete searches, unrelated mutation failures and changes to production source. Keep the receipt and full failing logs with active work. Do not commit generated bundles or raw run directories.

Read every TLA+ result with the current p-stack `/statechart` skill. Follow its current instructions; do not copy an installed command or path into this skill or repository scripts. Use the package's `view.mjs`. `NativeAudio.cfg` is the two-attempt proof domain. `Chart.cfg` is a smaller one-attempt illustration; never substitute its pass for the full model.

## Interpret a result

A successful proof run requires the complete unmodified model to pass, all six broken variants to violate their named invariants, each reported path to pass against the unmodified actual controller, and each corresponding actual-source mutant to fail its specific behavioral assertion. A model-only mutation is not implementation verification.

A missing tool, port/sandbox error, malformed model or timeout is a verification harness failure for Chief. It is not a product result. If a counterexample does not reproduce against actual code, investigate model mapping before reporting a product defect. Do not weaken the invariant to make it pass.

Pending spawn ownership must remain held even after failed scope cleanup or a launch that may have created no child. Only a Known handle with confirmed exit, or an attempt that never requested spawn, may release ownership. The conservative recovery tradeoff and the original failing witness are recorded in `finding.md`.

## Keep the proof in sync

The current coverage record is synced to the real fix commit `7e702341cc484193b3df6186f2eaca5371aed400`. It names covered files and symbols and records exact hashes. Review every relevant change to `PersistentDesk.setAudio`, `stop`, `start`, `runAttempt`, `finished`, `observe`, `command`, `ChildOwnership`, the audio state schemas, or Effect process/scope behavior.

Map every changed await and ownership transfer to model actions. Preserve separate child acquisition and handle publication, and distinguish physical exit from asynchronous public-view updates. Review the synthetic process/transport assumptions and rerun the real-code witnesses. Only then advance the sync commit, source hashes and dependency version in `coverage.json` to the reviewed revision. Updating hashes alone does not repair model drift.

Use `/maintain-formal-verification-skill` after covered code changes without the corresponding verification. If operator intent changes, record the new plain-language promise and update the model, negative mutants and real-code replays together. Keep findings as findings until resolved.
