# Darren's reference geometry

Inspection on 2026-10-29 used the existing pinned CAD environment. The STEP imports as one valid solid with 35 faces and volume 75,384.7502 mm³. Its declared length unit is millimetres.

The bounds are x and y ±47.2306651 mm, with z from -109.22 to 0 mm. The model contains cylindrical, conical, planar, and toroidal faces, with no spherical faces. An offline rendering shows a cylindrical shell, a rounded lower edge, top notches, and a central blind recess. The operator must confirm what this reference represents within the disco-ball assembly.

The main cylindrical wall has outer radius 47.230665 mm and inner radius 45.643165 mm. Their difference is 1.5875 mm. The central recess has a cylindrical diameter of 44.35475 mm and a floor at z=-25.4 mm, with a bevel near z=0. These are CAD dimensions, not caliper measurements or a confirmed SpinTrak fit.

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

`preview(step_path=None)` returns `(objects, names, colors, alphas)` for the parent's coordinated publisher. It uses `SHOW_TOOLS_DISCO_STEP` when no path is supplied. The current preview includes three screw-clamp studies and a separately labelled reference crop lowered 35 mm for display. Importing the module or running the inspection CLI does not contact the viewer or modify attachments. The separate `--concepts DIRECTORY` command exports only proposed print parts, as described in [README.md](README.md).
