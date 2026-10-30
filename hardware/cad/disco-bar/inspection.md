# Darren's reference geometry

Inspection on 2026-10-29 used the existing pinned CAD environment. The STEP imports as one valid solid with 35 faces and volume 75,384.7502 mm³. Its declared length unit is millimetres.

The bounds are x and y ±47.2306651 mm, with z from -109.22 to 0 mm. The model contains cylindrical, conical, planar, and toroidal faces, with no spherical faces. An offline rendering shows a cylindrical shell, a rounded lower edge, top notches, and a central blind recess. The operator confirmed that the full bar reaches the top attachment and its outer width was precisely measured to fit the disco-ball opening. Preserve the original pose without inferring that source Z=0 is the ball's physical top.

The operator clarified the installed boundary in Scrawl `scrawl-1793325809287-20a-15`, frames 03–05 and 09–11: the complete cylinder sits inside the ball, and its root is approximately flush with the opening. No installed lateral tool access is available above that plane. The original channels carry debond fluid from below; they are not side tool ports. Preserve their exact original empty geometry without inventing a minimum flow width. The operator retained the need for rotation and the passive bearing surface.

The main cylindrical wall has outer radius 47.230665 mm and inner radius 45.643165 mm. Their difference is 1.5875 mm. The central recess has a cylindrical diameter of 44.35475 mm and a floor at z=-25.4 mm, with a bevel near z=0. These are source CAD dimensions rather than independent caliper measurements. The operator confirms that the existing pocket provides snug knob insertion. New variants preserve that known clearance; their clamp fit remains physically untested.

The STL's raw height is 4.3000002 units. Multiplying by 25.4 gives the STEP's height. The OBJ's raw height is 0.10922 units, requiring a factor of 1000 for the same comparison. These factors are hypotheses checked against the STEP, not unit declarations read from the meshes.

For each scaled mesh, the inspector sampled 128 vertices and 128 triangle centres and measured their distances to the STEP surface. STL distances had a maximum of 0.00921 mm and mean of 0.000950 mm. OBJ distances had a maximum of 0.02788 mm and mean of 0.00236 mm. This one-way sample check supports the scale mappings. It does not prove complete surface or topology equivalence.

Trimesh reports the STL as watertight and consistently wound. It reports the OBJ as consistently wound but not watertight. No mesh repair or manufacturing export was performed. Use STEP as the CAD reference and preserve its original pose.

The local inspection command accepts private paths without storing them in its receipt:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/disco_bar.py \
  --step "$SHOW_TOOLS_DISCO_STEP" \
  --stl "$SHOW_TOOLS_DISCO_STL" \
  --obj "$SHOW_TOOLS_DISCO_OBJ" \
  --output /private/tmp/disco-bar-inspection.json
```

Only `--step` or `SHOW_TOOLS_DISCO_STEP` is required. The optional receipt records asset hashes, source hash, geometry, and comparison limits. It contains no copied model or source path. Keep generated receipts outside tracked directories.

`preview(step_path=None)` returns `(objects, names, colors, alphas)` for the parent's coordinated publisher. It uses `SHOW_TOOLS_DISCO_STEP` when no path is supplied. The current scene contains the complete unchanged original at its source pose and four complete integrated variants at positive X display offsets. No default crop or explosion replaces any full bar.

The `--concepts DIRECTORY` command requires the original private STEP and exports only the active full-height variant print pieces. See [README.md](README.md). The old isolated carriers and Ø40 mm illustrative knob are retired. Neither the inspector nor exporter contacts the viewer or modifies attachments.
