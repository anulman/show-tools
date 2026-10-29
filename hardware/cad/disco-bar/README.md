# Disco bar shortlist for Darren

The operator renamed the former C screw clamp to **A**, and the former B′ grip-latch study to **B**. The page keeps those geometries as references. Their internal legacy identifiers are unchanged so presentation renaming cannot alter their motion checks.

The new C task separates two joints: a baseplate grips the knob with padded set screws, adjusted while the bar is removed; the complete bar then latches onto and off that baseplate without changing the grip setting. Three C1/C2/C3 attachment prototypes must be checked before a final C is synthesized. Release access at the roughly flush mounting box is still awaiting an operator decision. The old latch-to-pad-actuation models do not satisfy this new topology.

The current page shows three complete bars side by side: the unchanged original, A's axial screw clamp, and B's prior knob-grip latch concept. The earlier discarded bridge/jaw designs, A′, and D are omitted and are not constructed by the page. A is blue, B is teal, pads are orange, and hardware envelopes are grey. B remains a static locked-state review model with unverified holding and installed access. See [the latch review status](latch-review.md). This comparison is for review, not manufacturing approval.

All four source-derived screw studies remain in the generator for explicit headless selection. Every variant retains the original long hollow body, top-attachment end, measured insertion width, and known-snug released socket. Only display copies move sideways. The original remains opaque and in its source pose. Variant bodies are translucent so their internal clamps remain visible.

| Variant | Mechanism | Geometry-check exports |
| --- | --- | --- |
| A, formerly C | Inboard axial screws lift a drawframe against two tapered shoes | Complete bar, drawframe, and two shoes |
| B, formerly B′ | Lift-and-turn collar retains an axial draw yoke on fixed shoulders | Static review only; excluded |

All units are millimetres. The original socket is the operator-confirmed snug baseline. Actual knob dimensions are not independently measured. The new clamps are CAD prototypes awaiting physical tests.

Run the full geometry/export checks with the private STEP path:

```sh
hardware/cad/cad disco-check --step "$SHOW_TOOLS_DISCO_STEP" \
  --concepts hardware/cad/build/disco-full-height
```

The command exports reference A's four proposed print pieces as STEP and STL into a legacy `c` directory. The receipt records the new display name, both model-source hashes, and the reference asset hash. Pads, hardware, and the unchanged original are not exported. Full-bar derivatives remain local in the ignored build directory. STL coordinates must be interpreted as millimetres. Use a fresh output directory when preparing a handoff so retired variants are not mixed with these exports.

B is excluded from this export set. Its source is in `latches.py`, and the publisher records its hash separately. Only its current locked pose is displayed; no operating animation or release is verified. The earlier Darren review pack uses the former names and topology; a new handoff follows the detachable-baseplate validation.

The active generators and checks are in [full_height.py](full_height.py). The entrypoint remains `../disco_bar.py`. The old short carriers and Ø40 mm illustrative knob are retired; their source remains in Git history.

The checks cover the original and actual preview pieces, full body preservation outside explicit edit masks, source pocket clearance, screw/tool envelopes, sampled clamp travel, connected fixed bodies, STEP Boolean round trips, and watertight STL meshes. They do not prove physical assembly access, elastic deformation, print strength, screw torque, or support loads. See [design.md](design.md) for the mechanisms and limits.

The parent session owns viewer/page publishing. This workstream owns this directory and `../disco_bar.py`. Original attachments remain read-only and private.
