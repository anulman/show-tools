---
name: verify-physical-controls
description: Verify six physical held-light identities, source-scoped release, four explicit LED mappings and release to sequenced baseline after native routing or delivery changes.
---

# Verify physical controls

Read `verification/physical-controls/README.md`. Run
`node --import tsx verification/physical-controls/verify.ts` from the repository
root. The command builds actual C++ and retains its JSON receipt and logs in a
unique temporary directory. It opens no hardware and changes no installed state.

Source sync is `5edc12a4d6a23f1b19f9e1fcb5265da8fe66d74d`.
`verification/physical-controls/coverage.json` records 47 implementation, header,
build and fixture hashes. The runner checks those hashes before building and
audits compiler dependency records against the declared inputs.

The finite domain enumerates all 4,096 pairs of two six-bit held masks and their
source-scoped cleanup. It also enumerates 12,288 four-output images from two
synthetic SDK maps, 24 map list orders and 256 four-level assignments. A concrete
identified-control capture witness checks recording-pulse and playback-baseline
restoration. Existing native input and cue-light fixtures run separately.

Require pristine success, eight exact assertion-specific real-source mutant
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
