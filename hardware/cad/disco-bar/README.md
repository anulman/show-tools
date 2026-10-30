# Disco bar shortlist for Darren

**Fabrication hold:** do not print the modified C2 collar/bar from the previous handoff. A fresh audit found added material in both original debond passage voids. The existing files stay unchanged for comparison. A replacement must preserve both original voids, move interfering carrier hardware clear, and pass structural, latch, tool and box checks before review. See the [canonical interface facts](../fabrication/interface-facts.json) and [installed boundary](inspection.md). This hold concerns the modified collar proposal; Darren’s unchanged original remains an optional reference under the existing fabricator-review policy.

The operator renamed the former C screw clamp to **A**, and the former B′ grip-latch study to **B**. Those geometries remain historical source references; the focused page omits both. Their internal legacy identifiers are unchanged so presentation renaming cannot alter their motion checks.

The new C task separates two joints: a baseplate grips the knob with padded set screws, adjusted while the bar is removed; the complete bar then latches onto and off that baseplate without changing the grip setting. Three C1/C2/C3 attachment prototypes must be checked before a final C is synthesized. The operator permits added collar spacing and underside release access through the fixed mounting box. Installed dimensions and physical fit remain unresolved. See the [two-joint plan](two-joint-plan.md) and [prototype review criteria](latch-review-contract.md). The old latch-to-pad-actuation models do not satisfy this new topology.

The historical [C1–C3 comparison](C123-findings.md) records the original functional failures. The complete [C proposal](final-C-proposal.md) uses the collar architecture, a corrected flange, a captive pin and actual service-tool engagement. Its matching base permits lifted underside service. Use the [review preparation guide](../FINAL_REVIEW.md) to stage the checked exports for publication.

The page shows two complete bars: the unchanged original and C's checked review proposal. C replaces the obsolete standalone cup study. The earlier discarded bridge/jaw designs, A′, and D are omitted. The source pose and full bar reach remain intact. B remains a static locked-state reference with unverified holding and access. C's service sequence is checked in geometry; physical fit and manufacturing remain unverified.

All four source-derived screw studies remain in the generator for explicit headless selection. Every variant retains the original long hollow body, top-attachment end, measured insertion width, and known-snug released socket. Only display copies move sideways. The original remains opaque and in its source pose. Variant bodies are translucent so their internal clamps remain visible.

| Variant | Mechanism | Geometry-check exports |
| --- | --- | --- |
| A, formerly C | Inboard axial screws lift a drawframe against two tapered shoes | Complete bar, drawframe, and two shoes |
| B, formerly B′ | Lift-and-turn collar retains an axial draw yoke on fixed shoulders | Static review only; excluded |

All units are millimetres. The original socket is the operator-confirmed snug baseline. Actual knob dimensions are not independently measured. The new clamps are CAD prototypes awaiting physical tests.

The following command checks and exports legacy reference A, not the new C:

```sh
hardware/cad/cad disco-check --step "$SHOW_TOOLS_DISCO_STEP" \
  --concepts hardware/cad/build/disco-full-height
```

The command exports reference A's four proposed print pieces as STEP and STL into a legacy `c` directory. The receipt records the new display name, both model-source hashes, and the reference asset hash. Pads, hardware, and the unchanged original are not exported. Full-bar derivatives remain local in the ignored build directory. STL coordinates must be interpreted as millimetres. Use a fresh output directory when preparing a handoff so retired variants are not mixed with these exports.

B is excluded from this export set. Its source is in `latches.py`, and the publisher records its hash separately. Only its current locked pose is displayed; no operating animation or release is verified. The earlier Darren review pack uses the former names and topology; a new handoff follows the detachable-baseplate validation.

Legacy generators remain in [full_height.py](full_height.py). New C uses [final_c.py](final_c.py) and [check_final_c.py](check_final_c.py). The entrypoint remains `../disco_bar.py`. The old short carriers and Ø40 mm illustrative knob are retired; their source remains in Git history.

The checks cover the original and actual preview pieces, full body preservation outside explicit edit masks, source pocket clearance, screw/tool envelopes, sampled clamp travel, connected fixed bodies, STEP Boolean round trips, and watertight STL meshes. They do not prove physical assembly access, elastic deformation, print strength, screw torque, or support loads. See [design.md](design.md) for the mechanisms and limits.

The parent session owns viewer/page publishing. This workstream owns this directory and `../disco_bar.py`. Original attachments remain read-only and private.
