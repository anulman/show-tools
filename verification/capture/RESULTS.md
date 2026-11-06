# Capture verification result

Verified against source sync `679a8f35ddaba418f4d4286094c3f98a9f62386d`, with the unchanged mapped source files checked by SHA-256. This is a bounded model safety result with actual C++ witness/mutation sensitivity. It is not an unrestricted implementation or DSP proof.

The reproducible command is `node verification/capture/verify.ts` after provisioning the pinned `JAVA` and `TLA2TOOLS` environment paths. Logs and the full machine receipt are generated outside Git.

- Full model: 3 takes, 2 banks each, at most 3 capture beginnings. TLC generated 42,863 states, found 4,904 distinct states, and exhausted its queue. All ten configured invariants passed.
- Smaller display model: 2 takes and at most 2 beginnings. TLC generated 1,825 states, found 362 distinct states, and exhausted its queue. The same invariants passed. The current `/statechart` output draws 7 user-visible states and 23 arrows; it omits 382 self-label transitions.
- All 10 actual C++ scenarios passed. Five actual-source mutants failed at their intended policy assertions. The pristine executable passed all 10 scenarios again afterward. Production source hashes remained unchanged.
- All five model mutants produced their named invariant failures. Their shortest counterexamples have two steps after the initial state, except latest-bank overwrite, which has three. Every result was read through `/statechart`.
- Three public CLI negative tests passed. Strict TypeScript checking and the project skill validator passed.

The rejected-arm path is: arm a recording, reject its combined incoming target, and incorrectly lose the outgoing recording. The real C++ mutant produces the corresponding unavailable-CRB assertion failure. An earlier mutation only inside `execute` survived because public admission blocked it earlier; that version was discarded rather than counted as evidence.

The invalid-release path is: arm a recording, fail its outgoing validation, and incorrectly start an incoming recording. The real C++ mutant fails the source-cue/status assertion. The other counterexamples expose recording over a retained bank, missing autoplay, and missing authored endpoint completion.

The finite model does not prove clock advancement, numeric boundary conversion, arbitrary effect state, physical timing, or exhaustive trace equivalence with C++. Successful endpoint publication is conditional on evaluating the modeled endpoint. Selected actual native witnesses check missed-finish delivery at 8, 44.1, and 48 kHz. Stop-complete behavior has a direct real `Program` witness so adapter endpoint evaluation cannot conceal that distinct transition.
