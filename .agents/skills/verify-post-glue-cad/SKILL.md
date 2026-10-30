---
name: verify-post-glue-cad
description: Verify CAD coupling assembly and service changes after the bare bar is permanently glued inside the disco ball; use whenever coupling actors, assembly steps, access or publication change.
---

The operator must be able to install and remove every coupling component after the bare printed bar is glued inside the ball. Hidden pre-glue nuts, receivers or caps violate this requirement even if routine ball removal works.

Run `python3 hardware/cad/verification/check_lifecycle.py`. This exhaustively checks a finite transition system, using Python's standard library, and exercises negative controls. It requires no install. Fixture results verify the checker only; they do not verify a CAD design.

For an actual design, construct the full actor inventory from its actual exported components. Include every loose printed part, purchased nut, screw, pad and knob; the glued bar is immutable environment. Every actor starts outside the ball. Assembly outside the ball after glue is permitted, provided the whole removable module fits through the root. Encode outside-module assembly states as finite variables; actor location stays outside until inserted. Represent each independently checked motion with guards, effects, a standard tool and its frozen geometry evidence. All actions must model the real generator/staging functions. Call `verify_evidence(model, frozen_bundle)` after independently regenerating the geometry checks.

The verifier enumerates every reachable model state (maximum 100,000, otherwise fails). It requires a complete assembled state and proves every reachable state has a path back to all actors outside the bare glued bar. It rejects above-root side access and custom tools. It emits assembly/removal witness traces and the model digest. This proves the stated transition system, not real-world mechanics or the correctness of a receipt's geometric claims.

Geometry evidence must separately establish continuous insertion/removal motion, ordinary-tool staging and operation, purchased hardware clearance, complete part inventory, the original snug socket, full bar height/profile, source debond passages and unlimited assembled rotation. Rotation requires an axisymmetric containment proof, not angular samples. Bind all evidence to source revisions and exported file digests. A positive boolean alone is insufficient evidence.

Before declaring verification ready, mutate a real candidate's protocol to assume a preinstalled receiver, remove its unlock action and change a tool to above-root side access. Each must fail. Restore and rerun. Keep physical strength, resin tolerance, friction, adhesive compatibility and actual fit explicitly unverified until measured.

Coverage: `hardware/cad/verification/post_glue_lifecycle.py::verify` and `verify_evidence`; negative controls in `check_lifecycle.py`. Initial synchronization base is commit `76d8d48` (withdrawal gate); candidate bindings are pending and must be recorded with their exact frozen commit before any design claims PASS. Move this record forward only after confirming the model matches the changed CAD and rerunning the real-candidate mutations.
