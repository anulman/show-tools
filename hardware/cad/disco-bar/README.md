# Disco bar screw-clamp studies

The Disco bar preview now shows three screw-clamp concepts side by side. Magnets are removed from the current design. The parent session owns the shared viewer and page publishing. This workstream owns this directory and `../disco_bar.py`.

| Concept | Mechanism | Proposed print parts |
| --- | --- | --- |
| A | Two screws pull a separate padded bridge toward a fixed padded saddle | Carrier and bridge |
| B | Two radial pressure screws move independent padded jaws inside guides | Carrier and two jaws |
| C | Two axial screws follow the original channel axes and lift a drawplate against tapered shoes | Upper carrier, drawplate, and two shoes |

Blue parts are proposed prints, orange parts are replaceable pad envelopes, and grey parts are hardware envelopes. The translucent knob is an illustrative Ø40 mm cylinder, not a measured part. All coordinates are millimetres. No concept is fit-ready.

The preview includes separately named crops of the upper 28 mm of Darren's reference, lowered 35 mm for display. These are context rather than mated assembly parts. C's fixed upper carrier has a display-only front cutaway to expose the shoes. Its export contains the complete carrier.

Run the headless geometry and export checks from the repository root:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/disco_bar.py \
  --concepts hardware/cad/build/disco-screw-clamps
```

The command exports nine proposed print parts as separate STEP and STL files in `a`, `b`, and `c` directories, plus `receipt.json`. Hardware, pads, and private reference geometry are not exported. The output directory is ignored by Git. STEP uses millimetres; STL coordinates must be interpreted as millimetres.

The checks validate each positive-volume solid, STEP round trips, and watertight, consistently wound STL meshes with matching volume. They also check assembled print and pad intersections, pad seats, hardware clearance through the prints, and the illustrative knob clearance. Sampled travel checks cover each moving plate or jaw against all fixed print parts. They do not establish print strength, material deformation, screw torque, friction, adhesive attachment, or physical fit.

See [design.md](design.md) for load paths and access, and [inspection.md](inspection.md) for private reference inspection. Original attachments remain read-only and local. No source asset is bundled here. The inventory's requirement for separate ball-weight support remains unresolved.
