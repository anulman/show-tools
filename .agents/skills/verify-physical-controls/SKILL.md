---
name: verify-physical-controls
description: Verify six physical held-light identities, source-scoped release, four explicit LED mappings and release to sequenced baseline after native routing or delivery changes.
---

# Verify physical controls

Read `verification/physical-controls/README.md`. Run
`node --import tsx verification/physical-controls/verify.ts` from the repository
root. The command builds actual C++ and retains its JSON receipt and logs in a
unique temporary directory. It opens no hardware and changes no installed state.

Source sync is `eb994928dab680d594860152b65b677dc47d71d0`.
`verification/physical-controls/coverage.json` records 47 implementation, header,
build and fixture hashes. The runner checks those hashes before building and
audits compiler dependency records against the declared inputs.

The finite domain enumerates all 4,096 pairs of two six-bit held masks and their
source-scoped cleanup. All six sequenced-only baseline rows stay independent
under those held masks. It also enumerates 24,576 four-output images over held
and baseline IDs, two synthetic SDK maps, 24 map list orders and 256 four-level
assignments. A concrete capture witness checks pulse and playback restoration
and advancement of the baseline while held. Two new source mutants contaminate
the baseline with held brightness or suppress it during a hold. Existing native
input and cue-light fixtures run separately.

Require pristine success, ten exact assertion-specific real-source mutant
failures, restored success after every mutant, final pristine success and
unchanged original source. A compiler error or a different assertion is a
harness failure, not mutant evidence. Read every retained log if a stage fails.

For a source change, inspect the diff from the sync commit in every changed
covered file. Confirm whether the finite checks still describe the real C++
operations. Update the domain or witnesses when intentional behavior changes;
never weaken a property to make a bug pass. Refresh hashes and the source sync
only after review, then rerun the complete command including mutations. Use
`/maintain-formal-verification-skill` for drift accumulated across other work.

This check does not prove unbounded traces, lost-attach recovery, spinner
position/rates, real USB writes, electrical acceptance, atomic physical LED
updates, arbitrary real brightness or all-song practice readiness. The SDK maps
are synthetic and cannot substitute for operator-confirmed wiring.
