# Prepare and publish the final review proposals

The Disco bar page shows the unchanged original, legacy references A and B, and the complete C proposal. C replaces the historical standalone T-pad cup study. The Box mount page replaces the old rotor shell and bottom with C's matching fixed base. The arcade and mushroom models keep their existing positions and roof/ground alignment.

The pages load checked STEP exports. They do not rebuild a different latch during publication. The registry binds the C and base receipts, their source files, and each displayed STEP/STL pair. Changed sources, changed files, failed geometry checks, and mismatched C/base receipts prevent publication. Imported components are normalized to sole solids before placement.

## Generate a fresh private export set

Commit the model sources first. Keep the original STEP outside Git. Generate into a fresh persistent directory; do not overwrite the export set currently used by the viewer.

```sh
mkdir -p hardware/cad/build/review-candidates
review_dir="$(mktemp -d "$PWD/hardware/cad/build/review-candidates/run.XXXXXX")"
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/disco-bar/check_final_c.py \
  --step "$SHOW_TOOLS_DISCO_STEP" --output "$review_dir/C"
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/final_base.py \
  --receipt "$review_dir/C/receipt.json" --source-worktree "$PWD" \
  --source-revision HEAD --output "$review_dir/box"
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_final_base.py \
  --receipt "$review_dir/C/receipt.json"
```

The C receipt distinguishes printable geometry, cut-stock padding, unselected fastener envelopes, the custom captive pin, and custom service tools. Tool and hardware exports are reference/fabrication proposals, not instructions to print every STL.

Use `review_components` for one locked assembly's part list. The state directories repeat the same components for verification. The operating and staging tool records also repeat poses of three tools; they are not additional physical tools.

## Select the checked pair in the CAD desk checkout

Use the checkout that runs the existing CAD desk. Its source files must match the receipts. Pass absolute receipt paths if the exports live in another checkout.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/final_review.py \
  --disco-report "$review_dir/C/receipt.json" --box-report "$review_dir/box/receipt.json"
```

This validates the inputs before atomically replacing `build/final-review/current.json`. It does not publish, start a service, or copy the original asset. The Box mount page then reads the fixed-base exports without opening the private original STEP.

Switch pages in the existing [CAD desk](http://127.0.0.1:3940/), or publish explicitly from that checkout:

```sh
hardware/cad/cad view box-mount --reset-camera
hardware/cad/cad view disco-bar --step "$SHOW_TOOLS_DISCO_STEP" --reset-camera
```

`--variant rotor-level` isolates the new fixed base. `--explode 25` lowers its cover and the other selected box bottoms. Arcade-only and mushroom-only views do not require the final-review registry. Publication keeps one selection snapshot through scene construction, geometry comparison and the final input check.

## Review the service workflow before manufacturing

C's proposed sequence uses a slotted driver, an under-head fork, and a two-pin spanner. The pin remains captive; routine bar removal does not change the padded-screw grip. The spanner bridge stays below the box. Complete straight tool insertion needs approximately 130 mm of free space; the matching base proposes a 140 mm lift. The earlier 15 mm result covered working probes only.

The fixed base has a top-side well for the device's existing stock hex, two compact keeper tabs, a separate buffer, closed-cover tool ports, and a proposed cable exit 25 degrees from the front. No additional device retaining nut is assumed. The shortened ballast pocket stays separated from the tool ports.

Read the [C operation and fabrication notes](disco-bar/final-C-proposal.md) and [matching base checks](box-mount/access/FINAL_BASE.md). Hardware selection, actual hex dimensions, knob engagement, printer/material choices, grip, adhesion, load capacity and service ergonomics remain unverified. Geometry review is not manufacturing approval.
