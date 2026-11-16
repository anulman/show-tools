# Verify performance contracts

These packages make selected performance promises executable and reviewable. Changing the instrument's intended behavior requires reviewing the corresponding contract, model or grammar, and real-code witnesses together. A failing assertion must not be weakened merely to produce a pass.

| Package | Promise | Verification kind |
| --- | --- | --- |
| [Native audio lifecycle](native-audio/README.md) | Canceled startup cannot publish Ready; obsolete callbacks and controls cannot affect a replacement; cleanup confirmation gates replacement. | Bounded TLA+ state-machine checking, actual-controller witnesses, and deliberate source mutations. |
| [Capture handoff](capture/README.md) | Capture publication and admission preserve valid drafts and retained takes, including manual and automatic endpoint paths. | Bounded TLA+ state-machine checking, actual C++ witnesses, and deliberate source mutations. |
| [MusicXML semantics](musicxml/README.md) | Canonical round trips preserve executable meaning and voices; optional archives do not change meaning; displayed cues agree with actions. | Exhaustive finite grammar through the actual TypeScript implementation, with deliberate source mutations. |
| [Physical controls](physical-controls/README.md) | Six identified held states remain independent and four explicit LED mappings preserve brightness and complete-frame delivery. | Bounded exhaustive replay through actual C++ with assertion-specific source mutations. |
| [Terse cues](cues/README.md) | The declared terse notation preserves its deterministic action meaning. | Bounded actual-parser enumeration and source mutations. |

## Run the checks

Install the repository's locked Node dependencies. Prepare the pinned [formal tools](tools/README.md) and set `JAVA` and `TLA2TOOLS` for the two model packages. Run the checks sequentially:

```sh
npm run verify:formal
node --import tsx verification/physical-controls/verify.ts
```

Run one package with `npm run verify:formal:native`, `npm run verify:formal:capture`, or `npm run verify:formal:musicxml`. These explicit checks are separate from the default test suite. They open no microphone, ALSA device, physical peripheral, or live application service. TLC may require permission for its internal local socket. Each package uses its own temporary outputs and preserves production source.

Read each package's complete output. Source drift, an incomplete checker search, a surviving mutant, a different failure from the expected behavioral assertion, or failure to restore the pristine witness is not a pass. Generated reports and checker state belong outside Git.

## Review a changed intent

The project-local `verify-native-audio-lifecycle`, `verify-capture-handoff`, `verify-musicxml-semantics`, and `verify-physical-controls` skills describe the covered source, last synchronization record, commands, and failure interpretation. `/maintain-formal-verification-skill` helps reconcile later source changes.

Read the plain-language promise before updating a model. Distinguish a product defect from an inaccurate abstraction, a changed contract, or a missing verification dependency. Keep observed implementation behavior separate from newly proposed behavior. Report a genuine product counterexample with a replay against real code. Hold only dependent work and never waive a valid product invariant through harness recovery.

For each TLA+ result, use the current `/statechart` skill to inspect reachable states and short failure paths in the operator's terms. A deliberately smaller chart configuration illustrates only its own scope; it does not replace the full model run.

## Interpret the claims

A complete TLC search proves the stated invariants for its finite abstract model under its assumptions. The source mapping and real-code witnesses test that the abstraction guards relevant implementation paths. They do not constitute a formal refinement proof of every implementation trace.

The MusicXML checker proves its assertions by enumerating its complete declared finite grammar through real code. It does not prove arbitrary XML, every notation, or unbounded scores. No package proves physical audio behavior, latency, all DSP arithmetic, deployment correctness, arbitrary failures, or unbounded liveness. Package documentation states additional exclusions and exact bounds.

## Initial verified result

The initial combined run checks source synchronized at `09e5ecfbed4d37bd3ea595dc5c35ea9339ed15f0`. It includes the reviewed main changes from PRs 113 and 118. Source hashes in each package detect later drift.

- Native lifecycle exhausts 1,761 states with seven invariants. Six actual-source mutants are caught across seven counterexample paths. Twelve ordinary controller regressions protect the source-level cleanup correction.
- Capture exhausts 4,904 states with ten invariants. Ten actual native scenarios and five source mutants check the mapping. Its smaller 362-state display model is separate from the full bound.
- MusicXML checks 624 score inputs and 7,488 canonical cases, including 312 action-identity pairs and 3,744 equivalent 6/8 tempo cases. Both actual-source mutants are caught. The finite grammar includes two stop-command forms and does not cover every capture, slice, reuse, continuation, or Jiggle notation.

The lifecycle work found and corrected a fault-injected acquired-but-unreported child ownership gap. An ambiguous launch now retains Stopping instead of claiming Off and accepting a replacement. Read the [finding and correction](native-audio/finding.md). This does not establish physical device cleanup or authorize automatic recovery.
