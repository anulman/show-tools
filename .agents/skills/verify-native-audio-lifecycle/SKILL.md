---
name: verify-native-audio-lifecycle
description: Verify native audio attempt ownership, cancellation, pending spawn cleanup and stale control/event fences when PersistentDesk or its scoped process boundaries change.
---

# Verify native audio lifecycle

Read `verification/native-audio/README.md`, `finding.md`, and `coverage.json` before changing the covered code. The operator's safety contract is that Terminate cannot be undone by delayed startup, a canceled/old attempt cannot publish controls or events into its replacement, and a requested but unresolved child cannot release ownership.

The finite TLA+ model covers two attempt identities and at most one issued command in total. It proves seven stated ownership invariants in that scope. A separate two-attempt, two-request configuration model checks seven additional rules for Off-only admission, exclusive preparation, revision equality and shutdown. Actual-controller replays and six deliberate source mutants provide selected conformance and sensitivity checks, not a complete refinement proof of TypeScript, Effect, or the operating system. Do not broaden the claim to physical silence, process groups, every device, duplicated gateway processes or eventual shutdown.

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

A successful proof run requires the complete unmodified model to pass, all six ownership broken variants and all eight configuration broken variants to violate their named invariants, each reported path to pass against the unmodified actual controller, and each corresponding actual-source mutant to fail its specific behavioral assertion. A model-only mutation is not implementation verification.

A missing tool, port/sandbox error, malformed model or timeout is a verification harness failure for Chief. It is not a product result. If a counterexample does not reproduce against actual code, investigate model mapping before reporting a product defect. Do not weaken the invariant to make it pass.

Pending spawn ownership must remain held even after failed scope cleanup or a launch that may have created no child. Only a Known handle with confirmed exit, or an attempt that never requested spawn, may release ownership. The conservative recovery tradeoff and the original failing witness are recorded in `finding.md`.

## Keep the proof in sync

The current coverage record is synced to integration commit `e9ecebb858dc580fb43717c3d3771d9c8c458858`. It names covered files and symbols and records exact hashes, including the tuner payload schema. Review every relevant change to `PersistentDesk.setAudio`, `stop`, `start`, `runAttempt`, `finished`, `observe`, `command`, `ChildOwnership`, the audio state schemas, or Effect process/scope behavior. The replay validates its synthetic tuner observation with the real schema. Tuner DSP, preview timing, and browser modal ownership remain outside this lifecycle model.

Map every changed await and ownership transfer to model actions. Preserve separate child acquisition and handle publication, and distinguish physical exit from asynchronous public-view updates. Review the synthetic process/transport assumptions and rerun the real-code witnesses. Only then advance the sync commit, source hashes and dependency version in `coverage.json` to the reviewed revision. Updating hashes alone does not repair model drift.

Use `/maintain-formal-verification-skill` after covered code changes without the corresponding verification. If operator intent changes, record the new plain-language promise and update the model, negative mutants and real-code replays together. Keep findings as findings until resolved.

The current maintenance reviewed optional validated input-routing observations. The lifecycle controller and modeled await/ownership boundaries remain unchanged; the binding schema and pure registries are source-pinned dependencies. This proof does not establish gateway/native producer allocation, input release barriers or Panic priority.

The controller now records exact-target, server-scoped engine retirement only after a known child confirms exit. This is derived after the modeled ownership-release condition; it does not weaken that condition. Native and controller revision domains are distinct. The model does not verify gateway intent ledgers, status capabilities or browser handoff. Their actual protocol/controller tests remain required.

The configuration work adds `PersistentDesk.configure`, `selectSong`, `configureSongBindings` and the configuration wait in `close`. Reserve the configuration promise before the first await. Admission requires no attempt, audio Off, an idle configuration slot, a current desk revision and no shutdown. Check closing again before synchronous commit and activation. Enable and another configuration must reject while preparation is pending. Close must wait for that preparation to settle.

Run `verify.ts` as above for both models and all source mutants. Read every ownership and configuration result through the current statechart tool. `SongConfiguration.tla` with `SongConfiguration.cfg` is the complete two-request model. `configuration-view.mjs` supplies the reader's labels. Preserve the old ownership model and its seven invariants when changing the configuration proof.

The supplemental native reservation is coarse and releases only after confirmed exit. This release assumption is tied to the separate ownership proof by source review and witnesses, not by a mechanical composition proof. Preparation and synchronous compare-and-swap outcomes are abstract boundaries. SQLite crash durability, ambiguous commit outcomes, canonical compilation, profile migration, helpers and physical devices remain outside this proof. The temporary authority in the replay does not turn those contracts into database proofs.
