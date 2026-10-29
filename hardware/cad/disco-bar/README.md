# Full-height disco bar clamp comparison

The Disco bar page shows the complete unchanged original, C, D, and static locked-state A′ and B′ latch studies. A and B are omitted and are not constructed by the page. Only axial access is available, so D is a historical comparison. A′ is visibly labelled with its release collision; both latch studies have unresolved access at the roughly flush box interface. See [the latch review status](latch-review.md). Their display is not operating or manufacturing approval.

All four source-derived screw studies remain in the generator for explicit headless selection. Every variant retains the original long hollow body, top-attachment end, measured insertion width, and known-snug released socket. Only display copies move sideways. The original remains opaque and in its source pose. Variant bodies are translucent so their internal clamps remain visible.

| Variant | Mechanism | Exported print pieces |
| --- | --- | --- |
| A | Removable bridge pulled toward a fixed padded saddle | Complete bar and bridge |
| B | Two independent screw-driven padded jaws | Complete bar and two jaws |
| C | Inboard axial screws lift a drawframe against two tapered shoes | Complete bar, drawframe, and two shoes |
| D | A's bridge retained in integral side guides | Complete bar and captured bridge |

Blue pieces are proposed prints, orange pieces are pad envelopes, and grey pieces are screw/nut envelopes. All units are millimetres. The original socket is the operator-confirmed snug baseline. Actual knob dimensions are not independently measured. The new clamps are CAD prototypes awaiting physical tests.

Run the full geometry/export checks with the private STEP path:

```sh
hardware/cad/cad disco-check --step "$SHOW_TOOLS_DISCO_STEP" \
  --concepts hardware/cad/build/disco-full-height
```

The command exports six selected proposed print pieces as STEP and STL into `c` and `d` directories. It writes `receipt.json` with both model-source hashes and the reference asset hash. Pads, hardware, and the unchanged original are not exported. Full-bar derivatives remain local in the ignored build directory. STL coordinates must be interpreted as millimetres.

The A′ and B′ review studies are excluded from this export set. Their source is in `latches.py`, and the publisher records its hash separately. Only their current locked poses are displayed; no operating animation or release is verified.

The active generators and checks are in [full_height.py](full_height.py). The entrypoint remains `../disco_bar.py`. The old short carriers and Ø40 mm illustrative knob are retired; their source remains in Git history.

The checks cover the original and actual preview pieces, full body preservation outside explicit edit masks, source pocket clearance, screw/tool envelopes, sampled clamp travel, connected fixed bodies, STEP Boolean round trips, and watertight STL meshes. They do not prove physical assembly access, elastic deformation, print strength, screw torque, or support loads. See [design.md](design.md) for the mechanisms and limits.

The parent session owns viewer/page publishing. This workstream owns this directory and `../disco_bar.py`. Original attachments remain read-only and private.
