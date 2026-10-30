# Prepare and publish the final review proposals

The selected publication candidates are the dual-exit inclined arcade box, compact spinner base and unchanged C2 bar/baseplate. Box mount shows the two selected bases. Disco bar shows Darren’s unchanged original bar and the C2 bar/baseplate side by side, both upright on the same root plane, without boxes. Historical comparisons, the uncut mushroom blank, optional uninstalled shim and isolated fit coupons stay out of these scenes. Existing data remains intact.

Select the checked receipts in the CAD desk checkout:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/comparison_review.py \
  --collar /absolute/path/to/review-candidates/4903640/C2/receipt.json \
  --rotor /absolute/path/to/compact-mount-v4/receipt.json \
  --arcade /absolute/path/to/arcade-dual-exit-v4/receipt.json \
  --presentation candidates
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/check_candidate_review.py --step /absolute/reference.step
```

The selection pins exact reviewed receipt hashes, verifies displayed STEP/STL pairs, rechecks the base inputs and generating sources, and verifies the collar's immutable source revision. Existing page switches load the selected candidates without restarting services. Staging saves the previous selection under ignored `build/comparison-review/prior-selections/`; no source models or frozen export sets are deleted. Candidate-only publication bypasses the historical final-review selection. This permits human review, not fabrication release or verified physical fit.

The arcade proposal includes low/front and raised high/back cable exits. The rotor base uses a 5 mm stand-off, or 7 mm with its optional 2 mm shim. See [the dual-exit checks](box-mount/access/ARCADE_DUAL_EXIT.md) and [compact mount checks](box-mount/access/COMPACT_MOUNT.md).

## Historical proposal generation and comparisons

The following instructions describe the earlier proposals and remain available for recovery. They are not the current publication selection.

The Disco bar page shows only the unchanged original and the complete C proposal. A and B remain historical source studies and are absent from this focused review. The Box mount page replaces the old rotor shell and bottom with C's matching fixed base. The arcade and mushroom models keep their existing positions and roof/ground alignment.

The pages load checked STEP exports. Source-owned inventories require every named component and role, and independent source factories verify each loaded component's material geometry. The registry binds the C and base receipts, the exact required source files, the original reference and each displayed STEP/STL pair. Changed sources, changed files, missing parts, substituted geometry, failed checks and mismatched receipts prevent publication. Imported components are normalized to sole solids before placement.

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
  --disco-report "$review_dir/C/receipt.json" --box-report "$review_dir/box/receipt.json" \
  --step "$SHOW_TOOLS_DISCO_STEP"
```

This validates the inputs before atomically replacing `build/final-review/current.json`. It does not publish, start a service, or copy the original asset. The original's location is kept only in the local ignored registry. The Box mount page verifies fixed-base exports against its STEP-independent source factory without opening that original; the Disco bar page verifies C against the pinned original.

Switch pages in the existing [CAD desk](http://127.0.0.1:3940/), or publish explicitly from that checkout:

```sh
hardware/cad/cad view box-mount --reset-camera
hardware/cad/cad view disco-bar --step "$SHOW_TOOLS_DISCO_STEP" --reset-camera
```

`--variant rotor-level` isolates the new fixed base. `--explode 25` lowers its cover and the other selected box bottoms. Arcade-only and mushroom-only views do not require the final-review registry. Publication keeps one selection snapshot through scene construction, geometry comparison and the final input check.

## Review the service workflow before manufacturing

Follow [Attach and release final C](disco-bar/final-C-operating-guide.md) for the operating steps and the command that creates the short MP4 and GIF guide. Routine attachment turns the separate collar and locks its captive pin. The assembly screws and knob-grip screws stay fitted.

C's proposed sequence uses a slotted driver, an under-head fork, and a two-pin spanner. The pin remains captive; routine bar removal does not change the padded-screw grip. The spanner bridge stays below the box. Complete straight tool insertion needs approximately 130 mm of free space; the matching base proposes a 140 mm lift. The earlier 15 mm result covered working probes only.

The fixed base has a top-side well for the device's existing stock hex, two compact keeper tabs, a separate buffer, closed-cover tool ports, and a proposed cable exit 25 degrees from the front. No additional device retaining nut is assumed. The shortened ballast pocket stays separated from the tool ports.

Read the [C operation and fabrication notes](disco-bar/final-C-proposal.md) and [matching base checks](box-mount/access/FINAL_BASE.md). Hardware selection, actual hex dimensions, knob engagement, printer/material choices, grip, adhesion, load capacity and service ergonomics remain unverified. Geometry review is not manufacturing approval.


## Package one of each design as STL

Export only the inclined arcade variant into a fresh directory with `box_mount.py --variant arcade-inclined --output PATH`. Then run `package_stl_handoff.py` with the checked C/base registry and original STEP:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/package_stl_handoff.py \
  --arcade-receipt /absolute/path/to/arcade/receipt.json \
  --arcade-sha ARCADE_RECEIPT_SHA256 \
  --registry /absolute/path/to/build/final-review/current.json \
  --step "$SHOW_TOOLS_DISCO_STEP" --revision MODEL_SOURCE_COMMIT \
  --output /absolute/path/to/new/STL-handoff
```

The command requires a new output directory. The output directory includes 14 proposed print parts, the unchanged original bar as a separate alternative, three custom fabrication proposals, three material envelopes, and one ordinary-driver clearance reference. The ZIP contains only the 18 fabrication STL files. The README, manifest, material envelopes, and ordinary-driver reference stay outside it. Repeated validation poses and purchased fastener envelopes are excluded. The README and manifest separate the print list, custom fabrication list, and buy/cut/reuse list, including quantities and unselected specifications. Each exported file has a hash, bounds, volume, and boundary-shell count. The command validates both the files and their archived copies. `model_checkout_revision` identifies the model-source checkout; `packager_sha256` identifies the packaging script separately.

Darren's original is one CAD solid with a sealed internal cavity and two boundary shells. The export preserves both shells. Its internal roof needs slicer review; the packager does not fill the cavity or change the design. Geometry validation does not establish physical fit or manufacturing approval.

See the separate [prototype shopping and bench-tool guide](STL_SHOPPING.md) for supplier links, fastener quantities, ordinary screwdriver candidates, and the remaining custom fork/spanner access requirements.

Before ordering a full set, use the [fabrication review](FABRICATION_REVIEW.md). It records the unresolved standard hardware, real component fits, resin cavity/tolerance issues, cable anchorage, and physical load tests, together with exact prototype material products.
