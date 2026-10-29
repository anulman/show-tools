# Full disco bar and historical clamp studies

The Disco bar preview shows the complete, unmodified original STEP in its original pose. The operator confirmed that the full 109.22 mm height reaches the top attachment and that the outer width was precisely measured to fit the disco ball's opening. Preserve the complete insertion profile, cross-sections, and attachment geometry in future revisions. Matching the bounding box alone is insufficient.

The three isolated clamp studies below are historical mechanism studies, not approved replacements for the bar. Their short carriers omitted the functional full height, and B and C extend beyond the original outer profile. They remain available through headless exports only. The parent session owns the shared viewer and page publishing. This workstream owns this directory and `../disco_bar.py`.

| Concept | Mechanism | Proposed print parts |
| --- | --- | --- |
| A | Two screws pull a separate padded bridge toward a fixed padded saddle | Carrier and bridge |
| B | Two radial pressure screws move independent padded jaws inside guides | Carrier and two jaws |
| C | Two axial screws follow the original channel axes and lift a drawplate against tapered shoes | Upper carrier, drawplate, and two shoes |

In the historical studies, blue parts are proposed prints, orange parts are replaceable pad envelopes, and grey parts are hardware envelopes. The knob is an illustrative Ø40 mm cylinder, not a measured part. All coordinates are millimetres. No concept is fit-ready.

The rejected preview cropped the original bar to 28 mm and displaced it for display. The restored default preview performs neither operation and shows no replacement carrier. Its source hash, bounds, and volume are checked against the original asset. Run the regression check with the private STEP path:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/disco-bar/check_full_bar.py --step "$SHOW_TOOLS_DISCO_STEP"
```

The check also rejects the historical crop, display offset, and replacement assembly scene. This protects the restoration; it does not approve future fitted modifications or establish mechanical performance.

Run the headless geometry and export checks from the repository root:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/disco_bar.py \
  --concepts hardware/cad/build/disco-screw-clamps
```

The command exports nine proposed print parts as separate STEP and STL files in `a`, `b`, and `c` directories, plus `receipt.json`. Hardware, pads, and private reference geometry are not exported. The output directory is ignored by Git. STEP uses millimetres; STL coordinates must be interpreted as millimetres.

The checks validate each positive-volume solid, STEP round trips, and watertight, consistently wound STL meshes with matching volume. They also check assembled print and pad intersections, pad seats, hardware clearance through the prints, and the illustrative knob clearance. Sampled travel checks cover each moving plate or jaw against all fixed print parts. They do not establish print strength, material deformation, screw torque, friction, adhesive attachment, or physical fit.

See [design.md](design.md) for load paths and access, and [inspection.md](inspection.md) for private reference inspection. Original attachments remain read-only and local. No source asset is bundled here. The inventory's requirement for separate ball-weight support remains unresolved.
