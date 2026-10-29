# Disco bar review for Darren

Historical review, superseded by the detachable-baseplate task. This document and its associated ZIP use the former names C and B′, now A and B. Their latch-to-pad actuation does not implement the new requirement: padded set screws grip a knob-side baseplate, and a separate latch attaches/releases the full bar. Retain this record for provenance; the next handoff follows C1/C2/C3 validation and final C synthesis.

The comparison contains three complete bars: the unchanged original, C's screw-driven clamp, and B′'s latch concept. A′ and D are excluded from this review.

All three retain the original 109.22 mm reach and nominal 94.46133 mm insertion profile. The original pocket is the operator-confirmed snug baseline: Ø44.35475 mm, with its entry bevel and blind stop at 25.4 mm depth. Clamp changes are local to the knob end. The original long hollow body and far attachment end remain intact.

| Model | Purpose | Readiness |
| --- | --- | --- |
| Original | Reference for the measured opening fit, reach, and existing socket | Unmodified source geometry |
| C | Axial screws lift a drawframe against two tapered, padded shoes | Four print pieces have CAD/export and sampled-motion checks. Installed access and physical performance remain unverified. |
| B′ | A pull-and-quarter-turn collar retains the drawframe on a ledge; a separate axial key blocks reverse rotation | Static concept in its nominal locked pose. Holding, complete release/capture behavior, and installed access are unverified. It is not approved for manufacture. |

Support contact is print-on-print, not wood. No thrust washer, material pair, finish, friction coefficient, or preload has been selected. The approximately flush box interface may obstruct the current operating surfaces. The installed box/encoder/knob stack must be resolved before either clamp is selected.

Darren's review can settle these decisions:

- Can C's screws be reached for assembly, adjustment, and removal in the installed stack?
- Where could B′'s collar and safety key be operated without interference from the box or knob?
- Which local supports, pad pockets, and retaining features are practical to print and assemble?
- Does the print-on-print support need a replaceable thrust washer or a different contact finish?

C is the simpler mechanism baseline for discussion. B′ is the latch direction to critique. Neither is ready for a functional print. Physical trials must establish insertion, pad grip, slip/lift resistance, release, wear, and the ball's support path.

C's four print pieces can be exported locally through `cad disco-check` with the private STEP. B′ is excluded from manufacturing exports. The review renders show CAD geometry, not tested hardware. Original assets and derived geometry remain private.

An additional SpinTrak mounting nut above the box is being considered. The [manufacturer drawing](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/images/1/spintrakdiag.gif) shows a 28 mm body but does not specify the thread pitch. Obtain an identical nut and thread designation from [Ultimarc](https://www.ultimarc.com/contactus/), or gauge the actual thread before sourcing a generic nut. Confirm nut thickness, usable threaded length, and the resulting bar seating height before changing the stack.
