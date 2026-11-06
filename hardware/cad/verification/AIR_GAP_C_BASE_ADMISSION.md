# Verify the air-gap C assembly

Generate the new base with the isolated CAD Python environment:

```sh
python hardware/cad/box-mount/access/air_gap_c_mount.py \
  --reference-base /private/tmp/c-mount-no-ballast-fused-v3/verification/receipt.json \
  --output /absolute/path/to/fresh-air-gap-base
```

Combine its receipt with the coupling owner's frozen serial-key admission:

```sh
python hardware/cad/verification/air_gap_c_base_admission.py \
  --base-receipt /absolute/path/to/fresh-air-gap-base/verification/receipt.json \
  --coupling-admission /private/tmp/airgap-c-final-admission-v1/admission.json \
  --output /absolute/path/to/fresh-air-gap-assembly
```

The combined proof checks all five coupling stages at both 5 and 7 mm bar-root
heights. It verifies continuous rotation, positive distance from the rotation
envelope to every fixed obstacle, complete root tools, recovery travel, module
withdrawal, grip adjustment, bounded race recovery, and bottom-panel service.
Actual STEP fingerprints must remain unchanged throughout those operations.

Panel changes require both keys out and the ball either off the module or fully
clamped. A hand-supported ball cannot share a closed-panel state. The exact
58-state, 156-transition product retains all 35 coupling states and every removal
path. An independent Cartesian graph and transitive-closure oracle checks the
result. Removing the hand guard exposes both entered and turned counterexamples.

The default bar root is 5 mm above the roof. Its required nominal
hex-to-knob-underside setting is 5.25 mm. The optional checked 7 mm placement
uses the existing adjustment, with no printed adapter.

The conservative rotation envelope has a minimum distance of
0.254771339934117 mm to the keeper corners. Its minimum distance to the shell is
0.5 mm. These bounds describe the checked CAD envelope. They are separate from
the 5 mm bar-root-to-roof distance and do not certify actual resin fit.

`load(path)` returns `base`, `candidate`, `lifecycle`, `panel_lifecycle`,
`placement`, and `base_reference_components`. The last field supplies twelve
standard fastener solids and the existing nominal stock hex model for the
viewer. Those thirteen references are excluded from the print inventory.

Run the geometry and edited-receipt controls:

```sh
python hardware/cad/box-mount/access/check_air_gap_c_mount.py \
  --reference-base /private/tmp/c-mount-no-ballast-fused-v3/verification/receipt.json \
  --receipt /absolute/path/to/fresh-air-gap-base/verification/receipt.json
python hardware/cad/verification/check_air_gap_c_base_admission.py \
  --admission /absolute/path/to/fresh-air-gap-assembly/admission.json
```

The geometry controls reject restored support, reopened support holes, and a
missing keeper. The receipt controls rewrite the proof and its configuration
hash, then require rejection of failed or incomplete geometry results, invalid
physical claims, old bearing protocols, and missing viewer references.

The box has no passive bearing, PTFE, support fasteners, or height cap. The
operator holds the ball with one hand during serial AF3 and AF4 key exchange.
The spinner and knob carry the ball's load during use. Their physical load
capacity, grip, handling, and fit remain unverified.
